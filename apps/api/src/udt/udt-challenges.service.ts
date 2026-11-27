import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { ADAPTER_MH } from '@tourney/adapter-ut99';
import type { TournamentSettings } from '@tourney/protocol';
import {
  challengeMinutes,
  challengePot,
  isWindowStart,
  leagueClashDays,
  MH_TEAM_SIZE,
  PER_EVENING,
  stakeCap,
  stakeProblem,
  weekdayOf,
  windowStarts,
  type ChallengeMode,
} from '@tourney/udt';
import { z } from 'zod';
import { AgentsService } from '../agents/agents.service.js';
import type { User } from '../auth/users.service.js';
import { ServerActivity } from '../common/activity.js';
import { badRequest, conflict, forbidden, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { CLOCK, CONFIG, type ApiClock, type ApiConfig } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { tournaments, udtChallenges, udtEntries } from '../db/schema.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { nextDay, today, zonedMs } from '../seasons/season-time.js';
import {
  SettingsService,
  type ChallengeSettings,
  type UdtSettings,
} from '../settings/settings.service.js';
import type { CalendarTournament, Reservation } from '../tournaments/server-calendar.js';
import { estimateMs } from '../tournaments/server-calendar.js';
import { TournamentsService, UdtEventRulesSchema } from '../tournaments/tournaments.service.js';
import { UdtEventsService } from './udt-events.service.js';
import { estimateEvening, UdtLeagueService } from './udt-league.service.js';
import { UdtService } from './udt.service.js';

const DAY = 86_400_000;
const MIN = 60_000;

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

export const SlotsQuery = z.object({
  mode: z.enum(['dm', 'mh']).default('dm'),
  bestOf: z.coerce.number().int().min(1).max(5).default(1),
  opponent: z.string().min(1).max(40).optional(),
  days: z.coerce.number().int().min(1).max(14).default(7),
});
export type SlotsInput = z.infer<typeof SlotsQuery>;

type Row = typeof udtChallenges.$inferSelect;
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
 * a cap at the index. The match itself (lineups at the lock, bets, the pot) follows in the next
 * step.
 */
@Injectable()
export class UdtChallengesService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  /** A challenge whose own reservation is left out while it is being moved (counter offers). */
  private ignore: string | null = null;

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
  ) {}

  onModuleInit(): void {
    this.tournaments.calendar.registerSource((agentId, from, to) =>
      this.reservations(agentId, from, to),
    );
    this.settings.checkUdt((next, sent) => {
      if (sent.challenge || sent.league) this.checkWindow(next);
    });
    this.timer = setInterval(
      () => void this.activity.task('challenges', () => this.sweep()),
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
      map: body.map,
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
      .where(
        and(eq(udtChallenges.id, c.id), inArray(udtChallenges.status, ['pending', 'accepted'])),
      )
      .run();
    if (!done.changes) return false;
    this.refund(c, c.fromUser);
    if (c.toUser && c.status === 'accepted') this.refund(c, c.toUser);
    return true;
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
    return this.view(user);
  }

  /** The challenged team says no: the challenger's stake comes back. */
  decline(user: User, id: string) {
    this.assertOn();
    const c = this.get(id);
    if (c.toUser !== user.id) throw forbidden('only the challenged team can answer');
    if (c.status !== 'pending') throw conflict('the challenge is {status}', { status: c.status });
    this.close(c, 'declined');
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
      .where(eq(udtChallenges.status, 'pending'))
      .all())
      if (c.expiresAt <= now || c.season !== season) if (this.close(c, 'expired')) n++;
    return n;
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
  // Views
  // ------------------------------------------------------------------------------------------

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
        },
        pairPerWeek: c.pairPerWeek,
        perDay: c.perDay,
        maxOpen: c.maxOpen,
        expiryHours: c.expiryHours,
        lockMin: c.lockMin,
        maxRounds: MAX_ROUNDS,
      },
      spendable: this.ledger.spendable(user.id).spendable,
      tier,
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
