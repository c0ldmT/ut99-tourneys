import { describe, expect, it } from 'vitest';
import {
  computeBracket,
  createRng,
  InvalidBracketDefinitionError,
  type MatchResult,
} from '../src/index.js';
import { def, playOut, win } from './helpers.js';

const SIZES = [8, 16, 32] as const;

function placements(state: ReturnType<typeof computeBracket>) {
  return state.standings.map((s) => s.placement).sort((a, b) => (a ?? 0) - (b ?? 0));
}

describe('engine: full runs', () => {
  it.each(SIZES)('single %i always finishes with correct placements', (size) => {
    for (let seed = 0; seed < 25; seed++) {
      const { state, results } = playOut(def('single', size), createRng(seed));
      expect(state.status).toBe('finished');
      expect(results).toHaveLength(size - 1);
      expect(state.issues).toEqual([]);
      const expected = [1, 2, 3, 3, ...Array(4).fill(5)];
      if (size >= 16) expected.push(...Array(8).fill(9));
      if (size >= 32) expected.push(...Array(16).fill(17));
      expect(placements(state)).toEqual(expected);
      expect(state.standings.every((s) => s.losses <= 1)).toBe(true);
    }
  });

  it.each(SIZES)('double %i always finishes, nobody loses three times', (size) => {
    for (let seed = 0; seed < 25; seed++) {
      const { state, results } = playOut(def('double', size), createRng(seed));
      expect(state.status).toBe('finished');
      expect(state.issues).toEqual([]);
      expect([2 * size - 2, 2 * size - 1]).toContain(results.length);
      expect(state.standings.every((s) => s.losses <= 2)).toBe(true);
      const champ = state.standings.find((s) => s.placement === 1);
      expect(champ?.entrantId).toBe(state.championId);
      expect(champ?.losses).toBeLessThanOrEqual(1);
    }
  });

  it('double 8 placements: 1,2,3,4,5,5,7,7', () => {
    const { state } = playOut(def('double', 8), createRng(42));
    expect(placements(state)).toEqual([1, 2, 3, 4, 5, 5, 7, 7]);
  });

  it('double 32 placements follow losers-round elimination', () => {
    const { state } = playOut(def('double', 32), createRng(7));
    const counts: Record<number, number> = {};
    for (const p of placements(state)) counts[p as number] = (counts[p as number] ?? 0) + 1;
    expect(counts).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 2, 7: 2, 9: 4, 13: 4, 17: 8, 25: 8 });
  });

  it.each(SIZES)(
    'double %i: a drop-down never meets an earlier opponent in losers round 2',
    (size) => {
      for (let seed = 0; seed < 25; seed++) {
        const { state } = playOut(def('double', size), createRng(seed));
        const met = new Set<string>();
        for (const m of state.matches.filter((m) => m.side === 'W')) {
          met.add([...m.entrants].sort().join('|'));
        }
        for (const m of state.matches.filter((m) => m.side === 'L' && m.round === 2)) {
          expect(met.has([...m.entrants].sort().join('|'))).toBe(false);
        }
      }
    },
  );
});

describe('engine: grand final', () => {
  function toGrandFinal(reset: boolean) {
    const d = def('double', 8, { grandFinalReset: reset });
    const results: MatchResult[] = [];
    let state = computeBracket(d, results);
    // Higher slot always wins everything except where we steer the grand final.
    while (state.byId['GF1']?.status !== 'ready') {
      const m = state.matches.find((x) => x.status === 'ready');
      if (!m) throw new Error('stuck');
      results.push(win(state, m.id, 0));
      state = computeBracket(d, results);
    }
    return { d, results, state };
  }

  it('winners champion wins GF1: reset is void and tournament is over', () => {
    const { d, results, state } = toGrandFinal(true);
    results.push(win(state, 'GF1', 0));
    const done = computeBracket(d, results);
    expect(done.byId['GF2']?.status).toBe('void');
    expect(done.status).toBe('finished');
    expect(done.championId).toBe(state.byId['GF1']?.entrants[0]);
  });

  it('losers champion wins GF1: reset is played', () => {
    const { d, results, state } = toGrandFinal(true);
    results.push(win(state, 'GF1', 1));
    let s = computeBracket(d, results);
    expect(s.status).toBe('running');
    expect(s.byId['GF2']?.status).toBe('ready');
    const wbChamp = state.byId['GF1']?.entrants[0];
    expect(s.standings.find((x) => x.entrantId === wbChamp)?.placement).toBeNull();
    results.push(win(s, 'GF2', 0));
    s = computeBracket(d, results);
    expect(s.status).toBe('finished');
    expect(s.championId).toBe(wbChamp);
    expect(s.standings.find((x) => x.entrantId === state.byId['GF1']?.entrants[1])?.placement).toBe(
      2,
    );
  });

  it('without reset the GF1 winner is champion', () => {
    const { d, results, state } = toGrandFinal(false);
    results.push(win(state, 'GF1', 1));
    const s = computeBracket(d, results);
    expect(s.byId['GF2']).toBeUndefined();
    expect(s.championId).toBe(state.byId['GF1']?.entrants[1]);
  });
});

