import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { ADAPTER_ID, ADAPTER_MH, defaultLimits } from '@tourney/adapter-ut99';
import {
  udtEntrantId,
  udtManagerOf,
  type TournamentEvent,
  type TournamentSettings,
} from '@tourney/protocol';
import {
  brokenRecord,
  challengeMinutes,
  challengePot,
  DEFAULT_ECONOMY,
  hardnessOfSkill,
  isWindowStart,
  leagueClashDays,
  managerEffects,
  MH_HARDNESS,
  MH_RUN_MIN,
  MH_TEAM_SIZE,
  PER_EVENING,
  gameChance,
  seriesChance,
  stakeCap,
  stakeProblem,
  weekdayOf,
  windowStarts,
  type ChallengeMode,
  type MhHardness,
} from '@tourney/udt';
import { z } from 'zod';
import { AgentsService } from '../agents/agents.service.js';
import { UsersService, type User } from '../auth/users.service.js';
import { ServerActivity } from '../common/activity.js';
import { badRequest, conflict, forbidden, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { CLOCK, CONFIG, type ApiClock, type ApiConfig } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { neuroLedger, tournaments, udtChallenges, udtEntries, udtRoster } from '../db/schema.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { NotificationsService, type ChallengeNote } from '../notify/notifications.service.js';
import { nextDay, today, zonedMs } from '../seasons/season-time.js';
import {
  SettingsService,
  type ChallengeSettings,
  type UdtSettings,
} from '../settings/settings.service.js';
import type { CalendarTournament, Reservation } from '../tournaments/server-calendar.js';
import { estimateMs } from '../tournaments/server-calendar.js';
import { StatsService } from '../stats/stats.service.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import {
  TournamentsService,
  UdtEventRulesSchema,
  type TournamentRow,
} from '../tournaments/tournaments.service.js';
import { UdtEventsService } from './udt-events.service.js';
import { estimateEvening, UdtLeagueService } from './udt-league.service.js';
import { UdtService } from './udt.service.js';

const DAY = 86_400_000;
const MIN = 60_000;
/** Discord reminds both managers this long before the lock (decision 339). */
const REMIND_MIN = 30;

const Size = z.union([z.literal(1), z.literal(3), z.literal(5)]);

/** A challenge (or a counter offer: `to` is then the other side of the challenge answered). */
const ChallengeFields = z.object({
  /** The challenged manager; null: an open challenge (`open` says for whom). */
  to: z.string().min(1).max(40).nullable().default(null),
  open: z.enum(['all', 'tier']).optional(),
  mode: z.enum(['dm', 'mh']).default('dm'),
  teamSize: Size.default(5),
  bestOf: Size.default(1),
  /** A map of the pool; null: the vote. */
  map: z.string().trim().min(1).max(64).nullable().default(null),
  hardness: z.enum(['normal', 'hard', 'nightmare']).optional(),
  stake: z.number().int().min(0).max(100_000_000).default(0),
  /** The start (an instant from the slots). */
  at: z.iso.datetime(),
  message: z.string().trim().max(120).optional(),
});
export const ChallengeBody = ChallengeFields.refine(
  (b) => b.to !== null || !!b.open,
  'an open challenge needs a scope',
);
export type ChallengeInput = z.infer<typeof ChallengeBody>;
/** A counter offer: the same fields; it always goes back to the challenger. */
export const CounterBody = ChallengeFields;

export const OpponentsQuery = z.object({
  mode: z.enum(['dm', 'mh']).default('dm'),
  teamSize: z.coerce.number().int().min(1).max(5).default(5),
});

export const SlotsQuery = z.object({
  mode: z.enum(['dm', 'mh']).default('dm'),
  bestOf: z.coerce.number().int().min(1).max(5).default(1),
  opponent: z.string().min(1).max(40).optional(),
  days: z.coerce.number().int().min(1).max(14).default(7),
});
export type SlotsInput = z.infer<typeof SlotsQuery>;

/** A rematch: the same challenge the other way round, only the start is new. */
export const RematchBody = z.object({
  at: z.iso.datetime(),
  message: z.string().trim().max(120).optional(),
});
export type RematchInput = z.infer<typeof RematchBody>;

type Row = typeof udtChallenges.$inferSelect;
export type ChallengeRow = Row;
/** What a challenge's game depends on (its format). */
export type ChallengeFormat = Pick<Row, 'mode' | 'teamSize' | 'bestOf' | 'map' | 'hardness'>;
type Status =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'expired'
  | 'countered'
  | 'void'
  | 'locked'
  | 'played';

/** Challenges that keep their start and server (and count for the team's day). */
const ACTIVE: Status[] = ['pending', 'accepted', 'locked'];
/** Challenges that count for the pair limit. */
const COUNTED: Status[] = ['pending', 'accepted', 'locked', 'played'];
/** Counter offers per chain: the challenge and two answers. */
export const MAX_ROUNDS = 3;

/** Why a start cannot be booked: no server, the own team or the opponent plays, too late. */
export type SlotState = 'free' | 'full' | 'mine' | 'opponent' | 'closed';

interface DayContext {
  date: string;
  servers: string[];
  /** Reservations (league evening, other challenges) per server over the day's window. */
  reserved: Map<string, Reservation[]>;
  active: Row[];
  /** Scheduled tournaments (not challenges) over the window: a fixed server or the pool. */
  scheduled: { from: number; to: number; agentId: string | null }[];
}

const overlaps = (a: number, b: number, c: number, d: number) => a < d && c < b;

/**
 * Dream Team challenges (decision 334, the plan "Challenges"): a manager challenges another
 * manager's team - or everybody, or the own league tier - to a match at a fixed start in the
 * challenge window. The start keeps a server of the pool from the moment it is sent (the server
 * calendar keeps cups out); the challenger's stake is held until the answer, the taker's on
 * accepting. Brakes as for trades: a limit per pair and week, stakes only above the rescue floor,
 * a cap at the index. At the lock (start − lockMin) both lineups are fixed in a tournament of
 * its own on the booked server (bets open), the autostart plays it at the start; the winner takes
 * the pot less the fee, the bots lose stamina but gain no experience (decision 335).
 */
