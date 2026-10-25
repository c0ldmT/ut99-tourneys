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

  it('models blueprints, licences and own salaries when asked (academy)', () => {
    const opts = {
      managers: ['casual', 'gambler', 'shark', 'saver'] as const,
      library,
      betMultiples: [0, 0, 1.4, 1.8, 2.5],
      topMultiples: [0, 1.4, 1.8, 2.5],
      seed: 3,
    };
    const plain = simulateSeason({ ...opts, managers: [...opts.managers] });
    const capped = simulateSeason({
      ...opts,
      managers: [...opts.managers],
      academy: {
        licence: (n) => [0, 2000, 4000, 8000][n] ?? null,
        blueprintSalary: 1,
        boxesPerWeek: { saver: 10, casual: 10, gambler: 10, shark: 10 },
      },
    });
    expect(plain.totals.every((t) => t.built === 0 && t.boxes === 0)).toBe(true);
    expect(capped.totals.some((t) => t.built > 0)).toBe(true);
    // At most three licences after the starter; own bots pay salaries with the full share.
    expect(capped.totals.every((t) => t.built <= 3)).toBe(true);
    expect(capped.totals.some((t) => t.ownSalaries > 0)).toBe(true);
    const free = simulateSeason({
      ...opts,
      managers: [...opts.managers],
      academy: { licence: () => 0, blueprintSalary: 0, boxesPerWeek: { casual: 10 } },
    });
    expect(free.totals.every((t) => t.ownSalaries === 0)).toBe(true);
  });
});
