import { describe, expect, it } from 'vitest';
import {
  FIXTURE_SIZES,
  buildStructure,
  computeBracket,
  nextMatch,
  playableMatches,
  validateDefinition,
} from '../src/index.js';
import { def, win } from './helpers.js';

describe('fixtures (league matchday)', () => {
  it.each(FIXTURE_SIZES)('%i entrants: independent pairings of the slots, all ready', (size) => {
    const nodes = buildStructure('fixtures', size, { default: 3 }, true);
    expect(nodes).toHaveLength(size / 2);
    nodes.forEach((n, i) => {
      expect(n).toMatchObject({ id: `W1-${i + 1}`, side: 'W', round: 1, bestOf: 3, stage: null });
      expect(n.sources).toEqual([
        { kind: 'slot', slot: 2 * i },
        { kind: 'slot', slot: 2 * i + 1 },
      ]);
    });
    const s = computeBracket(def('fixtures', size), []);
    expect(s.matches.every((m) => m.status === 'ready')).toBe(true);
    expect(s.status).toBe('running');
  });

  it('finishes when every pairing is decided, without a champion or placements', () => {
    let state = computeBracket(def('fixtures', 6), []);
    const results = [];
    for (const id of ['W1-2', 'W1-1', 'W1-3']) {
      results.push(win(state, id, id === 'W1-3' ? 1 : 0));
      state = computeBracket(def('fixtures', 6), results);
    }
    expect(state.status).toBe('finished');
    expect(state.championId).toBeUndefined();
    expect(state.standings.every((s) => s.placement === null)).toBe(true);
    expect(state.standings.find((s) => s.entrantId === 'e6')).toMatchObject({ wins: 1 });
    expect(state.standings.find((s) => s.entrantId === 'e5')).toMatchObject({ losses: 1 });
    expect(nextMatch(state, results)).toBeUndefined();
  });

  it('plays the pairings in order, a club that just played waits when it can', () => {
    const state = computeBracket(def('fixtures', 8), []);
    expect(playableMatches(state).map((m) => m.id)).toEqual(['W1-1', 'W1-2', 'W1-3', 'W1-4']);
  });

  it('accepts only its own sizes', () => {
    expect(validateDefinition(def('fixtures', 2))).toEqual([]);
    expect(validateDefinition({ ...def('fixtures', 4), size: 32 })).toContain(
      'unsupported size 32',
    );
    expect(validateDefinition({ ...def('single', 4), size: 6 })).toContain('unsupported size 6');
  });
});
