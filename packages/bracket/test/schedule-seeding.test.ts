import { describe, expect, it } from 'vitest';
import {
  buildSlots,
  computeBracket,
  createRng,
  fillEmptySlots,
  playableMatches,
  slotsFromSeeds,
  smallestBracketSize,
  standardSeedOrder,
} from '../src/index.js';
import { def, playOut, win } from './helpers.js';

describe('seeding', () => {
  it('standard seed order', () => {
    expect(standardSeedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(standardSeedOrder(16).slice(0, 4)).toEqual([1, 16, 8, 9]);
  });

  it('top seeds can only meet in the final', () => {
    const slots = slotsFromSeeds(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']);
    expect(slots.indexOf('s1') < 4).not.toBe(slots.indexOf('s2') < 4);
  });

  it('bye placement: every bot faces a human when at least half are humans', () => {
    for (let seed = 0; seed < 50; seed++) {
      const humans = ['h1', 'h2', 'h3', 'h4', 'h5'];
      const slots = buildSlots({
        size: 8,
        humans,
        botPool: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'],
        humanOrder: 'random',
        botPlacement: 'byes',
        rng: createRng(seed),
      });
      expect(new Set(slots).size).toBe(8);
      for (let i = 0; i < 8; i += 2) {
        const pair = [slots[i], slots[i + 1]];
        expect(pair.some((e) => e?.startsWith('h'))).toBe(true);
      }
    }
  });

  it('is reproducible from a seed', () => {
    const input = {
      size: 16 as const,
      humans: ['a', 'b', 'c', 'd', 'e'],
      botPool: Array.from({ length: 20 }, (_, i) => `bot${i}`),
      humanOrder: 'random' as const,
      botPlacement: 'random' as const,
    };
    expect(buildSlots({ ...input, rng: createRng('x') })).toEqual(
      buildSlots({ ...input, rng: createRng('x') }),
    );
  });

  it('fills empty slots of a manually stacked bracket', () => {
    const slots = fillEmptySlots(['h1', null, 'b2', null], ['b1', 'b2', 'b3'], createRng(3));
    expect(slots[0]).toBe('h1');
    expect(slots[2]).toBe('b2');
    expect(new Set(slots).size).toBe(4);
    expect(() => fillEmptySlots([null, null, null], ['b1'], createRng(1))).toThrow();
  });

  it('picks the smallest bracket size', () => {
    expect(smallestBracketSize(5)).toBe(8);
    expect(smallestBracketSize(9)).toBe(16);
    expect(smallestBracketSize(32)).toBe(32);
    expect(() => smallestBracketSize(33)).toThrow();
  });
});

describe('schedule', () => {
  it('plays round by round in single elimination', () => {
    const { order } = playOut(def('single', 8));
    expect(order.slice(0, 4).every((id) => id.startsWith('W1-'))).toBe(true);
    expect(order.slice(4, 6).every((id) => id.startsWith('W2-'))).toBe(true);
    expect(order[6]).toBe('W3-1');
  });

  it('gives players a break when another match is playable', () => {
    const d = def('double', 8);
    let s = computeBracket(d, []);
    const results = [win(s, 'W1-1', 0), win(s, 'W1-2', 0), win(s, 'W1-3', 0)];
    s = computeBracket(d, results);
    // W1-4 is the natural next match (depth 0). Now finish it and check W2-2 (contains its winner)
    // is pushed behind W2-1 and L1-1.
    results.push(win(s, 'W1-4', 0));
    s = computeBracket(d, results);
    const next = playableMatches(s, { justPlayed: results[3]?.entrants }).map((m) => m.id);
    expect(next[0]).toBe('W2-1');
    expect(next.indexOf('W2-2')).toBeGreaterThan(next.indexOf('L1-1'));
  });

  it.each([4, 8, 16, 32] as const)(
    'double %i: nobody plays twice in a row unless unavoidable',
    (size) => {
      for (let seed = 0; seed < 10; seed++) {
        const { results } = playOut(def('double', size), createRng(seed));
        let backToBack = 0;
        for (let i = 1; i < results.length; i++) {
          const prev = new Set(results[i - 1]?.entrants);
          if (results[i]?.entrants.some((e) => prev.has(e))) backToBack++;
        }
        // Only the final stretch (LB semi -> LB final -> GF -> reset) is unavoidable; a bracket
        // of 4 has one more because round two starts right after round one.
        expect(backToBack).toBeLessThanOrEqual(size === 4 ? 4 : 3);
      }
    },
  );
});
