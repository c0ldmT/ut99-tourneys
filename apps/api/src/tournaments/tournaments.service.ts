import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { buildSlots, createRng, fillEmptySlots, shuffle, type Rng } from '@tourney/bracket';
import {
  BotSpecSchema,
  MAX_SUBS,
  TournamentSettingsSchema,
  botEntrant,
  botTeamName,
  entrantUserIds,
  settingsProblems,
  teamStarters,
  userEntrantId,
  type AccessEntry,
  type BotSpec,
  type Entrant,
  udtManagerOf,
  type MapRecords,
  type NewTournamentEvent,
  type TeamEntrant,
  type TournamentProjection,
  type TournamentSettings,
} from '@tourney/protocol';
import { gameProblems } from '@tourney/adapter-ut99';
import { z } from 'zod';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import {
  neuroLedger,
  registrations,
  shopPurchases,
  tournaments,
  users,
  watchers,
} from '../db/schema.js';
import { badRequest, conflict, forbidden, notFound } from '../common/http.js';
import { randomId, slugify, TOURNAMENT_ID } from '../common/ids.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { AgentConnections } from '../agents/connections.js';
import { AgentsService } from '../agents/agents.service.js';
import type { User } from '../auth/users.service.js';
import { isWebhookUrl } from '../notify/discord-out.js';
import { NotificationsService } from '../notify/notifications.service.js';
import { botKey, statMode, userKey } from '../stats/facts.js';
import type { RatedGame } from '../stats/ratings.js';
import { StatsService } from '../stats/stats.service.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { BotsService } from '../bots/bots.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { ShopService } from '../shop/shop.service.js';
import { BetsService } from '../bets/bets.service.js';
import { EventLogService } from './event-log.service.js';
import { matchDetail, type MatchDetail } from './match-detail.js';
import { LiveHub } from './hub.js';
import {
  balanceBots,
  pickBotsNear,
  ratingSlots,
  teamStrength,
  type RatedBot,
} from './rating-seed.js';
import { assignBots, fits, formTeams, joinRole, type TeamShape } from './teams.js';
import { shapeOf, TeamsService, type TeamView } from './teams.service.js';

export type TournamentRow = typeof tournaments.$inferSelect;

/** Bots of a tournament when the control center has no active bot and the server none. */
const STOCK_BOTS: BotSpec[] = [
  'Xan',
  'Loque',
  'Malcolm',
  'Brock',
  'Lauren',
  'Visse',
  'Tamika',
  'Dominator',
].map((name, i) => ({ name, skill: [6, 5, 5, 4, 4, 3, 3, 2][i] ?? 3 }));

/** Phases in which the bridge runs the tournament. */
export const ACTIVE_PHASES = ['checkIn', 'running', 'paused'];
/** The mod's access list holds 64 entries. */
export const MAX_ACCESS = 64;

/**
 * Rules of a Dream Team tournament: the lineup's market value at most `valueCap` reference
 * Neuro (× the economy index), at most `starLimit` bots of skill 6-7. Null = no limit.
 */
export const UdtEventRulesSchema = z.object({
  valueCap: z.number().int().min(100).max(10_000_000).nullable().default(null),
  starLimit: z.number().int().min(0).max(5).nullable().default(null),
  /** High stakes: the entry ticket in Neuro (null: none), at the economy index or fixed. */
  ticket: z.number().int().min(10).max(10_000_000).nullable().default(null),
  ticketIndexed: z.boolean().default(true),
  /** High stakes: fewer human teams at the seeding and the tickets go back. */
  minTeams: z.number().int().min(2).max(16).default(4),
  /** Season finale: the top of the season table plays (no sign-up). */
  finale: z.boolean().default(false),
});
export type UdtEventRules = z.infer<typeof UdtEventRulesSchema>;

/** Kinds of tournaments: managers' Dream Team lineups play in "udt" ones. */
export const TOURNAMENT_KINDS = ['standard', 'udt'] as const;
export type TournamentKind = (typeof TOURNAMENT_KINDS)[number];

/**
 * Who plays in a tournament of another kind than "standard" (Dream Team): all entrants of the
 * bracket, filled up to the bracket size; the seeding draws them into the slots.
 */
export type LineupProvider = (
  t: TournamentRow,
  settings: TournamentSettings,
  rng: () => number,
) => { entrants: Entrant[]; fill: Entrant[] };

/**
 * Who signs up for an add-on's kind of tournament (Dream Team: managers enter their teams).
 * The tournament page's register and withdraw go through it, and its entries are the
 * registrations everybody sees (with a label, e.g. the team name).
 */
export interface SignupProvider {
  enter(t: TournamentRow, user: User): void;
  leave(t: TournamentRow, userId: string): void;
  entries(tournamentId: string): { userId: string; label: string; ai?: boolean }[];
  /** Extra facts for the tournament page (Dream Team: whether AI managers play). */
  info?(t: TournamentRow): Record<string, unknown>;
}

const TournamentFields = z.object({
  name: z.string().trim().min(1).max(100),
  agentId: z.string().min(1).max(64),
  profileId: z.string().min(1).max(64),
  connectAddress: z.string().trim().max(128).nullable().optional(),
  settings: TournamentSettingsSchema,
  /** Missing or empty: the active bots of the control center (fixed at the seeding). */
  botPool: z.array(BotSpecSchema).max(64).optional(),
  registrationOpen: z.boolean().optional(),
  scheduledAt: z.iso.datetime().nullable().optional(),
  /** Discord channel for this tournament: the default webhook, its own, or none. */
  notifyMode: z.enum(['default', 'custom', 'off']).optional(),
  /**
   * Season tournament: counts for the ratings and the season statistics and records (lifetime
   * statistics count every tournament). Can only be switched on while a season runs.
   */
  seasonal: z.boolean().optional(),
  /** Seeded and started by itself at the start time (needs `scheduledAt`). */
  autoStart: z.boolean().optional(),
  /** "udt": the Dream Team managers' lineups play (draft only). */
  kind: z.enum(TOURNAMENT_KINDS).optional(),
  udt: UdtEventRulesSchema.optional(),
  webhookUrl: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === '' || isWebhookUrl(v), 'not a Discord webhook URL')
    .nullable()
    .optional(),
});
export const CreateTournamentBody = TournamentFields.extend({
  id: z.string().regex(TOURNAMENT_ID).optional(),
});
export const UpdateTournamentBody = TournamentFields.partial();
export type CreateTournament = z.infer<typeof CreateTournamentBody>;
export type UpdateTournament = z.infer<typeof UpdateTournamentBody>;

export const SeedBody = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('auto'),
    /** random; seeded = registration order; rating = strongest meet late, bots balanced. */
    humanOrder: z.enum(['random', 'seeded', 'rating']).default('random'),
    rngSeed: z.string().max(100).optional(),
  }),
  z.object({
    mode: z.literal('manual'),
    /** Entrant ids per bracket slot; null = random bot from the pool. */
    slots: z.array(z.string().max(64).nullable()),
    rngSeed: z.string().max(100).optional(),
  }),
]);
export type Seed = z.infer<typeof SeedBody>;

export const CommandBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('forceStart') }),
  z.object({ kind: z.literal('pause'), reason: z.string().trim().min(1).max(200) }),
  z.object({ kind: z.literal('resume') }),
  z.object({ kind: z.literal('abort'), reason: z.string().trim().min(1).max(200) }),
  z.object({ kind: z.literal('announce'), message: z.string().trim().min(1).max(200) }),
  /** Plays the current game (Monster Hunt: run) of the current match again. */
  z.object({ kind: z.literal('restart') }),
  /** Monster Hunt: the running team gives up its run, the other team runs next. */
  z.object({ kind: z.literal('forfeitRun') }),
]);
export type Command = z.infer<typeof CommandBody>;

/** Admin: sets the winner of a match (the current one, a coming one, or a correction). */
export const OverrideBody = z.object({
  matchId: z.string().min(1).max(16),
  winnerId: z.string().min(1).max(64),
});
export type Override = z.infer<typeof OverrideBody>;

export const CreateTeamBody = z.object({
  name: z.string().trim().min(1).max(40),
  tag: z.string().trim().max(20).nullable().optional(),
});
export const JoinTeamBody = z.object({ code: z.string().regex(/^[A-Za-z0-9]{8,32}$/) });
export const UpdateTeamBody = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  tag: z.string().trim().max(20).nullable().optional(),
  captainId: z.string().min(1).max(64).optional(),
});
export const LineupBody = z.object({ starters: z.array(z.string().min(1).max(64)).max(5) });
export const MoveMemberBody = z.object({
  teamId: z.string().min(1).max(64).nullable(),
  sub: z.boolean().default(false),
});
export type CreateTeam = z.infer<typeof CreateTeamBody>;
export type UpdateTeam = z.infer<typeof UpdateTeamBody>;
export type MoveMember = z.infer<typeof MoveMemberBody>;

/** Bracket entrant ids of teams made of bots only (the team table uses "t-…"). */
const botTeamId = (n: number) => `botteam-${n}`;

