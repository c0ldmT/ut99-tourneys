import type { BracketState, EntrantId, MatchResult, MatchState } from './types.js';

const SIDE_ORDER = { W: 0, L: 1, GF: 2 } as const;

/** How much later (in critical-path units) a match may be scheduled to give a player a break. */
const REST_PENALTY = 1.5;

export interface ScheduleOptions {
  /**
   * Entrants of the most recently finished match. Matches with one of them are pushed back,
   * so nobody plays twice in a row if anything else is playable.
   */
  justPlayed?: readonly EntrantId[];
}

/**
 * All playable matches in the order they should be played on a single server.
 * The first element is the next match. Deterministic.
 *
 * Ordering: longest remaining chain first (critical path scheduling keeps winners and losers
 * bracket progressing together and avoids a long back-to-back run at the end), players who just
 * played get a break when possible, then winners before losers, then round and index.
 */
export function playableMatches(state: BracketState, options: ScheduleOptions = {}): MatchState[] {
  const resting = new Set(options.justPlayed ?? []);
  const score = (m: MatchState) =>
    -m.height + (m.entrants.some((e) => e !== null && resting.has(e)) ? REST_PENALTY : 0);

  return state.matches
    .filter((m) => m.status === 'ready')
    .sort(
      (a, b) =>
        score(a) - score(b) ||
        SIDE_ORDER[a.side] - SIDE_ORDER[b.side] ||
        a.round - b.round ||
        a.index - b.index,
    );
}

/** Convenience: the next match, using the last applied result to determine who needs rest. */
export function nextMatch(
  state: BracketState,
  results: readonly MatchResult[],
): MatchState | undefined {
  const last = results[results.length - 1];
  return playableMatches(state, last ? { justPlayed: last.entrants } : {})[0];
}
