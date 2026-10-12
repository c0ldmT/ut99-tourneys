import { shuffle, type Rng } from '@tourney/bracket';
import { MAX_SUBS } from '@tourney/protocol';

/**
 * Pure rules for team tournaments: who fits where, how solo players become teams and which bots
 * fill the places nobody takes. The service applies the results to the database.
 */

export interface TeamShape {
  id: string;
  /** Members in lineup order (starters first). */
  members: { userId: string; sub: boolean }[];
}

export interface Capacity {
  /** Bracket size in teams (in 1v1: players). */
  size: number;
  teamSize: number;
  teams: TeamShape[];
  /** Registered players without a team. */
  solos: number;
}

const starters = (t: TeamShape) => t.members.filter((m) => !m.sub).length;

/** Starter places that solo players can still take: open places in teams plus new teams. */
export function openStarterPlaces(c: Capacity): number {
  const inTeams = c.teams.reduce((n, t) => n + Math.max(0, c.teamSize - starters(t)), 0);
  return inTeams + Math.max(0, c.size - c.teams.length) * c.teamSize;
}

/** Every solo player must find a starter place, and there cannot be more teams than slots. */
export function fits(c: Capacity): boolean {
  return c.teams.length <= c.size && c.solos <= openStarterPlaces(c);
}

/** Whether a team can take one more member, and in which role. */
export function joinRole(team: TeamShape, teamSize: number): 'starter' | 'sub' | null {
  if (starters(team) < teamSize) return 'starter';
  if (team.members.length < teamSize + MAX_SUBS) return 'sub';
  return null;
}

export interface FormedTeams {
  /** Solo players added to existing teams as starters. */
  fills: { teamId: string; userId: string }[];
  /** New teams made of the remaining solo players (the first one is the captain). */
  created: string[][];
}

/**
 * Puts solo players into teams: first into the open starter places of existing teams (teams with
 * fewer players first), then the rest are drawn into new teams. The last new team may be short;
 * bots fill it. Throws if more teams would be needed than the bracket holds.
 */
export function formTeams(input: {
  size: number;
  teamSize: number;
  teams: TeamShape[];
  solos: readonly string[];
  rng: Rng;
}): FormedTeams {
  const { teamSize } = input;
  const pool = shuffle(input.solos, input.rng);
  const fills: FormedTeams['fills'] = [];
  const open = input.teams
    .map((t) => ({ id: t.id, free: teamSize - starters(t) }))
    .filter((t) => t.free > 0)
    .sort((a, b) => b.free - a.free);
  // Round-robin, so two short teams both get a player before one of them gets two.
  while (pool.length && open.some((t) => t.free > 0)) {
    for (const t of open) {
      if (!pool.length) break;
      if (t.free <= 0) continue;
      fills.push({ teamId: t.id, userId: pool.shift() as string });
      t.free--;
    }
  }
  const created: string[][] = [];
  while (pool.length) created.push(pool.splice(0, teamSize));
  const total = input.teams.length + created.length;
  if (total > input.size) {
    throw new Error(
      `${total} teams do not fit into a bracket of ${input.size} (${input.solos.length} players without a team)`,
    );
  }
  return { fills, created };
}

export { assignBots } from '@tourney/protocol';
