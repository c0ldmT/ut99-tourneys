import {
  wireName,
  type AccessEntry,
  type BridgeToMod,
  type Entrant,
  type ModPhase,
  type TournamentProjection,
} from '@tourney/protocol';
import { travelOptions, type Ut99DmRules } from '@tourney/adapter-ut99';

/** Builds the bridge -> mod lines from the tournament projection. Pure functions. */

export type Side = 'a' | 'b';

export function entrantName(proj: TournamentProjection, id: string | null | undefined): string {
  if (!id) return '';
  return wireName(proj.entrants[id]?.displayName ?? id);
}

/** Role of a website user on the game server: match player a/b of the current match, else spectator. */
export function roleOf(
  proj: TournamentProjection,
  entry: AccessEntry,
  matchEntrants: readonly [string, string] | undefined,
): 'a' | 'b' | 's' {
  if (!entry.entrantId || !matchEntrants) return 's';
  const entrant = proj.entrants[entry.entrantId];
  // A user replaced by a bot is a spectator from then on.
  if (!entrant || entrant.kind !== 'human' || entrant.userId !== entry.userId) return 's';
  if (matchEntrants[0] === entry.entrantId) return 'a';
  if (matchEntrants[1] === entry.entrantId) return 'b';
  return 's';
}

export function aclLines(
  proj: TournamentProjection,
  access: readonly AccessEntry[],
  matchEntrants: readonly [string, string] | undefined,
  rev: number,
): BridgeToMod[] {
  return [
    { t: 'acl', n: access.length, rev },
    ...access.map((e): BridgeToMod => ({
      t: 'acle',
      tk: e.token,
      name: wireName(e.displayName),
      r: roleOf(proj, e, matchEntrants),
    })),
  ];
}

export function seriesWins(
  proj: TournamentProjection,
  matchId: string,
  entrants: readonly [string, string],
) {
  const games = proj.games[matchId] ?? [];
  return [
    games.filter((g) => g.winnerId === entrants[0]).length,
    games.filter((g) => g.winnerId === entrants[1]).length,
  ] as [number, number];
}

export function matchLines(
  proj: TournamentProjection,
  rules: Ut99DmRules,
  matchId: string,
  game: number,
  entrants: readonly [string, string],
): BridgeToMod[] {
  const node = proj.bracket?.byId[matchId];
  const [wa, wb] = seriesWins(proj, matchId, entrants);
  const lines: BridgeToMod[] = [
    {
      t: 'match',
      mid: matchId,
      g: game,
      bo: node?.bestOf ?? 1,
      wa,
      wb,
      na: entrantName(proj, entrants[0]),
      nb: entrantName(proj, entrants[1]),
      fl: rules.fragLimit,
      tl: rules.timeLimitMin,
    },
  ];
  entrants.forEach((id, i) => {
    const e: Entrant | undefined = proj.entrants[id];
    if (e?.kind === 'bot') {
      lines.push({
        t: 'bot',
        s: i === 0 ? 'a' : 'b',
        name: wireName(e.bot.name),
        sk: Math.max(0, Math.min(7, Math.round(e.bot.skill))),
        cls: e.bot.botClass ?? '',
      });
    }
  });
  return lines;
}

export function bracketLines(
  proj: TournamentProjection,
  liveMatchId: string | undefined,
  rev: number,
): BridgeToMod[] {
  const b = proj.bracket;
  if (!b) return [];
  const lines: BridgeToMod[] = [
    { t: 'brh', fmt: b.definition.format, size: b.definition.size, n: b.matches.length, rev },
  ];
  for (const m of b.matches) {
    let sa = -1;
    let sb = -1;
    const [ea, eb] = m.entrants;
    if (ea && eb) {
      const games = proj.games[m.id] ?? [];
      if (m.bestOf === 1 && games[0]) {
        sa = games[0].scores[ea] ?? -1;
        sb = games[0].scores[eb] ?? -1;
      } else if (games.length) {
        [sa, sb] = seriesWins(proj, m.id, [ea, eb]);
      }
    }
    const st =
      m.id === liveMatchId
        ? 'l'
        : ({ waiting: 'w', ready: 'r', completed: 'c', void: 'v' } as const)[m.status];
    lines.push({
      t: 'brm',
      id: m.id,
      s: m.side,
      r: m.round,
      i: m.index,
      na: entrantName(proj, ea),
      nb: entrantName(proj, eb),
      sa,
      sb,
      st,
      w: m.winnerId ? (m.winnerId === ea ? 'a' : 'b') : '',
    });
  }
  return lines;
}

export function standingsLines(proj: TournamentProjection, rev: number): BridgeToMod[] {
  const s = proj.bracket?.standings ?? [];
  return [
    { t: 'sth', n: s.length, rev },
    ...s.map((x): BridgeToMod => ({
      t: 'ste',
      name: entrantName(proj, x.entrantId),
      pl: x.placement ?? 0,
      w: x.wins,
      l: x.losses,
      bot: proj.entrants[x.entrantId]?.kind === 'bot',
    })),
  ];
}

export function voteLines(
  matchId: string,
  pool: readonly { id: string; title?: string }[],
  seconds: number,
): BridgeToMod[] {
  return [
    { t: 'vopen', mid: matchId, n: pool.length, sec: seconds },
    ...pool.map((m, i): BridgeToMod => ({
      t: 'vmap',
      i: i + 1,
      map: m.id,
      title: wireName(m.title ?? m.id),
    })),
  ];
}

export function travelLine(
  rules: Ut99DmRules,
  map: string,
  matchId: string,
  game: number,
): BridgeToMod {
  return { t: 'travel', map, mid: matchId, g: game, opt: travelOptions(rules) };
}

export function phaseLine(p: ModPhase, matchId = '', sec = -1): BridgeToMod {
  return { t: 'phase', p, mid: matchId, sec };
}
