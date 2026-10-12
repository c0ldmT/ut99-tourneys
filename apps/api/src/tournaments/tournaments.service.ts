import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { buildSlots, createRng, fillEmptySlots, type Rng } from '@tourney/bracket';
import {
  BotSpecSchema,
  MAX_SUBS,
  TournamentSettingsSchema,
  botEntrant,
  botTeamName,
  entrantUserIds,
  settingsProblems,
  userEntrantId,
  type AccessEntry,
  type BotSpec,
  type Entrant,
  type NewTournamentEvent,
  type TeamEntrant,
  type TournamentProjection,
  type TournamentSettings,
} from '@tourney/protocol';
import { gameProblems } from '@tourney/adapter-ut99';
import { z } from 'zod';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { registrations, tournaments, users, watchers } from '../db/schema.js';
import { badRequest, conflict, forbidden, notFound } from '../common/http.js';
import { randomId, slugify, TOURNAMENT_ID } from '../common/ids.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { AgentConnections } from '../agents/connections.js';
import { AgentsService } from '../agents/agents.service.js';
import type { User } from '../auth/users.service.js';
import { EventLogService } from './event-log.service.js';
import { LiveHub } from './hub.js';
import { assignBots, fits, formTeams, joinRole, type TeamShape } from './teams.js';
import { shapeOf, TeamsService, type TeamView } from './teams.service.js';

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
          `team tournaments of ${f.settings.teamSize} need at least ${2 * f.settings.teamSize} different bots in the pool`,
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
    if (body.registrationOpen !== undefined) set.registrationOpen = body.registrationOpen;
    if (body.scheduledAt !== undefined) set.scheduledAt = body.scheduledAt;
    const oldTeamSize = this.settings(t).teamSize;
    if (Object.keys(set).length) {
      this.db.update(tournaments).set(set).where(eq(tournaments.id, id)).run();
      if (body.settings && body.settings.teamSize !== oldTeamSize) {
        if (body.settings.teamSize === 1) this.teams.dissolveAll(id);
        else this.teams.normalize(id, body.settings.teamSize, MAX_SUBS);
      }
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
    if (!team.members.some((m) => m.user.id === userId)) throw notFound(`member ${userId}`);
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
    if (!reg) throw notFound(`registration of ${userId}`);
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
      throw badRequest(`at most ${settings.teamSize} starters`);
    if (t.phase === 'draft') {
      const team = this.teams.get(id, teamId);
      this.requireManager(team, user);
      const unknown = unique.filter((u) => !team.members.some((m) => m.user.id === u));
      if (unknown.length) throw badRequest(`not in the team: ${unknown.join(', ')}`);
      this.teams.setStarters(id, teamId, unique);
      this.notifyDraft(id);
      return;
    }
    if (t.phase === 'finished' || t.phase === 'aborted')
      throw conflict(`the tournament is ${t.phase}`);
    const entrant = this.log.projection(id)?.entrants[teamId];
    if (entrant?.kind !== 'team') throw notFound(`team ${teamId}`);
    this.requireManager({ captainId: entrant.captainUserId ?? '' }, user);
    const unknown = unique.filter((u) => !entrant.members.some((m) => m.userId === u));
    if (unknown.length) throw badRequest(`not in the team: ${unknown.join(', ')}`);
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

  seed(id: string, body: Seed, by: User): TournamentProjection {
    const t = this.require(id);
    if (t.phase !== 'draft' && t.phase !== 'seeded') {
      throw conflict(`cannot seed in phase ${t.phase}`);
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
      for (let n = 1; n <= settings.size; n++) {
        bots.push({ id: botTeamId(n), kind: 'team', displayName: 'Bots', members: [], bots: [] });
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
    if (!humans.length) throw badRequest('nobody is registered');
    if (humans.length > settings.size) {
      const what = teamMode ? 'teams' : 'players';
      throw badRequest(`${humans.length} ${what} do not fit into a bracket of ${settings.size}`);
    }
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
    let entrants = [...humans, ...bots].filter((e) => used.has(e.id));
    if (teamMode) {
      try {
        entrants = this.fillTeamsWithBots(
          t,
          slots,
          entrants as TeamEntrant[],
          settings.teamSize,
          rng,
        );
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    }
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
    const need = ordered.map((e) => Math.max(0, teamSize - e.members.length));
    const fills = assignBots(need, this.botPool(t), rng);
    const taken = new Set(
      entrants.filter((e) => e.members.length).map((e) => e.displayName.toLowerCase()),
    );
    let next = 0;
    const botName = () => {
      let name = botTeamName(next++);
      while (taken.has(name.toLowerCase())) name = botTeamName(next++);
      taken.add(name.toLowerCase());
      return name;
    };
    return ordered.map((e, i) => ({
      ...e,
      ...(e.members.length ? {} : { displayName: botName() }),
      bots: fills[i] ?? [],
    }));
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
        // Unqualified "id" would bind to teams.id inside the subquery, so name the outer table.
        teamCount: sql<number>`(select count(*) from teams x where x.tournament_id = "tournaments"."id")`,
      })
      .from(tournaments)
      .orderBy(desc(tournaments.createdAt))
      .all();
    return rows.map(({ t, registered, mine, teamCount }) => {
      const s = this.settings(t);
      const proj = t.phase === 'finished' ? this.log.projection(t.id) : undefined;
      return {
        id: t.id,
        name: t.name,
        phase: t.phase,
        format: s.format,
        size: s.size,
        teamSize: s.teamSize,
        teams: teamCount,
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
      registrationOpen: t.registrationOpen,
      scheduledAt: t.scheduledAt,
      createdAt: t.createdAt,
      registrations: regs.map((u) => ({
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