@Injectable()
export class UdtChallengesService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  /** Set by the AI managers (decision 336): they answer and take challenges on every tick. */
  aiTick: (now: number) => void = () => {};
  /** A challenge whose own reservation is left out while it is being moved (counter offers). */
  private ignore: string | null = null;
  /** Challenges whose managers were reminded of the lock (decision 339; once per run). */
  private readonly reminded = new Set<string>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(ServerActivity) private readonly activity: ServerActivity,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AgentsService) private readonly agents: AgentsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
    @Inject(UdtService) private readonly udt: UdtService,
    @Inject(UdtEventsService) private readonly events: UdtEventsService,
    @Inject(UdtLeagueService) private readonly league: UdtLeagueService,
    @Inject(EventLogService) private readonly eventLog: EventLogService,
    @Inject(StatsService) private readonly stats: StatsService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(NotificationsService) private readonly notify: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.tournaments.calendar.registerSource((agentId, from, to) =>
      this.reservations(agentId, from, to),
    );
    // A challenge's tournament waits for its server until its deadline, then it is called off.
    this.tournaments.calendar.registerDeadline((t) => {
      const c = this.find(challengeIdOf(t.udtJson));
      return c ? this.deadline(c) : null;
    });
    this.events.challengeLineup = (t, settings) => this.lineup(t, settings);
    this.events.challengeClash = (userId, from, to) => this.clash(userId, from, to);
    // The match decides the challenge; a called-off tournament voids it.
    this.eventLog.onAppend((id, stored) => {
      if (stored.some(decides))
        try {
          this.settle(id);
        } catch (e) {
          this.log.error(`challenge result ${id}: ${(e as Error).message}`);
        }
    });
    this.tournaments.onRemove((t) => {
      const c = this.find(challengeIdOf(t.udtJson));
      if (c?.status === 'locked') this.callOff(c, 'removed');
    });
    this.settings.checkUdt((next, sent) => {
      if (sent.challenge || sent.league) this.checkWindow(next);
    });
    this.timer = setInterval(
      () => void this.activity.task('challenges', () => this.tick()),
      30_000,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private cfg(): ChallengeSettings {
    return this.settings.get().udt.challenge;
  }

  private get tz() {
    return this.config.seasonTimeZone;
  }

  private now() {
    return this.clock.now();
  }

  private nowIso() {
    return new Date(this.now()).toISOString();
  }

  private assertOn() {
    this.udt.assertOn();
    if (!this.cfg().enabled) throw forbidden('challenges are switched off');
  }

  // ------------------------------------------------------------------------------------------
  // The window and the league
  // ------------------------------------------------------------------------------------------

  /** Minutes the league evening keeps its servers (an estimate with every pairing played). */
  private leagueSpan(next: UdtSettings): number {
    const l = next.league;
    const season = this.udt.seasonNumber();
    const managers = season === null ? 0 : this.udt.teams(season).length;
    const { minutes } = estimateEvening({
      managers,
      tiers: l.tiers,
      size: l.size,
      perEvening: PER_EVENING[l.length],
      aiGames: l.aiGames,
      servers: l.serverAuto ? Math.max(1, this.agents.pool().length) : 1,
    });
    return minutes + 15;
  }

  /**
   * Settings check (both blocks): the window ends after it starts and never runs into the league
   * evening (Mario 27.11.: challenges must not collide with the league).
   */
  private checkWindow(next: UdtSettings): void {
    const c = next.challenge;
    if (c.from >= c.to)
      throw badRequest('the challenge window must end after it starts ({from} - {to})', {
        from: c.from,
        to: c.to,
      });
    if (!c.enabled) return;
    const days = leagueClashDays(c, next.league, this.leagueSpan(next));
    if (days.length)
      throw conflict('the challenge window {from} - {to} runs into the league evening at {time}', {
        from: c.from,
        to: c.to,
        time: next.league.slotTime,
      });
  }

  // ------------------------------------------------------------------------------------------
  // Servers and times
  // ------------------------------------------------------------------------------------------

  /** Reservations of booked challenges: their server for their time, only for their tournament. */
  private reservations(agentId: string, from: number, to: number): Reservation[] {
    const season = this.udt.seasonNumber();
    if (season === null) return [];
    return this.active(season)
      .filter(
        (c) =>
          c.agentId === agentId &&
          c.id !== this.ignore &&
          overlaps(Date.parse(c.scheduledAt), Date.parse(c.endsAt), from, to),
      )
      .map((c) => ({
        from: Date.parse(c.scheduledAt),
        to: Date.parse(c.endsAt),
        label: 'challenge',
        allows: (t: CalendarTournament) => challengeIdOf(t.udtJson) === c.id,
      }));
  }

  private active(season: number): Row[] {
    return this.db
      .select()
      .from(udtChallenges)
      .where(and(eq(udtChallenges.season, season), inArray(udtChallenges.status, ACTIVE)))
      .all();
  }

  /** The pool's servers (challenges never run on a server outside it). */
  private servers(): string[] {
    return this.agents.pool().map((p) => p.agentId);
  }

  private probe(agentId: string): CalendarTournament {
    return {
      id: 'challenge-probe',
      agentId,
      kind: 'udt',
      udtJson: JSON.stringify({ challenge: { id: 'probe' } }),
      settings: {} as TournamentSettings,
    };
  }

  /** Everything the times of a day depend on, read once. */
  private dayContext(season: number, date: string, except: string | null): DayContext {
    const c = this.cfg();
    const from = zonedMs(date, c.from, this.tz);
    const to = zonedMs(date, c.to, this.tz);
    const servers = this.servers();
    this.ignore = except;
    let reserved: Map<string, Reservation[]>;
    try {
      reserved = new Map(
        servers.map((a) => [a, this.tournaments.calendar.conflicts(this.probe(a), from, to)]),
      );
    } finally {
      this.ignore = null;
    }
    const scheduled = this.db
      .select()
      .from(tournaments)
      .where(
        and(
          isNotNull(tournaments.scheduledAt),
          inArray(tournaments.phase, ['draft', 'seeded', 'running']),
        ),
      )
      .all()
      .filter((t) => !challengeIdOf(t.udtJson))
      .flatMap((t) => {
        const span = this.spanOf(t);
        return span && overlaps(span.from, span.to, from, to)
          ? [{ ...span, agentId: t.serverAuto ? null : t.agentId }]
          : [];
      });
    return {
      date,
      servers,
      reserved,
      active: this.active(season).filter((x) => x.id !== except),
      scheduled,
    };
  }

  /** A free server for [from, to) (null: none): at most `servers` challenges at once. */
  private freeServer(ctx: DayContext, from: number, to: number): string | null {
    const then = ctx.active.filter((c) =>
      overlaps(Date.parse(c.scheduledAt), Date.parse(c.endsAt), from, to),
    );
    if (then.length >= this.cfg().servers) return null;
    const tours = ctx.scheduled.filter((t) => overlaps(t.from, t.to, from, to));
    const fixed = new Set(tours.flatMap((t) => (t.agentId ? [t.agentId] : [])));
    const pool = tours.filter((t) => !t.agentId).length;
    const free = ctx.servers.filter(
      (a) =>
        !fixed.has(a) &&
        !then.some((c) => c.agentId === a) &&
        !(ctx.reserved.get(a) ?? []).some((r) => overlaps(r.from, r.to, from, to)),
    );
    // Cups on the pool take free servers first.
    return free[pool] ?? null;
  }

  /** When a scheduled tournament keeps a server (its start and the estimate), null: unreadable. */
  private spanOf(t: typeof tournaments.$inferSelect): { from: number; to: number } | null {
    const from = Date.parse(t.scheduledAt ?? '');
    if (!Number.isFinite(from)) return null;
    try {
      return { from, to: from + estimateMs(this.tournaments.settings(t)) };
    } catch {
      return null;
    }
  }

  /** Cups a manager's team entered that run (or lock its bots) at that time. */
  private cupBusy(userId: string, from: number, to: number): boolean {
    const lock = this.cfg().lockMin * MIN;
    return this.db
      .select({ t: tournaments })
      .from(udtEntries)
      .innerJoin(tournaments, eq(tournaments.id, udtEntries.tournamentId))
      .where(
        and(
          eq(udtEntries.userId, userId),
          inArray(tournaments.phase, ['draft', 'seeded', 'running']),
          isNotNull(tournaments.scheduledAt),
        ),
      )
      .all()
      .some(({ t }) => {
        const span = this.spanOf(t);
        return !!span && overlaps(span.from, Math.max(span.to, span.from + 1), from - lock, to);
      });
  }

  private involves(c: Row, userId: string) {
    return c.fromUser === userId || c.toUser === userId;
  }

  /** A booked challenge of the manager keeps its bots from its lock to its end within [from, to). */
  private clash(userId: string, from: number, to: number): boolean {
    const season = this.udt.seasonNumber();
    if (season === null) return false;
    const lock = this.cfg().lockMin * MIN;
    return this.active(season).some(
      (c) =>
        this.involves(c, userId) &&
        overlaps(Date.parse(c.scheduledAt) - lock, Date.parse(c.endsAt), from, to),
    );
  }

  /** Why a team cannot play a challenge then (null: it can). */
  private teamProblem(ctx: DayContext, userId: string, from: number, to: number) {
    if (
      ctx.active.some(
        (c) =>
          this.involves(c, userId) &&
          overlaps(Date.parse(c.scheduledAt), Date.parse(c.endsAt), from, to),
      )
    )
      return 'busy' as const;
    const perDay = ctx.active.filter(
      (c) => this.involves(c, userId) && today(Date.parse(c.scheduledAt), this.tz) === ctx.date,
    ).length;
    if (perDay >= this.cfg().perDay) return 'day' as const;
    if (this.cupBusy(userId, from, to)) return 'cup' as const;
    return null;
  }

  /**
   * The bookable start times of the next days for a challenge of a mode and length: per start
   * free, no server (`full`), the own team or the opponent plays then, or too late to answer.
   */
  slots(user: User, q: SlotsInput) {
    this.assertOn();
    const s = this.udt.season();
    const c = this.cfg();
    const minutes = challengeMinutes({ mode: q.mode, bestOf: q.mode === 'mh' ? 1 : q.bestOf });
    const now = this.now();
    const lock = c.lockMin * MIN;
    const days: {
      date: string;
      weekday: number;
      free: number;
      starts: { time: string; at: string; state: SlotState }[];
    }[] = [];
    let date = today(now, this.tz);
    for (let i = 0; i < q.days && date <= s.endDate; i++, date = nextDay(date)) {
      const weekday = weekdayOf(date);
      if (!c.days.includes(weekday)) continue;
      const ctx = this.dayContext(s.number, date, null);
      const starts = windowStarts(c, minutes).map((time) => {
        const from = zonedMs(date, time, this.tz);
        const to = from + minutes * MIN;
        const at = new Date(from).toISOString();
        let state: SlotState = 'free';
        if (from - lock <= now) state = 'closed';
        else if (this.teamProblem(ctx, user.id, from, to)) state = 'mine';
        else if (q.opponent && this.teamProblem(ctx, q.opponent, from, to)) state = 'opponent';
        else if (!this.freeServer(ctx, from, to)) state = 'full';
        return { time, at, state };
      });
      days.push({
        date,
        weekday,
        free: starts.filter((x) => x.state === 'free').length,
        starts,
      });
    }
    return { minutes, lockMin: c.lockMin, window: { from: c.from, to: c.to }, days };
  }

  // ------------------------------------------------------------------------------------------
  // Rules of a challenge
  // ------------------------------------------------------------------------------------------

  private cap(season: number): number {
    return stakeCap(this.cfg().stakeMax, this.udt.index(season));
  }

  private feePct(mode: ChallengeMode): number {
    const c = this.cfg();
    return mode === 'mh' ? c.mh.feePct : c.feePct;
  }

  /** Bots of the manager's Monster Hunt lineup that can play now (the showcase needs five). */
  private mhBots(userId: string): number {
    const settings = {
      teamSize: MH_TEAM_SIZE,
      game: { adapter: ADAPTER_MH },
    } as unknown as TournamentSettings;
    return this.events.lineup(userId, settings, UdtEventRulesSchema.parse({})).bots.length;
  }

  private tierOf(userId: string): number | null {
    try {
      return this.league.hubLeague(userId).tier;
    } catch {
      return null;
    }
  }

  private pairCount(season: number, a: string, b: string, except: string | null): number {
    const since = new Date(this.now() - 7 * DAY).toISOString();
    return this.db
      .select()
      .from(udtChallenges)
      .where(and(eq(udtChallenges.season, season), inArray(udtChallenges.status, COUNTED)))
      .all()
      .filter(
        (c) =>
          c.id !== except &&
          c.createdAt >= since &&
          ((c.fromUser === a && c.toUser === b) || (c.fromUser === b && c.toUser === a)),
      ).length;
  }

  /** The format checked against the settings: mode, size, best of, difficulty. */
  private format(body: ChallengeInput) {
    const c = this.cfg();
    if (!c.modes.includes(body.mode)) throw conflict('this mode is not open for challenges');
    if (body.mode === 'mh') {
      const hardness = body.hardness ?? 'normal';
      if (!c.mh.hardness.includes(hardness))
        throw conflict('this difficulty is not open for challenges');
      return { mode: 'mh' as const, teamSize: MH_TEAM_SIZE, bestOf: 1, hardness };
    }
    if (!c.teamSizes.includes(body.teamSize) || !c.bestOf.includes(body.bestOf))
      throw conflict('this format is not open for challenges');
    return { mode: 'dm' as const, teamSize: body.teamSize, bestOf: body.bestOf, hardness: null };
  }

  /**
   * Checks a new challenge (or a counter offer) and books it: the start, a server, both teams,
   * the limits, the stake held. `except` is the challenge it replaces (counter offers).
   */
  private book(
    user: User,
    body: ChallengeInput,
    o: { counterOf?: Row; rematchOf?: string | null } = {},
  ): Row {
    const s = this.udt.season();
    const c = this.cfg();
    const to = body.to;
    if (to === user.id) throw badRequest('a challenge needs two teams');
    if (!this.udt.team(user.id, s.number)) throw conflict('found your team first');
    if (to !== null) {
      if (!this.udt.team(to, s.number)) throw notFound('team of that manager');
      const ai = this.udt.aiIds().has(to);
      if (ai && (!this.udt.aiOn() || !c.ai)) throw conflict('the AI managers are switched off');
    }
    const f = this.format(body);
    const cap = this.cap(s.number);
    const stake = stakeProblem(body.stake, cap);
    if (stake === 'step') throw badRequest('stakes go in steps of 10 Neuro');
    if (stake === 'low') throw badRequest('a stake is 0 or at least {min} Neuro', { min: 100 });
    if (stake === 'high') throw conflict('at most {cap} Neuro per team', { cap });
    // The start: in the window, on the grid, before the lock, in the season.
    const minutes = challengeMinutes(f);
    const from = Date.parse(body.at);
    const date = today(from, this.tz);
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(from));
    if (
      !c.days.includes(weekdayOf(date)) ||
      !isWindowStart(c, time, minutes) ||
      zonedMs(date, time, this.tz) !== from
    )
      throw conflict('challenges start in the window {from} - {to}', { from: c.from, to: c.to });
    if (date > s.endDate) throw conflict('the start is after the end of the season');
    const lock = c.lockMin * MIN;
    if (from - lock <= this.now())
      throw conflict('too late: challenges are booked until {min} minutes before the start', {
        min: c.lockMin,
      });
    const end = from + minutes * MIN;
    const ctx = this.dayContext(s.number, date, o.counterOf?.id ?? null);
    teamError(this.teamProblem(ctx, user.id, from, end), true, c.perDay);
    if (to !== null) teamError(this.teamProblem(ctx, to, from, end), false, c.perDay);
    const agentId = this.freeServer(ctx, from, end);
    if (!agentId) throw conflict('no server is free for challenges then');
    // Limits.
    const open = this.db
      .select()
      .from(udtChallenges)
      .where(
        and(
          eq(udtChallenges.season, s.number),
          eq(udtChallenges.fromUser, user.id),
          eq(udtChallenges.status, 'pending'),
        ),
      )
      .all()
      .filter((x) => x.id !== o.counterOf?.id).length;
    if (open >= c.maxOpen)
      throw conflict('at most {max} challenges can wait for an answer at once', {
        max: c.maxOpen,
      });
    if (
      to !== null &&
      c.pairPerWeek &&
      this.pairCount(s.number, user.id, to, o.counterOf?.id ?? null) >= c.pairPerWeek
    )
      throw conflict('at most {n} challenges between two managers per week', {
        n: c.pairPerWeek,
      });
    // The showcase: five Monster Hunt bots on each side.
    if (f.mode === 'mh') {
      if (this.mhBots(user.id) < MH_TEAM_SIZE)
        throw conflict('Monster Hunt needs {n} bots in your lineup', { n: MH_TEAM_SIZE });
      if (to !== null && this.mhBots(to) < MH_TEAM_SIZE)
        throw conflict('Monster Hunt needs {n} bots in the other lineup', { n: MH_TEAM_SIZE });
    }
    const map = this.poolMap(f.mode, body.map);
    const tier = body.open === 'tier' ? this.tierOf(user.id) : null;
    if (to === null && body.open === 'tier' && tier === null)
      throw conflict('your team plays in no league tier');
    const id = `c${randomId(12)}`;
    const now = this.now();
    const row: Row = {
      id,
      season: s.number,
      fromUser: user.id,
      toUser: to,
      openScope: to === null ? (body.open ?? 'all') : null,
      openTier: tier,
      status: 'pending',
      mode: f.mode,
      teamSize: f.teamSize,
      bestOf: f.bestOf,
      map,
      hardness: f.hardness,
      stake: body.stake,
      feePct: this.feePct(f.mode),
      scheduledAt: new Date(from).toISOString(),
      endsAt: new Date(end).toISOString(),
      agentId,
      tournamentId: null,
      counterOf: o.counterOf?.id ?? null,
      rematchOf: o.rematchOf ?? null,
      round: (o.counterOf?.round ?? 0) + 1,
      message: body.message || null,
      reason: null,
      winnerUser: null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(Math.min(now + c.expiryHours * 3_600_000, from - lock)).toISOString(),
      answeredAt: null,
      decidedAt: null,
    };
    this.db.insert(udtChallenges).values(row).run();
    if (row.stake > 0)
      this.ledger.charge({
        userId: user.id,
        kind: 'udt_challenge',
        amount: row.stake,
        ref: holdRef(id, user.id),
        meta: { challengeId: id },
      });
    return row;
  }

  // ------------------------------------------------------------------------------------------
  // Sending and answering
  // ------------------------------------------------------------------------------------------

  /** Sends a challenge: the start and its server are kept, the stake is held. */
  create(user: User, body: ChallengeInput, rematchOf: string | null = null) {
    this.assertOn();
    this.sweep();
    const row = this.db.transaction(() => this.book(user, body, { rematchOf }));
    this.notify.challengeSent(this.note(row), rematchOf ? 'rematch' : 'new');
    return { id: row.id, ...this.view(user) };
  }

  private get(id: string): Row {
    const c = this.db.select().from(udtChallenges).where(eq(udtChallenges.id, id)).get();
    if (!c) throw notFound('challenge');
    return c;
  }

  /** Gives a held stake back (idempotent by its ref). */
  private refund(c: Row, userId: string) {
    if (c.stake > 0 && this.ledger.seasonOfRef(holdRef(c.id, userId)) !== null)
      this.ledger.book({
        season: c.season,
        userId,
        kind: 'udt_challenge',
        amount: c.stake,
        ref: `challenge-back:${c.id}:${userId}`,
        meta: { challengeId: c.id },
      });
  }

  /** Ends a challenge that will not be played; the stakes held go back. */
  private close(c: Row, status: Status, reason: string | null = null): boolean {
    const done = this.db
      .update(udtChallenges)
      .set({ status, reason, decidedAt: this.nowIso() })
      .where(and(eq(udtChallenges.id, c.id), inArray(udtChallenges.status, ACTIVE)))
      .run();
    if (!done.changes) return false;
    // Only stakes that were held come back (the refund goes by the hold's ref).
    this.refund(c, c.fromUser);
    if (c.toUser) this.refund(c, c.toUser);
    return true;
  }

  /** A booked challenge that will not be played: stakes back, both managers hear why. */
  private callOff(c: Row, reason: string): boolean {
    if (!this.close(c, 'void', reason)) return false;
    this.notify.challengeVoid(this.note(c), reason);
    return true;
  }

  /** The facts of a challenge for Discord (decision 339). */
  private note(c: Row): ChallengeNote {
    const name = (u: string | null) => (u ? (this.udt.team(u, c.season)?.name ?? '?') : null);
    const { pot, prize } = challengePot(c.stake, c.feePct);
    return {
      fromUser: c.fromUser,
      toUser: c.toUser,
      info: {
        from: name(c.fromUser) ?? '?',
        to: name(c.toUser),
        mode: c.mode as ChallengeMode,
        teamSize: c.teamSize,
        bestOf: c.bestOf,
        map: c.map,
        hardness: (c.hardness ?? 'normal') as MhHardness,
        stake: c.stake,
        pot,
        prize,
        at: c.scheduledAt,
        expiresAt: c.expiresAt,
        link: `${this.config.publicUrl}/udt/challenges`,
      },
    };
  }

  /** Can this manager take this challenge (the challenged one, or an open one in scope)? */
  private canTake(c: Row, userId: string): boolean {
    if (c.fromUser === userId) return false;
    if (c.toUser !== null) return c.toUser === userId;
    if (c.openScope === 'tier') return this.tierOf(userId) === c.openTier;
    return true;
  }

  /** The challenged team takes it: its stake is held too, the start stays booked. */
  accept(user: User, id: string) {
    this.assertOn();
    this.sweep();
    const s = this.udt.season();
    const c = this.get(id);
    if (c.status !== 'pending') throw conflict('the challenge is {status}', { status: c.status });
    if (c.season !== s.number || !this.canTake(c, user.id))
      throw forbidden('only the challenged team can answer');
    if (!this.udt.team(user.id, s.number)) throw conflict('found your team first');
    const from = Date.parse(c.scheduledAt);
    const to = Date.parse(c.endsAt);
    const date = today(from, this.tz);
    const ctx = this.dayContext(s.number, date, c.id);
    teamError(this.teamProblem(ctx, user.id, from, to), true, this.cfg().perDay);
    if (c.toUser === null && this.cfg().pairPerWeek) {
      if (this.pairCount(s.number, c.fromUser, user.id, c.id) >= this.cfg().pairPerWeek)
        throw conflict('at most {n} challenges between two managers per week', {
          n: this.cfg().pairPerWeek,
        });
    }
    if (c.mode === 'mh' && this.mhBots(user.id) < MH_TEAM_SIZE)
      throw conflict('Monster Hunt needs {n} bots in your lineup', { n: MH_TEAM_SIZE });
    this.db.transaction(() => {
      const done = this.db
        .update(udtChallenges)
        .set({ status: 'accepted', toUser: user.id, answeredAt: this.nowIso() })
        .where(and(eq(udtChallenges.id, c.id), eq(udtChallenges.status, 'pending')))
        .run();
      if (!done.changes) throw conflict('the challenge was answered meanwhile');
      if (c.stake > 0)
        this.ledger.charge({
          userId: user.id,
          kind: 'udt_challenge',
          amount: c.stake,
          ref: holdRef(c.id, user.id),
          meta: { challengeId: c.id },
        });
    });
    this.answered(this.get(c.id));
    return this.view(user);
  }

  /** Discord: the challenger hears the answer, the channel gets the match (MH: the showcase). */
  private answered(c: Row): void {
    if (c.mode !== 'mh') return this.notify.challengeAnswered(this.note(c), true);
    const rec = this.mhRecords(c.season).find(
      (r) => r.map.toLowerCase() === (c.map ?? '').toLowerCase() && r.hardness === c.hardness,
    );
    this.notify.challengeAnswered(this.note(c), true, {
      record: rec ? { finalMs: rec.finalMs, team: rec.team ?? null } : null,
      bonus: stakeCap(this.cfg().mh.recordBonus, this.udt.index(c.season)),
    });
  }

  /** The challenged team says no: the challenger's stake comes back. */
  decline(user: User, id: string) {
    this.assertOn();
    const c = this.get(id);
    if (c.toUser !== user.id) throw forbidden('only the challenged team can answer');
    if (c.status !== 'pending') throw conflict('the challenge is {status}', { status: c.status });
    if (this.close(c, 'declined')) this.notify.challengeAnswered(this.note(c), false);
    return this.view(user);
  }

  /** The challenger takes it back before an answer. */
  withdraw(user: User, id: string) {
    this.assertOn();
    const c = this.get(id);
    if (c.fromUser !== user.id) throw forbidden('only the challenger can withdraw');
    if (c.status !== 'pending') throw conflict('the challenge is {status}', { status: c.status });
    this.close(c, 'withdrawn');
    return this.view(user);
  }

  /**
   * A counter offer: the challenged team proposes another start, stake or format to the
   * challenger. The challenge ends (its stake comes back), the offer is a new challenge the other
   * way (at most three rounds).
   */
  counter(user: User, id: string, body: ChallengeInput) {
    this.assertOn();
    this.sweep();
    const c = this.get(id);
    if (c.toUser !== user.id) throw forbidden('only the challenged team can answer');
    if (c.status !== 'pending') throw conflict('the challenge is {status}', { status: c.status });
    if (c.round >= MAX_ROUNDS)
      throw conflict('at most {n} rounds of counter offers', { n: MAX_ROUNDS });
    const row = this.db.transaction(() => {
      const made = this.book(user, { ...body, to: c.fromUser, open: undefined }, { counterOf: c });
      this.close(c, 'countered');
      return made;
    });
    this.notify.challengeSent(this.note(row), 'counter');
    return { id: row.id, ...this.view(user) };
  }

  /**
   * Answers that came too late: pending challenges past their deadline (or of a season that is
   * over) expire, their stakes come back.
   */
  sweep(): number {
    const now = this.nowIso();
    const season = this.udt.seasonNumber();
    let n = 0;
    for (const c of this.db
      .select()
      .from(udtChallenges)
      .where(inArray(udtChallenges.status, ['pending', 'accepted']))
      .all())
      if (c.status === 'pending' && (c.expiresAt <= now || c.season !== season)) {
        if (this.close(c, 'expired')) {
          n++;
          this.notify.challengeExpired(this.note(c));
        }
      } else if (c.status === 'accepted' && c.season !== season) {
        // Booked for a season that is over (its last day): never played.
        if (this.callOff(c, 'season')) n++;
      }
    return n;
  }

  /**
   * The admin tab (decision 339): the league evening the window must keep clear of (its weekdays,
   * start and the minutes it keeps the servers), the pool, the indexed stake cap and record bonus,
   * the challenges booked in the running season.
   */
  adminView() {
    const s = this.settings.get().udt;
    const season = this.udt.seasonNumber();
    const index = season === null ? 1 : this.udt.index(season);
    return {
      league: {
        enabled: s.enabled && s.league.enabled,
        days: s.league.slotDays,
        time: s.league.slotTime,
        minutes: this.leagueSpan(s),
      },
      pool: this.agents.pool().length,
      index,
      stakeCap: stakeCap(s.challenge.stakeMax, index),
      recordBonus: stakeCap(s.challenge.mh.recordBonus, index),
      booked: season === null ? 0 : this.active(season).length,
    };
  }

  /** Waiting answers of a manager (the count on the navigation). */
  incoming(userId: string): number {
    const season = this.udt.seasonNumber();
    if (season === null || !this.cfg().enabled) return 0;
    const now = this.nowIso();
    return this.db
      .select()
      .from(udtChallenges)
      .where(
        and(
          eq(udtChallenges.season, season),
          eq(udtChallenges.toUser, userId),
          eq(udtChallenges.status, 'pending'),
        ),
      )
      .all()
      .filter((c) => c.expiresAt > now).length;
  }

  // ------------------------------------------------------------------------------------------
  // Maps
  // ------------------------------------------------------------------------------------------

  /**
   * The maps of a mode: deathmatch the league's pool; Monster Hunt the newest Dream Team Monster
   * Hunt cup's pool, else the Monster Hunt maps the pool's servers have.
   */
  mapPool(mode: ChallengeMode): string[] {
    if (mode === 'dm') return this.league.mapPool();
    for (const t of this.db
      .select()
      .from(tournaments)
      .where(eq(tournaments.kind, 'udt'))
      .orderBy(desc(tournaments.createdAt))
      .all()) {
      if (challengeIdOf(t.udtJson)) continue;
      try {
        const s = this.tournaments.settings(t);
        const pool = (s.game.rules as { mapPool?: string[] }).mapPool;
        if (s.game.adapter === ADAPTER_MH && pool?.length) return pool;
      } catch {
        // broken settings: the next
      }
    }
    const maps = new Map<string, string>();
    for (const p of this.agents.pool()) {
      const inv = Inventory.safeParse(this.agents.inventory(p.agentId, p.profileId));
      if (inv.success)
        for (const m of inv.data.maps)
          if (m.id.toUpperCase().startsWith('MH-')) maps.set(m.id.toLowerCase(), m.id);
    }
    return [...maps.values()].sort((a, b) => a.localeCompare(b));
  }

  /** A chosen map checked against the mode's pool (its spelling there); null: the vote. */
  private poolMap(mode: ChallengeMode, map: string | null): string | null {
    const pool = this.mapPool(mode);
    if (map === null) {
      if (!pool.length) throw conflict('there are no maps for this mode');
      return null;
    }
    const hit = pool.find((m) => m.toLowerCase() === map.toLowerCase());
    if (!hit) throw conflict('the map {map} is not in the pool', { map });
    return hit;
  }

  /** The season's Monster Hunt map records per difficulty (what a showcase can beat). */
  private mhRecords(season: number) {
    try {
      return this.stats.mapRecords(season).flatMap((r) => {
        const hardness = hardnessOfSkill(r.monsterSkill);
        return hardness ? [{ map: r.map, hardness, finalMs: r.finalMs, team: r.team }] : [];
      });
    } catch {
      return [];
    }
  }

  // ------------------------------------------------------------------------------------------
  // The match: lock, tournament, result
  // ------------------------------------------------------------------------------------------

  private find(id: string | null): Row | undefined {
    if (!id) return undefined;
    return this.db.select().from(udtChallenges).where(eq(udtChallenges.id, id)).get();
  }

  /**
   * The latest start of a challenge's tournament: a quarter of an hour after its start, or later
   * while the game still ends in the window. Not started by then, it is called off.
   */
  private deadline(c: Row): number {
    const start = Date.parse(c.scheduledAt);
    const end = zonedMs(today(start, this.tz), this.cfg().to, this.tz);
    return Math.max(start + 15 * MIN, end - (Date.parse(c.endsAt) - start));
  }

  /**
   * Every 30 seconds: answers that came too late, the lock of accepted challenges (lineups fixed,
   * the tournament seeded, bets open), tournaments that never started or got lost.
   */
  tick(): void {
    this.sweep();
    const season = this.udt.seasonNumber();
    if (season === null) return;
    const now = this.now();
    const lock = this.cfg().lockMin * MIN;
    for (const c of this.active(season))
      try {
        if (c.status === 'accepted' && Date.parse(c.scheduledAt) - lock <= now) this.lock(c);
        else if (c.status === 'accepted') this.remind(c, now);
        else if (c.status === 'locked') this.watch(c, now);
      } catch (e) {
        this.log.error(`challenge ${c.id}: ${(e as Error).message}`);
      }
    try {
      this.aiTick(now);
    } catch (e) {
      this.log.error(`challenges of the AI managers: ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------------------------------------------------
  // For the AI managers (decision 336)
  // ------------------------------------------------------------------------------------------

  /** Challenges of the running season that still wait for an answer (oldest first). */
  waiting(): Row[] {
    const season = this.udt.seasonNumber();
    if (season === null) return [];
    const now = this.nowIso();
    return this.db
      .select()
      .from(udtChallenges)
      .where(and(eq(udtChallenges.season, season), eq(udtChallenges.status, 'pending')))
      .all()
      .filter((c) => c.expiresAt > now)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** A team in the model for a format: lineup strength, a full lineup, its tired bots. */
  lineupState(userId: string, f: ChallengeFormat) {
    const season = this.udt.season().number;
    const settings = this.gameSettings(f);
    const l = this.events.lineup(userId, settings, UdtEventRulesSchema.parse({}));
    const tiredBelow = this.udt.clubFx(season, userId).tiredBelow;
    return {
      strength: this.league.lineupStrength(userId, settings),
      full: l.bots.length >= f.teamSize,
      tired: l.bots.filter((b) => b.stamina < tiredBelow).length,
    };
  }

  /** The chance of team `a` to win a challenge of this format against team `b` (the model). */
  chance(f: ChallengeFormat, a: string, b: string): number {
    const sa = this.lineupState(a, f).strength;
    const sb = this.lineupState(b, f).strength;
    return seriesChance(gameChance(sa, sb, f.teamSize), f.bestOf);
  }

  /** Booked challenges of a team on the day of a start (another one than `except`). */
  playsOn(userId: string, at: string, except: string | null = null): number {
    const season = this.udt.seasonNumber();
    if (season === null) return 0;
    const day = today(Date.parse(at), this.tz);
    return this.active(season).filter(
      (c) =>
        c.id !== except &&
        c.status !== 'pending' &&
        this.involves(c, userId) &&
        today(Date.parse(c.scheduledAt), this.tz) === day,
    ).length;
  }

  /** Who makes the tournaments: an admin, else the challenger. */
  private maker(c: Row): User | undefined {
    return this.users.list().find((u) => u.isAdmin) ?? this.users.byId(c.fromUser);
  }

  /** The game of a challenge: a fixtures bracket of two, its mode, length, map and rules. */
  gameSettings(c: ChallengeFormat) {
    const mh = c.mode === 'mh';
    const maps = c.map ? [c.map] : this.mapPool(c.mode as ChallengeMode);
    const league = this.settings.get().udt.league;
    const h = MH_HARDNESS[(c.hardness ?? 'normal') as MhHardness] ?? MH_HARDNESS.normal;
    // Deathmatch 5v5 as the league plays it, smaller teams with the usual limits.
    const limits = mh
      ? { fragLimit: 0, timeLimitMin: MH_RUN_MIN }
      : c.teamSize === 5
        ? { fragLimit: league.fragLimit, timeLimitMin: league.timeLimitMin }
        : defaultLimits(c.teamSize);
    return {
      format: 'fixtures',
      size: 2,
      teamSize: c.teamSize,
      grandFinalReset: false,
      bestOf: { default: c.bestOf },
      checkInWindowMin: 10,
      noShowSec: 180,
      reconnectGraceSec: 180,
      maxReconnects: 2,
      botMatchMode: 'watch',
      botPlacement: 'byes',
      clanTeams: false,
      postTournamentShutdownSec: 30,
      game: {
        adapter: mh ? ADAPTER_MH : ADAPTER_ID,
        rules: {
          ...limits,
          // A map picked: every game there; else the vote (best of: the loser picks).
          mapMode: maps.length === 1 ? 'random' : 'vote',
          mapPool: maps,
          ...(mh ? { monsterSkill: h.monsterSkill, lives: h.lives, penaltySec: h.penaltySec } : {}),
        },
      },
    } as TournamentSettings;
  }

  /**
   * The lock (start − lockMin): both lineups are fixed. A team that cannot field one loses
   * without a game (both: called off); else the challenge's tournament is made on its server and
   * seeded - the bets open, the betting bots bet, the autostart runs it at the start.
   */
  private lock(c: Row): void {
    const to = c.toUser!;
    if (this.now() > this.deadline(c)) {
      this.callOff(c, 'late');
      return;
    }
    const settings = this.gameSettings(c);
    const ready = (u: string) => {
      const team = this.events.challengeTeam(u, settings, udtEntrantId(u));
      return !!team && !team.problems.length;
    };
    const okFrom = ready(c.fromUser);
    const okTo = ready(to);
    if (!okFrom && !okTo) {
      this.callOff(c, 'lineups');
      return;
    }
    if (!okFrom || !okTo) {
      const winner = okFrom ? c.fromUser : to;
      if (this.decide(c, winner, 'forfeit'))
        this.announce(c, winner, { forfeit: true, upset: false, games: [] }, null, null);
      return;
    }
    const by = this.maker(c);
    const server = this.agents.pool().find((p) => p.agentId === c.agentId);
    if (!by || !server) {
      this.log.warn(`challenge ${c.id}: ${by ? 'its server left the pool' : 'nobody to make it'}`);
      this.callOff(c, 'server');
      return;
    }
    const name = (u: string) => this.udt.team(u, c.season)?.name ?? '?';
    let t: TournamentRow;
    try {
      t = this.tournaments.create(
        {
          name: `Challenge${c.mode === 'mh' ? ' · Monster Hunt' : ''} · ${name(c.fromUser)} – ${name(to)}`.slice(
            0,
            100,
          ),
          agentId: server.agentId,
          profileId: server.profileId,
          serverAuto: false,
          settings,
          // Not used (the two lineups play), but a team tournament needs two teams of bots.
          botPool: Array.from({ length: 10 }, (_, i) => ({ name: `Challenge${i + 1}`, skill: 3 })),
          registrationOpen: false,
          scheduledAt: c.scheduledAt,
          autoStart: true,
          kind: 'udt',
          udt: {
            valueCap: null,
            starLimit: null,
            ticket: null,
            ticketIndexed: true,
            minTeams: 2,
            finale: false,
            league: null,
            challenge: { id: c.id },
          },
        },
        by,
      );
    } catch (e) {
      this.log.warn(`challenge ${c.id}: no tournament (${(e as Error).message})`);
      this.callOff(c, 'server');
      return;
    }
    const locked = this.db
      .update(udtChallenges)
      .set({ status: 'locked', tournamentId: t.id })
      .where(and(eq(udtChallenges.id, c.id), eq(udtChallenges.status, 'accepted')))
      .run();
    if (!locked.changes) {
      this.tournaments.remove(t.id);
      return;
    }
    try {
      this.tournaments.seed(t.id, { mode: 'auto', humanOrder: 'random' }, by);
    } catch (e) {
      this.log.warn(`challenge ${c.id}: not seeded (${(e as Error).message})`);
      this.tournaments.remove(t.id); // voids it (onRemove)
      return;
    }
    this.notify.challengeBetsOpen(this.note(c), t.id);
  }

  /** The result in the channel (decision 339). */
  private announce(
    c: Row,
    winner: string,
    o: { forfeit: boolean; upset: boolean; games: { w: number; l: number; map: string | null }[] },
    tournamentId: string | null,
    matchId: string | null,
  ): void {
    const n = this.note(c);
    const won = winner === c.fromUser;
    this.notify.challengeResult(
      n,
      {
        ...o,
        winner: (won ? n.info.from : n.info.to) ?? '?',
        loser: (won ? n.info.to : n.info.from) ?? '?',
      },
      tournamentId,
      matchId,
    );
  }

  /**
   * A result against the odds: the winner's chance before the match (the model of the lineups,
   * as the AI managers judge challenges) was at most this (decision 339).
   */
  private static readonly UPSET_CHANCE = 0.35;

  /** Reminds both managers of the lock (once per challenge and run, decision 339). */
  private remind(c: Row, now: number): void {
    const lock = Date.parse(c.scheduledAt) - this.cfg().lockMin * MIN;
    const from = lock - REMIND_MIN * MIN;
    if (now < from || now >= lock || this.reminded.has(c.id)) return;
    this.reminded.add(c.id);
    // Accepted just now: the answer said it all.
    if (c.answeredAt && Date.parse(c.answeredAt) >= from) return;
    this.notify.challengeReminder(this.note(c), new Date(lock).toISOString());
  }

  /** The two lineups of a challenge's tournament in their slots (the challenger first). */
  private lineup(t: TournamentRow, settings: TournamentSettings) {
    const c = this.find(this.tournaments.udtRules(t)?.challenge?.id ?? null);
    if (!c?.toUser) throw notFound('challenge');
    const entrants = [c.fromUser, c.toUser].map((u) => {
      const team = this.events.challengeTeam(u, settings, udtEntrantId(u));
      if (!team) throw notFound('team of that manager');
      return team.entrant;
    });
    return { entrants, fill: [], slots: entrants.map((e) => e.id) };
  }

  /** A locked challenge: its tournament is gone, decided, or never started by its deadline. */
  private watch(c: Row, now: number): void {
    const t = c.tournamentId ? this.tournaments.get(c.tournamentId) : undefined;
    if (!t) {
      this.callOff(c, 'removed');
      return;
    }
    if (t.phase === 'finished' || t.phase === 'aborted') {
      this.settle(t.id);
      return;
    }
    if (t.phase === 'seeded' && now > this.deadline(c)) {
      const by = this.maker(c);
      if (by) this.tournaments.cancelSeeded(t.id, 'the challenge could not start in time', by);
    }
  }

  /**
   * A challenge's tournament got its result (or was called off): the winner takes the pot (less
   * the fee), the bots that played lose stamina (no experience, no game money); a Monster Hunt
   * run that beat the season's map record earns the record bonus. Called off: the stakes go back,
   * the bets were refunded by the bets themselves.
   */
  private settle(tournamentId: string): void {
    const t = this.tournaments.get(tournamentId);
    const c = this.find(challengeIdOf(t?.udtJson ?? null));
    if (!c || c.status !== 'locked') return;
    const p = this.eventLog.projection(tournamentId);
    if (!p) return;
    if (p.phase === 'aborted') {
      this.callOff(c, 'aborted');
      return;
    }
    const r = p.results[0];
    const winner = r ? udtManagerOf(r.winnerId) : undefined;
    if (!r || !winner) {
      // Over without a result (ended by hand): nobody won, the stakes go back.
      if (p.phase === 'finished') this.callOff(c, 'aborted');
      return;
    }
    const games = Math.max(1, p.games[r.matchId]?.length ?? 0);
    const loser = winner === c.fromUser ? c.toUser! : c.fromUser;
    let upset = false;
    try {
      upset = this.chance(c, winner, loser) <= UdtChallengesService.UPSET_CHANCE;
    } catch {
      // no model, no upset
    }
    const played = this.decide(c, winner, r.outcome === 'forfeit' ? 'forfeit' : null, () => {
      // Stamina as in a cup (per game, the fatigue traits), nothing else.
      const onBots = this.udt.traitsOnBots(c.season);
      for (const userId of [c.fromUser, c.toUser!]) {
        const e = p.entrants[udtEntrantId(userId)];
        const ids =
          e?.kind === 'team'
            ? e.bots.flatMap((b) => (b.id ? [b.id] : []))
            : e?.kind === 'bot' && e.bot.id
              ? [e.bot.id]
              : [];
        if (!ids.length) continue;
        for (const row of this.db
          .select()
          .from(udtRoster)
          .where(
            and(
              eq(udtRoster.season, c.season),
              eq(udtRoster.userId, userId),
              inArray(udtRoster.botId, ids),
            ),
          )
          .all()) {
          const fx = managerEffects(onBots.get(row.botId) ?? []);
          const lost = Math.round(games * DEFAULT_ECONOMY.stamina.perGame * fx.fatigue);
          this.db
            .update(udtRoster)
            .set({ stamina: Math.max(0, row.stamina - lost) })
            .where(and(eq(udtRoster.season, c.season), eq(udtRoster.botId, row.botId)))
            .run();
        }
      }
    });
    if (!played) return;
    const forfeit = r.outcome === 'forfeit';
    this.announce(
      c,
      winner,
      {
        forfeit,
        upset: upset && !forfeit,
        games: (r.games ?? []).map((g) => ({
          w: g.scores[r.winnerId] ?? 0,
          l: g.scores[r.entrants.find((e) => e !== r.winnerId) ?? ''] ?? 0,
          map: g.map ?? null,
        })),
      },
      tournamentId,
      r.matchId,
    );
    if (c.mode === 'mh') this.recordBonus(c, tournamentId);
  }

  /** Decides a challenge for `winner`: the pot less the fee (once, by its refs). */
  private decide(c: Row, winner: string, reason: string | null, also?: () => void): boolean {
    return this.db.transaction(() => {
      const done = this.db
        .update(udtChallenges)
        .set({ status: 'played', winnerUser: winner, reason, decidedAt: this.nowIso() })
        .where(
          and(eq(udtChallenges.id, c.id), inArray(udtChallenges.status, ['accepted', 'locked'])),
        )
        .run();
      if (!done.changes) return false;
      const { pot, fee } = challengePot(c.stake, c.feePct);
      const meta = { challengeId: c.id };
      this.ledger.book({
        season: c.season,
        userId: winner,
        kind: 'udt_challenge',
        amount: pot,
        ref: `challenge-win:${c.id}`,
        meta,
      });
      this.ledger.book({
        season: c.season,
        userId: winner,
        kind: 'udt_challenge_fee',
        amount: -fee,
        ref: `challenge-fee:${c.id}`,
        meta,
      });
      also?.();
      return true;
    });
  }

  /** Monster Hunt: the bonus for a run that beat the season's record of its map and skill. */
  private recordBonus(c: Row, tournamentId: string): void {
    try {
      const facts = this.stats.udtFacts(c.season).find((f) => f.tournamentId === tournamentId);
      const before = this.stats.mapRecords(c.season, tournamentId);
      const run = facts && brokenRecord(facts.runs, before);
      const userId = run ? udtManagerOf(run.entrantId) : undefined;
      if (!run || !userId) return;
      const bonus = stakeCap(this.cfg().mh.recordBonus, this.udt.index(c.season));
      const booked = this.ledger.book({
        season: c.season,
        userId,
        kind: 'udt_challenge_record',
        amount: bonus,
        ref: `challenge-record:${c.id}`,
        meta: { challengeId: c.id, map: run.map, finalMs: run.finalMs },
      });
      const old = before.find(
        (b) => b.map.toLowerCase() === run.map.toLowerCase() && b.monsterSkill === run.monsterSkill,
      );
      if (booked && old)
        this.notify.challengeRecord(
          {
            team: this.udt.team(userId, c.season)?.name ?? '?',
            map: run.map,
            hardness: hardnessOfSkill(run.monsterSkill) ?? 'normal',
            finalMs: run.finalMs,
            oldMs: old.finalMs,
            bonus,
          },
          `${this.config.publicUrl}/t/${tournamentId}`,
        );
    } catch (e) {
      this.log.error(`challenge record ${c.id}: ${(e as Error).message}`);
    }
  }

  /**
   * A rematch of a played challenge: the same format and stake, the other team challenges, only
   * the start is new (it counts for the pair limit).
   */
  rematch(user: User, id: string, body: RematchInput) {
    this.assertOn();
    const c = this.get(id);
    if (c.status !== 'played' || !c.toUser) throw conflict('only a played challenge has a rematch');
    if (!this.involves(c, user.id)) throw forbidden('only the two teams can ask for a rematch');
    if (c.season !== this.udt.seasonNumber()) throw conflict('the challenge is of another season');
    const booked = this.db
      .select()
      .from(udtChallenges)
      .where(and(eq(udtChallenges.rematchOf, c.id), inArray(udtChallenges.status, ACTIVE)))
      .get();
    if (booked) throw conflict('a rematch of this challenge is booked already');
    return this.create(
      user,
      {
        to: c.fromUser === user.id ? c.toUser : c.fromUser,
        mode: c.mode as ChallengeMode,
        teamSize: c.teamSize as 1 | 3 | 5,
        bestOf: c.bestOf as 1 | 3 | 5,
        map: c.map,
        ...(c.hardness ? { hardness: c.hardness as MhHardness } : {}),
        stake: c.stake,
        at: body.at,
        ...(body.message ? { message: body.message } : {}),
      },
      c.id,
    );
  }

  // ------------------------------------------------------------------------------------------
  // Records, rivals, evenings (decision 338)
  // ------------------------------------------------------------------------------------------

  /** What a decided challenge brought a side: won the stake less the fee, lost the stake. */
  private net(c: Row, userId: string): number {
    if (c.status !== 'played' || !c.winnerUser) return 0;
    const { fee } = challengePot(c.stake, c.feePct);
    return c.winnerUser === userId ? c.stake - fee : -c.stake;
  }

  /** A manager's played challenges, all seasons, newest first. */
  private playedBy(userId: string): Row[] {
    return this.db
      .select()
      .from(udtChallenges)
      .where(eq(udtChallenges.status, 'played'))
      .all()
      .filter((c) => this.involves(c, userId))
      .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));
  }

  /** Challenges against one other manager are a rivalry from this many on. */
  static readonly RIVAL_FROM = 3;

  /**
   * Two managers against each other (all seasons): challenges won, lost and the Neuro they
   * brought, league games won and lost, rivals from three challenges on.
   */
  rivalry(user: User, otherId: string) {
    const games = this.playedBy(user.id).filter((c) => this.involves(c, otherId));
    const won = games.filter((c) => c.winnerUser === user.id).length;
    return {
      challenges: {
        won,
        lost: games.length - won,
        net: games.reduce((n, c) => n + this.net(c, user.id), 0),
      },
      league: this.league.headToHead(user.id, otherId),
      rival: games.length >= UdtChallengesService.RIVAL_FROM,
    };
  }

  /**
   * A manager's challenge record (all seasons): won, lost, Neuro, record bonuses, the managers
   * played against (rivals first), the last results.
   */
  record(user: User) {
    this.assertOn();
    const games = this.playedBy(user.id);
    const season = this.udt.seasonNumber();
    const ai = this.udt.aiIds();
    const by = new Map<string, { won: number; lost: number; net: number; last: string }>();
    for (const c of games) {
      const other = c.fromUser === user.id ? c.toUser! : c.fromUser;
      const r = by.get(other) ?? { won: 0, lost: 0, net: 0, last: c.decidedAt ?? '' };
      if (c.winnerUser === user.id) r.won++;
      else r.lost++;
      r.net += this.net(c, user.id);
      by.set(other, r);
    }
    const nameOf = (u: string) => {
      for (const s of [season, ...games.map((c) => c.season)])
        if (s !== null) {
          const t = this.udt.team(u, s);
          if (t) return { name: t.name, tag: t.tag };
        }
      return { name: '?', tag: '' };
    };
    const bonuses = this.db
      .select()
      .from(neuroLedger)
      .where(and(eq(neuroLedger.userId, user.id), eq(neuroLedger.kind, 'udt_challenge_record')))
      .all();
    const won = games.filter((c) => c.winnerUser === user.id).length;
    return {
      won,
      lost: games.length - won,
      net: games.reduce((n, c) => n + this.net(c, user.id), 0),
      records: bonuses.length,
      recordNeuro: bonuses.reduce((n, b) => n + b.amount, 0),
      rivals: [...by.entries()]
        .map(([userId, r]) => ({
          userId,
          ...nameOf(userId),
          ai: ai.has(userId),
          won: r.won,
          lost: r.lost,
          net: r.net,
          rival: r.won + r.lost >= UdtChallengesService.RIVAL_FROM,
        }))
        .sort((a, b) => b.won + b.lost - (a.won + a.lost) || b.net - a.net),
      history: games.slice(0, 30).map((c) => ({
        ...this.item(c, user.id, ai),
        net: this.net(c, user.id),
        record: bonuses.some((b) => b.ref === `challenge-record:${c.id}`),
      })),
      me: user.id,
    };
  }

  /**
   * Monster Hunt records set in challenges of a season (the yearbook, decision 338): the team,
   * the map and the time of every record bonus paid.
   */
  recordsOf(season: number) {
    return this.db
      .select()
      .from(neuroLedger)
      .where(and(eq(neuroLedger.season, season), eq(neuroLedger.kind, 'udt_challenge_record')))
      .all()
      .map((b) => {
        const meta = (b.metaJson ? JSON.parse(b.metaJson) : {}) as {
          map?: string;
          finalMs?: number;
        };
        const team = this.udt.team(b.userId, season);
        return {
          team: team?.name ?? '?',
          tag: team?.tag ?? '',
          map: meta.map ?? '?',
          finalMs: meta.finalMs ?? 0,
          at: b.at,
        };
      })
      .sort((a, b) => a.at.localeCompare(b.at));
  }

  /**
   * Challenge evenings for the calendar (decision 338): per day of [from, to] (season time zone)
   * the first start, the last end, the games, whether the manager's team plays (first own game
   * and opponent), whether a Monster Hunt showcase is on, and the state.
   */
  calendar(from: string, to: string, userId: string) {
    if (!this.visible()) return [];
    const now = this.nowIso();
    const rows = this.db
      .select()
      .from(udtChallenges)
      .where(inArray(udtChallenges.status, ['accepted', 'locked', 'played']))
      .all()
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const days = new Map<string, Row[]>();
    for (const c of rows) {
      const d = today(Date.parse(c.scheduledAt), this.tz);
      if (d >= from && d <= to) days.set(d, [...(days.get(d) ?? []), c]);
    }
    return [...days.entries()].map(([day, list]) => {
      const mine = list.find((c) => this.involves(c, userId));
      const other = mine ? (mine.fromUser === userId ? mine.toUser : mine.fromUser) : null;
      const until = list.reduce((m, c) => (c.endsAt > m ? c.endsAt : m), list[0]!.endsAt);
      const state: 'done' | 'live' | 'planned' = list.every((c) => c.status === 'played')
        ? 'done'
        : list[0]!.scheduledAt <= now && until > now
          ? 'live'
          : 'planned';
      return {
        day,
        at: list[0]!.scheduledAt,
        until,
        games: list.length,
        showcase: list.some((c) => c.mode === 'mh'),
        state,
        myGame: mine
          ? {
              at: mine.scheduledAt,
              opponent: (other && this.udt.team(other, mine.season)?.name) || '?',
            }
          : null,
      };
    });
  }

  /**
   * The challenge evenings of the season (decision 338): per day the booked and played
   * challenges, the main fight first (a Monster Hunt showcase before deathmatch, then the
   * highest stake).
   */
  evenings(user: User) {
    this.assertOn();
    const s = this.udt.season();
    const ai = this.udt.aiIds();
    const rows = this.db
      .select()
      .from(udtChallenges)
      .where(
        and(
          eq(udtChallenges.season, s.number),
          inArray(udtChallenges.status, ['accepted', 'locked', 'played']),
        ),
      )
      .all()
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const days = new Map<string, Row[]>();
    for (const c of rows) {
      const d = today(Date.parse(c.scheduledAt), this.tz);
      days.set(d, [...(days.get(d) ?? []), c]);
    }
    const records = new Set(
      this.db
        .select({ ref: neuroLedger.ref })
        .from(neuroLedger)
        .where(eq(neuroLedger.kind, 'udt_challenge_record'))
        .all()
        .map((r) => r.ref),
    );
    return {
      today: today(this.now(), this.tz),
      days: [...days.entries()].map(([date, list]) => {
        const main = mainFight(list);
        return {
          date,
          main: main?.id ?? null,
          items: list.map((c) => ({
            ...this.item(c, user.id, ai),
            record: records.has(`challenge-record:${c.id}`),
          })),
        };
      }),
    };
  }

  // ------------------------------------------------------------------------------------------
  // Views
  // ------------------------------------------------------------------------------------------

  /** Whether challenges show (Dream Team and challenges on): their area in Dream Team. */
  visible(): boolean {
    const u = this.settings.get().udt;
    return u.enabled && u.challenge.enabled;
  }

  /**
   * The hub's state of the challenges (decision 337): answers waiting, open challenges the
   * manager can take, the next booked one.
   */
  hub(userId: string) {
    const season = this.udt.seasonNumber();
    if (season === null || !this.visible()) return null;
    const now = this.nowIso();
    const tier = this.tierOf(userId);
    const rows = this.db
      .select()
      .from(udtChallenges)
      .where(and(eq(udtChallenges.season, season), inArray(udtChallenges.status, ACTIVE)))
      .all();
    const pending = rows.filter((c) => c.status === 'pending' && c.expiresAt > now);
    const next = rows
      .filter((c) => c.status !== 'pending' && this.involves(c, userId))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
    const other = next ? (next.fromUser === userId ? next.toUser : next.fromUser) : null;
    // Today's Monster Hunt showcase (for every manager, decision 338): the main fight.
    const day = today(this.now(), this.tz);
    const show = mainFight(
      rows.filter(
        (c) =>
          c.mode === 'mh' &&
          c.status !== 'pending' &&
          today(Date.parse(c.scheduledAt), this.tz) === day,
      ),
    );
    const sideName = (u: string | null) => (u && this.udt.team(u, season)?.name) || '?';
    return {
      showcase: show
        ? {
            at: show.scheduledAt,
            from: sideName(show.fromUser),
            to: sideName(show.toUser),
            hardness: show.hardness,
            stake: show.stake,
            map: show.map,
            mine: this.involves(show, userId),
          }
        : null,
      incoming: pending.filter((c) => c.toUser === userId).length,
      open: pending.filter(
        (c) =>
          c.toUser === null &&
          c.fromUser !== userId &&
          (c.openScope !== 'tier' || c.openTier === tier),
      ).length,
      next: next
        ? {
            at: next.scheduledAt,
            mode: next.mode as ChallengeMode,
            stake: next.stake,
            opponent: (other && this.udt.team(other, season)?.name) || '?',
          }
        : null,
    };
  }

  /**
   * Teams a manager can challenge (decision 337): every other team of the season with its
   * lineup strength for the format, whether it can field it, the Monster Hunt lineup, and how
   * many challenges the pair has left this week.
   */
  opponents(user: User, q: { mode: ChallengeMode; teamSize: number }) {
    this.assertOn();
    const s = this.udt.season();
    const c = this.cfg();
    const f = {
      mode: q.mode,
      teamSize: q.mode === 'mh' ? MH_TEAM_SIZE : q.teamSize,
      bestOf: 1,
      map: null,
      hardness: null,
    };
    const ai = this.udt.aiIds();
    const aiOn = this.udt.aiOn() && c.ai;
    const mine = this.udt.team(user.id, s.number) ? this.lineupState(user.id, f) : null;
    const teams = this.udt
      .teams(s.number)
      .filter((t) => t.userId !== user.id && (aiOn || !ai.has(t.userId)))
      .map((t) => {
        const st = this.lineupState(t.userId, f);
        const used = c.pairPerWeek ? this.pairCount(s.number, user.id, t.userId, null) : 0;
        return {
          userId: t.userId,
          name: t.name,
          tag: t.tag,
          ai: ai.has(t.userId),
          strength: Math.round(st.strength * 10) / 10,
          full: st.full,
          mh: this.mhBots(t.userId),
          pairLeft: c.pairPerWeek ? Math.max(0, c.pairPerWeek - used) : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      me: mine
        ? {
            strength: Math.round(mine.strength * 10) / 10,
            full: mine.full,
            mh: this.mhBots(user.id),
          }
        : null,
      teams,
    };
  }

  private side(userId: string | null, season: number, ai: Set<string>) {
    if (!userId) return null;
    const t = this.udt.team(userId, season);
    return { userId, name: t?.name ?? '?', tag: t?.tag ?? '', ai: ai.has(userId) };
  }

  private item(c: Row, userId: string, ai: Set<string>) {
    const { pot, prize } = challengePot(c.stake, c.feePct);
    return {
      id: c.id,
      status: c.status as Status,
      mode: c.mode as ChallengeMode,
      teamSize: c.teamSize,
      bestOf: c.bestOf,
      map: c.map,
      hardness: c.hardness,
      stake: c.stake,
      feePct: c.feePct,
      pot,
      prize,
      scheduledAt: c.scheduledAt,
      endsAt: c.endsAt,
      expiresAt: c.expiresAt,
      createdAt: c.createdAt,
      answeredAt: c.answeredAt,
      decidedAt: c.decidedAt,
      round: c.round,
      counterOf: c.counterOf,
      rematchOf: c.rematchOf,
      message: c.message,
      reason: c.reason,
      tournamentId: c.tournamentId,
      winner: c.winnerUser,
      from: this.side(c.fromUser, c.season, ai)!,
      to: this.side(c.toUser, c.season, ai),
      open: c.toUser === null ? { scope: c.openScope ?? 'all', tier: c.openTier } : null,
      incoming: c.toUser === userId,
      mine: c.fromUser === userId,
    };
  }

  /**
   * A manager's challenges: waiting answers (incoming), sent ones, open challenges of others
   * it can take, the booked ones coming, the last decided; with the rules of the window.
   */
  view(user: User) {
    this.assertOn();
    this.sweep();
    const s = this.udt.season();
    const c = this.cfg();
    const ai = this.udt.aiIds();
    const all = this.db
      .select()
      .from(udtChallenges)
      .where(eq(udtChallenges.season, s.number))
      .all()
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    const now = this.nowIso();
    const pending = all.filter((x) => x.status === 'pending' && x.expiresAt > now);
    const item = (x: Row) => this.item(x, user.id, ai);
    const tier = this.tierOf(user.id);
    return {
      incoming: pending.filter((x) => x.toUser === user.id).map(item),
      outgoing: pending.filter((x) => x.fromUser === user.id).map(item),
      open: pending
        .filter(
          (x) =>
            x.toUser === null &&
            x.fromUser !== user.id &&
            (x.openScope !== 'tier' || x.openTier === tier),
        )
        .map(item),
      upcoming: all
        .filter(
          (x) => (x.status === 'accepted' || x.status === 'locked') && this.involves(x, user.id),
        )
        .map(item),
      recent: all
        .filter((x) => !ACTIVE.includes(x.status as Status) && this.involves(x, user.id))
        .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt))
        .slice(0, 20)
        .map(item),
      rules: {
        days: c.days,
        from: c.from,
        to: c.to,
        servers: c.servers,
        modes: c.modes,
        teamSizes: c.teamSizes,
        bestOf: c.bestOf,
        stakeCap: this.cap(s.number),
        minStake: 100,
        feePct: c.feePct,
        mh: {
          feePct: c.mh.feePct,
          recordBonus: stakeCap(c.mh.recordBonus, this.udt.index(s.number)),
          hardness: c.mh.hardness,
          records: this.mhRecords(s.number),
        },
        maps: { dm: this.mapPool('dm'), mh: this.mapPool('mh') },
        pairPerWeek: c.pairPerWeek,
        perDay: c.perDay,
        maxOpen: c.maxOpen,
        expiryHours: c.expiryHours,
        lockMin: c.lockMin,
        maxRounds: MAX_ROUNDS,
      },
      spendable: this.ledger.spendable(user.id).spendable,
      tier,
      me: user.id,
    };
  }
}

/** The challenge a tournament belongs to (its Dream Team rules), if any. */
export function challengeIdOf(udtJson: string | null): string | null {
  if (!udtJson) return null;
  try {
    const id = (JSON.parse(udtJson) as { challenge?: { id?: unknown } | null }).challenge?.id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

const holdRef = (id: string, userId: string) => `challenge-hold:${id}:${userId}`;

/**
 * The main fight of an evening (decision 338): a Monster Hunt showcase before deathmatch, then
 * the highest stake, then the earliest.
 */
export function mainFight<C extends { mode: string; stake: number; scheduledAt: string }>(
  list: readonly C[],
): C | null {
  return (
    [...list].sort(
      (a, b) =>
        Number(b.mode === 'mh') - Number(a.mode === 'mh') ||
        b.stake - a.stake ||
        a.scheduledAt.localeCompare(b.scheduledAt),
    )[0] ?? null
  );
}

/** Events that decide a challenge's tournament (its match, its end, called off). */
const decides = (e: TournamentEvent) =>
  e.type === 'match.result' || e.type === 'tournament.finished' || e.type === 'tournament.aborted';

const Inventory = z.object({ maps: z.array(z.object({ id: z.string() })) });

/** Throws when a team cannot play then (its own challenges, its day, a cup it entered). */
function teamError(p: 'busy' | 'day' | 'cup' | null, own: boolean, n: number): void {
  if (p === 'busy')
    throw own
      ? conflict('your team plays another challenge then')
      : conflict('the other team plays another challenge then');
  if (p === 'day')
    throw own
      ? conflict('your team plays {n} challenges that day already', { n })
      : conflict('the other team plays {n} challenges that day already', { n });
  if (p === 'cup')
    throw own
      ? conflict('your team plays a cup then')
      : conflict('the other team plays a cup then');
}