describe('engine: overrides and invalid results', () => {
  it('overriding an upstream result makes downstream results stale instead of corrupting the bracket', () => {
    const d = def('single', 8);
    const results: MatchResult[] = [];
    let s = computeBracket(d, results);
    results.push(win(s, 'W1-1', 0), win(s, 'W1-2', 0));
    s = computeBracket(d, results);
    results.push(win(s, 'W2-1', 0)); // e1 beats e3
    s = computeBracket(d, results);
    expect(s.byId['W2-1']?.winnerId).toBe('e1');

    // Admin: actually e2 won W1-1.
    results.push({ matchId: 'W1-1', entrants: ['e1', 'e2'], winnerId: 'e2', outcome: 'override' });
    s = computeBracket(d, results);
    expect(s.byId['W1-1']?.winnerId).toBe('e2');
    expect(s.byId['W2-1']?.status).toBe('ready');
    expect(s.byId['W2-1']?.entrants).toEqual(['e2', 'e3']);
    expect(s.issues).toEqual([expect.objectContaining({ matchId: 'W2-1', code: 'stale_result' })]);
  });

  it('reports unknown matches, wrong winners and results for undetermined matches', () => {
    const d = def('single', 8);
    const s = computeBracket(d, [
      { matchId: 'X9-9', entrants: ['e1', 'e2'], winnerId: 'e1', outcome: 'played' },
      { matchId: 'W1-1', entrants: ['e1', 'e2'], winnerId: 'e5', outcome: 'played' },
      { matchId: 'W2-1', entrants: ['e1', 'e3'], winnerId: 'e1', outcome: 'played' },
    ]);
    expect(s.issues.map((i) => i.code).sort()).toEqual([
      'invalid_winner',
      'not_ready',
      'unknown_match',
    ]);
    expect(s.byId['W1-1']?.status).toBe('ready');
  });

  it('validates best-of games', () => {
    const d = def('single', 8, { bestOf: { default: 3 } });
    const game = (w: string) => ({ scores: {}, winnerId: w });
    const ok = computeBracket(d, [
      {
        matchId: 'W1-1',
        entrants: ['e1', 'e2'],
        winnerId: 'e1',
        outcome: 'played',
        games: [game('e1'), game('e2'), game('e1')],
      },
    ]);
    expect(ok.byId['W1-1']?.status).toBe('completed');
    const bad = computeBracket(d, [
      {
        matchId: 'W1-1',
        entrants: ['e1', 'e2'],
        winnerId: 'e1',
        outcome: 'played',
        games: [game('e1')],
      },
    ]);
    expect(bad.issues[0]?.code).toBe('invalid_games');
    // Forfeits do not need complete games.
    const forfeit = computeBracket(d, [
      {
        matchId: 'W1-1',
        entrants: ['e2', 'e1'],
        winnerId: 'e1',
        outcome: 'forfeit',
        games: [game('e1')],
      },
    ]);
    expect(forfeit.byId['W1-1']?.winnerId).toBe('e1');
  });

  it('rejects invalid definitions', () => {
    expect(() => computeBracket(def('single', 8, { slots: ['a', 'a'] }), [])).toThrow(
      InvalidBracketDefinitionError,
    );
    expect(() => computeBracket(def('double', 8, { bestOf: { default: 2 } }), [])).toThrow(
      /bestOf/,
    );
  });

  it('is deterministic', () => {
    const a = playOut(def('double', 16), createRng('same'));
    const b = playOut(def('double', 16), createRng('same'));
    expect(a.order).toEqual(b.order);
    expect(a.state.standings).toEqual(b.state.standings);
  });
});
