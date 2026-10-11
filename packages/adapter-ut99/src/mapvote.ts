import { pick, shuffle, type Rng } from '@tourney/bracket';

/**
 * Map selection for a match.
 *
 * Vote mode: each player ranks up to N maps (Borda count: first pick N points, then N-1, ...).
 * Maps picked by both players get a bonus, so a common choice beats one player's favourite.
 * Maps played recently in the tournament, or already played by one of the two players, get a
 * penalty. Only maps that received at least one pick can win. Ties are broken randomly
 * (seeded, so the result is reproducible). Players who do not vote, and bots, vote randomly.
 */

export interface Ballot {
  entrantId: string;
  /** Ranked picks, best first. Unknown maps and duplicates are ignored. Empty = abstained. */
  picks: readonly string[];
}

export interface PlayedMap {
  map: string;
  entrants: readonly [string, string];
}

export interface MapVoteInput {
  pool: readonly string[];
  entrants: readonly [string, string];
  ballots: readonly Ballot[];
  /** Maps played so far in the tournament, oldest first. */
  history: readonly PlayedMap[];
  picksPerPlayer: number;
  /** Size of the "recently played" window. */
  avoidRecentMaps: number;
  rng: Rng;
}

export interface MapScore {
  map: string;
  votePoints: number;
  mutualBonus: number;
  recentPenalty: number;
  playedPenalty: number;
  total: number;
}

export interface MapVoteOutcome {
  map: string;
  /** Ballots after cleaning and random filling, for display ("who voted what"). */
  ballots: { entrantId: string; picks: string[]; random: boolean }[];
  /** Scores of all maps that received picks, best first. */
  scores: MapScore[];
  /** Maps that tied for first place (length > 1 means the RNG decided). */
  tiedFor: string[];
}

export const SCORING = {
  mutualBonus: 3,
  /** Per occurrence in the recent window. */
  recentPenalty: 2,
  /** Per player of this match who already played the map in this tournament. */
  playedPenalty: 1,
} as const;

/** Random ballot used for bots and players who did not vote. */
export function randomBallot(pool: readonly string[], picks: number, rng: Rng): string[] {
  return shuffle(pool, rng).slice(0, Math.min(picks, pool.length));
}

function cleanPicks(picks: readonly string[], pool: readonly string[], max: number): string[] {
  const byLower = new Map(pool.map((m) => [m.toLowerCase(), m]));
  const out: string[] = [];
  for (const p of picks) {
    const m = byLower.get(p.toLowerCase());
    if (m && !out.includes(m)) out.push(m);
    if (out.length === max) break;
  }
  return out;
}

export function resolveMapVote(input: MapVoteInput): MapVoteOutcome {
  const { pool, entrants, history, picksPerPlayer, rng } = input;
  if (pool.length === 0) throw new Error('map pool is empty');

  const ballots = entrants.map((entrantId) => {
    const given = input.ballots.find((b) => b.entrantId === entrantId);
    const picks = cleanPicks(given?.picks ?? [], pool, picksPerPlayer);
    return picks.length > 0
      ? { entrantId, picks, random: false }
      : { entrantId, picks: randomBallot(pool, picksPerPlayer, rng), random: true };
  });

  const recent = input.avoidRecentMaps > 0 ? history.slice(-input.avoidRecentMaps) : [];
  const scores = new Map<string, MapScore>();
  for (const ballot of ballots) {
    ballot.picks.forEach((map, rank) => {
      const s = scores.get(map) ?? {
        map,
        votePoints: 0,
        mutualBonus: 0,
        recentPenalty: 0,
        playedPenalty: 0,
        total: 0,
      };
      s.votePoints += picksPerPlayer - rank;
      scores.set(map, s);
    });
  }
  for (const s of scores.values()) {
    if (ballots.every((b) => b.picks.includes(s.map))) s.mutualBonus = SCORING.mutualBonus;
    s.recentPenalty = recent.filter((h) => h.map === s.map).length * SCORING.recentPenalty;
    s.playedPenalty =
      entrants.filter((e) => history.some((h) => h.map === s.map && h.entrants.includes(e)))
        .length * SCORING.playedPenalty;
    s.total = s.votePoints + s.mutualBonus - s.recentPenalty - s.playedPenalty;
  }

  const ranked = [...scores.values()].sort(
    (a, b) => b.total - a.total || a.map.localeCompare(b.map),
  );
  const best = ranked[0]?.total as number;
  const tiedFor = ranked.filter((s) => s.total === best).map((s) => s.map);
  return { map: pick(tiedFor, rng), ballots, scores: ranked, tiedFor };
}

/**
 * Random mode: picks a random pool map, avoiding maps played recently or already played by one of
 * the two players. Falls back step by step if the pool is too small.
 */
export function randomMap(input: Omit<MapVoteInput, 'ballots' | 'picksPerPlayer'>): string {
  const { pool, entrants, history, rng } = input;
  if (pool.length === 0) throw new Error('map pool is empty');
  const recent = new Set(history.slice(-input.avoidRecentMaps).map((h) => h.map));
  const playedByThem = new Set(
    history.filter((h) => h.entrants.some((e) => entrants.includes(e))).map((h) => h.map),
  );
  const fresh = pool.filter((m) => !recent.has(m) && !playedByThem.has(m));
  if (fresh.length) return pick(fresh, rng);
  const notRecent = pool.filter((m) => !recent.has(m));
  if (notRecent.length) return pick(notRecent, rng);
  return pick(pool, rng);
}

/**
 * Best-of series, game 2+: the loser of the previous game picks. Takes the loser's highest-ranked
 * map not yet played in this series; if none, a random unplayed map.
 */
export function loserPickMap(input: {
  pool: readonly string[];
  loserPicks: readonly string[];
  playedInSeries: readonly string[];
  rng: Rng;
}): { map: string; random: boolean } {
  const unplayed = input.pool.filter((m) => !input.playedInSeries.includes(m));
  const candidates = unplayed.length ? unplayed : [...input.pool];
  const choice = cleanPicks(input.loserPicks, candidates, candidates.length)[0];
  return choice
    ? { map: choice, random: false }
    : { map: pick(candidates, input.rng), random: true };
}
