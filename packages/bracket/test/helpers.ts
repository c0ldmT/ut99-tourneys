import {
  computeBracket,
  createRng,
  nextMatch,
  type BracketDefinition,
  type BracketFormat,
  type BracketSize,
  type BracketState,
  type MatchResult,
  type Rng,
} from '../src/index.js';

export const entrants = (n: number) => Array.from({ length: n }, (_, i) => `e${i + 1}`);

export function def(
  format: BracketFormat,
  size: BracketSize,
  extra: Partial<BracketDefinition> = {},
): BracketDefinition {
  return {
    format,
    size,
    slots: entrants(size),
    grandFinalReset: true,
    bestOf: { default: 1 },
    ...extra,
  };
}

export function win(state: BracketState, matchId: string, winner: 0 | 1): MatchResult {
  const m = state.byId[matchId];
  if (!m || m.status !== 'ready') throw new Error(`${matchId} not ready (${m?.status})`);
  const [a, b] = m.entrants as [string, string];
  return { matchId, entrants: [a, b], winnerId: winner === 0 ? a : b, outcome: 'played' };
}

/** Plays the whole bracket with random winners using the scheduler. */
export function playOut(
  definition: BracketDefinition,
  rng: Rng = createRng(1),
): { state: BracketState; results: MatchResult[]; order: string[] } {
  const results: MatchResult[] = [];
  const order: string[] = [];
  let state = computeBracket(definition, results);
  for (let guard = 0; guard < 200; guard++) {
    const m = nextMatch(state, results);
    if (!m) break;
    results.push(win(state, m.id, rng() < 0.5 ? 0 : 1));
    order.push(m.id);
    state = computeBracket(definition, results);
  }
  return { state, results, order };
}
