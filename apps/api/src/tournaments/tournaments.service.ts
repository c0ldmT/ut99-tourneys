import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { buildSlots, createRng, fillEmptySlots } from '@tourney/bracket';
import {
  BotSpecSchema,
  TournamentSettingsSchema,
  botEntrant,
  userEntrantId,
  type AccessEntry,
  type BotSpec,
  type Entrant,
  type NewTournamentEvent,
  type TournamentProjection,
  type TournamentSettings,
} from '@tourney/protocol';
import { parseRules } from '@tourney/adapter-ut99';
import { z } from 'zod';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { registrations, tournaments, users, watchers } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../common/http.js';
import { randomId, slugify, TOURNAMENT_ID } from '../common/ids.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { AgentConnections } from '../agents/connections.js';
import { AgentsService } from '../agents/agents.service.js';
import type { User } from '../auth/users.service.js';
import { EventLogService } from './event-log.service.js';
import { LiveHub } from './hub.js';

export type TournamentRow = typeof tournaments.$inferSelect;

/** Phases in which the bridge runs the tournament. */
export const ACTIVE_PHASES = ['checkIn', 'running', 'paused'];
/** The mod's access list holds 64 entries. */
export const MAX_ACCESS = 64;

const TournamentFields = z.object({
  name: z.string().trim().min(1).max(100),
  agentId: z.string().min(1).max(64),
  profileId: z.string().min(1).max(64),
  connectAddress: z.string().trim().max(128).nullable().optional(),
  settings: TournamentSettingsSchema,
  botPool: z.array(BotSpecSchema).min(1).max(64),
  registrationOpen: z.boolean().optional(),
  scheduledAt: z.iso.datetime().nullable().optional(),
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
    humanOrder: z.enum(['random', 'seeded']).default('random'),
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
]);
export type Command = z.infer<typeof CommandBody>;

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
  ) {}

  private now() {
    return new Date(this.clock.now()).toISOString();
  }

  get(id: string): TournamentRow | undefined {
    return this.db.select().from(tournaments).where(eq(tournaments.id, id)).get();
  }

  require(id: string): TournamentRow {
    const t = this.get(id);
    if (!t) throw notFound(`tournament ${id}`);
    return t;
  }

  byAgent(agentId: string): TournamentRow[] {
    return this.db.select().from(tournaments).where(eq(tournaments.agentId, agentId)).all();
  }

  settings(t: TournamentRow): TournamentSettings {
    return TournamentSettingsSchema.parse(JSON.parse(t.settingsJson));
  }

  botPool(t: TournamentRow): BotSpec[] {
    return z.array(BotSpecSchema).parse(JSON.parse(t.botPoolJson));
  }

  // ------------------------------------------------------------------------------------------
  // Drafts
  // ------------------------------------------------------------------------------------------

  private checkFields(f: { settings?: TournamentSettings; agentId?: string; profileId?: string }) {
    if (f.settings) {
      if (f.settings.game.adapter !== 'ut99-dm') {
        throw badRequest(`unknown game adapter ${f.settings.game.adapter}`);
      }
      try {
        parseRules(f.settings.game.rules);
      } catch (e) {
        throw badRequest(
          `invalid game rules: ${e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message}`,
        );
      }
    }
    if (f.agentId) {
      const agent = this.agents.require(f.agentId);
      const profiles = this.agents.info(agent).profiles;
      if (f.profileId && profiles && !profiles.some((p) => p.id === f.profileId)) {
        throw badRequest(`agent ${f.agentId} has no server profile ${f.profileId}`);
      }
    }
  }

  create(body: CreateTournament, by: User): TournamentRow {
    this.checkFields(body);
    let id = body.id ?? slugify(body.name);
    if (this.get(id)) {
      if (body.id) throw conflict(`tournament ${id} exists`);
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
        registrationOpen: body.registrationOpen ?? true,
        scheduledAt: body.scheduledAt ?? null,
        createdBy: by.id,
        createdAt: this.now(),
      })
      .run();
    this.logger.info(`tournament ${id} created by ${by.displayName}`);
    return this.require(id);
  }

  update(id: string, body: UpdateTournament): TournamentRow {
    const t = this.require(id);
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
      settings: body.settings,
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
    if (body.registrationOpen !== undefined) set.registrationOpen = body.registrationOpen;
    if (body.scheduledAt !== undefined) set.scheduledAt = body.scheduledAt;
    if (Object.keys(set).length) {
      this.db.update(tournaments).set(set).where(eq(tournaments.id, id)).run();
      this.notifyDraft(id);
    }
    return this.require(id);
  }

  remove(id: string): void {
    const t = this.require(id);
    if (ACTIVE_PHASES.includes(t.phase)) throw conflict('abort the tournament before deleting it');
    this.db.delete(tournaments).where(eq(tournaments.id, id)).run();
    this.log.forget(id);
    this.hub.clearLive(id);
  }

  private notifyDraft(id: string) {
    const t = this.require(id);
    this.hub.publish(id, { type: 'change', headSeq: t.headSeq, phase: t.phase });
  }

  // ------------------------------------------------------------------------------------------
  // Players and spectators
  // ------------------------------------------------------------------------------------------

  registered(id: string): User[] {
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

  register(id: string, user: User): void {
    const t = this.require(id);
    if (t.phase !== 'draft')
      throw conflict('registration is closed: the bracket is already seeded');
    if (!t.registrationOpen) throw conflict('registration is closed');
    const count = this.registered(id).length;
    if (count >= this.settings(t).size) throw conflict('the tournament is full');
    this.db
      .insert(registrations)
      .values({ tournamentId: id, userId: user.id, createdAt: this.now() })
      .onConflictDoNothing()
      .run();
    this.notifyDraft(id);
  }

  unregister(id: string, userId: string): void {
    const t = this.require(id);
    if (t.phase !== 'draft') throw conflict('the bracket is already seeded');
    this.db
      .delete(registrations)
      .where(and(eq(registrations.tournamentId, id), eq(registrations.userId, userId)))
      .run();
    this.notifyDraft(id);
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

  /** Who may join the game server: the players first, then spectators who clicked "watch". */
  access(t: TournamentRow): AccessEntry[] {
    const proj = this.log.projection(t.id);
    const out: AccessEntry[] = [];
    const seen = new Set<string>();
    const add = (e: AccessEntry) => {
      if (seen.has(e.userId) || out.length >= MAX_ACCESS) return;
      seen.add(e.userId);
      out.push(e);
    };
    for (const u of this.registered(t.id)) {
      const entrant = proj?.entrants[userEntrantId(u.id)];
      add({
        userId: u.id,
        displayName: entrant?.displayName ?? u.displayName,
        token: u.joinToken,
        ...(entrant && entrant.kind === 'human' ? { entrantId: entrant.id } : {}),
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

  seed(id: string, body: Seed, by: User): TournamentProjection {
    const t = this.require(id);
    if (t.phase !== 'draft' && t.phase !== 'seeded') {
      throw conflict(`cannot seed in phase ${t.phase}`);
    }
    const settings = this.settings(t);
    const humans: Entrant[] = this.registered(id).map((u) => ({
      id: userEntrantId(u.id),
      kind: 'human',
      displayName: u.displayName,
      userId: u.id,
    }));
    if (!humans.length) throw badRequest('nobody is registered');
    if (humans.length > settings.size) {
      throw badRequest(`${humans.length} players do not fit into a bracket of ${settings.size}`);
    }
    const bots: Entrant[] = [];
    for (const spec of this.botPool(t)) {
      const e = botEntrant(spec);
      if (!bots.some((b) => b.id === e.id)) bots.push(e);
    }
    const rngSeed = body.rngSeed ?? `${id}-${this.clock.now()}`;
    const rng = createRng(rngSeed);
    const humanIds = humans.map((h) => h.id);
    const botIds = bots.map((b) => b.id);
    let slots: string[];
    try {
      if (body.mode === 'auto') {
        slots = buildSlots({
          size: settings.size,
          humans: humanIds,
          botPool: botIds,
          humanOrder: body.humanOrder,
          botPlacement: settings.botPlacement,
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
    } catch (e) {
      throw badRequest((e as Error).message);
    }
    const used = new Set(slots);
    const entrants = [...humans, ...bots].filter((e) => used.has(e.id));
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
      },
    });
    const res = this.log.append(id, head, batch);
    if (!res.accepted) throw conflict(res.reason);
    this.syncToAgent(t, head);
    return res.projection;
  }

  /** Throws away the seeding (allowed until check-in opens). */
  resetToDraft(id: string): void {
    const t = this.require(id);
    if (t.phase !== 'seeded') throw conflict(`cannot reset in phase ${t.phase}`);
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
      },
    });
  }

  async run(id: string): Promise<void> {
    const t = this.require(id);
    if (t.phase !== 'seeded' && !ACTIVE_PHASES.includes(t.phase)) {
      throw conflict(`cannot run a tournament in phase ${t.phase}`);
    }
    if (!this.connections.isOnline(t.agentId)) throw conflict(`agent ${t.agentId} is offline`);
    const other = this.byAgent(t.agentId).find(
      (x) => x.id !== id && ACTIVE_PHASES.includes(x.phase),
    );
    if (other) throw conflict(`agent ${t.agentId} is busy with ${other.name}`);
    this.syncToAgent(t, 0);
    await this.connections.command(t.agentId, {
      kind: 'tournament.run',
      tournamentId: id,
      profileId: t.profileId,
      botPool: this.botPool(t),
    });
  }

  async command(id: string, cmd: Command, by: User): Promise<void> {
    const t = this.require(id);
    const online = this.connections.isOnline(t.agentId);
    if (cmd.kind === 'abort' && !online) {
      // The bridge is gone: the website closes the tournament on its own.
      if (t.phase === 'finished' || t.phase === 'aborted' || t.phase === 'draft') {
        throw conflict(`cannot abort in phase ${t.phase}`);
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
    if (!online) throw conflict(`agent ${t.agentId} is offline`);
    if (!ACTIVE_PHASES.includes(t.phase))
      throw conflict(`the tournament is not running (${t.phase})`);
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
    }
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
      })
      .from(tournaments)
      .orderBy(desc(tournaments.createdAt))
      .all();
    return rows.map(({ t, registered, mine }) => {
      const s = this.settings(t);
      const proj = t.phase === 'finished' ? this.log.projection(t.id) : undefined;
      return {
        id: t.id,
        name: t.name,
        phase: t.phase,
        format: s.format,
        size: s.size,
        registered,
        registeredMe: mine > 0,
        registrationOpen: t.registrationOpen,
        scheduledAt: t.scheduledAt,
        createdAt: t.createdAt,
        champion: proj?.championId ? proj.entrants[proj.championId]?.displayName : undefined,
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
    const watching = this.watching(id);
    const proj = this.log.projection(id);
    const myEntrant = proj?.entrants[userEntrantId(user.id)];
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
      registrationOpen: t.registrationOpen,
      scheduledAt: t.scheduledAt,
      createdAt: t.createdAt,
      registrations: regs.map((u) => ({
        userId: u.id,
        displayName: u.displayName,
        avatar: u.avatar,
      })),
      watchers: watching.length,
      me: {
        registered: regs.some((u) => u.id === user.id),
        watching: watching.some((u) => u.id === user.id),
        entrantId: myEntrant?.kind === 'human' ? myEntrant.id : null,
        hasAccess: inAccess,
      },
      projection: proj ?? null,
      live: this.hub.latestLive(id) ?? null,
      agent: { online: this.connections.isOnline(t.agentId) },
    };
  }

  events(id: string) {
    this.require(id);
    return this.log.load(id);
  }
}