@Injectable()
export class TournamentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(EventLogService) private readonly log: EventLogService,
    @Inject(LiveHub) private readonly hub: LiveHub,
    @Inject(AgentsService) private readonly agents: AgentsService,
    @Inject(AgentConnections) private readonly connections: AgentConnections,
    @Inject(LOGGER) private readonly logger: ApiLogger,
    @Inject(TeamsService) private readonly teams: TeamsService,
    @Inject(NotificationsService) private readonly notify: NotificationsService,
    @Inject(StatsService) private readonly stats: StatsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(SettingsService) private readonly settingsSvc: SettingsService,
    @Inject(BetsService) private readonly bets: BetsService,
    @Inject(ShopService) private readonly shop: ShopService,
  ) {}

  private now() {
    return new Date(this.clock.now()).toISOString();
  }

  get(id: string): TournamentRow | undefined {
    return this.db.select().from(tournaments).where(eq(tournaments.id, id)).get();
  }

  require(id: string): TournamentRow {
    const t = this.get(id);
    if (!t) throw notFound('tournament {id}', { id });
    return t;
  }

  byAgent(agentId: string): TournamentRow[] {
    return this.db.select().from(tournaments).where(eq(tournaments.agentId, agentId)).all();
  }

  settings(t: TournamentRow): TournamentSettings {
    return TournamentSettingsSchema.parse(JSON.parse(t.settingsJson));
  }

  /**
   * The bot pool; website bots with their current name, look and play style. Until the seeding
   * a control-center tournament takes the active bots as they are now.
   */
  botPool(t: TournamentRow): BotSpec[] {
    if (t.botsFromLibrary && t.phase === 'draft') return this.libraryPool(t.agentId, t.profileId);
    return z
      .array(BotSpecSchema)
      .parse(JSON.parse(t.botPoolJson))
      .map((b) => this.bots.resolveSpec(b));
  }

  /**
   * The active bots of the control center with their skill (at most 64). Without any: the
   * bots of the server's configuration, else the stock bots.
   */
  libraryPool(agentId?: string, profileId?: string): BotSpec[] {
    const active = this.bots
      .list()
      .filter((b) => b.active)
      .slice(0, 64)
      .map((b) => this.bots.resolveSpec({ id: b.id, name: b.gameName, skill: b.skill }));
    if (active.length) return active;
    const inv = z
      .object({ bots: z.array(BotSpecSchema).max(64) })
      .safeParse(agentId && profileId ? this.agents.inventory(agentId, profileId) : undefined);
    if (inv.success && inv.data.bots.length) return inv.data.bots;
    return STOCK_BOTS.map((b) => ({ ...b }));
  }

  /** Checks a series template (as a tournament would be checked when it is created). */
  checkTemplate(t: Omit<CreateTournament, 'name'>): void {
    this.checkFields({
      settings: t.settings,
      botPool: t.botPool?.length
        ? t.botPool.map((b) => this.bots.resolveSpec(b))
        : this.libraryPool(t.agentId, t.profileId),
      agentId: t.agentId,
      profileId: t.profileId,
    });
  }

  /**
   * Clan teams (team tournaments with `clanTeams`): every clan with enough bots in the pool
   * plays as a bot team of its own (clan name, a random line-up of its bots).
   */
  private clanTeams(
    pool: BotSpec[],
    teamSize: number,
    rng: Rng,
  ): { name: string; tag: string; bots: BotSpec[] }[] {
    const byClan = new Map<string, { name: string; tag: string; bots: BotSpec[] }>();
    for (const b of pool) {
      const clan = this.bots.clanOf(b.id);
      if (!clan) continue;
      const entry = byClan.get(clan.id) ?? { name: clan.name, tag: clan.tag, bots: [] };
      if (!entry.bots.some((x) => x.id === b.id)) entry.bots.push(b);
      byClan.set(clan.id, entry);
    }
    return shuffle([...byClan.values()], rng)
      .filter((c) => c.bots.length >= teamSize)
      .map((c) => ({ ...c, bots: shuffle(c.bots, rng).slice(0, teamSize) }));
  }

  /** The pool without the bots that already play in a clan team (if enough bots are left). */
  private fillPool(pool: BotSpec[], teams: TeamEntrant[], need: number): BotSpec[] {
    const used = new Set(teams.flatMap((e) => e.bots.map((b) => b.name.toLowerCase())));
    const rest = pool.filter((b) => !used.has(b.name.toLowerCase()));
    const distinct = new Set(rest.map((b) => b.name.toLowerCase())).size;
    return distinct >= need ? rest : pool;
  }

  // ------------------------------------------------------------------------------------------
  // Drafts
  // ------------------------------------------------------------------------------------------

  private checkFields(f: {
    settings?: TournamentSettings;
    botPool?: BotSpec[];
    agentId?: string;
    profileId?: string;
  }) {
    if (f.settings) {
      const problems = [...settingsProblems(f.settings), ...gameProblems(f.settings)];
      if (problems.length) throw badRequest(problems.join('; '));
      const distinctBots = new Set((f.botPool ?? []).map((b) => b.name.toLowerCase())).size;
      if (f.settings.teamSize > 1 && f.botPool && distinctBots < 2 * f.settings.teamSize) {
        // Two full bot teams must be able to play each other.
        throw badRequest(
          'team tournaments of {teamSize} need at least {teamSize2} different bots in the pool',
          { teamSize: f.settings.teamSize, teamSize2: 2 * f.settings.teamSize },
        );
      }
    }
    if (f.agentId) {
      const agent = this.agents.require(f.agentId);
      const profiles = this.agents.info(agent).profiles;
      if (f.profileId && profiles && !profiles.some((p) => p.id === f.profileId)) {
        throw badRequest('agent {agentId} has no server profile {profileId}', {
          agentId: f.agentId,
          profileId: f.profileId,
        });
      }
    }
  }

  create(input: CreateTournament, by: User, opts: { seriesId?: string } = {}): TournamentRow {
    // Website bots get their current name (with clan tag) for the checks and the stored pool.
    const fromLibrary = !input.botPool?.length;
    const body = {
      ...input,
      botPool: fromLibrary
        ? this.libraryPool(input.agentId, input.profileId)
        : input.botPool!.map((b) => this.bots.resolveSpec(b)),
    };
    this.checkFields(body);
    const inSeason = !!this.seasons.current();
    // Dream Team tournaments belong to the running season, always (no switch of their own).
    if (body.kind === 'udt') body.seasonal = true;
    if (body.seasonal && !inSeason && !opts.seriesId) throw conflict('no season is running');
    let id = body.id ?? slugify(body.name);
    if (this.get(id)) {
      if (body.id) throw conflict('tournament {id} exists', { id });
      id = `${id.slice(0, 50)}-${randomId(6).toLowerCase()}`;
    }
    this.db
      .insert(tournaments)
      .values({
        id,
        name: body.name,
        agentId: body.agentId,
        profileId: body.profileId,
        connectAddress: body.connectAddress || null,
        settingsJson: JSON.stringify(body.settings),
        botPoolJson: JSON.stringify(body.botPool),
        botsFromLibrary: fromLibrary,
        autoStart: body.autoStart ?? false,
        registrationOpen: body.registrationOpen ?? true,
        scheduledAt: body.scheduledAt ?? null,
        notifyMode: body.notifyMode ?? 'default',
        webhookUrl: body.webhookUrl || null,
        seasonal: (body.seasonal ?? inSeason) && inSeason,
        seriesId: opts.seriesId ?? null,
        kind: body.kind ?? 'standard',
        udtJson:
          body.kind === 'udt' ? JSON.stringify(UdtEventRulesSchema.parse(body.udt ?? {})) : null,
        createdBy: by.id,
        createdAt: this.now(),
      })
      .run();
    this.logger.info(`tournament ${id} created by ${by.displayName}`);
    this.notify.announceIfOpen(id);
    this.saved(id);
    return this.require(id);
  }

  update(id: string, input: UpdateTournament): TournamentRow {
    const t = this.require(id);
    // An empty pool switches to the control center's bots.
    const fromLibrary = input.botPool ? !input.botPool.length : undefined;
    const body = input.botPool
      ? {
          ...input,
          botPool: fromLibrary
            ? this.libraryPool(input.agentId ?? t.agentId, input.profileId ?? t.profileId)
            : input.botPool.map((b) => this.bots.resolveSpec(b)),
        }
      : input;
    const structural =
      body.settings !== undefined || body.agentId !== undefined || body.profileId !== undefined;
    if (structural && t.phase !== 'draft') {
      throw conflict(
        'settings, agent and profile can only be changed in draft (reset the seeding first)',
      );
    }
    if (body.botPool && ACTIVE_PHASES.includes(t.phase)) {
      throw conflict('the bot pool cannot change while the tournament runs');
    }
    this.checkFields({
      settings: body.settings ?? (body.botPool ? this.settings(t) : undefined),
      botPool: body.botPool ?? this.botPool(t),
      agentId: body.agentId ?? (body.profileId ? t.agentId : undefined),
      profileId: body.profileId ?? t.profileId,
    });
    const set: Partial<TournamentRow> = {};
    if (body.name !== undefined) set.name = body.name;
    if (body.agentId !== undefined) set.agentId = body.agentId;
    if (body.profileId !== undefined) set.profileId = body.profileId;
    if (body.connectAddress !== undefined) set.connectAddress = body.connectAddress || null;
    if (body.settings !== undefined) set.settingsJson = JSON.stringify(body.settings);
    if (body.botPool !== undefined) set.botPoolJson = JSON.stringify(body.botPool);
    if (fromLibrary !== undefined) set.botsFromLibrary = fromLibrary;
    if (body.registrationOpen !== undefined) set.registrationOpen = body.registrationOpen;
    if (body.scheduledAt !== undefined && body.scheduledAt !== t.scheduledAt) {
      set.scheduledAt = body.scheduledAt;
      set.remindedAt = null; // a new start gets a new reminder
    }
    if (body.notifyMode !== undefined) set.notifyMode = body.notifyMode;
    if (body.autoStart !== undefined) set.autoStart = body.autoStart;
    if (body.kind !== undefined || body.udt !== undefined) {
      if (t.phase !== 'draft') throw conflict('the kind of a tournament changes in draft only');
      const kind = body.kind ?? (t.kind as TournamentKind);
      set.kind = kind;
      if (kind === 'udt') {
        if (!this.seasons.current()) throw conflict('no season is running');
        set.seasonal = true;
      }
      set.udtJson =
        kind === 'udt'
          ? JSON.stringify(UdtEventRulesSchema.parse(body.udt ?? this.udtRules(t) ?? {}))
          : null;
    }
    if (body.webhookUrl !== undefined) set.webhookUrl = body.webhookUrl || null;
    const udtNow = (body.kind ?? t.kind) === 'udt';
    if (!udtNow && body.seasonal !== undefined && body.seasonal !== t.seasonal) {
      if (body.seasonal && !this.seasons.current()) throw conflict('no season is running');
      set.seasonal = body.seasonal;
    }
    const oldTeamSize = this.settings(t).teamSize;
    if (Object.keys(set).length) {
      this.db.update(tournaments).set(set).where(eq(tournaments.id, id)).run();
      if (body.settings && body.settings.teamSize !== oldTeamSize) {
        if (body.settings.teamSize === 1) this.teams.dissolveAll(id);
        else this.teams.normalize(id, body.settings.teamSize, MAX_SUBS);
      }
      this.notifyDraft(id);
      this.notify.announceIfOpen(id);
      this.saved(id);
    }
    return this.require(id);
  }

  /** Called after a tournament was created or changed (the Dream Team lets AI managers enter). */
  private readonly saveHooks: ((t: TournamentRow) => void)[] = [];
  onSaved(fn: (t: TournamentRow) => void): void {
    this.saveHooks.push(fn);
  }

  private saved(id: string): void {
    const t = this.get(id);
    if (!t) return;
    for (const fn of this.saveHooks) {
      try {
        fn(t);
      } catch (err) {
        this.logger.warn(`after saving ${id}: ${String(err)}`);
      }
    }
  }

  /** Called before a tournament is deleted (the Dream Team gives entry tickets back). */
  private readonly removeHooks: ((t: TournamentRow) => void)[] = [];
  onRemove(fn: (t: TournamentRow) => void): void {
    this.removeHooks.push(fn);
  }

  /** Called by the website reset after the tournaments are gone (the Dream Team wipes its data). */
  private readonly resetHooks: (() => void)[] = [];
  onResetAll(fn: () => void): void {
    this.resetHooks.push(fn);
  }

  remove(id: string): void {
    const t = this.require(id);
    if (ACTIVE_PHASES.includes(t.phase)) throw conflict('abort the tournament before deleting it');
    for (const fn of this.removeHooks) fn(t);
    this.db.delete(tournaments).where(eq(tournaments.id, id)).run();
    this.log.forget(id);
    this.hub.clearLive(id);
  }

  /**
   * Website reset (settings page): deletes every tournament with its log, registrations and
   * teams, and every season; statistics, ratings and records are gone with them, and the data of
   * add-ons (Dream Team) through their reset hooks. Users, bots, clans, servers and settings
   * stay. Not while a tournament is checking in or running.
   */
  resetAll(): { tournaments: number; seasons: number } {
    const all = this.db.select().from(tournaments).all();
    const active = all.filter((t) => ACTIVE_PHASES.includes(t.phase));
    if (active.length)
      throw conflict('abort the running tournaments first: {list}', {
        list: active.map((t) => t.name).join(', '),
      });
    for (const t of all) this.remove(t.id);
    for (const fn of this.resetHooks) fn();
    // Shop purchases were paid with the seasons' Neuro: they go with them (looks too).
    this.db.delete(shopPurchases).run();
    // So do the ledger's bookings (Dream Team rewards, purchases, salaries).
    this.db.delete(neuroLedger).run();
    this.db.update(users).set({ lookJson: null }).run();
    const seasons = this.seasons.clearAll();
    this.stats.clearCache();
    this.logger.warn(`website reset: ${all.length} tournaments and ${seasons} seasons deleted`);
    return { tournaments: all.length, seasons };
  }

  /**
   * The projection with the current names of the control center's bots (renamed or moved to
   * another clan after the seeding); the event log keeps the names of the time.
   */
  private withCurrentBotNames<T extends { entrants: Record<string, Entrant> }>(proj: T): T {
    const names = this.bots.gameNames();
    if (!names.size) return proj;
    const entrants: Record<string, Entrant> = {};
    for (const [id, e] of Object.entries(proj.entrants)) {
      // Dream Team lineups play under their manager's tag and team name.
      if (udtManagerOf(id)) entrants[id] = e;
      else if (e.kind === 'bot' && e.bot.id && names.has(e.bot.id)) {
        const name = names.get(e.bot.id)!;
        entrants[id] = { ...e, displayName: name, bot: { ...e.bot, name } };
      } else if (e.kind === 'team' && e.bots.some((b) => b.id && names.has(b.id))) {
        entrants[id] = {
          ...e,
          bots: e.bots.map((b) => (b.id && names.has(b.id) ? { ...b, name: names.get(b.id)! } : b)),
        };
      } else entrants[id] = e;
    }
    return { ...proj, entrants };
  }

  private notifyDraft(id: string) {
    const t = this.require(id);
    this.hub.publish(id, { type: 'change', headSeq: t.headSeq, phase: t.phase });
  }

  // ------------------------------------------------------------------------------------------
  // Players and spectators
  // ------------------------------------------------------------------------------------------

  registered(id: string): User[] {
    const provider = this.signupProviders.get(this.get(id)?.kind ?? 'standard');
    if (provider) {
      const ids = provider.entries(id).map((e) => e.userId);
      if (!ids.length) return [];
      const byId = new Map(
        this.db
          .select()
          .from(users)
          .where(inArray(users.id, ids))
          .all()
          .map((u) => [u.id, u]),
      );
      return ids.flatMap((u) => (byId.has(u) ? [byId.get(u)!] : []));
    }
    return this.db
      .select({ user: users })
      .from(registrations)
      .innerJoin(users, eq(users.id, registrations.userId))
      .where(eq(registrations.tournamentId, id))
      .orderBy(asc(registrations.createdAt), asc(users.displayKey))
      .all()
      .map((r) => r.user);
  }

  private watching(id: string): User[] {
    return this.db
      .select({ user: users })
      .from(watchers)
      .innerJoin(users, eq(users.id, watchers.userId))
      .where(eq(watchers.tournamentId, id))
      .orderBy(asc(watchers.createdAt))
      .all()
      .map((r) => r.user);
  }

  private readonly signupProviders = new Map<string, SignupProvider>();
  registerSignupProvider(kind: TournamentKind, provider: SignupProvider): void {
    this.signupProviders.set(kind, provider);
  }

  /** The tournament's page and list change (an add-on took a sign-up). */
  changed(id: string): void {
    if (this.get(id)) this.notifyDraft(id);
  }

  register(id: string, user: User): void {
    const t = this.require(id);
    const provider = this.signupProviders.get(t.kind);
    if (provider) {
      provider.enter(t, user);
      this.notifyDraft(id);
      return;
    }
    if (t.phase !== 'draft')
      throw conflict('registration is closed: the bracket is already seeded');
    if (!t.registrationOpen) throw conflict('registration is closed');
    if (this.teams.registration(id, user.id)) return;
    const settings = this.settings(t);
    const teams = this.teams.list(id);
    const solos = this.teams.solos(id).length + 1;
    if (
      !fits({ size: settings.size, teamSize: settings.teamSize, teams: teams.map(shapeOf), solos })
    )
      throw conflict('the tournament is full');
    this.teams.setMembership(id, user.id, null, false);
    this.notifyDraft(id);
  }

  unregister(id: string, userId: string): void {
    const t = this.require(id);
    if (t.phase !== 'draft') throw conflict('the bracket is already seeded');
    const provider = this.signupProviders.get(t.kind);
    if (provider) {
      provider.leave(t, userId);
      this.notifyDraft(id);
      return;
    }
    const teamId = this.teams.registration(id, userId)?.teamId;
    this.db
      .delete(registrations)
      .where(and(eq(registrations.tournamentId, id), eq(registrations.userId, userId)))
      .run();
    if (teamId) this.teams.repair(id, teamId);
    this.notifyDraft(id);
  }

  // ------------------------------------------------------------------------------------------
  // Teams (team deathmatch)
  // ------------------------------------------------------------------------------------------

  private requireTeamDraft(id: string, opts: { open?: boolean } = {}) {
    const t = this.require(id);
    const settings = this.settings(t);
    if (settings.teamSize < 2) throw conflict('this is not a team tournament');
    if (this.signupProviders.has(t.kind))
      throw conflict('teams sign up on their own page here (Dream Team: the manager enters)');
    if (t.phase !== 'draft') throw conflict('teams are fixed: the bracket is already seeded');
    if (opts.open && !t.registrationOpen) throw conflict('registration is closed');
    return { t, settings };
  }

  private requireManager(team: { captainId: string }, user: User) {
    if (!user.isAdmin && team.captainId !== user.id)
      throw forbidden('only the captain can do this');
  }

  /** Throws unless every solo player still finds a starter place after a change. */
  private ensureFits(settings: TournamentSettings, teams: TeamShape[], solos: number) {
    if (!fits({ size: settings.size, teamSize: settings.teamSize, teams, solos })) {
      throw conflict('the tournament is full');
    }
  }

  createTeam(id: string, user: User, body: CreateTeam) {
    const { settings } = this.requireTeamDraft(id, { open: true });
    const reg = this.teams.registration(id, user.id);
    if (reg?.teamId) throw conflict('leave your team first');
    const teams = this.teams.list(id).map(shapeOf);
    const solos = this.teams.solos(id).length - (reg ? 1 : 0);
    this.ensureFits(
      settings,
      [...teams, { id: 'new', members: [{ userId: user.id, sub: false }] }],
      solos,
    );
    const row = this.teams.create(id, user, body);
    this.notifyDraft(id);
    return row;
  }

  /** What an invite link points to (shown before joining). */
  invitePreview(id: string, code: string) {
    this.require(id);
    const team = this.teams.byInvite(id, code);
    return {
      teamId: team.id,
      name: team.name,
      tag: team.tag,
      members: team.members.map((m) => ({ displayName: m.user.displayName, sub: m.sub })),
    };
  }

  joinTeam(id: string, user: User, code: string) {
    const { settings } = this.requireTeamDraft(id, { open: true });
    const team = this.teams.byInvite(id, code);
    const reg = this.teams.registration(id, user.id);
    if (reg?.teamId === team.id) return;
    if (reg?.teamId) throw conflict('leave your team first');
    const role = joinRole(shapeOf(team), settings.teamSize);
    if (!role) throw conflict('the team is full');
    const teams = this.teams.list(id).map((t) =>
      t.id === team.id
        ? {
            ...shapeOf(t),
            members: [...shapeOf(t).members, { userId: user.id, sub: role === 'sub' }],
          }
        : shapeOf(t),
    );
    this.ensureFits(settings, teams, this.teams.solos(id).length - (reg ? 1 : 0));
    this.teams.setMembership(id, user.id, team.id, role === 'sub');
    this.notifyDraft(id);
    this.notify.teamJoined(id, { name: team.name, captainId: team.captainId }, user);
  }

  updateTeam(id: string, teamId: string, user: User, body: UpdateTeam) {
    this.requireTeamDraft(id);
    this.requireManager(this.teams.get(id, teamId), user);
    this.teams.update(id, teamId, body);
    this.notifyDraft(id);
  }

  newInvite(id: string, teamId: string, user: User): string {
    this.requireTeamDraft(id);
    this.requireManager(this.teams.get(id, teamId), user);
    return this.teams.newInvite(id, teamId);
  }

  /** Deletes a team; its members stay registered without a team. */
  removeTeam(id: string, teamId: string, user: User) {
    const { settings } = this.requireTeamDraft(id);
    const team = this.teams.get(id, teamId);
    this.requireManager(team, user);
    const teams = this.teams
      .list(id)
      .filter((t) => t.id !== teamId)
      .map(shapeOf);
    this.ensureFits(settings, teams, this.teams.solos(id).length + team.members.length);
    this.teams.remove(id, teamId);
    this.notifyDraft(id);
  }

  /** A member leaves the team (or the captain/an admin removes them); they stay registered solo. */
  removeMember(id: string, teamId: string, userId: string, user: User) {
    const { settings } = this.requireTeamDraft(id);
    const team = this.teams.get(id, teamId);
    if (userId !== user.id) this.requireManager(team, user);
    if (!team.members.some((m) => m.user.id === userId))
      throw notFound('member {userId}', { userId });
    const teams = this.teams
      .list(id)
      .map((t) =>
        t.id === teamId
          ? { ...shapeOf(t), members: shapeOf(t).members.filter((m) => m.userId !== userId) }
          : shapeOf(t),
      );
    this.ensureFits(settings, teams, this.teams.solos(id).length + 1);
    this.teams.setMembership(id, userId, null, false);
    this.teams.repair(id, teamId);
    this.notifyDraft(id);
  }

  /** Admin: puts a registered player into a team (or makes them solo). */
  moveMember(id: string, userId: string, body: MoveMember) {
    const { settings } = this.requireTeamDraft(id);
    const reg = this.teams.registration(id, userId);
    if (!reg) throw notFound('registration of {userId}', { userId });
    if (body.teamId) {
      const target = this.teams.get(id, body.teamId);
      const others = target.members.filter((m) => m.user.id !== userId);
      if (others.length >= settings.teamSize + MAX_SUBS) throw conflict('the team is full');
      if (!body.sub && others.filter((m) => !m.sub).length >= settings.teamSize)
        throw conflict('the team has all its starters');
    }
    this.teams.setMembership(id, userId, body.teamId, body.teamId ? body.sub : false);
    if (reg.teamId && reg.teamId !== body.teamId) this.teams.repair(id, reg.teamId);
    this.notifyDraft(id);
  }

  /**
   * Who starts. Before seeding the database changes; afterwards a `team.lineupSet` event goes into
   * the log (the bridge applies it from the next game on).
   */
  setLineup(id: string, teamId: string, user: User, starters: string[]) {
    const t = this.require(id);
    const settings = this.settings(t);
    if (settings.teamSize < 2) throw conflict('this is not a team tournament');
    const unique = [...new Set(starters)];
    if (unique.length > settings.teamSize)
      throw badRequest('at most {teamSize} starters', { teamSize: settings.teamSize });
    if (t.phase === 'draft') {
      const team = this.teams.get(id, teamId);
      this.requireManager(team, user);
      const unknown = unique.filter((u) => !team.members.some((m) => m.user.id === u));
      if (unknown.length) throw badRequest('not in the team: {list}', { list: unknown.join(', ') });
      this.teams.setStarters(id, teamId, unique);
      this.notifyDraft(id);
      return;
    }
    if (t.phase === 'finished' || t.phase === 'aborted')
      throw conflict('the tournament is {phase}', { phase: t.phase });
    const entrant = this.log.projection(id)?.entrants[teamId];
    if (entrant?.kind !== 'team') throw notFound('team {teamId}', { teamId });
    this.requireManager({ captainId: entrant.captainUserId ?? '' }, user);
    const unknown = unique.filter((u) => !entrant.members.some((m) => m.userId === u));
    if (unknown.length) throw badRequest('not in the team: {list}', { list: unknown.join(', ') });
    const head = t.headSeq;
    const res = this.log.append(id, head, [
      {
        type: 'team.lineupSet',
        actor: { kind: user.isAdmin ? 'admin' : 'player', id: user.id },
        data: { entrantId: teamId, starters: unique },
      },
    ]);
    if (!res.accepted) throw conflict(res.reason);
    this.syncToAgent(this.require(id), head);
  }

  /** Admin: puts every solo player into a team (see formTeams). */
  buildTeams(id: string) {
    const { t, settings } = this.requireTeamDraft(id);
    this.applyFormTeams(t, settings, createRng(`${id}-teams-${this.clock.now()}`));
    this.notifyDraft(id);
  }

  private applyFormTeams(t: TournamentRow, settings: TournamentSettings, rng: Rng) {
    const solos = this.teams.solos(t.id);
    if (!solos.length) return;
    let formed;
    try {
      formed = formTeams({
        size: settings.size,
        teamSize: settings.teamSize,
        teams: this.teams.list(t.id).map(shapeOf),
        solos: solos.map((u) => u.id),
        rng,
      });
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    for (const f of formed.fills) this.teams.setMembership(t.id, f.userId, f.teamId, false);
    for (const group of formed.created) {
      const [captain, ...rest] = group.map((uid) => solos.find((u) => u.id === uid) as User);
      const row = this.teams.create(
        t.id,
        captain as User,
        { name: `Team ${(captain as User).displayName}` },
        { uniqueSuffix: true },
      );
      for (const u of rest) this.teams.setMembership(t.id, u.id, row.id, false);
    }
  }

  async watch(id: string, user: User): Promise<void> {
    const t = this.require(id);
    if (t.phase === 'finished' || t.phase === 'aborted') throw conflict('the tournament is over');
    this.db
      .insert(watchers)
      .values({ tournamentId: id, userId: user.id, createdAt: this.now() })
      .onConflictDoNothing()
      .run();
    await this.pushAccess(t);
    this.notifyDraft(id);
  }

  async unwatch(id: string, userId: string): Promise<void> {
    const t = this.require(id);
    this.db
      .delete(watchers)
      .where(and(eq(watchers.tournamentId, id), eq(watchers.userId, userId)))
      .run();
    if (ACTIVE_PHASES.includes(t.phase) && this.connections.isOnline(t.agentId)) {
      if (!this.access(t).some((a) => a.userId === userId)) {
        await this.connections
          .command(t.agentId, { kind: 'access.revoke', tournamentId: id, userIds: [userId] })
          .catch((e: Error) => this.logger.warn(`access.revoke: ${e.message}`));
      }
    }
    this.notifyDraft(id);
  }

  /** Entrant per website user (the player in 1v1, the team in team tournaments). */
  private entrantByUser(proj: TournamentProjection | undefined): Map<string, Entrant> {
    const out = new Map<string, Entrant>();
    for (const e of Object.values(proj?.entrants ?? {})) {
      for (const userId of entrantUserIds(e)) out.set(userId, e);
    }
    return out;
  }

  /**
   * Who may join the game server: the players first (those of the current match before everyone
   * else, so they always fit into the mod's 64 entries), then spectators who clicked "watch".
   */
  access(t: TournamentRow): AccessEntry[] {
    const proj = this.log.projection(t.id);
    const byUser = this.entrantByUser(proj);
    const out: AccessEntry[] = [];
    const seen = new Set<string>();
    const add = (e: AccessEntry) => {
      if (seen.has(e.userId) || out.length >= MAX_ACCESS) return;
      seen.add(e.userId);
      out.push(e);
    };
    const playing = new Set(proj?.currentMatch?.entrants ?? []);
    const players = this.registered(t.id);
    const inMatch = (u: User) => playing.has(byUser.get(u.id)?.id ?? '');
    for (const u of [...players.filter(inMatch), ...players.filter((u) => !inMatch(u))]) {
      const entrant = byUser.get(u.id);
      const member =
        entrant?.kind === 'team' ? entrant.members.find((m) => m.userId === u.id) : undefined;
      add({
        userId: u.id,
        displayName:
          entrant?.kind === 'human' ? entrant.displayName : (member?.displayName ?? u.displayName),
        token: u.joinToken,
        ...(entrant && entrant.kind !== 'bot' ? { entrantId: entrant.id } : {}),
      });
    }
    for (const u of this.watching(t.id)) {
      add({ userId: u.id, displayName: u.displayName, token: u.joinToken });
    }
    return out;
  }

  /** Re-sends the access list to the bridge while the tournament runs (token changes, watchers). */
  async pushAccess(t: TournamentRow): Promise<void> {
    if (!ACTIVE_PHASES.includes(t.phase) || !this.connections.isOnline(t.agentId)) return;
    await this.connections
      .command(t.agentId, { kind: 'access.upsert', tournamentId: t.id, entries: this.access(t) })
      .catch((e: Error) => this.logger.warn(`access.upsert for ${t.id}: ${e.message}`));
  }

  /**
   * A new match was called: when more people have access than the mod's list holds, the list
   * changes with the match (its players come first), so the bridge gets it again.
   */
  async refreshAccessForMatch(id: string): Promise<void> {
    const t = this.get(id);
    if (!t) return;
    if (this.registered(id).length + this.watching(id).length <= MAX_ACCESS) return;
    await this.pushAccess(t);
  }

  /** A user changed their token or name: refresh running tournaments they belong to. */
  async userChanged(userId: string): Promise<void> {
    const active = this.db
      .select()
      .from(tournaments)
      .where(inArray(tournaments.phase, ACTIVE_PHASES))
      .all();
    for (const t of active) {
      if (this.access(t).some((a) => a.userId === userId)) await this.pushAccess(t);
    }
  }

  // ------------------------------------------------------------------------------------------
  // Seeding
  // ------------------------------------------------------------------------------------------

  private readonly lineupProviders = new Map<string, LineupProvider>();

  /** Add-ons (Dream Team) say who plays in their kind of tournament. */
  registerLineupProvider(kind: TournamentKind, provider: LineupProvider): void {
    this.lineupProviders.set(kind, provider);
  }

  /** The rules of a Dream Team tournament (null for other kinds). */
  udtRules(t: TournamentRow): UdtEventRules | null {
    if (t.kind !== 'udt') return null;
    try {
      return UdtEventRulesSchema.parse(t.udtJson ? JSON.parse(t.udtJson) : {});
    } catch {
      return UdtEventRulesSchema.parse({});
    }
  }

  seed(id: string, body: Seed, by: User): TournamentProjection {
    const t = this.require(id);
    if (t.phase !== 'draft' && t.phase !== 'seeded') {
      throw conflict('cannot seed in phase {phase}', { phase: t.phase });
    }
    if (t.kind !== 'standard') return this.seedByProvider(t, body, by);
    if (t.botsFromLibrary) {
      // The control center's bots as they are now: fixed for this bracket.
      t.botPoolJson = JSON.stringify(this.libraryPool(t.agentId, t.profileId));
      this.db
        .update(tournaments)
        .set({ botPoolJson: t.botPoolJson })
        .where(eq(tournaments.id, id))
        .run();
    }
    const settings = this.settings(t);
    const teamMode = settings.teamSize > 1;
    const rngSeed = body.rngSeed ?? `${id}-${this.clock.now()}`;
    const rng = createRng(rngSeed);
    let humans: Entrant[];
    const bots: Entrant[] = [];
    if (teamMode) {
      if (this.teams.solos(id).length) {
        if (body.mode === 'manual')
          throw badRequest('form the teams first: some players have no team');
        if (t.phase !== 'draft') throw badRequest('reset the seeding to change the teams');
        this.applyFormTeams(t, settings, rng);
      }
      humans = this.teams.list(id).map((v) => this.teamEntrant(v, settings.teamSize));
      const needed = Math.max(0, settings.size - humans.length);
      const clans = settings.clanTeams
        ? this.clanTeams(this.botPool(t), settings.teamSize, rng).slice(0, needed)
        : [];
      for (let n = 1; n <= settings.size; n++) {
        const clan = clans[n - 1];
        bots.push({
          id: botTeamId(n),
          kind: 'team',
          displayName: clan?.name ?? 'Bots',
          ...(clan ? { tag: clan.tag } : {}),
          members: [],
          bots: clan?.bots ?? [],
        });
      }
    } else {
      humans = this.registered(id).map((u) => ({
        id: userEntrantId(u.id),
        kind: 'human',
        displayName: u.displayName,
        userId: u.id,
      }));
      for (const spec of this.botPool(t)) {
        const e = botEntrant(spec);
        if (!bots.some((b) => b.id === e.id)) bots.push(e);
      }
    }
    // Nobody registered: a tournament of bots only (everybody can watch).
    if (humans.length > settings.size) {
      const params = { n: humans.length, size: settings.size };
      throw teamMode
        ? badRequest('{n} teams do not fit into a bracket of {size}', params)
        : badRequest('{n} players do not fit into a bracket of {size}', params);
    }
    const humanIds = humans.map((h) => h.id);
    const botIds = bots.map((b) => b.id);
    const byRating = body.mode === 'auto' && body.humanOrder === 'rating';
    let slots: string[];
    let entrants: Entrant[] = [];
    try {
      if (byRating) {
        ({ slots, entrants } = this.seedByRating(t, settings, humans, bots, rng));
      } else if (body.mode === 'auto') {
        slots = buildSlots({
          size: settings.size,
          humans: humanIds,
          // Teams: bot teams are interchangeable, the clan teams (first) always play.
          botPool: teamMode ? botIds.slice(0, settings.size - humanIds.length) : botIds,
          humanOrder: body.humanOrder === 'seeded' ? 'seeded' : 'random',
          // "Draw at random" mixes everybody: players are not placed on top for being human.
          // The bot placement setting applies to registration order (and rating).
          botPlacement: body.humanOrder === 'seeded' ? settings.botPlacement : 'random',
          rng,
        });
      } else {
        if (body.slots.length !== settings.size) {
          throw new Error(`expected ${settings.size} slots, got ${body.slots.length}`);
        }
        const known = new Set([...humanIds, ...botIds]);
        const placed = body.slots.filter((s): s is string => s !== null);
        const unknown = placed.filter((s) => !known.has(s));
        if (unknown.length) throw new Error(`unknown entrants: ${unknown.join(', ')}`);
        if (new Set(placed).size !== placed.length) throw new Error('an entrant is placed twice');
        const missing = humanIds.filter((h) => !placed.includes(h));
        if (missing.length) throw new Error(`not placed: ${missing.join(', ')}`);
        slots = fillEmptySlots(body.slots, botIds, rng);
      }
      if (!byRating) {
        const used = new Set(slots);
        entrants = [...humans, ...bots].filter((e) => used.has(e.id));
        if (teamMode)
          entrants = this.fillTeamsWithBots(
            t,
            slots,
            entrants as TeamEntrant[],
            settings.teamSize,
            rng,
          );
      }
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    const ratings = this.entrantRatings(settings, entrants);
    const actor = { kind: 'admin' as const, id: by.id };
    const batch: NewTournamentEvent[] = [];
    const head = this.log.load(id).length;
    if (head === 0) {
      batch.push({
        type: 'tournament.created',
        actor,
        data: { tournamentId: id, name: t.name, settings },
      });
    }
    batch.push({
      type: 'seeding.set',
      actor,
      data: {
        entrants,
        rngSeed,
        bracket: {
          format: settings.format,
          size: settings.size,
          slots,
          grandFinalReset: settings.grandFinalReset,
          bestOf: settings.bestOf,
        },
        ...(ratings ? { ratings } : {}),
      },
    });
    const res = this.log.append(id, head, batch);
    if (!res.accepted) throw conflict(res.reason);
    this.syncToAgent(t, head);
    return res.projection;
  }

  /**
   * Seeding of a Dream Team (or other add-on) tournament: the provider's entrants, filled up with
   * its fill entrants, drawn at random into the slots.
   */
  private seedByProvider(t: TournamentRow, body: Seed, by: User): TournamentProjection {
    const provider = this.lineupProviders.get(t.kind);
    if (!provider)
      throw conflict('tournaments of kind {kind} cannot be seeded now', { kind: t.kind });
    const settings = this.settings(t);
    const rngSeed = body.rngSeed ?? `${t.id}-${this.clock.now()}`;
    const rng = createRng(rngSeed);
    const { entrants: main, fill } = provider(t, settings, rng);
    if (main.length > settings.size)
      throw badRequest('{n} teams do not fit into a bracket of {size}', {
        n: main.length,
        size: settings.size,
      });
    let slots: string[];
    try {
      slots = buildSlots({
        size: settings.size,
        humans: main.map((e) => e.id),
        botPool: fill.map((e) => e.id).slice(0, settings.size - main.length),
        humanOrder: 'random',
        botPlacement: 'random',
        rng,
      });
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    const used = new Set(slots);
    const entrants = [...main, ...fill].filter((e) => used.has(e.id));
    const actor = { kind: 'admin' as const, id: by.id };
    const batch: NewTournamentEvent[] = [];
    const head = this.log.load(t.id).length;
    if (head === 0)
      batch.push({
        type: 'tournament.created',
        actor,
        data: { tournamentId: t.id, name: t.name, settings },
      });
    batch.push({
      type: 'seeding.set',
      actor,
      data: {
        entrants,
        rngSeed,
        bracket: {
          format: settings.format,
          size: settings.size,
          slots,
          grandFinalReset: settings.grandFinalReset,
          bestOf: settings.bestOf,
        },
      },
    });
    const res = this.log.append(t.id, head, batch);
    if (!res.accepted) throw conflict(res.reason);
    this.syncToAgent(t, head);
    return res.projection;
  }

  private teamEntrant(v: TeamView, teamSize: number): TeamEntrant {
    return {
      id: v.id,
      kind: 'team',
      displayName: v.name,
      ...(v.tag ? { tag: v.tag } : {}),
      captainUserId: v.captainId,
      // Starters first; substitutes move up when the team has fewer starters than places.
      members: v.members.map((m, i) => ({
        userId: m.user.id,
        displayName: m.user.displayName,
        sub: i >= teamSize,
      })),
      bots: [],
    };
  }

  /** Bots for the starter places nobody fills, and names for the teams made of bots only. */
  private fillTeamsWithBots(
    t: TournamentRow,
    slots: string[],
    entrants: TeamEntrant[],
    teamSize: number,
    rng: Rng,
  ): TeamEntrant[] {
    const ordered = slots.map((id) => entrants.find((e) => e.id === id) as TeamEntrant);
    const need = ordered.map((e) => Math.max(0, teamSize - e.members.length - e.bots.length));
    const pool = this.fillPool(this.botPool(t), ordered, Math.max(0, ...need));
    return this.nameBotTeams(ordered, assignBots(need, pool, rng));
  }

  /** Adds the bots to the teams and names the teams made of bots only. */
  private nameBotTeams(teams: TeamEntrant[], fills: BotSpec[][]): TeamEntrant[] {
    const taken = new Set(
      teams.filter((e) => e.members.length).map((e) => e.displayName.toLowerCase()),
    );
    for (const e of teams) if (e.bots.length) taken.add(e.displayName.toLowerCase());
    const names = this.settingsSvc.get().teamNames;
    let next = 0;
    const nameAt = (i: number) => names[i] ?? botTeamName(i);
    const botName = () => {
      let name = nameAt(next++);
      while (taken.has(name.toLowerCase())) name = nameAt(next++);
      taken.add(name.toLowerCase());
      return name;
    };
    return teams.map((e, i) => ({
      ...e,
      // Clan teams keep their name; other teams of bots get one from the list.
      ...(e.members.length || e.bots.length ? {} : { displayName: botName() }),
      bots: [...e.bots, ...(fills[i] ?? [])],
    }));
  }

  /** Strength (rating) of a player or bot in this tournament's mode. */
  private strengthOf(settings: TournamentSettings, ref: { userId?: string; bot?: BotSpec }) {
    const mode = statMode(settings);
    if (ref.userId) return this.stats.strength(mode, userKey(ref.userId));
    return this.stats.strength(mode, botKey(ref.bot!.name), ref.bot!.skill);
  }

  /** Strength of an entrant: the player, the bot, or the average of a team's starters and bots. */
  private entrantStrength(settings: TournamentSettings, e: Entrant): number {
    if (e.kind === 'human') return this.strengthOf(settings, { userId: e.userId });
    if (e.kind === 'bot') return this.strengthOf(settings, { bot: e.bot });
    return teamStrength([
      ...teamStarters(e, settings.teamSize).map((m) =>
        this.strengthOf(settings, { userId: m.userId }),
      ),
      ...e.bots.map((b) => this.strengthOf(settings, { bot: b })),
    ]);
  }

  /** Ratings of the seeded entrants (shown in the bracket); undefined if they cannot be read. */
  private entrantRatings(
    settings: TournamentSettings,
    entrants: Entrant[],
  ): Record<string, number> | undefined {
    try {
      return Object.fromEntries(entrants.map((e) => [e.id, this.entrantStrength(settings, e)]));
    } catch (err) {
      // A nicety: a broken log elsewhere must not stop the seeding.
      this.logger.warn(`ratings for the seeding: ${String(err)}`);
      return undefined;
    }
  }

  /**
   * Seeding by rating: bots chosen and spread so that the teams come out about equally strong
   * (1v1: bots close to the players' level), then the strongest meet late.
   */
  private seedByRating(
    t: TournamentRow,
    settings: TournamentSettings,
    humans: Entrant[],
    bots: Entrant[],
    rng: Rng,
  ): { slots: string[]; entrants: Entrant[] } {
    const pool: RatedBot[] = this.botPool(t).map((spec) => ({
      spec,
      strength: this.strengthOf(settings, { bot: spec }),
    }));
    const missing = settings.size - humans.length;
    const strengths = new Map<string, number>();
    let entrants: Entrant[];
    let botIds: string[];
    if (settings.teamSize > 1) {
      const teams = [...humans, ...bots.slice(0, missing)] as TeamEntrant[];
      const need = teams.map((e) =>
        Math.max(0, settings.teamSize - e.members.length - e.bots.length),
      );
      const free = this.fillPool(
        pool.map((p) => p.spec),
        teams,
        Math.max(0, ...need),
      );
      const fills = balanceBots(
        teams.map((e, i) => ({
          // Players and the clan bots already in the team.
          humans: [
            ...teamStarters(e, settings.teamSize).map((m) =>
              this.strengthOf(settings, { userId: m.userId }),
            ),
            ...e.bots.map((b) => this.strengthOf(settings, { bot: b })),
          ],
          need: need[i]!,
        })),
        pool.filter((p) => free.includes(p.spec)),
        settings.teamSize,
        rng,
      );
      entrants = this.nameBotTeams(teams, fills);
      botIds = entrants.slice(humans.length).map((e) => e.id);
    } else {
      const picked = pickBotsNear(
        pool,
        missing,
        humans.map((h) => this.entrantStrength(settings, h)),
        rng,
      );
      if (picked.length < missing)
        throw new Error(`the bot pool has ${picked.length} bots, ${missing} are needed`);
      const chosen = picked.map((b) =>
        bots.find((e) => e.kind === 'bot' && e.bot.name === b.spec.name)!,
      );
      entrants = [...humans, ...chosen];
      botIds = chosen.map((e) => e.id);
    }
    for (const e of entrants) strengths.set(e.id, this.entrantStrength(settings, e));
    const slots = ratingSlots({
      humans: humans.map((h) => h.id),
      bots: botIds,
      strength: (id) => strengths.get(id) ?? 0,
      botPlacement: settings.botPlacement,
      rng,
    });
    return { slots, entrants };
  }

  /** Rating changes per game of a season tournament. */
  /** Match page: entrants, games with the players' statistics (current bot names). */
  matchDetail(id: string, matchId: string): MatchDetail {
    const t = this.require(id);
    const proj = this.log.projection(t.id);
    const d = proj ? matchDetail(this.log.load(t.id), proj, matchId) : undefined;
    if (!d) throw notFound('match {matchId}', { matchId });
    const names = this.bots.gameNames();
    const current = this.withCurrentBotNames(proj!);
    for (const s of d.entrants) {
      s.name = current.entrants[s.id]?.displayName ?? s.name;
      if (udtManagerOf(s.id)) continue; // Dream Team: the names with the team tag
      for (const b of s.bots) if (b.id && names.has(b.id)) b.name = names.get(b.id)!;
    }
    for (const g of d.games)
      for (const p of g.players) if (p.botId && names.has(p.botId)) p.name = names.get(p.botId)!;
    return d;
  }

  ratings(id: string): RatedGame[] {
    const t = this.require(id);
    return t.seasonal ? this.stats.tournamentRatings(id) : [];
  }

  /**
   * The season a tournament counts for: the season of its first game; before the first game the
   * running season (where it would count if it started now). Undefined: no season tournament.
   */
  seasonOf(t: TournamentRow): number | undefined {
    if (!t.seasonal) return undefined;
    try {
      const played = this.stats.seasonOfTournament(t.id);
      if (played !== undefined) return played;
      if (this.stats.facts().some((f) => f.tournamentId === t.id && f.games.length + f.runs.length))
        return undefined; // played outside every season
    } catch (err) {
      this.logger.warn(`season of ${t.id}: ${String(err)}`);
    }
    return this.seasons.current()?.number;
  }

  /** Throws away the seeding (allowed until check-in opens). */
  resetToDraft(id: string): void {
    const t = this.require(id);
    if (t.phase !== 'seeded') throw conflict('cannot reset in phase {phase}', { phase: t.phase });
    this.log.clear(id);
    this.syncToAgent(this.require(id), 0);
  }

  // ------------------------------------------------------------------------------------------
  // Running (through the bridge agent)
  // ------------------------------------------------------------------------------------------

  /** Sends the log (from `fromSeq`) and the access list to the agent if it is connected. */
  syncToAgent(t: TournamentRow, fromSeq: number): void {
    if (!this.connections.isOnline(t.agentId)) return;
    const log = this.log.load(t.id);
    const from = fromSeq > log.length ? 0 : fromSeq;
    this.connections.send(t.agentId, {
      type: 'tournament.sync',
      payload: {
        tournamentId: t.id,
        fromSeq: from,
        events: log.slice(from),
        access: this.access(t),
        records: this.mapRecordsFor(t),
        bots: this.botPersonalities(t),
        dedications: this.dedications(t),
        betWindowSec: this.betWindowSec(t),
        antiIdle: this.settingsSvc.get().botAi.level,
        skillCurve: this.settingsSvc.get().botAi.skillCurve,
      },
    });
  }

  /** Betting phase length for the bridge: only season tournaments in season take bets. */
  private betWindowSec(t: TournamentRow): number {
    const season = this.seasons.current();
    return t.seasonal && season ? season.betting.windowSec : 0;
  }

  /** Neuro shop: the approved dedications of the tournament's players. */
  private dedications(t: TournamentRow) {
    try {
      const names = new Map<string, string>();
      for (const e of Object.values(this.log.projection(t.id)?.entrants ?? {})) {
        if (e.kind === 'human') names.set(e.userId, e.displayName);
        if (e.kind === 'team') for (const m of e.members) names.set(m.userId, m.displayName);
      }
      return this.shop.dedications(names).slice(0, 64);
    } catch (err) {
      this.logger.warn(`dedications for ${t.id}: ${String(err)}`);
      return [];
    }
  }

  /** Personalities (chat lines, rivals) of the website bots of the pool and the entrants. */
  private botPersonalities(t: TournamentRow) {
    try {
      const ids = this.botPool(t).flatMap((b) => (b.id ? [b.id] : []));
      // The names in the game (Dream Team bots play under their manager's tag).
      const names = new Map<string, string>();
      for (const e of Object.values(this.log.projection(t.id)?.entrants ?? {})) {
        if (e.kind === 'bot' && e.bot.id) {
          ids.push(e.bot.id);
          names.set(e.bot.id, e.bot.name);
        }
        if (e.kind === 'team')
          for (const b of e.bots)
            if (b.id) {
              ids.push(b.id);
              names.set(b.id, b.name);
            }
      }
      return this.bots.personalities(ids, this.bets.botBetNews([...new Set(ids)]), names);
    } catch (err) {
      this.logger.warn(`bot personalities for ${t.id}: ${String(err)}`);
      return [];
    }
  }

  /**
   * Monster Hunt: the map records for the HUD (season records for the tournament's monster
   * skill); undefined for other games. A tournament that counts for no season shows the records
   * of the running or last season, but cannot set new ones.
   */
  private mapRecordsFor(t: TournamentRow): MapRecords | undefined {
    const settings = this.settings(t);
    if (settings.game.adapter !== 'ut99-mh') return undefined;
    const counts = this.seasonOf(t) !== undefined;
    try {
      const season =
        this.seasonOf(t) ?? (this.seasons.current() ?? this.seasons.latestStarted())?.number;
      const skillRule = (settings.game.rules as { monsterSkill?: unknown }).monsterSkill;
      const skill = typeof skillRule === 'number' ? skillRule : 5;
      const maps = season === undefined ? [] : this.stats.mapRecords(season);
      return {
        counts,
        maps: maps
          .filter((r) => r.monsterSkill === skill)
          .map((r) => ({
            map: r.map.slice(0, 64),
            finalMs: Math.max(0, Math.round(r.finalMs)),
            by: (r.team || r.members.map((m) => m.name).join(', ')).slice(0, 64),
          })),
      };
    } catch (err) {
      // The HUD line is a nicety: a broken log elsewhere must not stop the sync.
      this.logger.warn(`map records for ${t.id}: ${String(err)}`);
      return { counts, maps: [] };
    }
  }

  async run(id: string): Promise<void> {
    const t = this.require(id);
    if (t.phase !== 'seeded' && !ACTIVE_PHASES.includes(t.phase)) {
      throw conflict('cannot run a tournament in phase {phase}', { phase: t.phase });
    }
    if (!this.connections.isOnline(t.agentId))
      throw conflict('agent {agentId} is offline', { agentId: t.agentId });
    const other = this.byAgent(t.agentId).find(
      (x) => x.id !== id && ACTIVE_PHASES.includes(x.phase),
    );
    if (other)
      throw conflict('agent {agentId} is busy with {name}', {
        agentId: t.agentId,
        name: other.name,
      });
    this.syncToAgent(t, 0);
    await this.connections.command(t.agentId, {
      kind: 'tournament.run',
      tournamentId: id,
      profileId: t.profileId,
      botPool: this.botPool(t),
    });
  }

  /** Calls off a seeded tournament that never ran (autostart: no free server). */
  cancelSeeded(id: string, reason: string, by: User): void {
    const t = this.require(id);
    if (t.phase !== 'seeded') throw conflict('cannot cancel in phase {phase}', { phase: t.phase });
    const res = this.log.append(id, t.headSeq, [
      { type: 'tournament.aborted', actor: { kind: 'admin', id: by.id }, data: { reason } },
    ]);
    if (!res.accepted) throw conflict(res.reason);
  }

  /** Tournaments that start by themselves and whose start time has come (oldest first). */
  dueAutoStarts(now: number): TournamentRow[] {
    return this.db
      .select()
      .from(tournaments)
      .where(and(eq(tournaments.autoStart, true), inArray(tournaments.phase, ['draft', 'seeded'])))
      .orderBy(asc(tournaments.scheduledAt))
      .all()
      .filter((t) => t.scheduledAt && Date.parse(t.scheduledAt) <= now);
  }

  /** Autostart gave up (seeding failed for an hour): the tournament waits for an admin. */
  stopAutoStart(id: string): void {
    this.db.update(tournaments).set({ autoStart: false }).where(eq(tournaments.id, id)).run();
  }

  async command(id: string, cmd: Command, by: User): Promise<void> {
    const t = this.require(id);
    const online = this.connections.isOnline(t.agentId);
    if (cmd.kind === 'abort' && !online) {
      // The bridge is gone: the website closes the tournament on its own.
      if (t.phase === 'finished' || t.phase === 'aborted' || t.phase === 'draft') {
        throw conflict('cannot abort in phase {phase}', { phase: t.phase });
      }
      const res = this.log.append(id, t.headSeq, [
        {
          type: 'tournament.aborted',
          actor: { kind: 'admin', id: by.id },
          data: { reason: cmd.reason },
        },
      ]);
      if (!res.accepted) throw conflict(res.reason);
      return;
    }
    if (!online) throw conflict('agent {agentId} is offline', { agentId: t.agentId });
    if (!ACTIVE_PHASES.includes(t.phase))
      throw conflict('the tournament is not running ({phase})', { phase: t.phase });
    switch (cmd.kind) {
      case 'forceStart':
        return this.connections.command(t.agentId, {
          kind: 'tournament.forceStart',
          tournamentId: id,
        });
      case 'pause':
        return this.connections.command(t.agentId, {
          kind: 'tournament.pause',
          tournamentId: id,
          reason: cmd.reason,
        });
      case 'resume':
        return this.connections.command(t.agentId, { kind: 'tournament.resume', tournamentId: id });
      case 'abort':
        return this.connections.command(t.agentId, {
          kind: 'tournament.abort',
          tournamentId: id,
          reason: cmd.reason,
        });
      case 'announce':
        return this.connections.command(t.agentId, { kind: 'announce', message: cmd.message });
      case 'restart': {
        const cm = this.log.projection(id)?.currentMatch;
        if (!cm) throw conflict('no match is being played right now');
        if (!cm.map) throw conflict('{matchId} has no map yet (map vote)', { matchId: cm.matchId });
        return this.connections.command(t.agentId, {
          kind: 'match.restart',
          tournamentId: id,
          matchId: cm.matchId,
        });
      }
      case 'forfeitRun': {
        const cm = this.log.projection(id)?.currentMatch;
        if (!cm?.runOrder) throw conflict('no Monster Hunt run is being played right now');
        return this.connections.command(t.agentId, {
          kind: 'match.forfeitRun',
          tournamentId: id,
          matchId: cm.matchId,
        });
      }
    }
  }

  /**
   * Admin: sets the winner of a match whose two entrants are known. For the current match the
   * bridge ends the game on the server; a corrected earlier result makes later results that
   * depended on it void (those matches are played again). Works while the bridge is offline too:
   * it gets the event when it reconnects.
   */
  override(id: string, body: Override, by: User): void {
    const t = this.require(id);
    if (t.phase !== 'running' && t.phase !== 'paused')
      throw conflict('results can only be set while the tournament runs ({phase})', {
        phase: t.phase,
      });
    const p = this.log.projection(id);
    const node = p?.bracket?.byId[body.matchId];
    if (!p || !node) throw notFound('match {matchId}', { matchId: body.matchId });
    const [a, b] = node.entrants;
    if (!a || !b || (node.status !== 'ready' && node.status !== 'completed'))
      throw conflict('{matchId} cannot be decided yet (entrants not known)', {
        matchId: body.matchId,
      });
    if (body.winnerId !== a && body.winnerId !== b)
      throw badRequest('{winnerId} does not play in {matchId}', {
        winnerId: body.winnerId,
        matchId: body.matchId,
      });
    const head = t.headSeq;
    const res = this.log.append(id, head, [
      {
        type: 'match.result',
        actor: { kind: 'admin', id: by.id },
        data: {
          result: {
            matchId: body.matchId,
            entrants: [a, b],
            winnerId: body.winnerId,
            outcome: 'override',
          },
        },
      },
    ]);
    if (!res.accepted) throw conflict(res.reason);
    this.syncToAgent(this.require(id), head);
  }

  // ------------------------------------------------------------------------------------------
  // Views
  // ------------------------------------------------------------------------------------------

  list(user: User) {
    const rows = this.db
      .select({
        t: tournaments,
        registered: sql<number>`(select count(*) from registrations r where r.tournament_id = ${tournaments.id})`,
        mine: sql<number>`(select count(*) from registrations r where r.tournament_id = ${tournaments.id} and r.user_id = ${user.id})`,
        // Unqualified "id" would bind to teams.id inside the subquery, so name the outer table.
        teamCount: sql<number>`(select count(*) from teams x where x.tournament_id = "tournaments"."id")`,
      })
      .from(tournaments)
      .orderBy(desc(tournaments.createdAt))
      .all();
    return rows.map(({ t, registered, mine, teamCount }) => {
      const s = this.settings(t);
      const provider = this.signupProviders.get(t.kind);
      if (provider) {
        const entries = provider.entries(t.id);
        registered = entries.length;
        mine = entries.some((e) => e.userId === user.id) ? 1 : 0;
        teamCount = 0;
      }
      const live = t.phase === 'running' || t.phase === 'paused';
      const loaded = t.phase === 'finished' || live ? this.log.projection(t.id) : undefined;
      const proj = loaded ? this.withCurrentBotNames(loaded) : undefined;
      const cm = live ? proj?.currentMatch : undefined;
      const name = (id: string) => proj?.entrants[id]?.displayName ?? id;
      const tele = cm ? (this.hub.latestLive(t.id) as { matchId?: string } | undefined) : undefined;
      const liveNow = tele && tele.matchId === cm?.matchId ? tele : undefined;
      const wins = (id: string) =>
        (cm ? (proj?.games[cm.matchId] ?? []) : []).filter((g) => g.winnerId === id).length;
      return {
        id: t.id,
        name: t.name,
        phase: t.phase,
        format: s.format,
        size: s.size,
        teamSize: s.teamSize,
        game: s.game.adapter === 'ut99-mh' ? ('mh' as const) : ('dm' as const),
        teams: teamCount,
        registered,
        registeredMe: mine > 0,
        registrationOpen: t.registrationOpen,
        autoStart: t.autoStart,
        scheduledAt: t.scheduledAt,
        createdAt: t.createdAt,
        champion: proj?.championId ? proj.entrants[proj.championId]?.displayName : undefined,
        seasonal: t.seasonal,
        kind: t.kind,
        /** The match being played now (running tournaments): names and series score. */
        ...(cm
          ? {
              now: {
                matchId: cm.matchId,
                game: cm.game,
                ...(cm.map ? { map: cm.map } : {}),
                status: cm.status,
                entrants: cm.entrants,
                names: [name(cm.entrants[0]), name(cm.entrants[1])],
                wins: [wins(cm.entrants[0]), wins(cm.entrants[1])],
                bestOf: proj?.bracket?.byId[cm.matchId]?.bestOf ?? 1,
                /** Monster Hunt: finished runs of the game. */
                ...(cm.runs?.length ? { runs: cm.runs } : {}),
                /** Telemetry of the game in progress (frags, run clock), if any. */
                ...(liveNow ? { live: liveNow } : {}),
              },
            }
          : {}),
      };
    });
  }

  connectAddress(t: TournamentRow): string | null {
    if (t.connectAddress) return t.connectAddress;
    const p = this.agents.profile(t.agentId, t.profileId);
    return p?.publicAddress ?? null;
  }

  detail(id: string, user: User) {
    const t = this.require(id);
    const regs = this.registered(id);
    const provided = new Map(
      (this.signupProviders.get(t.kind)?.entries(id) ?? []).map((e) => [e.userId, e]),
    );
    const watching = this.watching(id);
    const proj = this.log.projection(id);
    const myEntrant = this.entrantByUser(proj).get(user.id);
    const teamViews = this.teams.list(id);
    const myTeam = teamViews.find((v) => v.members.some((m) => m.user.id === user.id));
    const membership = new Map(
      teamViews.flatMap((v) =>
        v.members.map((m) => [m.user.id, { teamId: v.id, sub: m.sub }] as const),
      ),
    );
    const inAccess =
      ACTIVE_PHASES.includes(t.phase) || t.phase === 'seeded'
        ? this.access(t).some((a) => a.userId === user.id)
        : false;
    return {
      id: t.id,
      name: t.name,
      phase: t.phase,
      headSeq: t.headSeq,
      agentId: t.agentId,
      profileId: t.profileId,
      connectAddress: this.connectAddress(t),
      connectAddressOverride: t.connectAddress,
      settings: this.settings(t),
      botPool: this.botPool(t),
      botsFromLibrary: t.botsFromLibrary,
      seriesId: t.seriesId,
      autoStart: t.autoStart,
      registrationOpen: t.registrationOpen,
      seasonal: t.seasonal,
      season: this.seasonOf(t) ?? null,
      kind: t.kind,
      udt: this.udtRules(t),
      ...(this.signupProviders.get(t.kind)?.info
        ? { signup: this.signupProviders.get(t.kind)!.info!(t) }
        : {}),
      scheduledAt: t.scheduledAt,
      createdAt: t.createdAt,
      registrations: regs.map((u) => ({
        ...(provided.has(u.id)
          ? { label: provided.get(u.id)!.label, ai: !!provided.get(u.id)!.ai }
          : {}),
        userId: u.id,
        displayName: u.displayName,
        avatar: u.avatar,
        teamId: membership.get(u.id)?.teamId ?? null,
        sub: membership.get(u.id)?.sub ?? false,
      })),
      teams: teamViews.map((v) => ({
        id: v.id,
        name: v.name,
        tag: v.tag,
        captainId: v.captainId,
        members: v.members.map((m) => ({
          userId: m.user.id,
          displayName: m.user.displayName,
          avatar: m.user.avatar,
          sub: m.sub,
        })),
        // Only the team itself (and admins) see the invite code.
        inviteCode: user.isAdmin || v.id === myTeam?.id ? v.inviteCode : null,
      })),
      watchers: watching.length,
      // Admins only: the webhook URL is a secret of the channel.
      notify: user.isAdmin
        ? { mode: t.notifyMode, webhookUrl: t.webhookUrl, ...this.notify.status() }
        : null,
      me: {
        registered: regs.some((u) => u.id === user.id),
        watching: watching.some((u) => u.id === user.id),
        entrantId: myEntrant && myEntrant.kind !== 'bot' ? myEntrant.id : null,
        teamId: myTeam?.id ?? null,
        captain: myTeam
          ? myTeam.captainId === user.id
          : myEntrant?.kind === 'team' && myEntrant.captainUserId === user.id,
        hasAccess: inAccess,
      },
      projection: proj ? this.withCurrentBotNames(proj) : null,
      live: this.hub.latestLive(id) ?? null,
      agent: { online: this.connections.isOnline(t.agentId) },
    };
  }

  events(id: string) {
    this.require(id);
    return this.log.load(id);
  }
}
