import type { PlayerGameStats } from '@tourney/protocol';
import type { PlayerGameFact, PlayerRef, RunFact, StatMode, TournamentFacts } from './facts.js';

/** Statistics and records from the facts of all counted tournaments (pure). */

export interface PlayerRow {
  key: string;
  name: string;
  bot: boolean;
  userId?: string;
  tournaments: number;
  titles: number;
  matches: number;
  matchesWon: number;
  games: number;
  gamesWon: number;
  /** Games with statistics from the mod (the counts below come from these). */
  statGames: number;
  kills: number;
  deaths: number;
  suicides: number;
  teamKills: number;
  /** Kills minus suicides and team kills, like UT's score. */
  frags: number;
  /** Kills per death (deaths at least 1). */
  kd: number;
  /** Kills / (kills + deaths + suicides), 0..1. */
  efficiency: number;
  headshots: number;
  firstBloods: number;
  bestSpree: number;
  sprees: number;
  multiKills: number;
  timeSec: number;
  favoriteWeapon?: { name: string; kills: number };
  /** Monster Hunt. */
  runs: number;
  runsFinished: number;
  monsters: number;
  monsterPoints: number;
  /** Mod 0.16.0: games with damage data, damage dealt and taken in them, items taken. */
  damageGames: number;
  damageDealt: number;
  damageTaken: number;
  amps: number;
  belts: number;
  armors: number;
  kegs: number;
}

export interface RecordHolder {
  key: string;
  name: string;
  bot: boolean;
}

export interface RecordEntry {
  /** Category id, e.g. `game.frags`; the website translates it. */
  id: string;
  mode: StatMode | 'all';
  value: number;
  unit: 'count' | 'ratio' | 'sec' | 'ms';
  holders: RecordHolder[];
  /** Team or player name the record is shown with. */
  label: string;
  tournamentId?: string;
  tournamentName?: string;
  matchId?: string;
  map?: string;
  at?: string;
}

export interface MapRecord {
  map: string;
  finalMs: number;
  timeMs: number;
  deaths: number;
  penaltyMs: number;
  monsterSkill: number;
  team: string;
  members: RecordHolder[];
  tournamentId: string;
  tournamentName: string;
  at: string;
}

const holder = (r: PlayerRef): RecordHolder => ({ key: r.key, name: r.name, bot: r.bot });

const inMode = (t: TournamentFacts, mode?: StatMode) => !mode || t.mode === mode;

function emptyRow(r: PlayerRef): PlayerRow {
  return {
    key: r.key,
    name: r.name,
    bot: r.bot,
    ...(r.userId ? { userId: r.userId } : {}),
    tournaments: 0,
    titles: 0,
    matches: 0,
    matchesWon: 0,
    games: 0,
    gamesWon: 0,
    statGames: 0,
    kills: 0,
    deaths: 0,
    suicides: 0,
    teamKills: 0,
    frags: 0,
    kd: 0,
    efficiency: 0,
    headshots: 0,
    firstBloods: 0,
    bestSpree: 0,
    sprees: 0,
    multiKills: 0,
    timeSec: 0,
    runs: 0,
    runsFinished: 0,
    monsters: 0,
    monsterPoints: 0,
    damageGames: 0,
    damageDealt: 0,
    damageTaken: 0,
    amps: 0,
    belts: 0,
    armors: 0,
    kegs: 0,
  };
}

const multi = (s: PlayerGameStats) => s.multi2 + s.multi3 + s.multi4 + s.multi5;
const frags = (s: PlayerGameStats) => s.kills - s.suicides - s.teamKills;

/**
 * One row per player (and bot, if wanted) over the tournaments of a mode. `names` maps user
 * keys to the current display name (players can rename themselves).
 */
