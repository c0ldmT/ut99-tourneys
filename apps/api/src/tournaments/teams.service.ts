import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { registrations, teams, users } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { nameKey, sanitizeName, uniqueName } from '../common/names.js';
import type { User } from '../auth/users.service.js';
import type { TeamShape } from './teams.js';

export type TeamRow = typeof teams.$inferSelect;

export interface TeamMemberView {
  user: User;
  sub: boolean;
}

export interface TeamView extends TeamRow {
  /** Starters first, then substitutes, each in order of joining. */
  members: TeamMemberView[];
}

export const MAX_TAG = 6;

export function cleanTeamName(raw: string): string {
  const name = sanitizeName(raw);
  if (!name) throw badRequest('the team name needs letters or digits (ASCII)');
  return name;
}

export function cleanTag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const tag = sanitizeName(raw).replace(/\s+/g, '').slice(0, MAX_TAG);
  return tag || null;
}

export const shapeOf = (t: TeamView): TeamShape => ({
  id: t.id,
  members: t.members.map((m) => ({ userId: m.user.id, sub: m.sub })),
});

/**
 * Database access for teams. Teams exist per tournament; every member also has a registration
 * row pointing at the team. Phase and permission checks happen in TournamentsService.
 */
@Injectable()
export class TeamsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
  ) {}

  private now() {
    return new Date(this.clock.now()).toISOString();
  }

  list(tournamentId: string): TeamView[] {
    const rows = this.db
      .select()
      .from(teams)
      .where(eq(teams.tournamentId, tournamentId))
      .orderBy(asc(teams.createdAt), asc(teams.nameKey))
      .all();
    if (!rows.length) return [];
    const members = this.db
      .select({ user: users, teamId: registrations.teamId, sub: registrations.sub })
      .from(registrations)
      .innerJoin(users, eq(users.id, registrations.userId))
      .where(eq(registrations.tournamentId, tournamentId))
      .orderBy(asc(registrations.sub), asc(registrations.createdAt), asc(users.displayKey))
      .all();
    return rows.map((t) => ({
      ...t,
      members: members.filter((m) => m.teamId === t.id).map((m) => ({ user: m.user, sub: m.sub })),
    }));
  }

  get(tournamentId: string, teamId: string): TeamView {
    const team = this.list(tournamentId).find((t) => t.id === teamId);
    if (!team) throw notFound(`team ${teamId}`);
    return team;
  }

  byInvite(tournamentId: string, code: string): TeamView {
    const row = this.db
      .select()
      .from(teams)
      .where(and(eq(teams.tournamentId, tournamentId), eq(teams.inviteCode, code)))
      .get();
    if (!row) throw notFound('team for this invite link');
    return this.get(tournamentId, row.id);
  }

  /** Registered players without a team, in order of registration. */
  solos(tournamentId: string): User[] {
    return this.db
      .select({ user: users })
      .from(registrations)
      .innerJoin(users, eq(users.id, registrations.userId))
      .where(and(eq(registrations.tournamentId, tournamentId), isNull(registrations.teamId)))
      .orderBy(asc(registrations.createdAt), asc(users.displayKey))
      .all()
      .map((r) => r.user);
  }

  registration(tournamentId: string, userId: string) {
    return this.db
      .select()
      .from(registrations)
      .where(and(eq(registrations.tournamentId, tournamentId), eq(registrations.userId, userId)))
      .get();
  }

  private nameTaken(tournamentId: string, key: string, except?: string): boolean {
    return this.list(tournamentId).some((t) => t.nameKey === key && t.id !== except);
  }

  create(
    tournamentId: string,
    captain: User,
    fields: { name: string; tag?: string | null },
    opts: { uniqueSuffix?: boolean } = {},
  ): TeamRow {
    let name = cleanTeamName(fields.name);
    if (this.nameTaken(tournamentId, nameKey(name))) {
      if (!opts.uniqueSuffix) throw conflict(`a team called ${name} already exists`);
      name = uniqueName(name, (k) => this.nameTaken(tournamentId, k));
    }
    const row: TeamRow = {
      id: `t-${randomId(10)}`,
      tournamentId,
      name,
      nameKey: nameKey(name),
      tag: cleanTag(fields.tag),
      captainId: captain.id,
      inviteCode: randomId(16),
      createdAt: this.now(),
    };
    this.db.insert(teams).values(row).run();
    this.setMembership(tournamentId, captain.id, row.id, false);
    return row;
  }

  update(
    tournamentId: string,
    teamId: string,
    fields: { name?: string; tag?: string | null; captainId?: string },
  ): void {
    const team = this.get(tournamentId, teamId);
    const set: Partial<TeamRow> = {};
    if (fields.name !== undefined) {
      const name = cleanTeamName(fields.name);
      if (this.nameTaken(tournamentId, nameKey(name), teamId))
        throw conflict(`a team called ${name} already exists`);
      set.name = name;
      set.nameKey = nameKey(name);
    }
    if (fields.tag !== undefined) set.tag = cleanTag(fields.tag);
    if (fields.captainId !== undefined) {
      if (!team.members.some((m) => m.user.id === fields.captainId))
        throw badRequest('the new captain must be a member of the team');
      set.captainId = fields.captainId;
    }
    if (Object.keys(set).length) this.db.update(teams).set(set).where(eq(teams.id, teamId)).run();
  }

  newInvite(tournamentId: string, teamId: string): string {
    this.get(tournamentId, teamId);
    const code = randomId(16);
    this.db.update(teams).set({ inviteCode: code }).where(eq(teams.id, teamId)).run();
    return code;
  }

  /** Inserts or moves a registration (teamId null = solo). */
  setMembership(tournamentId: string, userId: string, teamId: string | null, sub: boolean): void {
    const existing = this.registration(tournamentId, userId);
    if (existing) {
      this.db
        .update(registrations)
        .set({ teamId, sub })
        .where(and(eq(registrations.tournamentId, tournamentId), eq(registrations.userId, userId)))
        .run();
    } else {
      this.db
        .insert(registrations)
        .values({ tournamentId, userId, teamId, sub, createdAt: this.now() })
        .run();
    }
  }

  /** Marks who starts; everybody else in the team becomes a substitute. */
  setStarters(tournamentId: string, teamId: string, starters: readonly string[]): void {
    for (const m of this.get(tournamentId, teamId).members) {
      this.setMembership(tournamentId, m.user.id, teamId, !starters.includes(m.user.id));
    }
  }

  /**
   * Call after a member left or moved away: hands the captaincy to the next member (starters
   * first) and deletes the team once it is empty.
   */
  repair(tournamentId: string, teamId: string): void {
    const team = this.list(tournamentId).find((t) => t.id === teamId);
    if (!team) return;
    if (!team.members.length) {
      this.db.delete(teams).where(eq(teams.id, teamId)).run();
      return;
    }
    if (!team.members.some((m) => m.user.id === team.captainId)) {
      const next = team.members[0] as TeamMemberView;
      this.db.update(teams).set({ captainId: next.user.id }).where(eq(teams.id, teamId)).run();
    }
  }

  /** Deletes a team; its members stay registered as solo players. */
  remove(tournamentId: string, teamId: string): void {
    this.get(tournamentId, teamId);
    this.db
      .update(registrations)
      .set({ teamId: null, sub: false })
      .where(and(eq(registrations.tournamentId, tournamentId), eq(registrations.teamId, teamId)))
      .run();
    this.db.delete(teams).where(eq(teams.id, teamId)).run();
  }

  /** Removes all teams (switch to 1v1). */
  dissolveAll(tournamentId: string): void {
    for (const t of this.list(tournamentId)) this.remove(tournamentId, t.id);
  }

  /**
   * Brings teams in line with a (changed) team size: at most `teamSize` starters, at most
   * `teamSize + maxSubs` members; whoever does not fit becomes a solo player.
   */
  normalize(tournamentId: string, teamSize: number, maxSubs: number): void {
    for (const t of this.list(tournamentId)) {
      t.members.forEach((m, i) => {
        if (i >= teamSize + maxSubs) this.setMembership(tournamentId, m.user.id, null, false);
        else if (i >= teamSize && !m.sub) this.setMembership(tournamentId, m.user.id, t.id, true);
      });
      this.repair(tournamentId, t.id);
    }
  }
}
