import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray, lte, sql, type SQL } from 'drizzle-orm';
import {
  udtEntrantId,
  type BotSpec,
  type Entrant,
  type TournamentSettings,
} from '@tourney/protocol';
import {
  botStrength,
  clubFactor,
  eveningsOf,
  finalFour,
  leagueBots,
  leagueRng,
  matchdaysOf,
  nextTiers,
  PER_EVENING,
  promotion,
  rewardIndex,
  rubberBands,
  schedule,
  simulateGame,
  standings,
  tableMoney,
  valueScore,
  winsNeeded,
  type LeagueResult,
  type TableRow,
} from '@tourney/udt';
import { z } from 'zod';
import { UsersService, type User } from '../auth/users.service.js';
import { badRequest, conflict, forbidden, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { ServerActivity } from '../common/activity.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { pickTeamNames } from '../common/names.js';
import { CLOCK, CONFIG, type ApiClock, type ApiConfig } from '../config.js';
import { DB, type Db } from '../db/database.js';
import {
  leagueClubs,
  leagueFixtures,
  leagueRuns,
  leagueSeasons,
  tournaments,
  udtAi,
} from '../db/schema.js';
import { BetsService } from '../bets/bets.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { isoWeekday } from '../series/series-time.js';
import { nextDay, zonedMs } from '../seasons/season-time.js';
import { SeasonsService, type Season } from '../seasons/seasons.service.js';
import { SettingsService, type LeagueSettings } from '../settings/settings.service.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import { ServerCalendar } from '../tournaments/server-calendar.js';
import {
  TournamentsService,
  UdtEventRulesSchema,
  type LeagueTag,
  type TournamentRow,
} from '../tournaments/tournaments.service.js';
import { UdtEventsService } from './udt-events.service.js';
import { UdtMarketService } from './udt-market.service.js';
import { UdtRewardsService } from './udt-rewards.service.js';
import { gameName, UdtService } from './udt.service.js';

type FixtureRow = typeof leagueFixtures.$inferSelect;
type RunRow = typeof leagueRuns.$inferSelect;
type ClubRow = typeof leagueClubs.$inferSelect;
export type FixtureKind = 'league' | 'relegation' | 'semi' | 'final' | 'third';

function chunks<T>(list: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/** What the simulations of one evening share (see `simContext`). */
interface SimContext {
  strength: (clubId: string) => number;
  /** Per day: when the last simulated result shows. */
  latest: Map<string, number>;
  fragLimit: number;
}

/**
 * Runs the steps one after another and gives the event loop a turn whenever about 20 ms of
 * work were done (requests, the bridge, live data go on in between).
 */
export async function runInSteps(
  steps: (() => void)[],
  onError: (e: unknown) => void,
  onStep?: (done: number) => void,
): Promise<void> {
  let since = performance.now();
  for (let i = 0; i < steps.length; i++) {
    try {
      steps[i]!();
    } catch (e) {
      onError(e);
    }
    onStep?.(i + 1);
    if (performance.now() - since > 20) {
      await new Promise<void>((r) => setImmediate(r));
      since = performance.now();
    }
  }
}

/** The days of a league: the evenings with their matchdays, the relegation and final day. */
export interface LeaguePlan {
  slotTime: string;
  evenings: { day: string; matchdays: number[] }[];
  relegation: string;
  final: string;
}

export const TestLeagueBody = z.object({
  /** First league evening (date); default tomorrow. */
  startDate: z.iso.date().optional(),
  /** Matchdays per evening; default: what fits before the season's end. */
  perEvening: z.number().int().min(1).max(30).optional(),
  placement: z.enum(['cup', 'random', 'one']).default('cup'),
  tableMoney: z.boolean().default(true),
});
export type TestLeagueInput = z.infer<typeof TestLeagueBody>;

/** The plan of a league started late (the start dialog, decision 230). */
export const FitQuery = z.object({ startDate: z.iso.date().optional() });

export const EstimateQuery = z.object({
  tiers: z.coerce.number().int().min(1).max(4).optional(),
  size: z.coerce.number().int().min(8).max(16).optional(),
  length: z.enum(['short', 'medium', 'long']).optional(),
  aiGames: z.enum(['simulate', 'topGame', 'all']).optional(),
  managers: z.coerce.number().int().min(0).max(64).optional(),
});

/** Minutes of a played league game with the pause before the next (5v5, export of 25.10.). */
export const GAME_MINUTES = 4;
/** Buffer of the league's reservation after its estimated time. */
const BUFFER_MS = 15 * 60_000;
const DAY = 86_400_000;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Entrant id of an AI club in a league game. */
export const aiClubEntrantId = (clubId: string) => `lg-${clubId}`;

/**
 * The days of a league from `start`: `perEvening` matchdays on each league weekday, then the
 * relegation day and the final four day (the next two days). Null: it does not end by `end`.
 */
export function leaguePlan(o: {
  start: string;
  end: string;
  weekdays: readonly number[];
  perEvening: number;
  size: number;
  slotTime: string;
  /** A test league may use every day when the league weekdays are too few. */
  anyDay?: boolean;
}): LeaguePlan | null {
  const total = matchdaysOf(o.size);
  const evenings: LeaguePlan['evenings'] = [];
  let md = 0;
  for (let d = o.start; md < total && d <= o.end; d = addDays(d, 1)) {
    if (!o.anyDay && !o.weekdays.includes(isoWeekday(d) - 1)) continue;
    const n = Math.min(o.perEvening, total - md);
    evenings.push({ day: d, matchdays: Array.from({ length: n }, (_, i) => md + i) });
    md += n;
  }
  if (md < total) return null;
  const last = evenings.at(-1)!.day;
  const relegation = addDays(last, 1);
  const final = addDays(last, 2);
  if (final > o.end) return null;
  return { slotTime: o.slotTime, evenings, relegation, final };
}

/**
 * A league that starts late (a test league, a league started in a running season): the fewest
 * matchdays per evening that still end by `end` - on the league weekdays, else on any day.
 */
export function fittedPlan(o: {
  start: string;
  end: string;
  weekdays: readonly number[];
  size: number;
  slotTime: string;
}): LeaguePlan | null {
  for (const anyDay of [false, true])
    for (let n = 1; n <= matchdaysOf(o.size); n++) {
      const plan = leaguePlan({ ...o, perEvening: n, anyDay });
      if (plan) return plan;
    }
  return null;
}

/** A plan in short (the settings tab, decision 230). */
export interface PlanSummary {
  first: string;
  time: string;
  evenings: number;
  perEvening: number;
  last: string;
  relegation: string;
  final: string;
}

const summary = (p: LeaguePlan): PlanSummary => ({
  first: p.evenings[0]!.day,
  time: p.slotTime,
  evenings: p.evenings.length,
  perEvening: p.evenings[0]!.matchdays.length,
  last: p.evenings.at(-1)!.day,
  relegation: p.relegation,
  final: p.final,
});

/**
 * Where the league stands (the settings tab, decision 230): `off`, `waiting` (starts on its
 * start day in this season), `nextSeason` (this season's start day is over), `running`, `done`.
 */
export interface LeagueStatus {
  state: 'off' | 'waiting' | 'nextSeason' | 'running' | 'done';
  test: boolean;
  /** The next start by the settings (null: no season to start in yet, or the league is off). */
  start: { season: number; day: string; plan: PlanSummary | null } | null;
  /** A league started tomorrow in the running season (null: none fits, or one exists). */
  now: PlanSummary | null;
  /** A running league: evenings and matchdays played, the next evening. */
  progress: {
    evenings: number;
    eveningsTotal: number;
    matchdays: number;
    matchdaysTotal: number;
    next: { day: string; matchdays: number[] } | null;
    relegation: string;
    final: string;
    time: string;
    /** It can still be called off (a test league, or nothing played yet). */
    abortable: boolean;
  } | null;
  champion: string | null;
}

/**
 * Estimated server time of a league evening in minutes (played games × 4 min): per matchday
 * the pairings with a manager (expected from the managers per tier), plus a top game or every
 * AI game when they are played.
 */
export function estimateEvening(o: {
  managers: number;
  tiers: number;
  size: number;
  perEvening: number;
  aiGames: LeagueSettings['aiGames'];
}): { minutes: number; realPerMatchday: number } {
  let real = 0;
  // Managers fill the tiers from the top (as many per tier as fit).
  let left = o.managers;
  for (let t = 0; t < o.tiers; t++) {
    const h = Math.min(o.size, Math.ceil(left / (o.tiers - t)));
    left -= h;
    const n = o.size;
    const pairs = n / 2;
    // Expected pairings of two AI clubs: pairs × P(both AI).
    const aiPairs = pairs * (((n - h) * (n - h - 1)) / (n * (n - 1)));
    real +=
      o.aiGames === 'all' ? pairs : pairs - aiPairs + (o.aiGames === 'topGame' && t === 0 ? 1 : 0);
  }
  return {
    minutes: Math.round(real * o.perEvening * GAME_MINUTES),
    realPerMatchday: Math.round(real * 10) / 10,
  };
}

/**
 * The Dream Team league (league plan L6-L9): a season's run with its clubs (managers' teams and
 * AI clubs) in tiers, the fixture list, the league evenings - games with a manager are played on
 * the server (one tournament each, kept free by the server calendar), AI against AI is simulated
 * and shown during the evening - the table, the weekly table money and cup bonus, relegation,
 * the Pro Series final four and the move into the next season. A test league can run in a
 * season that started without one.
 */
@Injectable()
export class UdtLeagueService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(ServerActivity) private readonly activity: ServerActivity,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(UdtService) private readonly udt: UdtService,
    @Inject(UdtEventsService) private readonly events: UdtEventsService,
    @Inject(UdtRewardsService) private readonly rewards: UdtRewardsService,
    @Inject(UdtMarketService) private readonly market: UdtMarketService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
    @Inject(EventLogService) private readonly eventLog: EventLogService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(BetsService) private readonly bets: BetsService,
  ) {}

  onModuleInit(): void {
    const calendar: ServerCalendar = this.tournaments.calendar;
    calendar.registerSource((agentId, from, to) => this.reservations(agentId, from, to));
    calendar.registerDeadline((t) => {
      const f = this.fixtureOfTournament(t.id);
      // A league game waits for its server until the evening is over.
      return f ? zonedMs(nextDay(f.day), '00:00', this.tz) : null;
    });
    this.events.leagueLineup = (t, settings) => this.lineup(t, settings);
    this.eventLog.onAppend((id, stored) => {
      if (!stored.some((e) => e.type === 'match.result' || e.type === 'tournament.aborted')) return;
      try {
        this.onResult(id);
      } catch (e) {
        this.log.error(`league result ${id}: ${(e as Error).message}`);
      }
    });
    // The market's own timer is left out: the league has its timer (with pauses, tickAsync).
    this.market.onTick((fromTimer) => {
      if (!fromTimer) this.tick();
    });
    this.settings.checkUdt((next, sent) => {
      if (sent.league) this.checkFits(next.league);
    });
    this.market.afterDay((season, day) => this.marketDay(season, day));
    this.rewards.leagueChampion = (season) => this.champion(season);
    this.tournaments.leagueOf = (t, userId) => this.tagOf(t, userId);
    this.bets.botsPerMatchOf = (t) =>
      t.kind === 'udt' && t.udtJson && this.rulesOf(t.udtJson)?.league ? this.cfg().betBots : null;
    this.udt.onFounded((userId, season) => {
      try {
        this.newcomer(userId, season);
      } catch (e) {
        this.log.error(`league newcomer ${userId}: ${(e as Error).message}`);
      }
    });
    this.tournaments.onResetAll(() => this.wipe());
    this.timer = setInterval(
      () => void this.activity.task('league', () => this.tickAsync()),
      30_000,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private get tz(): string {
    return this.config.seasonTimeZone;
  }

  private cfg(): LeagueSettings {
    return this.settings.get().udt.league;
  }

  private nowIso(): string {
    return new Date(this.clock.now()).toISOString();
  }

  /** Website reset: the league goes with the Dream Team. */
  wipe(): void {
    for (const t of [leagueFixtures, leagueSeasons, leagueRuns, leagueClubs])
      this.db.delete(t).run();
  }

  // ------------------------------------------------------------------------------------------
  // Reading
  // ------------------------------------------------------------------------------------------

  run(season: number): RunRow | undefined {
    return this.db.select().from(leagueRuns).where(eq(leagueRuns.season, season)).get();
  }

  private plan(run: RunRow): LeaguePlan {
    return JSON.parse(run.planJson) as LeaguePlan;
  }

  private clubs(): Map<string, ClubRow> {
    return new Map(
      this.db
        .select()
        .from(leagueClubs)
        .all()
        .map((c) => [c.id, c]),
    );
  }

  private members(season: number) {
    return this.db.select().from(leagueSeasons).where(eq(leagueSeasons.season, season)).all();
  }

  fixtures(season: number): FixtureRow[] {
    return this.db
      .select()
      .from(leagueFixtures)
      .where(eq(leagueFixtures.season, season))
      .orderBy(
        asc(leagueFixtures.matchday),
        asc(leagueFixtures.scheduledAt),
        asc(leagueFixtures.id),
      )
      .all();
  }

  private fixtureOfTournament(id: string): FixtureRow | undefined {
    return this.db.select().from(leagueFixtures).where(eq(leagueFixtures.tournamentId, id)).get();
  }

  /** A decided game as the table sees it (only once it is shown: simulated ones tick in). */
  private result(f: FixtureRow, now = this.clock.now()): LeagueResult | null {
    if (!f.winner || f.homeFrags === null || f.awayFrags === null) return null;
    if (f.revealAt && Date.parse(f.revealAt) > now) return null;
    return {
      home: f.home,
      away: f.away,
      homeFrags: f.homeFrags,
      awayFrags: f.awayFrags,
      overtime: f.overtime,
      winner: f.winner,
    };
  }

  /** The table of each tier (tier 0 = Pro Series) from the shown regular games. */
  tables(
    season: number,
    now = this.clock.now(),
    beforeDay?: string,
    /** The season's games, when the caller has read them already. */
    fixtures?: FixtureRow[],
  ): TableRow[][] {
    const run = this.run(season);
    if (!run) return [];
    const members = this.members(season);
    const all = (fixtures ?? this.fixtures(season)).filter((f) => f.kind === 'league');
    return Array.from({ length: run.tiers }, (_, t) =>
      standings(
        members.filter((m) => m.tier === t).map((m) => m.clubId),
        all
          .filter((f) => f.tier === t && (!beforeDay || f.day < beforeDay))
          .map((f) => this.result(f, now))
          .filter((r): r is LeagueResult => !!r),
        `${season}:${t}`,
      ),
    );
  }

  /** The human clubs' user ids by club id. */
  private humanClubs(): Map<string, string> {
    return new Map(
      [...this.clubs().values()].filter((c) => c.userId).map((c) => [c.id, c.userId!]),
    );
  }

  // ------------------------------------------------------------------------------------------
  // Server calendar: the league evenings
  // ------------------------------------------------------------------------------------------

  /** The server of the league: the setting, else the newest Dream Team tournament's. */
  server(): { agentId: string; profileId: string } | null {
    const cfg = this.cfg();
    if (cfg.agentId && cfg.profileId) return { agentId: cfg.agentId, profileId: cfg.profileId };
    const t = this.db
      .select({
        kind: tournaments.kind,
        udtJson: tournaments.udtJson,
        agentId: tournaments.agentId,
        profileId: tournaments.profileId,
      })
      .from(tournaments)
      .where(eq(tournaments.kind, 'udt'))
      .orderBy(desc(tournaments.createdAt))
      .all()
      .find((x) => !this.isLeagueTournament(x));
    return t ? { agentId: t.agentId, profileId: t.profileId } : null;
  }

  private reservations(agentId: string, from: number, to: number) {
    const season = this.seasons.current();
    const run = season ? this.run(season.number) : undefined;
    if (!run || run.status !== 'running' || this.server()?.agentId !== agentId) return [];
    const plan = this.plan(run);
    // Asked for every tournament that could start (autostart, every tick): only what it needs.
    const real = this.db
      .select({ day: leagueFixtures.day, status: leagueFixtures.status })
      .from(leagueFixtures)
      .where(and(eq(leagueFixtures.season, run.season), eq(leagueFixtures.real, true)))
      .all();
    const perDay = new Map<string, number>();
    for (const f of real) perDay.set(f.day, (perDay.get(f.day) ?? 0) + 1);
    const days = [
      ...plan.evenings.map((e) => e.day),
      plan.relegation,
      plan.final,
      ...real.filter((f) => f.status === 'scheduled').map((f) => f.day),
    ];
    const out = [];
    for (const day of new Set(days)) {
      const start = zonedMs(day, plan.slotTime, this.tz);
      const games = perDay.get(day) || 1;
      const end = start + games * GAME_MINUTES * 60_000 + BUFFER_MS;
      if (start < to && end > from)
        out.push({
          from: start,
          to: end,
          label: 'league',
          allows: (t: { kind: string; udtJson: string | null }) =>
            t.kind === 'udt' && !!t.udtJson && !!this.rulesOf(t.udtJson)?.league,
        });
    }
    return out;
  }

  /** A league game's tournament (its rules name the fixture). */
  isLeagueTournament(t: { kind: string; udtJson: string | null }): boolean {
    return t.kind === 'udt' && !!t.udtJson && !!this.rulesOf(t.udtJson)?.league;
  }

  /** The league shows in Dream Team (setting on, or a league in the running season). */
  visible(): boolean {
    if (this.cfg().enabled) return true;
    const season = this.seasons.current();
    return !!season && !!this.run(season.number);
  }

  /** The league for the Dream Team hub: running, the manager's next game, place and tier. */
  hubLeague(userId: string) {
    const season = this.seasons.current();
    const run = season ? this.run(season.number) : undefined;
    const none = { visible: true, running: false, next: null, place: null, tier: null };
    if (!run) return { ...none, visible: this.visible() };
    const clubs = this.clubs();
    const members = new Map(this.members(run.season).map((m) => [m.clubId, m]));
    const mine = [...clubs.values()].find((c) => c.userId === userId && members.has(c.id));
    const running = run.status === 'running';
    if (!mine) return { ...none, running };
    const all = this.fixtures(run.season);
    // The next by kick-off (a postponed game keeps its matchday).
    const f = all
      .filter((x) => (x.home === mine.id || x.away === mine.id) && x.status === 'scheduled')
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
    const other = f ? (f.home === mine.id ? f.away : f.home) : null;
    return {
      visible: true,
      running,
      next: f
        ? {
            at: f.scheduledAt,
            kind: f.kind as FixtureKind,
            matchday: f.kind === 'league' ? f.matchday : null,
            opponent: clubs.get(other!)?.name ?? '?',
            home: f.home === mine.id,
          }
        : null,
      place: placeIn(this.tables(run.season, this.clock.now(), undefined, all), mine.id),
      tier: members.get(mine.id)?.tier ?? null,
    };
  }

  /** A league game in the tournament lists: evening, matchday, clubs, the user's own. */
  private tagOf(t: TournamentRow, userId: string): LeagueTag | null {
    const rules = t.kind === 'udt' && t.udtJson ? this.rulesOf(t.udtJson)?.league : null;
    if (!rules) return null;
    const f = this.db
      .select()
      .from(leagueFixtures)
      .where(eq(leagueFixtures.id, rules.fixture))
      .get();
    if (!f) return null;
    const clubs = this.db
      .select()
      .from(leagueClubs)
      .where(inArray(leagueClubs.id, [f.home, f.away]))
      .all();
    const club = (id: string) => clubs.find((c) => c.id === id);
    // A game called off and moved on: its old tournament stays on its own evening.
    const day =
      f.tournamentId !== t.id && t.scheduledAt
        ? new Intl.DateTimeFormat('en-CA', { timeZone: this.tz }).format(new Date(t.scheduledAt))
        : f.day;
    return {
      season: f.season,
      kind: f.kind as FixtureKind,
      day,
      matchday: f.kind === 'league' ? f.matchday : null,
      home: club(f.home)?.name ?? '?',
      away: club(f.away)?.name ?? '?',
      mine: club(f.home)?.userId === userId || club(f.away)?.userId === userId,
    };
  }

  private rulesOf(json: string) {
    try {
      return UdtEventRulesSchema.parse(JSON.parse(json));
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------------------------------
  // The season's start
  // ------------------------------------------------------------------------------------------

  /** Day n (1-based) of a season. */
  private seasonDay(s: Season, n: number): string {
    return addDays(s.startDate, n - 1);
  }

  /** The plan of the settings for a season (null: the league does not fit into it). */
  planFor(
    s: Pick<Season, 'startDate' | 'endDate'>,
    cfg = this.cfg(),
    /** A later first day (a start one day late). */
    from?: string,
  ): LeaguePlan | null {
    const first = addDays(s.startDate, cfg.startDay - 1);
    return leaguePlan({
      start: from && from > first ? from : first,
      end: s.endDate,
      weekdays: cfg.slotDays,
      perEvening: PER_EVENING[cfg.length],
      size: cfg.size,
      slotTime: cfg.slotTime,
    });
  }

  /**
   * Settings check (Settings page, tab "UDT Liga"): the league must fit into the running or the
   * next season; else the error names a length that fits.
   */
  checkFits(cfg: LeagueSettings): void {
    if (!cfg.enabled) return;
    const list = this.seasons.overview().seasons;
    const s = list.find((x) => x.status === 'planned') ?? list.find((x) => x.status === 'running');
    if (!s || this.planFor(s, cfg)) return;
    const fit = (['medium', 'short'] as const).find((l) => this.planFor(s, { ...cfg, length: l }));
    throw conflict('the league does not fit into season {season}: {hint}', {
      season: s.number,
      hint: fit ?? 'none',
    });
  }

  /**
   * Starts the league of a season: the managers with a team (not the AI managers) in their tier
   * (last season's league, newcomers at the bottom; a first league by the cup ranking), AI clubs
   * fill every tier, the fixture list on the league evenings.
   */
  start(
    season: Season,
    o: {
      test?: boolean;
      startDate?: string;
      perEvening?: number;
      placement?: 'cup' | 'random' | 'one';
      tableMoney?: boolean;
      /** Started late: the fewest matchdays per evening that fit (like a test league). */
      fit?: boolean;
    } = {},
  ): RunRow {
    // One transaction: a failed start leaves no clubs behind (the next tick tries again).
    return this.db.transaction(() => this.startNow(season, o));
  }

  private startNow(
    season: Season,
    o: {
      test?: boolean;
      startDate?: string;
      perEvening?: number;
      placement?: 'cup' | 'random' | 'one';
      tableMoney?: boolean;
      fit?: boolean;
    },
  ): RunRow {
    const cfg = this.cfg();
    if (this.run(season.number))
      throw conflict('the league of season {season} runs already', { season: season.number });
    const tiers = cfg.tiers;
    const size = cfg.size;
    const start =
      o.startDate ?? (o.test ? nextDay(this.udt.today()) : this.seasonDay(season, cfg.startDay));
    let plan: LeaguePlan | null = null;
    if (o.perEvening)
      plan = leaguePlan({
        start,
        end: season.endDate,
        weekdays: cfg.slotDays,
        perEvening: o.perEvening,
        size,
        slotTime: cfg.slotTime,
        anyDay: o.test,
      });
    else if (o.test || o.fit)
      plan = fittedPlan({
        start,
        end: season.endDate,
        weekdays: cfg.slotDays,
        size,
        slotTime: cfg.slotTime,
      });
    else plan = this.planFor(season, cfg, o.startDate);
    if (!plan)
      throw conflict('the league does not fit into season {season}: {hint}', {
        season: season.number,
        hint: 'none',
      });
    const perEvening = plan.evenings[0]?.matchdays.length ?? 1;
    const now = this.nowIso();
    const ai = new Set(
      this.db
        .select({ id: udtAi.userId })
        .from(udtAi)
        .all()
        .map((a) => a.id),
    );
    const teams = this.udt.teams(season.number).filter((t) => !ai.has(t.userId));
    // A manager's club for good (its name and tag follow the team of the season).
    const clubs = this.clubs();
    const byUser = new Map([...clubs.values()].filter((c) => c.userId).map((c) => [c.userId!, c]));
    const humanClub = new Map<string, string>();
    for (const t of teams) {
      const c = byUser.get(t.userId);
      if (c) {
        this.db
          .update(leagueClubs)
          .set({ name: t.name, tag: t.tag })
          .where(eq(leagueClubs.id, c.id))
          .run();
        humanClub.set(t.userId, c.id);
      } else {
        const id = `c${randomId(10)}`;
        this.db
          .insert(leagueClubs)
          .values({ id, userId: t.userId, name: t.name, tag: t.tag, seed: id, createdAt: now })
          .run();
        humanClub.set(t.userId, id);
      }
    }
    // Tiers: last season's next tier (a test league's only when the setting says so);
    // newcomers at the bottom. A first league (or the test dialog's choice) places everybody:
    // by the cup ranking (the best into the Pro Series), at random or all into one tier.
    const last = this.run(season.number - 1);
    const placement = o.placement ?? 'cup';
    const carry = !!last && last.status === 'done' && (!last.test || cfg.keepTestTiers) && !o.test;
    const lastTier = new Map(
      carry
        ? this.members(season.number - 1)
            .filter((m) => m.nextTier !== null)
            .map((m) => [m.clubId, Math.min(tiers - 1, m.nextTier!)])
        : [],
    );
    const tierOf = new Map<string, number>();
    const fresh: string[] = [];
    for (const t of teams) {
      const id = humanClub.get(t.userId)!;
      const k = lastTier.get(id);
      if (k !== undefined) tierOf.set(id, k);
      else fresh.push(id);
    }
    if (carry) for (const id of fresh) tierOf.set(id, tiers - 1);
    else if (placement === 'one') for (const id of fresh) tierOf.set(id, 0);
    else {
      const points = new Map(
        teams.map((t) => [humanClub.get(t.userId)!, this.cupPoints(season.number, t.userId)]),
      );
      const ranked =
        placement === 'random'
          ? shuffle(fresh, leagueRng(`place:${season.number}:${now}`))
          : [...fresh].sort((a, b) => points.get(b)! - points.get(a)!);
      const per = Math.max(1, Math.ceil(ranked.length / tiers));
      ranked.forEach((id, i) => tierOf.set(id, Math.min(tiers - 1, Math.floor(i / per))));
    }
    // A tier with more managers than places: the rest one tier down.
    for (let t = 0; t < tiers - 1; t++) {
      const inTier = [...tierOf].filter(([, k]) => k === t).map(([c]) => c);
      for (const c of inTier.slice(size)) tierOf.set(c, t + 1);
    }
    if ([...tierOf.values()].filter((k) => k === tiers - 1).length > size)
      throw conflict('{n} managers do not fit into {places} league places', {
        n: tierOf.size,
        places: tiers * size,
      });
    const members: { clubId: string; tier: number }[] = [...tierOf].map(([clubId, tier]) => ({
      clubId,
      tier,
    }));
    // AI clubs: last season's in their next tier, new ones for the free places.
    const aiLast = carry
      ? this.members(season.number - 1).filter((m) => !clubs.get(m.clubId)?.userId)
      : [];
    const takenNames = new Set([
      ...[...clubs.values()].map((c) => c.name.toLowerCase()),
      ...teams.map((t) => t.name.toLowerCase()),
    ]);
    const takenTags = new Set(
      [...clubs.values()]
        .map((c) => c.tag.toLowerCase())
        .concat(teams.map((t) => t.tag.toLowerCase())),
    );
    const rng = leagueRng(`clubs:${season.number}`);
    for (let t = 0; t < tiers; t++) {
      let free = size - members.filter((m) => m.tier === t).length;
      for (const m of aiLast.filter((x) => Math.min(tiers - 1, x.nextTier ?? x.tier) === t)) {
        if (free <= 0) break;
        if (members.some((x) => x.clubId === m.clubId)) continue;
        members.push({ clubId: m.clubId, tier: t });
        free--;
      }
      if (free > 0) {
        const names = pickTeamNames(
          this.settings.get().teamNames,
          free,
          takenNames,
          rng,
          (i) => `AI Club ${t + 1}-${i + 1}`,
        );
        for (const name of names) {
          takenNames.add(name.toLowerCase());
          const tag = clubTag(name, takenTags);
          takenTags.add(tag.toLowerCase());
          const id = `c${randomId(10)}`;
          this.db
            .insert(leagueClubs)
            .values({ id, userId: null, name, tag, seed: id, createdAt: now })
            .run();
          members.push({ clubId: id, tier: t });
        }
      }
    }
    const humans = new Set(humanClub.values());
    this.db.transaction((tx) => {
      tx.insert(leagueRuns)
        .values({
          season: season.number,
          test: !!o.test,
          status: 'running',
          tiers,
          size,
          perEvening,
          planJson: JSON.stringify(plan),
          tableMoney: o.tableMoney ?? true,
          placement: o.placement ?? 'cup',
          startedAt: now,
        })
        .run();
      // In batches (one insert per row took a Raspberry Pi seconds for a whole season).
      for (const part of chunks(members, 100))
        tx.insert(leagueSeasons)
          .values(part.map((m) => ({ season: season.number, clubId: m.clubId, tier: m.tier })))
          .run();
      const games: (typeof leagueFixtures.$inferInsert)[] = [];
      for (let t = 0; t < tiers; t++) {
        const days = schedule(
          members.filter((m) => m.tier === t).map((m) => m.clubId),
          `${season.number}:${t}:${now}`,
        );
        for (const e of plan.evenings)
          for (const md of e.matchdays)
            days[md]!.forEach((p, i, list) =>
              games.push({
                id: `f${randomId(12)}`,
                season: season.number,
                tier: t,
                matchday: md + 1,
                kind: 'league',
                home: p.home,
                away: p.away,
                day: e.day,
                scheduledAt: this.kickOff(e.day, plan.slotTime, md - e.matchdays[0]!, i + t * 10),
                real:
                  humans.has(p.home) ||
                  humans.has(p.away) ||
                  cfg.aiGames === 'all' ||
                  // The top game: the first pairing of two AI clubs in the Pro Series.
                  (cfg.aiGames === 'topGame' &&
                    t === 0 &&
                    list.findIndex((x) => !humans.has(x.home) && !humans.has(x.away)) === i),
              }),
            );
      }
      for (const part of chunks(games, 100)) tx.insert(leagueFixtures).values(part).run();
    });
    this.log.info(
      `league of season ${season.number} started${o.test ? ' (test)' : ''}: ${members.length} clubs, ${plan.evenings.length} evenings`,
    );
    return this.run(season.number)!;
  }

  /** Kick-off of a game: the slot, matchdays of the evening one after another (order only). */
  private kickOff(day: string, slotTime: string, matchdayOfEvening: number, order: number): string {
    return new Date(
      zonedMs(day, slotTime, this.tz) + matchdayOfEvening * 60_000 + order * 1000,
    ).toISOString();
  }

  private cupPoints(season: number, userId: string): number {
    return this.rewards.table(season).find((r) => r.userId === userId)?.points ?? 0;
  }

  // ------------------------------------------------------------------------------------------
  // The league evenings
  // ------------------------------------------------------------------------------------------

  /** The test mode's clock moves (and tests): starts, evenings, the season's end - at once. */
  tick(): void {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = this.due();
      if (due && !this.quiet(due.run, due.today)) this.evening(due.run, due.today);
    } catch (e) {
      this.log.error(`league: ${(e as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  /** A timer tick is running its evening's steps. */
  private stepping = false;

  /**
   * Every 30 s: like `tick`, but the evening's games are made and simulated in steps with
   * pauses in between, so the website keeps answering while a whole evening is set up (on a
   * Raspberry Pi that takes seconds). A test mode tick meanwhile does the rest itself (each
   * step reads its game again).
   */
  async tickAsync(): Promise<void> {
    if (this.ticking || this.stepping) return;
    let due: { run: RunRow; today: string } | null;
    let steps: (() => void)[] = [];
    this.ticking = true;
    try {
      due = this.due();
      if (due && this.quiet(due.run, due.today)) due = null;
      if (due) steps = this.eveningSteps(due.run, due.today);
    } catch (e) {
      this.log.error(`league: ${(e as Error).message}`);
      due = null;
    } finally {
      this.ticking = false;
    }
    if (!due) return;
    this.stepping = true;
    try {
      // The website shows the work (activity bar) while the games are made and simulated.
      if (steps.length)
        await this.activity.run('leagueEvening', steps.length, (h) =>
          runInSteps(
            steps,
            (e) => this.log.error(`league: ${(e as Error).message}`),
            (n) => h.step(n),
          ),
        );
      const run = this.run(due.run.season);
      if (run?.status === 'running') this.eveningEnd(run, due.today);
    } catch (e) {
      this.log.error(`league: ${(e as Error).message}`);
    } finally {
      this.stepping = false;
    }
  }

  /**
   * Nothing to do today (most ticks): no game due or left over, and regular games still to come
   * (so relegation, final four and the end cannot be due either). Two counts instead of
   * reading every game of the season twice a minute.
   */
  private quiet(run: RunRow, today: string): boolean {
    const count = (...where: SQL[]) =>
      this.db
        .select({ n: sql<number>`count(*)` })
        .from(leagueFixtures)
        .where(
          and(
            eq(leagueFixtures.season, run.season),
            eq(leagueFixtures.status, 'scheduled'),
            ...where,
          ),
        )
        .get()?.n ?? 0;
    if (count(lte(leagueFixtures.day, today))) return false;
    return count(eq(leagueFixtures.kind, 'league')) > 0;
  }

  /** The running league and today, after starting one that is due (null: nothing to do). */
  private due(): { run: RunRow; today: string } | null {
    const season = this.seasons.current();
    // A run of a season that is over: decided with what is there (also with the Dream Team
    // off, so the season keeps its champion).
    for (const r of this.db.select().from(leagueRuns).where(eq(leagueRuns.status, 'running')).all())
      if (r.season !== season?.number) this.finish(r, true);
    if (!season || !this.udt.enabled()) return null;
    let run = this.run(season.number);
    const cfg = this.cfg();
    const today = this.udt.today();
    // On the start day (or the day after, if the website was down): switched on later in a
    // season, the league waits for the next one (a test league runs at once).
    const first = this.seasonDay(season, cfg.startDay);
    if (
      !run &&
      cfg.enabled &&
      today >= first &&
      today <= addDays(first, 1) &&
      this.planFor(season, cfg, today)
    )
      run = this.start(season, { startDate: today > first ? today : first });
    if (!run || run.status !== 'running') return null;
    return { run, today };
  }

  private noServerDay = '';

  /** The day the rubber band was renewed last, per season (once per league evening). */
  private readonly banded = new Map<number, string>();

  /** What is due today: games, simulations, relegation, the final four (all at once). */
  private evening(run: RunRow, today: string): void {
    for (const step of this.eveningSteps(run, today)) step();
    this.eveningEnd(run, today);
  }

  /**
   * The evening's games as steps (one game made or simulated each), after the games missed on
   * their day moved on and the rubber band was renewed. Every step reads its game again: a
   * test mode tick may have done it meanwhile.
   */
  private eveningSteps(run: RunRow, today: string): (() => void)[] {
    const plan = this.plan(run);
    const now = this.clock.now();
    const slot = (day: string) => zonedMs(day, plan.slotTime, this.tz);
    let all = this.fixtures(run.season);
    // A played game not started by the end of its day moves on (one running over midnight is
    // waited for; a seeded one is called off first, its abort moves it).
    let moved = false;
    for (const f of all) {
      if (f.status !== 'scheduled' || !f.real || !f.tournamentId || f.day >= today) continue;
      const t = this.tournaments.get(f.tournamentId);
      if (t && ['checkIn', 'running', 'paused'].includes(t.phase)) continue;
      moved = true;
      if (t && t.phase === 'seeded')
        try {
          this.tournaments.cancelSeeded(
            t.id,
            'the league game was not played on its day',
            this.admin(),
          );
          continue;
        } catch {
          // moved below
        }
      this.postpone(run, f, 'missed');
    }
    if (moved) all = this.fixtures(run.season);
    const open = all.filter((f) => f.status === 'scheduled' && f.day <= today);
    // Regular games left over on the relegation day: simulated (R2, the season must end).
    const lastCall = today >= plan.relegation;
    if (open.length && this.banded.get(run.season) !== today) {
      this.renewBand(run);
      this.banded.set(run.season, today);
    }
    const ctx = this.simContext(run, all);
    const steps: (() => void)[] = [];
    for (const f of open) {
      const simulated = !f.real || (lastCall && f.kind === 'league');
      if (!simulated) {
        if (!f.tournamentId)
          steps.push(() => {
            // Still due today (a test mode tick meanwhile may have done or moved it).
            const cur = this.fixture(f.id);
            if (cur?.status === 'scheduled' && cur.day === f.day && !cur.tournamentId)
              this.createGame(run, cur);
          });
      } else if (now >= slot(f.day) || f.day < today)
        steps.push(() => {
          const cur = this.fixture(f.id);
          if (cur?.status === 'scheduled' && cur.day === f.day)
            this.simulate(run, cur, slot(cur.day), ctx);
        });
    }
    return steps;
  }

  private fixture(id: string): FixtureRow | undefined {
    return this.db.select().from(leagueFixtures).where(eq(leagueFixtures.id, id)).get();
  }

  /** After the evening's games: relegation, the final four, the end of the league. */
  private eveningEnd(run: RunRow, today: string): void {
    const plan = this.plan(run);
    const now = this.clock.now();
    let all = this.fixtures(run.season);
    const shown = (f: FixtureRow) => !!f.winner && (!f.revealAt || Date.parse(f.revealAt) <= now);
    const regularDone = all
      .filter((f) => f.kind === 'league')
      .every((f) => f.status !== 'scheduled');
    if (regularDone && today >= plan.relegation && !all.some((f) => f.kind === 'relegation')) {
      this.createRelegation(run, today > plan.relegation ? today : plan.relegation);
      all = this.fixtures(run.season);
    }
    const relegationDone = all
      .filter((f) => f.kind === 'relegation')
      .every((f) => f.status !== 'scheduled');
    if (
      regularDone &&
      relegationDone &&
      today >= plan.final &&
      !all.some((f) => f.kind === 'semi')
    ) {
      this.createSemis(run, today > plan.final ? today : plan.final);
      all = this.fixtures(run.season);
    }
    const semis = all.filter((f) => f.kind === 'semi');
    // The final and the game for third place once both semi-finals are shown.
    if (semis.length === 2 && semis.every(shown) && !all.some((f) => f.kind === 'final')) {
      this.createFinals(run, semis, today);
      all = this.fixtures(run.season);
    }
    const finals = all.filter((f) => f.kind === 'final' || f.kind === 'third');
    if (
      finals.length === 2 &&
      finals.every(shown) &&
      all.filter((f) => f.kind === 'relegation').every(shown)
    )
      this.finish(run, false);
  }

  /** The AI clubs' strength for the evening: the rubber band of their tier × the club's factor. */
  private renewBand(run: RunRow): void {
    const settings = this.leagueSettings('league');
    const humans = this.humanClubs();
    const members = this.members(run.season);
    const sides = members
      .filter((m) => humans.has(m.clubId))
      .map((m) => ({
        tier: m.tier,
        strength: this.lineupStrength(humans.get(m.clubId)!, settings),
      }));
    const cfg = this.cfg();
    const bands = rubberBands(sides, run.tiers, {
      factors: cfg.factors,
      floors: cfg.aiFloor,
      emptyTier: 0.75,
    });
    const clubs = this.clubs();
    this.db.transaction((tx) => {
      for (const m of members)
        if (!humans.has(m.clubId))
          tx.update(leagueSeasons)
            .set({
              strength:
                Math.round(
                  bands[m.tier]! * clubFactor(clubs.get(m.clubId)?.seed ?? m.clubId) * 100,
                ) / 100,
            })
            .where(and(eq(leagueSeasons.season, run.season), eq(leagueSeasons.clubId, m.clubId)))
            .run();
    });
  }

  /** A manager's lineup strength in the model (five bots, base bots for missing places). */
  private lineupStrength(userId: string, settings: TournamentSettings): number {
    try {
      const rules = {
        valueCap: null,
        starLimit: null,
        ticket: null,
        ticketIndexed: true,
        minTeams: 4,
        finale: false,
        league: null,
      };
      const l = this.events.lineup(userId, settings, rules);
      const s = l.bots.reduce(
        (n, r) => n + botStrength(r.effective.skill, valueScore(r.effective.traits)),
        0,
      );
      return s + (settings.teamSize - l.bots.length) * botStrength(1, 0.5);
    } catch {
      return settings.teamSize * botStrength(1, 0.5);
    }
  }

  /** The club's strength now (AI: the band; a manager: the lineup). */
  private strengthOf(season: number, clubId: string): number {
    const userId = this.humanClubs().get(clubId);
    if (userId) return this.lineupStrength(userId, this.leagueSettings('league'));
    const m = this.db
      .select()
      .from(leagueSeasons)
      .where(and(eq(leagueSeasons.season, season), eq(leagueSeasons.clubId, clubId)))
      .get();
    return m?.strength ?? this.cfg().aiFloor[m?.tier ?? 0] ?? 8;
  }

  /**
   * What the simulations of an evening share (read once): the clubs' strength (AI: the band;
   * a manager: the lineup), when the day's last result shows, the frag limit.
   */
  private simContext(run: RunRow, all: FixtureRow[]): SimContext {
    const humans = this.humanClubs();
    const members = new Map(this.members(run.season).map((m) => [m.clubId, m]));
    const cfg = this.cfg();
    const settings = this.leagueSettings('league');
    const strengths = new Map<string, number>();
    const latest = new Map<string, number>();
    for (const f of all)
      if (f.revealAt) latest.set(f.day, Math.max(latest.get(f.day) ?? 0, Date.parse(f.revealAt)));
    return {
      latest,
      fragLimit: cfg.fragLimit,
      strength: (clubId) => {
        let v = strengths.get(clubId);
        if (v === undefined) {
          const userId = humans.get(clubId);
          const m = members.get(clubId);
          v = userId
            ? this.lineupStrength(userId, settings)
            : (m?.strength ?? cfg.aiFloor[m?.tier ?? 0] ?? 8);
          strengths.set(clubId, v);
        }
        return v;
      },
    };
  }

  /** Simulates a game (AI against AI, or a played one the season has no time left for). */
  private simulate(run: RunRow, f: FixtureRow, slotStart: number, ctx: SimContext): void {
    const rng = leagueRng(`${f.id}:${run.season}`);
    const home = { club: f.home, strength: ctx.strength(f.home) };
    const away = { club: f.away, strength: ctx.strength(f.away) };
    const bo = f.kind === 'league' ? 1 : 3;
    let wh = 0;
    let wa = 0;
    let hf = 0;
    let af = 0;
    let ot = false;
    while (wh < winsNeeded(bo) && wa < winsNeeded(bo)) {
      const r = simulateGame(home, away, rng, 5, ctx.fragLimit);
      hf += r.homeFrags;
      af += r.awayFrags;
      ot = r.overtime;
      if (r.winner === f.home) wh++;
      else wa++;
    }
    // Shown during the evening one after another, like in a conference: after the last one
    // of the day.
    const latest = Math.max(ctx.latest.get(f.day) ?? 0, slotStart);
    const reveal = Math.max(this.clock.now(), latest + GAME_MINUTES * 60_000);
    ctx.latest.set(f.day, reveal);
    this.db
      .update(leagueFixtures)
      .set({
        status: 'simulated',
        homeFrags: hf,
        awayFrags: af,
        overtime: bo === 1 && ot,
        winner: wh > wa ? f.home : f.away,
        homeWins: wh,
        awayWins: wa,
        revealAt: new Date(reveal).toISOString(),
      })
      .where(eq(leagueFixtures.id, f.id))
      .run();
  }

  /** Settings of a league game (5v5 deathmatch, league rules; best of three at the end). */
  private leagueSettings(kind: FixtureKind, map?: string): TournamentSettings {
    const cfg = this.cfg();
    const pool = this.mapPool();
    return {
      format: 'fixtures',
      size: 2,
      teamSize: 5,
      grandFinalReset: false,
      bestOf: { default: kind === 'league' ? 1 : 3 },
      checkInWindowMin: 10,
      noShowSec: 180,
      reconnectGraceSec: 180,
      maxReconnects: 2,
      botMatchMode: 'watch',
      botPlacement: 'byes',
      clanTeams: false,
      postTournamentShutdownSec: 30,
      game: {
        adapter: 'ut99-dm',
        rules: {
          fragLimit: cfg.fragLimit,
          timeLimitMin: cfg.timeLimitMin,
          // The home club picks the map; best of three: the loser's pick from the pool.
          mapMode: kind === 'league' ? 'random' : 'vote',
          mapPool: kind === 'league' ? [map ?? pool[0]!] : pool,
        },
      },
    };
  }

  /** The league's maps: the setting, else the newest Dream Team deathmatch tournament's pool. */
  mapPool(): string[] {
    const cfg = this.cfg();
    if (cfg.mapPool.length) return cfg.mapPool;
    for (const t of this.db
      .select()
      .from(tournaments)
      .where(eq(tournaments.kind, 'udt'))
      .orderBy(asc(tournaments.createdAt))
      .all()
      .filter((x) => !this.isLeagueTournament(x))
      .reverse()) {
      try {
        const s = this.tournaments.settings(t);
        const pool = (s.game.rules as { mapPool?: string[] }).mapPool;
        if (s.game.adapter === 'ut99-dm' && pool?.length) return pool;
      } catch {
        // broken settings: the next
      }
    }
    return ['DM-Deck16][', 'DM-Morpheus', 'DM-Phobos', 'DM-Codex'];
  }

  private admin(): User {
    const a = this.users.list().find((u) => u.isAdmin);
    if (!a) throw conflict('no admin to make the league games');
    return a;
  }

  /** The tournament of a played game: the two clubs, autostart at the kick-off. */
  private createGame(run: RunRow, f: FixtureRow): void {
    const server = this.server();
    if (!server) {
      // Once a day (the tick comes every 30 s).
      if (this.noServerDay !== f.day)
        this.log.warn(
          'league: no server for the league games (settings, or a Dream Team tournament)',
        );
      this.noServerDay = f.day;
      return;
    }
    const clubs = this.clubs();
    const name = (id: string) => clubs.get(id)?.name ?? '?';
    const pool = this.mapPool();
    const map =
      f.map && pool.includes(f.map) ? f.map : pool[Math.floor(leagueRng(f.id)() * pool.length)]!;
    const kind = f.kind as FixtureKind;
    const label =
      kind === 'league'
        ? `Spieltag ${f.matchday}`
        : kind === 'relegation'
          ? 'Relegation'
          : kind === 'semi'
            ? 'Halbfinale'
            : kind === 'final'
              ? 'Finale'
              : 'Spiel um Platz 3';
    const at = Math.max(Date.parse(f.scheduledAt), this.clock.now() + 60_000);
    try {
      const t = this.tournaments.create(
        {
          name: `Liga S${run.season} · ${label} · ${name(f.home)} – ${name(f.away)}`.slice(0, 100),
          agentId: server.agentId,
          profileId: server.profileId,
          settings: this.leagueSettings(kind, map),
          // Not used (the two clubs play), but a team tournament needs two teams of bots.
          botPool: Array.from({ length: 10 }, (_, i) => ({ name: `League${i + 1}`, skill: 3 })),
          registrationOpen: false,
          scheduledAt: new Date(at).toISOString(),
          autoStart: true,
          kind: 'udt',
          udt: {
            valueCap: null,
            starLimit: null,
            ticket: null,
            ticketIndexed: true,
            minTeams: 2,
            finale: false,
            league: { season: run.season, fixture: f.id, kind },
          },
        },
        this.admin(),
      );
      this.db
        .update(leagueFixtures)
        .set({ tournamentId: t.id, map })
        .where(eq(leagueFixtures.id, f.id))
        .run();
    } catch (e) {
      this.log.warn(`league game ${f.id}: ${(e as Error).message}`);
    }
  }

  /** The two clubs of a league game in their slots (home first). */
  private lineup(t: TournamentRow, settings: TournamentSettings) {
    const rules = this.tournaments.udtRules(t)?.league;
    const f = rules
      ? this.db.select().from(leagueFixtures).where(eq(leagueFixtures.id, rules.fixture)).get()
      : undefined;
    if (!f) throw notFound('league game {id}', { id: t.id });
    const entrants = [f.home, f.away].map((c) => this.entrant(f.season, c, settings));
    return { entrants, fill: [], slots: entrants.map((e) => e.id) };
  }

  /** A club in a league game: a manager's lineup, or the AI club's own bots (never library bots). */
  private entrant(season: number, clubId: string, settings: TournamentSettings): Entrant {
    const club = this.clubs().get(clubId);
    if (!club) throw notFound('league club {id}', { id: clubId });
    if (club.userId) {
      const e = this.events.leagueTeam(club.userId, settings, udtEntrantId(club.userId));
      if (e) return e;
    }
    const bots: BotSpec[] = leagueBots(
      club.seed,
      this.strengthOf(season, clubId),
      settings.teamSize,
    ).map((b) => ({
      name: gameName(club.tag, b.name),
      skill: b.skill,
      traits: b.traits,
      botClass: b.botClass,
    }));
    return {
      id: aiClubEntrantId(clubId),
      kind: 'team',
      displayName: club.name,
      tag: club.tag,
      members: [],
      bots,
    };
  }

  /** A played game's tournament got a result (or was called off). */
  private onResult(tournamentId: string): void {
    const f = this.fixtureOfTournament(tournamentId);
    if (!f) return;
    const p0 = this.eventLog.projection(tournamentId);
    // A decided game changes only by an admin's corrected result.
    if (f.status !== 'scheduled' && p0?.results.at(-1)?.outcome !== 'override') return;
    if (f.status === 'void') return;
    const p = this.eventLog.projection(tournamentId);
    if (!p) return;
    if (p.phase === 'aborted') {
      const run = this.run(f.season);
      if (run) this.postpone(run, f, 'called off');
      return;
    }
    const r = p.results.at(-1);
    if (!r) return;
    const homeId = p.bracket?.definition.slots[0];
    const awayId = p.bracket?.definition.slots[1];
    if (!homeId || !awayId) return;
    const games = p.games[r.matchId] ?? [];
    let hf = games.reduce((n, g) => n + (g.scores[homeId] ?? 0), 0);
    let af = games.reduce((n, g) => n + (g.scores[awayId] ?? 0), 0);
    const homeWon = r.winnerId === homeId;
    const limit = this.cfg().fragLimit;
    // Without games (forfeit, set by an admin, the test mode): frags that fit the result.
    if (!games.length) {
      const loser = r.outcome === 'forfeit' ? 0 : Math.round(limit * 0.6);
      hf = homeWon ? limit : loser;
      af = homeWon ? loser : limit;
    }
    const overtime = f.kind === 'league' && games.at(-1)?.endReason === 'suddenDeath';
    this.db
      .update(leagueFixtures)
      .set({
        status: r.outcome === 'forfeit' ? 'forfeit' : 'played',
        homeFrags: hf,
        awayFrags: af,
        overtime,
        winner: homeWon ? f.home : f.away,
        homeWins: games.length
          ? games.filter((g) => g.winnerId === homeId).length
          : homeWon
            ? 1
            : 0,
        awayWins: games.length
          ? games.filter((g) => g.winnerId === awayId).length
          : homeWon
            ? 0
            : 1,
      })
      .where(eq(leagueFixtures.id, f.id))
      .run();
  }

  /** A played game did not happen: the next league evening (the relegation day simulates it). */
  private postpone(run: RunRow, f: FixtureRow, why: string): void {
    const plan = this.plan(run);
    const today = this.udt.today();
    // The next evening on which neither club plays yet (else the next one at all).
    const busy = (day: string) =>
      this.fixtures(run.season).some(
        (x) =>
          x.id !== f.id &&
          x.day === day &&
          [x.home, x.away].some((c) => c === f.home || c === f.away),
      );
    const later = plan.evenings.filter((e) => e.day > today && e.day > f.day).map((e) => e.day);
    const next = later.find((d) => !busy(d)) ?? later[0] ?? plan.relegation;
    if (f.tournamentId) {
      const t = this.tournaments.get(f.tournamentId);
      if (t && t.phase === 'draft')
        try {
          this.tournaments.remove(t.id);
        } catch {
          // left to an admin
        }
    }
    this.db
      .update(leagueFixtures)
      .set({
        day: next,
        scheduledAt: this.kickOff(next, plan.slotTime, 30, 0),
        tournamentId: null,
        postponed: f.postponed + 1,
      })
      .where(eq(leagueFixtures.id, f.id))
      .run();
    this.log.info(`league game ${f.id} ${why}: moved to ${next}`);
  }

  // ------------------------------------------------------------------------------------------
  // The season's end: relegation, final four, the next season
  // ------------------------------------------------------------------------------------------

  private addFixture(
    run: RunRow,
    o: { tier: number; kind: FixtureKind; home: string; away: string; day: string; order: number },
  ) {
    const humans = this.humanClubs();
    this.db
      .insert(leagueFixtures)
      .values({
        id: `f${randomId(12)}`,
        season: run.season,
        tier: o.tier,
        matchday: 0,
        kind: o.kind,
        home: o.home,
        away: o.away,
        day: o.day,
        scheduledAt: this.kickOff(o.day, this.plan(run).slotTime, 0, o.order),
        real: humans.has(o.home) || humans.has(o.away),
      })
      .run();
  }

  private createRelegation(run: RunRow, day: string): void {
    const ties = promotion(this.tables(run.season, Infinity)).relegation;
    ties.forEach((t, i) =>
      this.addFixture(run, {
        tier: t.tier,
        kind: 'relegation',
        home: t.upper,
        away: t.lower,
        day,
        order: i,
      }),
    );
  }

  private createSemis(run: RunRow, day: string): void {
    const pro = this.tables(run.season, Infinity)[0]!;
    finalFour(pro).forEach((p, i) =>
      this.addFixture(run, { tier: 0, kind: 'semi', home: p.home, away: p.away, day, order: i }),
    );
  }

  private createFinals(run: RunRow, semis: FixtureRow[], day: string): void {
    const loser = (f: FixtureRow) => (f.winner === f.home ? f.away : f.home);
    this.addFixture(run, {
      tier: 0,
      kind: 'final',
      home: semis[0]!.winner!,
      away: semis[1]!.winner!,
      day,
      order: 10,
    });
    this.addFixture(run, {
      tier: 0,
      kind: 'third',
      home: loser(semis[0]!),
      away: loser(semis[1]!),
      day,
      order: 11,
    });
  }

  /**
   * The season's end of the league: tables, relegation winners (missing: the upper club stays),
   * the final four places (missing: the table), next tiers, the champion.
   */
  private finish(run: RunRow, seasonOver: boolean): void {
    const all = this.fixtures(run.season);
    const tables = this.tables(run.season, Infinity);
    const winners = new Map<string, string>();
    for (const f of all) if (f.kind === 'relegation' && f.winner) winners.set(f.home, f.winner);
    const next = nextTiers(tables, winners);
    const finals = new Map<string, number>();
    const fin = all.find((f) => f.kind === 'final' && f.winner);
    const third = all.find((f) => f.kind === 'third' && f.winner);
    if (fin) {
      finals.set(fin.winner!, 1);
      finals.set(fin.winner === fin.home ? fin.away : fin.home, 2);
    }
    if (third) {
      finals.set(third.winner!, 3);
      finals.set(third.winner === third.home ? third.away : third.home, 4);
    }
    // Without the final four: the table's top four.
    if (!fin && tables[0]) tables[0].slice(0, 4).forEach((r, i) => finals.set(r.club, i + 1));
    // Games that will not be played any more: void, their tournaments go (or are called off).
    for (const f of all.filter((x) => x.status === 'scheduled')) {
      const t = f.tournamentId ? this.tournaments.get(f.tournamentId) : undefined;
      try {
        if (t?.phase === 'draft') this.tournaments.remove(t.id);
        else if (t?.phase === 'seeded')
          this.tournaments.cancelSeeded(t.id, 'the league season is over', this.admin());
      } catch {
        // left to an admin
      }
    }
    this.db.transaction((tx) => {
      tx.update(leagueFixtures)
        .set({ status: 'void' })
        .where(and(eq(leagueFixtures.season, run.season), eq(leagueFixtures.status, 'scheduled')))
        .run();
      tables.forEach((tb, t) =>
        tb.forEach((r) =>
          tx
            .update(leagueSeasons)
            .set({
              tier: t,
              place: r.place,
              points: r.points,
              nextTier: next.get(r.club) ?? t,
              finalPlace: finals.get(r.club) ?? null,
            })
            .where(and(eq(leagueSeasons.season, run.season), eq(leagueSeasons.clubId, r.club)))
            .run(),
        ),
      );
      tx.update(leagueRuns)
        .set({
          status: 'done',
          endedAt: this.nowIso(),
          champion: [...finals].find(([, p]) => p === 1)?.[0] ?? null,
        })
        .where(eq(leagueRuns.season, run.season))
        .run();
    });
    this.log.info(`league of season ${run.season} done${seasonOver ? ' (at the season end)' : ''}`);
  }

  /** The season's champion (L-E10): the human winner of the final four. */
  champion(season: number): string | null | undefined {
    const run = this.run(season);
    // A test league and a season without a league: the cups decide as before.
    if (!run || run.test || run.status === 'aborted') return undefined;
    if (!run.champion) return null;
    return this.clubs().get(run.champion)?.userId ?? null;
  }

  // ------------------------------------------------------------------------------------------
  // Money (Monday's market day)
  // ------------------------------------------------------------------------------------------

  /** Mondays: table money by the place (L-E8) and the cup bonus for the cup ranking (L-E10). */
  private marketDay(season: Season, day: string): void {
    if (isoWeekday(day) !== 1) return;
    const run = this.run(season.number);
    if (!run || run.status !== 'running') return;
    const f = rewardIndex(this.udt.index(season.number));
    const cfg = this.cfg();
    const humans = this.humanClubs();
    const played = this.fixtures(season.number).some((x) => x.kind === 'league' && this.result(x));
    if (run.tableMoney && played)
      this.tables(season.number).forEach((tb, t) =>
        tb.forEach((r) => {
          const userId = humans.get(r.club);
          if (!userId) return;
          this.ledger.book({
            season: season.number,
            userId,
            kind: 'udt_league',
            amount:
              Math.round((tableMoney(r.place, t, cfg.tableMoney, cfg.tierMult) * f) / 10) * 10,
            ref: `league-money:${season.number}:${day}:${userId}`,
            meta: { tier: t, place: r.place },
          });
        }),
      );
    const ai = this.udt.aiIds();
    this.rewards
      .table(season.number)
      .filter((r) => !ai.has(r.userId) && r.points > 0)
      .slice(0, this.settings.get().udt.cupBonus.length)
      .forEach((r, i) =>
        this.ledger.book({
          season: season.number,
          userId: r.userId,
          kind: 'udt_cup_bonus',
          amount: Math.round((this.settings.get().udt.cupBonus[i]! * f) / 10) * 10,
          ref: `cup-bonus:${season.number}:${day}:${r.userId}`,
          meta: { place: i + 1 },
        }),
      );
  }

  // ------------------------------------------------------------------------------------------
  // Managers
  // ------------------------------------------------------------------------------------------

  /**
   * A team founded while the league runs (L-E18): until the `joinUntil` matchday it takes over
   * the weakest AI club of the lowest tier, with its points and fixture list.
   */
  private newcomer(userId: string, season: number): void {
    const run = this.run(season);
    if (!run || run.status !== 'running' || this.udt.aiIds().has(userId)) return;
    const clubs = this.clubs();
    const mine = [...clubs.values()].find((c) => c.userId === userId);
    const members = this.members(season);
    if (mine && members.some((m) => m.clubId === mine.id)) return;
    const played = Math.max(
      0,
      ...this.fixtures(season)
        .filter((f) => f.kind === 'league' && f.winner)
        .map((f) => f.matchday),
    );
    if (played >= this.cfg().joinUntil) return;
    const bottom = run.tiers - 1;
    const table = this.tables(season, Infinity)[bottom] ?? [];
    const weakest = [...table].reverse().find((r) => !clubs.get(r.club)?.userId);
    if (!weakest) return;
    const team = this.udt.team(userId, season)!;
    const ai = weakest.club;
    // The manager's own club (for good) takes the AI club's place, points and games; the AI
    // club stays an AI club (its history is its own).
    const club = mine?.id ?? `c${randomId(10)}`;
    this.db.transaction((tx) => {
      if (mine)
        tx.update(leagueClubs)
          .set({ name: team.name, tag: team.tag })
          .where(eq(leagueClubs.id, mine.id))
          .run();
      else
        tx.insert(leagueClubs)
          .values({
            id: club,
            userId,
            name: team.name,
            tag: team.tag,
            seed: club,
            createdAt: this.nowIso(),
          })
          .run();
      tx.update(leagueSeasons)
        .set({ clubId: club, strength: null })
        .where(and(eq(leagueSeasons.season, season), eq(leagueSeasons.clubId, ai)))
        .run();
      for (const col of ['home', 'away', 'winner'] as const)
        tx.update(leagueFixtures)
          .set({ [col]: club })
          .where(and(eq(leagueFixtures.season, season), eq(leagueFixtures[col], ai)))
          .run();
    });
    // Its coming games are played from now on.
    this.db
      .update(leagueFixtures)
      .set({ real: true })
      .where(
        and(
          eq(leagueFixtures.season, season),
          eq(leagueFixtures.status, 'scheduled'),
          inArray(leagueFixtures.home, [club]),
        ),
      )
      .run();
    this.db
      .update(leagueFixtures)
      .set({ real: true })
      .where(
        and(
          eq(leagueFixtures.season, season),
          eq(leagueFixtures.status, 'scheduled'),
          inArray(leagueFixtures.away, [club]),
        ),
      )
      .run();
    this.log.info(`league: ${team.name} takes over a club of tier ${bottom + 1}`);
  }

  /** The home club's manager picks the map of a played game (before it starts). */
  setMap(user: User, fixtureId: string, map: string) {
    this.udt.assertOn();
    const f = this.db.select().from(leagueFixtures).where(eq(leagueFixtures.id, fixtureId)).get();
    if (!f) throw notFound('league game {id}', { id: fixtureId });
    if (this.humanClubs().get(f.home) !== user.id)
      throw forbidden('only the home club picks the map');
    if (f.status !== 'scheduled' || f.kind !== 'league')
      throw conflict('the game is not open any more');
    if (!this.mapPool().includes(map))
      throw badRequest('map {map} is not in the league pool', { map });
    const t = f.tournamentId ? this.tournaments.get(f.tournamentId) : undefined;
    if (t && t.phase !== 'draft') throw conflict('the game is not open any more');
    if (t) this.tournaments.update(t.id, { settings: this.leagueSettings('league', map) });
    this.db.update(leagueFixtures).set({ map }).where(eq(leagueFixtures.id, f.id)).run();
    return this.view(user);
  }

  /**
   * Test mode (L11): the next league evening of the running season with open games - the day
   * of the earliest open game, else the relegation or final day still to come - and its slot;
   * null without a running league.
   */
  testNextEvening(): { day: string; slot: number } | null {
    const season = this.seasons.current();
    const run = season ? this.run(season.number) : undefined;
    if (!run || run.status !== 'running') return null;
    const plan = this.plan(run);
    const today = this.udt.today();
    const all = this.fixtures(run.season);
    const open = all.filter((f) => f.status === 'scheduled').map((f) => f.day);
    let day = open.sort()[0];
    if (!day)
      day =
        run.tiers > 1 && !all.some((f) => f.kind === 'relegation')
          ? plan.relegation
          : !all.some((f) => f.kind === 'semi')
            ? plan.final
            : today;
    if (day < today) day = today;
    return { day, slot: zonedMs(day, plan.slotTime, this.tz) };
  }

  /** Test mode: the tournaments of the league's played games up to `day` that are not over. */
  testTournaments(day: string): string[] {
    const season = this.seasons.current();
    if (!season) return [];
    return this.fixtures(season.number)
      .filter((f) => f.status === 'scheduled' && f.real && f.tournamentId && f.day <= day)
      .map((f) => this.tournaments.get(f.tournamentId!))
      .filter((t) => !!t && ['draft', 'seeded', 'checkIn', 'running'].includes(t.phase))
      .map((t) => t!.id);
  }

  /** Test mode: whether the league of the running season is over (or there is none). */
  testDone(): boolean {
    const season = this.seasons.current();
    const run = season ? this.run(season.number) : undefined;
    return !run || run.status !== 'running';
  }

  // ------------------------------------------------------------------------------------------
  // Test league (L-E9)
  // ------------------------------------------------------------------------------------------

  startTest(body: TestLeagueInput) {
    this.udt.assertOn();
    const season = this.udt.season();
    if (body.startDate && body.startDate < this.udt.today())
      throw badRequest('the test league cannot start in the past');
    this.start(season, { test: true, ...body });
    return this.adminView();
  }

  /**
   * Starts the league in the running season now (decision 230): a regular one - it counts for
   * the champion and the next season's tiers - with the fewest matchdays per evening that fit
   * (as a test league). For a season whose start day is over, or to start earlier.
   */
  startRegular(body: TestLeagueInput) {
    this.udt.assertOn();
    const season = this.udt.season();
    const today = this.udt.today();
    if (body.startDate && body.startDate < today)
      throw badRequest('the league cannot start in the past');
    this.start(season, { ...body, fit: true, startDate: body.startDate ?? nextDay(today) });
    return this.adminView();
  }

  /**
   * Calls the league off: its fixture list and the games not played yet go. A test league at
   * any time, a regular one only before its first game (decision 230).
   */
  abortTest() {
    this.udt.assertOn();
    const season = this.udt.season();
    const run = this.run(season.number);
    if (!run) throw notFound('league of season {season}', { season: season.number });
    if (!this.canAbort(run))
      throw conflict('a league can only be called off before its first game');
    for (const f of this.fixtures(season.number)) {
      const t = f.tournamentId ? this.tournaments.get(f.tournamentId) : undefined;
      if (t && (t.phase === 'draft' || t.phase === 'seeded'))
        try {
          this.tournaments.remove(t.id);
        } catch {
          // left to an admin
        }
    }
    this.db.transaction((tx) => {
      tx.delete(leagueFixtures).where(eq(leagueFixtures.season, season.number)).run();
      tx.delete(leagueSeasons).where(eq(leagueSeasons.season, season.number)).run();
      tx.delete(leagueRuns).where(eq(leagueRuns.season, season.number)).run();
    });
    // A regular league called off in its start window would start again by itself (`due()`):
    // the league setting goes off.
    const cfg = this.cfg();
    if (
      !run.test &&
      cfg.enabled &&
      this.udt.today() <= addDays(this.seasonDay(season, cfg.startDay), 1)
    )
      this.settings.setUdt({ league: { ...cfg, enabled: false } });
    return this.adminView();
  }

  /**
   * A test league can be called off at any time, a regular one before its first evening begins
   * (and while nothing was played or simulated).
   */
  private canAbort(run: RunRow): boolean {
    if (run.test) return true;
    const plan = this.plan(run);
    const first = plan.evenings[0];
    if (first && this.clock.now() >= zonedMs(first.day, plan.slotTime, this.tz)) return false;
    return !this.anyPlayed(run.season);
  }

  /** The league tab of the settings: the run, its plan, the estimate. */
  adminView() {
    const season = this.seasons.current();
    const run = season ? this.run(season.number) : undefined;
    const cfg = this.cfg();
    const managers = season
      ? this.udt.teams(season.number).filter((t) => !this.udt.aiIds().has(t.userId)).length
      : 0;
    return {
      season: season?.number ?? null,
      today: this.udt.today(),
      daysLeft: season
        ? Math.round(
            (Date.parse(`${season.endDate}T00:00:00Z`) -
              Date.parse(`${this.udt.today()}T00:00:00Z`)) /
              DAY,
          )
        : null,
      run: run ? { ...runView(run), plan: this.plan(run) } : null,
      fits: season ? !!this.planFor(season, cfg) : null,
      status: this.status(),
      managers,
      estimate: estimateEvening({
        managers,
        tiers: cfg.tiers,
        size: cfg.size,
        perEvening: PER_EVENING[cfg.length],
        aiGames: cfg.aiGames,
      }),
      evenings: eveningsOf(cfg.size, PER_EVENING[cfg.length]),
      server: this.server(),
      mapPool: this.mapPool(),
    };
  }

  /** The plan of a league started late in the running season (null: it does not fit). */
  fit(startDate?: string): PlanSummary | null {
    this.udt.assertOn();
    const season = this.udt.season();
    const cfg = this.cfg();
    const plan = fittedPlan({
      start: startDate ?? nextDay(this.udt.today()),
      end: season.endDate,
      weekdays: cfg.slotDays,
      size: cfg.size,
      slotTime: cfg.slotTime,
    });
    return plan && summary(plan);
  }

  /** Whether a game of the season's league was played or simulated already. */
  private anyPlayed(season: number): boolean {
    return !!this.db
      .select({ id: leagueFixtures.id })
      .from(leagueFixtures)
      .where(and(eq(leagueFixtures.season, season), sql`${leagueFixtures.status} <> 'scheduled'`))
      .get();
  }

  /**
   * The next start by the settings: on the start day of the running season while it can still
   * start (as `due()`: the start day or the day after), else on the start day of the next
   * planned season (null: none planned yet).
   */
  private upcoming(cfg: LeagueSettings): LeagueStatus['start'] {
    const today = this.udt.today();
    const cur = this.seasons.current();
    if (cur && !this.run(cur.number)) {
      const first = this.seasonDay(cur, cfg.startDay);
      if (today <= addDays(first, 1)) {
        const plan = this.planFor(cur, cfg, today > first ? today : undefined);
        return {
          season: cur.number,
          day: today > first ? today : first,
          plan: plan && summary(plan),
        };
      }
    }
    const next = this.seasons
      .overview()
      .seasons.filter((x) => x.status === 'planned' && (!cur || x.number > cur.number))
      .sort((a, b) => a.number - b.number)[0];
    if (!next) return null;
    const plan = this.planFor(next, cfg);
    return {
      season: next.number,
      day: addDays(next.startDate, cfg.startDay - 1),
      plan: plan && summary(plan),
    };
  }

  /** Where the league stands, for the settings tab (decision 230). */
  status(): LeagueStatus {
    const cfg = this.cfg();
    const cur = this.seasons.current();
    const run = cur ? this.run(cur.number) : undefined;
    const today = this.udt.today();
    const none = { test: false, start: null, now: null, progress: null, champion: null };
    if (run?.status === 'running') {
      const plan = this.plan(run);
      const past = plan.evenings.filter((e) => e.day < today);
      const next = plan.evenings.find((e) => e.day >= today);
      return {
        ...none,
        state: 'running',
        test: run.test,
        progress: {
          evenings: past.length,
          eveningsTotal: plan.evenings.length,
          matchdays: past.reduce((n, e) => n + e.matchdays.length, 0),
          matchdaysTotal: matchdaysOf(run.size),
          next: next ? { day: next.day, matchdays: next.matchdays.map((m) => m + 1) } : null,
          relegation: plan.relegation,
          final: plan.final,
          time: plan.slotTime,
          abortable: this.canAbort(run),
        },
      };
    }
    const start = cfg.enabled ? this.upcoming(cfg) : null;
    // A start now: the rest of the running season, from tomorrow.
    const fit =
      cur && !run
        ? fittedPlan({
            start: nextDay(today),
            end: cur.endDate,
            weekdays: cfg.slotDays,
            size: cfg.size,
            slotTime: cfg.slotTime,
          })
        : null;
    const now = fit && summary(fit);
    if (run?.status === 'done')
      return {
        ...none,
        state: 'done',
        test: run.test,
        start,
        champion: run.champion ? (this.clubs().get(run.champion)?.name ?? null) : null,
      };
    if (!cfg.enabled) return { ...none, state: 'off', now };
    return {
      ...none,
      state: start && cur && start.season === cur.number ? 'waiting' : 'nextSeason',
      start,
      now: start && cur && start.season === cur.number ? null : now,
    };
  }

  estimate(q: z.infer<typeof EstimateQuery>) {
    const cfg = this.cfg();
    const season = this.seasons.current();
    const managers =
      q.managers ??
      (season
        ? this.udt.teams(season.number).filter((t) => !this.udt.aiIds().has(t.userId)).length
        : 0);
    const size = q.size ?? cfg.size;
    const perEvening = PER_EVENING[q.length ?? cfg.length];
    return {
      ...estimateEvening({
        managers,
        tiers: q.tiers ?? cfg.tiers,
        size,
        perEvening,
        aiGames: q.aiGames ?? cfg.aiGames,
      }),
      evenings: eveningsOf(size, perEvening),
      managers,
    };
  }

  // ------------------------------------------------------------------------------------------
  // Views
  // ------------------------------------------------------------------------------------------

  /**
   * The league page: tables of all tiers (the viewer's tier first), the matchday as a
   * conference (games with live tournaments and the simulated results shown so far), the
   * fixture list, the season's end, the viewer's next game.
   */
  view(user: User, seasonQ?: number) {
    this.udt.assertOn();
    const current = this.seasons.current()?.number ?? this.seasons.latestStarted()?.number;
    const season = seasonQ ?? current ?? 0;
    const run = this.run(season);
    const cfg = this.cfg();
    const now = this.clock.now();
    if (!run)
      return {
        season,
        run: null,
        enabled: cfg.enabled,
        seasons: this.runSeasons(),
        now: new Date(now).toISOString(),
      };
    const clubs = this.clubs();
    const members = new Map(this.members(season).map((m) => [m.clubId, m]));
    const plan = this.plan(run);
    const fixtures = this.fixtures(season);
    const mine = [...clubs.values()].find((c) => c.userId === user.id && members.has(c.id));
    const club = (id: string) => {
      const c = clubs.get(id);
      return {
        id,
        name: c?.name ?? '?',
        tag: c?.tag ?? '',
        manager: !!c?.userId,
        me: c?.userId === user.id,
      };
    };
    const today = this.udt.today();
    const tablesNow = this.tables(season, now);
    // The live table of the evening: moves against the table before today's games.
    const before = this.tables(season, now, today);
    const moveOf = (t: number, id: string, place: number) => {
      const b = before[t]?.find((r) => r.club === id)?.place;
      return b === undefined ? 0 : b - place;
    };
    const tables = tablesNow.map((tb, t) => ({
      tier: t,
      rows: tb.map((r) => ({
        ...r,
        ...club(r.club),
        strength: members.get(r.club)?.strength ?? null,
        move: moveOf(t, r.club, r.place),
      })),
      final: run.status === 'done',
    }));
    const game = (f: FixtureRow) => {
      const shown = this.result(f, now);
      const t = f.tournamentId ? this.tournaments.get(f.tournamentId) : undefined;
      return {
        id: f.id,
        tier: f.tier,
        matchday: f.matchday,
        kind: f.kind,
        day: f.day,
        scheduledAt: f.scheduledAt,
        home: club(f.home),
        away: club(f.away),
        real: f.real,
        map: f.map,
        status: shown ? f.status : f.status === 'simulated' ? 'scheduled' : f.status,
        homeFrags: shown?.homeFrags ?? null,
        awayFrags: shown?.awayFrags ?? null,
        overtime: shown ? f.overtime : false,
        winner: shown?.winner ?? null,
        homeWins: shown ? f.homeWins : null,
        awayWins: shown ? f.awayWins : null,
        postponed: f.postponed,
        tournament: t ? { id: t.id, phase: t.phase } : null,
      };
    };
    // The evening of the conference: the next one with games (today's while it runs), else
    // the last one.
    const days = [...new Set(fixtures.map((f) => f.day))].sort();
    const conferenceDay = days.find((d) => d >= today) ?? days.at(-1) ?? today;
    const onDay = fixtures.filter((f) => f.day === conferenceDay);
    const currentMatchdays = [
      ...new Set(onDay.filter((f) => f.kind === 'league').map((f) => f.matchday)),
    ].sort((a, b) => a - b);
    // The server's evening: the league slot and the other tournaments of that day.
    const slotStart = zonedMs(conferenceDay, plan.slotTime, this.tz);
    const cups = this.db
      .select()
      .from(tournaments)
      .all()
      .filter(
        (t) =>
          t.scheduledAt &&
          !this.isLeagueTournament(t) &&
          ['draft', 'seeded'].includes(t.phase) &&
          this.udt.today() <= conferenceDay &&
          Math.abs(Date.parse(t.scheduledAt) - slotStart) < DAY / 2,
      )
      .map((t) => ({ name: t.name, scheduledAt: t.scheduledAt! }));
    const next = mine
      ? fixtures.find((f) => (f.home === mine.id || f.away === mine.id) && f.status === 'scheduled')
      : undefined;
    return {
      season,
      enabled: cfg.enabled,
      seasons: this.runSeasons(),
      today,
      now: new Date(now).toISOString(),
      run: { ...runView(run), plan, matchdays: matchdaysOf(run.size) },
      myClub: mine ? { ...club(mine.id), tier: members.get(mine.id)?.tier ?? null } : null,
      tables,
      matchdays: currentMatchdays,
      conference: onDay.map(game),
      evening: {
        day: conferenceDay,
        slot: new Date(slotStart).toISOString(),
        games: onDay.filter((f) => f.real).length,
        until: new Date(
          slotStart + Math.max(1, onDay.filter((f) => f.real).length) * GAME_MINUTES * 60_000,
        ).toISOString(),
        cups,
      },
      fixtures: fixtures.map(game),
      next: next
        ? {
            ...game(next),
            home: club(next.home),
            away: club(next.away),
            place: placeIn(tablesNow, next.home),
            awayPlace: placeIn(tablesNow, next.away),
            canPickMap: !!mine && next.home === mine.id && next.kind === 'league',
          }
        : null,
      mapPool: this.mapPool(),
      rules: {
        fragLimit: cfg.fragLimit,
        timeLimitMin: cfg.timeLimitMin,
        tableMoney: cfg.tableMoney,
        tierMult: cfg.tierMult,
      },
      final:
        run.status === 'done'
          ? this.members(season)
              .filter((m) => m.finalPlace)
              .sort((a, b) => a.finalPlace! - b.finalPlace!)
              .map((m) => ({ ...club(m.clubId), place: m.finalPlace }))
          : [],
    };
  }

  private runSeasons(): number[] {
    return this.db
      .select({ s: leagueRuns.season })
      .from(leagueRuns)
      .all()
      .map((r) => r.s)
      .sort((a, b) => b - a);
  }

  /** History: champions and the tiers of every finished league season. */
  history() {
    this.udt.assertOn();
    const clubs = this.clubs();
    return this.db
      .select()
      .from(leagueRuns)
      .all()
      .filter((r) => r.status === 'done')
      .sort((a, b) => b.season - a.season)
      .map((r) => ({
        season: r.season,
        test: r.test,
        champion: r.champion
          ? {
              name: clubs.get(r.champion)?.name ?? '?',
              tag: clubs.get(r.champion)?.tag ?? '',
              manager: !!clubs.get(r.champion)?.userId,
            }
          : null,
        tiers: Array.from({ length: r.tiers }, (_, t) =>
          this.members(r.season)
            .filter((m) => m.tier === t)
            .sort((a, b) => (a.place ?? 99) - (b.place ?? 99))
            .map((m) => ({
              name: clubs.get(m.clubId)?.name ?? '?',
              tag: clubs.get(m.clubId)?.tag ?? '',
              manager: !!clubs.get(m.clubId)?.userId,
              place: m.place,
              points: m.points,
              nextTier: m.nextTier,
              finalPlace: m.finalPlace,
            })),
        ),
      }));
  }
}

function runView(r: RunRow) {
  return {
    season: r.season,
    test: r.test,
    status: r.status,
    tiers: r.tiers,
    size: r.size,
    perEvening: r.perEvening,
    tableMoney: r.tableMoney,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
  };
}

function shuffle<T>(l: readonly T[], rng: () => number): T[] {
  const a = [...l];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** A tag for an AI club from its name (two or three letters, free). */
function clubTag(name: string, taken: Set<string>): string {
  const words = name
    .replace(/[^A-Za-z ]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  const cands = [
    words
      .map((w) => w[0])
      .join('')
      .slice(0, 3),
    name.replace(/[^A-Za-z]/g, '').slice(0, 3),
    name.replace(/[^A-Za-z]/g, '').slice(0, 2),
  ];
  for (const c of cands) {
    const t = `[${c.toUpperCase()}]`;
    if (c.length >= 2 && !taken.has(t.toLowerCase())) return t;
  }
  for (let i = 1; ; i++) if (!taken.has(`[l${i}]`)) return `[L${i}]`;
}

/** A club's place in the tables (null: not in the league). */
function placeIn(tables: readonly TableRow[][], clubId: string): number | null {
  for (const tb of tables) {
    const r = tb.find((x) => x.club === clubId);
    if (r) return r.place;
  }
  return null;
}
