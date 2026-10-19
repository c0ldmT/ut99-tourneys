import { describe, expect, it } from 'vitest';
import { simulateSeason, type SimBot } from '../src/index.js';

const library: SimBot[] = Array.from({ length: 40 }, (_, i) => ({
  id: `b${i}`,
  name: `Bot ${i}`,
  skill: i % 8,
  score: (i % 5) / 4,
}));

describe('season simulator', () => {
  it('runs a season deterministically and keeps the books plausible', () => {
    const opts = {
      managers: ['saver', 'casual', 'gambler', 'shark'] as const,
      library,
      betMultiples: [0, 0, 1.4, 1.8, 2.5],
      topMultiples: [0, 1.4, 1.8, 2.5],
      seed: 7,
    };
    const a = simulateSeason({ ...opts, managers: [...opts.managers] });
    const b = simulateSeason({ ...opts, managers: [...opts.managers] });
    expect(a).toEqual(b);
    expect(a.days).toHaveLength(42);
    expect(a.days[0]!.index).toBe(0.3);
    expect(a.events.some((e) => e.name === 'Daily Cup')).toBe(true);
    for (const d of a.days) {
      expect(d.index).toBeGreaterThanOrEqual(0.3);
      for (const m of d.managers) {
        expect(m.cash).toBeGreaterThanOrEqual(100);
        expect(m.roster).toBeLessThanOrEqual(7);
      }
    }
    // Bots are unique: never more owned than the library has.
    const last = a.days.at(-1)!;
    expect(last.managers.reduce((s, m) => s + m.roster - 1, 0)).toBeLessThanOrEqual(library.length);
  });
});