export function playerTable(
  all: readonly TournamentFacts[],
  opts: { mode?: StatMode; bots?: boolean; names?: ReadonlyMap<string, string> } = {},
): PlayerRow[] {
  const rows = new Map<string, PlayerRow>();
  const weapons = new Map<string, Map<string, number>>();
  const row = (r: PlayerRef) => {
    let x = rows.get(r.key);
    if (!x) {
      x = emptyRow(r);
      rows.set(r.key, x);
    }
    return x;
  };
  for (const t of all) {
    if (!inMode(t, opts.mode)) continue;
    for (const p of t.participants) {
      const x = row(p.ref);
      x.tournaments++;
      if (p.champion && t.finished) x.titles++;
    }
    for (const m of t.matches) {
      for (const p of m.players) {
        const x = row(p.ref);
        x.matches++;
        if (p.won) x.matchesWon++;
      }
    }
    // Monster Hunt: a game is played in two runs; a player plays one of them.
    for (const p of t.players) {
      const x = row(p);
      x.games++;
      if (p.won) x.gamesWon++;
      const s = p.stats;
      if (!s) continue;
      x.statGames++;
      x.kills += s.kills;
      x.deaths += s.deaths;
      x.suicides += s.suicides;
      x.teamKills += s.teamKills;
      x.headshots += s.headshots;
      if (s.firstBlood) x.firstBloods++;
      x.bestSpree = Math.max(x.bestSpree, s.bestSpree);
      x.sprees += s.sprees;
      x.multiKills += multi(s);
      x.timeSec += s.timeSec;
      x.monsters += s.monsters;
      x.monsterPoints += s.monsterPoints;
      if (s.damageDealt !== undefined) {
        x.damageGames++;
        x.damageDealt += s.damageDealt;
        x.damageTaken += s.damageTaken ?? 0;
      }
      if (s.items) {
        x.amps += s.items.amp;
        x.belts += s.items.belt;
        x.armors += s.items.armor;
        x.kegs += s.items.keg;
      }
      const w = weapons.get(p.key) ?? new Map<string, number>();
      for (const [name, n] of Object.entries(s.weapons)) w.set(name, (w.get(name) ?? 0) + n);
      weapons.set(p.key, w);
    }
    for (const r of t.runs) {
      for (const m of r.members) {
        const x = row(m);
        x.runs++;
        if (r.finished) x.runsFinished++;
      }
    }
  }
  const out: PlayerRow[] = [];
  for (const x of rows.values()) {
    if (x.bot && !opts.bots) continue;
    const name = opts.names?.get(x.key);
    if (name) x.name = name;
    x.frags = x.kills - x.suicides - x.teamKills;
    x.kd = round2(x.kills / Math.max(1, x.deaths));
    const denom = x.kills + x.deaths + x.suicides;
    x.efficiency = denom ? round2(x.kills / denom) : 0;
    const fav = [...(weapons.get(x.key) ?? new Map<string, number>()).entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    if (fav) x.favoriteWeapon = { name: fav[0], kills: fav[1] };
    out.push(x);
  }
  return out.sort(
    (a, b) =>
      b.titles - a.titles ||
      b.matchesWon - a.matchesWon ||
      b.frags - a.frags ||
      a.name.localeCompare(b.name),
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Best value, ties to the earliest. */
function best<T extends { at: string }>(
  items: T[],
  value: (x: T) => number,
  lower = false,
): T | undefined {
  let b: T | undefined;
  let bv = 0;
  for (const x of items) {
    const v = value(x);
    if (!Number.isFinite(v)) continue;
    const better = !b || (lower ? v < bv : v > bv) || (v === bv && x.at < b.at);
    if (better) {
      b = x;
      bv = v;
    }
  }
  return b;
}

interface Located {
  t: TournamentFacts;
  at: string;
}

/** Record categories and the Monster Hunt map records. Bots count like players. */
export function records(
  all: readonly TournamentFacts[],
  opts: { mode?: StatMode; names?: ReadonlyMap<string, string> } = {},
): { records: RecordEntry[]; maps: MapRecord[] } {
  const ts = all.filter((t) => inMode(t, opts.mode));
  const nameOf = (r: PlayerRef) => opts.names?.get(r.key) ?? r.name;
  const h = (r: PlayerRef) => ({ ...holder(r), name: nameOf(r) });
  const out: RecordEntry[] = [];

  // --- per game (deathmatch and team deathmatch) ---
  const pg: (PlayerGameFact & Located & { s: PlayerGameStats })[] = [];
  for (const t of ts) {
    if (t.mode === 'mh') continue;
    for (const p of t.players) if (p.stats) pg.push({ ...p, t, s: p.stats });
  }
  const gameRecord = (
    id: string,
    value: (x: (typeof pg)[0]) => number,
    unit: RecordEntry['unit'] = 'count',
  ) => {
    const b = best(pg, value);
    if (!b || value(b) <= 0) return;
    out.push({
      id,
      mode: b.t.mode,
      value: value(b),
      unit,
      holders: [h(b)],
      label: nameOf(b),
      tournamentId: b.t.tournamentId,
      tournamentName: b.t.name,
      matchId: b.matchId,
      map: b.map,
      at: b.at,
    });
  };
  gameRecord('game.frags', (x) => frags(x.s));
  gameRecord('game.spree', (x) => x.s.bestSpree);
  gameRecord('game.headshots', (x) => x.s.headshots);
  gameRecord('game.multiKills', (x) => multi(x.s));
  gameRecord('game.damage', (x) => x.s.damageDealt ?? 0);
  gameRecord('game.amps', (x) => x.s.items?.amp ?? 0);
  gameRecord(
    'game.kd',
    (x) => (x.s.kills >= 10 ? round2(x.s.kills / Math.max(1, x.s.deaths)) : 0),
    'ratio',
  );

  // Fastest win by frag limit (the winner's players).
  const fast: {
    t: TournamentFacts;
    at: string;
    sec: number;
    matchId: string;
    map: string;
    winner: string;
    game: number;
  }[] = [];
  for (const t of ts) {
    if (t.mode === 'mh') continue;
    for (const g of t.games)
      if (g.endReason === 'fragLimit' && g.durationSec)
        fast.push({
          t,
          at: g.at,
          sec: g.durationSec,
          matchId: g.matchId,
          map: g.map,
          winner: g.winnerEntrantId,
          game: g.game,
        });
  }
  const f = best(fast, (x) => x.sec, true);
  if (f) {
    const ps = f.t.players.filter(
      (p) => p.matchId === f.matchId && p.game === f.game && p.entrantId === f.winner,
    );
    out.push({
      id: 'game.fastestWin',
      mode: f.t.mode,
      value: f.sec,
      unit: 'sec',
      holders: ps.map(h),
      label: f.t.entrantNames[f.winner] ?? ps.map(nameOf).join(', '),
      tournamentId: f.t.tournamentId,
      tournamentName: f.t.name,
      matchId: f.matchId,
      map: f.map,
      at: f.at,
    });
  }

  // --- careers ---
  const table = playerTable(ts, { bots: true, ...(opts.names ? { names: opts.names } : {}) });
  const career = (id: string, value: (r: PlayerRow) => number) => {
    let b: PlayerRow | undefined;
    for (const r of table) if (value(r) > 0 && (!b || value(r) > value(b))) b = r;
    if (!b) return;
    out.push({
      id,
      mode: opts.mode ?? 'all',
      value: value(b),
      unit: 'count',
      holders: [{ key: b.key, name: b.name, bot: b.bot }],
      label: b.name,
    });
  };
  career('career.titles', (r) => r.titles);
  career('career.matchWins', (r) => r.matchesWon);
  career('career.frags', (r) => r.frags);
  career('career.headshots', (r) => r.headshots);
  career('career.firstBloods', (r) => r.firstBloods);
  career('career.runsFinished', (r) => r.runsFinished);

  // Longest streak of won matches (in time order over all tournaments of the mode).
  const streak = new Map<string, { cur: number; best: number; ref: PlayerRef; at: string }>();
  const matches = ts.flatMap((t) => t.matches).sort((a, b) => a.at.localeCompare(b.at));
  for (const m of matches) {
    for (const p of m.players) {
      const s = streak.get(p.ref.key) ?? { cur: 0, best: 0, ref: p.ref, at: m.at };
      s.cur = p.won ? s.cur + 1 : 0;
      if (s.cur > s.best) {
        s.best = s.cur;
        s.at = m.at;
      }
      streak.set(p.ref.key, s);
    }
  }
  const sb = best([...streak.values()], (s) => s.best);
  if (sb && sb.best > 1)
    out.push({
      id: 'career.matchStreak',
      mode: opts.mode ?? 'all',
      value: sb.best,
      unit: 'count',
      holders: [h(sb.ref)],
      label: nameOf(sb.ref),
      at: sb.at,
    });

  // --- Monster Hunt ---
  const runs: (RunFact & Located)[] = [];
  for (const t of ts) if (t.mode === 'mh') for (const r of t.runs) runs.push({ ...r, t });
  const finishedRuns = runs.filter((r) => r.finished);
  const runRecord = (id: string, b: (typeof runs)[0] | undefined, value: number) => {
    if (!b) return;
    out.push({
      id,
      mode: 'mh',
      value,
      unit: 'count',
      holders: b.members.map(h),
      label: b.entrantName,
      tournamentId: b.t.tournamentId,
      tournamentName: b.t.name,
      matchId: b.matchId,
      map: b.map,
      at: b.at,
    });
  };
  const fewest = best(finishedRuns, (r) => r.deaths * 1e9 + r.finalMs, true);
  if (fewest) runRecord('run.fewestDeaths', fewest, fewest.deaths);
  const points = best(runs, (r) => r.points);
  if (points && points.points > 0) runRecord('run.points', points, points.points);
  const mons: (PlayerGameFact & Located & { n: number })[] = [];
  for (const t of ts)
    if (t.mode === 'mh')
      for (const p of t.players) if (p.stats?.monsters) mons.push({ ...p, t, n: p.stats.monsters });
  const mb = best(mons, (x) => x.n);
  if (mb)
    out.push({
      id: 'run.monsters',
      mode: 'mh',
      value: mb.n,
      unit: 'count',
      holders: [h(mb)],
      label: nameOf(mb),
      tournamentId: mb.t.tournamentId,
      tournamentName: mb.t.name,
      matchId: mb.matchId,
      map: mb.map,
      at: mb.at,
    });

  return { records: out, maps: mapRecords(ts, opts.names) };
}

/**
 * Best final time (time plus penalty) of a finished run per map and monster skill (a record on
 * easier monsters is no record on harder ones); map names compared case-insensitively.
 */
export function mapRecords(
  all: readonly TournamentFacts[],
  names?: ReadonlyMap<string, string>,
): MapRecord[] {
  const bestBy = new Map<string, { r: RunFact; t: TournamentFacts }>();
  for (const t of all) {
    if (t.mode !== 'mh') continue;
    for (const r of t.runs) {
      if (!r.finished || r.forfeit) continue;
      const k = `${r.map.toLowerCase()}|${r.monsterSkill}`;
      const cur = bestBy.get(k);
      if (!cur || r.finalMs < cur.r.finalMs || (r.finalMs === cur.r.finalMs && r.at < cur.r.at))
        bestBy.set(k, { r, t });
    }
  }
  return [...bestBy.values()]
    .map(({ r, t }) => ({
      map: r.map,
      finalMs: r.finalMs,
      timeMs: r.timeMs,
      deaths: r.deaths,
      penaltyMs: r.penaltyMs,
      monsterSkill: r.monsterSkill,
      team: r.entrantName,
      members: r.members.map((m) => ({ ...holder(m), name: names?.get(m.key) ?? m.name })),
      tournamentId: t.tournamentId,
      tournamentName: t.name,
      at: r.at,
    }))
    .sort((a, b) => a.map.localeCompare(b.map) || a.monsterSkill - b.monsterSkill);
}

export interface PlayerDetail {
  row: PlayerRow;
  byMode: Partial<Record<StatMode, PlayerRow>>;
  weapons: { name: string; kills: number }[];
  recent: {
    tournamentId: string;
    tournamentName: string;
    matchId: string;
    mode: StatMode;
    at: string;
    won: boolean;
    team: string;
    opponent: string;
  }[];
  /** Monster Hunt: the player's best finished run per map. */
  mapBests: {
    map: string;
    finalMs: number;
    deaths: number;
    team: string;
    tournamentName: string;
    at: string;
  }[];
  /** Records the player holds (alone or with the team). */
  records: RecordEntry[];
  mapRecords: MapRecord[];
}

export function playerDetail(
  all: readonly TournamentFacts[],
  key: string,
  names?: ReadonlyMap<string, string>,
): PlayerDetail | undefined {
  const opts = { bots: true, ...(names ? { names } : {}) };
  const row = playerTable(all, opts).find((r) => r.key === key);
  if (!row) return undefined;
  const byMode: PlayerDetail['byMode'] = {};
  for (const mode of ['dm', 'tdm', 'mh'] as const) {
    const r = playerTable(all, { ...opts, mode }).find((x) => x.key === key);
    if (r) byMode[mode] = r;
  }
  const weapons = new Map<string, number>();
  for (const t of all)
    for (const p of t.players)
      if (p.key === key && p.stats)
        for (const [w, n] of Object.entries(p.stats.weapons))
          weapons.set(w, (weapons.get(w) ?? 0) + n);
  const recent: PlayerDetail['recent'] = [];
  for (const t of all)
    for (const m of t.matches) {
      const me = m.players.find((p) => p.ref.key === key);
      if (!me) continue;
      const other = m.entrants.find((e) => e !== me.entrantId) ?? '';
      recent.push({
        tournamentId: t.tournamentId,
        tournamentName: t.name,
        matchId: m.matchId,
        mode: t.mode,
        at: m.at,
        won: me.won,
        team: t.entrantNames[me.entrantId] ?? '',
        opponent: t.entrantNames[other] ?? other,
      });
    }
  recent.sort((a, b) => b.at.localeCompare(a.at));
  const bests = new Map<string, PlayerDetail['mapBests'][0]>();
  for (const t of all)
    for (const r of t.runs) {
      if (!r.finished || r.forfeit || !r.members.some((m) => m.key === key)) continue;
      const k = r.map.toLowerCase();
      const cur = bests.get(k);
      if (!cur || r.finalMs < cur.finalMs)
        bests.set(k, {
          map: r.map,
          finalMs: r.finalMs,
          deaths: r.deaths,
          team: r.entrantName,
          tournamentName: t.name,
          at: r.at,
        });
    }
  const rec = records(all, names ? { names } : {});
  return {
    row,
    byMode,
    weapons: [...weapons.entries()]
      .map(([name, kills]) => ({ name, kills }))
      .sort((a, b) => b.kills - a.kills),
    recent: recent.slice(0, 20),
    mapBests: [...bests.values()].sort((a, b) => a.map.localeCompare(b.map)),
    records: rec.records.filter((r) => r.holders.some((x) => x.key === key)),
    mapRecords: rec.maps.filter((r) => r.members.some((x) => x.key === key)),
  };
}

/**
 * Head to head: games in which `key` and each of `others` played on opposite sides, and how
 * many of them `key` won.
 */
export function headToHead(
  all: readonly TournamentFacts[],
  key: string,
  others: readonly string[],
): Record<string, { games: number; wins: number }> {
  const out: Record<string, { games: number; wins: number }> = {};
  for (const o of others) out[o] = { games: 0, wins: 0 };
  for (const f of all) {
    const byGame = new Map<string, TournamentFacts['players']>();
    for (const p of f.players) {
      const g = `${p.matchId}/${p.game}`;
      byGame.set(g, [...(byGame.get(g) ?? []), p]);
    }
    for (const rows of byGame.values()) {
      const me = rows.find((r) => r.key === key);
      if (!me) continue;
      for (const o of others) {
        const them = rows.find((r) => r.key === o);
        if (!them || them.entrantId === me.entrantId) continue;
        out[o]!.games++;
        if (me.won) out[o]!.wins++;
      }
    }
  }
  return out;
}
