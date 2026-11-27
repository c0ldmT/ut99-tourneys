import { describe, expect, it } from 'vitest';
import { bracketRounds, hoursText, maxGames, maxMinutes } from '../src/app/core/bracket-time';

const base = {
  format: 'double' as const,
  size: 8,
  boDefault: 1,
  boSemi: 0,
  boFinal: 3,
  boLbFinal: 0,
  boGrand: 3,
  grandFinalReset: true,
};

describe('bracket time (decision 324)', () => {
  it('counts the matches of every round', () => {
    const single = bracketRounds({ ...base, format: 'single' });
    expect(single.map((r) => r.matches)).toEqual([4, 2, 1]);
    const double = bracketRounds(base);
    const matches = double.reduce((n, r) => n + r.matches, 0);
    // 7 winners' matches, size - 2 losers' matches, grand final and reset.
    expect(matches).toBe(7 + 6 + 2);
    expect(bracketRounds({ ...base, size: 16 }).reduce((n, r) => n + r.matches, 0)).toBe(
      15 + 14 + 2,
    );
  });

  it('uses the best of of the final rounds', () => {
    // 4 + 2 Bo1, final Bo3; losers 2+2+1 Bo1 and its final Bo1; grand final Bo3 twice.
    expect(maxGames(base)).toBe(4 + 2 + 3 + 6 + 6);
    expect(maxGames({ ...base, grandFinalReset: false })).toBe(4 + 2 + 3 + 6 + 3);
  });

  it('plays a round on several servers at once', () => {
    const one = maxMinutes(base, 10, 1);
    expect(one).toBe(maxGames(base) * 13);
    // 3 servers: 4 matches → 2 batches, 2 → 1, the rest one at a time.
    const three = maxMinutes(base, 10, 3);
    expect(three).toBe((2 + 1 + 3 + 1 + 1 + 1 + 1 + 6) * 13);
    expect(three).toBeLessThan(one);
    expect(maxMinutes(base, 10, 0)).toBe(one);
  });

  it('writes hours and minutes', () => {
    expect(hoursText(45)).toBe('45 min');
    expect(hoursText(120)).toBe('2 h');
    expect(hoursText(130)).toBe('2 h 10 min');
  });
});
