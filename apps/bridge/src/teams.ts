import type { BotSpec, Entrant, TeamEntrant } from '@tourney/protocol';

/** Pure helpers for team matches (2on2, 3on3, 5on5). */

export const isTeam = (e: Entrant | undefined): e is TeamEntrant => e?.kind === 'team';

export const isMember = (e: Entrant | undefined, userId: string | undefined): boolean =>
  !!userId && isTeam(e) && e.members.some((m) => m.userId === userId);

export function memberName(team: TeamEntrant, userId: string): string {
  return team.members.find((m) => m.userId === userId)?.displayName ?? userId;
}

/**
 * Who plays for a team in the next game, decided before the map loads (players log in as player
 * or spectator and cannot switch without reconnecting): connected starters first, then connected
 * substitutes, then starters and substitutes who are not on the server yet; at most `teamSize`.
 * Places left over are filled by bots at the countdown.
 */
export function lineupFor(
  team: TeamEntrant,
  connected: ReadonlySet<string>,
  teamSize: number,
  excluded: ReadonlySet<string> = new Set(),
): string[] {
  const members = team.members.filter((m) => !excluded.has(m.userId));
  const on = (m: { userId: string }) => connected.has(m.userId);
  const ordered = [
    ...members.filter((m) => !m.sub && on(m)),
    ...members.filter((m) => m.sub && on(m)),
    ...members.filter((m) => !m.sub && !on(m)),
    ...members.filter((m) => m.sub && !on(m)),
  ];
  return ordered.slice(0, teamSize).map((m) => m.userId);
}

/** The captain while on the server, otherwise the first member (starters first) who is. */
export function actingCaptain(
  team: TeamEntrant,
  connected: ReadonlySet<string>,
): string | undefined {
  if (team.captainUserId && connected.has(team.captainUserId)) return team.captainUserId;
  return team.members.find((m) => connected.has(m.userId))?.userId;
}

/**
 * `n` bots for a team: its own fill bots first, then the tournament's pool, each name only once
 * per match (`used` is updated). If the pool runs dry, numbered copies are used ("Xan2").
 */
export function pickBots(
  preferred: readonly BotSpec[],
  pool: readonly BotSpec[],
  used: Set<string>,
  n: number,
): BotSpec[] {
  const out: BotSpec[] = [];
  const key = (name: string) => name.toLowerCase();
  for (const b of [...preferred, ...pool]) {
    if (out.length >= n) break;
    if (used.has(key(b.name))) continue;
    used.add(key(b.name));
    out.push(b);
  }
  const base = pool.length ? pool : preferred;
  for (let i = 2; out.length < n && base.length; i++) {
    for (const b of base) {
      if (out.length >= n) break;
      const name = `${b.name}${i}`.slice(0, 32);
      if (used.has(key(name))) continue;
      used.add(key(name));
      out.push({ ...b, name });
    }
  }
  return out;
}

/** Average skill of the bots playing for an entrant (simulated bot matches). */
export function botSkill(e: Entrant | undefined): number {
  if (e?.kind === 'bot') return e.bot.skill;
  if (isTeam(e) && e.bots.length) return e.bots.reduce((s, b) => s + b.skill, 0) / e.bots.length;
  return 3;
}
