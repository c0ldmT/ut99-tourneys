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

  it('plays a league season: fixtures, tables, promotion, final four, money, keepers', () => {
    const managers = ['casual', 'gambler', 'shark', 'saver'] as const;
    const r = simulateSeason({
      managers: [...managers],
      library,
      betMultiples: [0, 0, 1.4, 1.8, 2.5],
      topMultiples: [0, 1.4, 1.8, 2.5],
      seed: 3,
      keepers: [[{ skill: 4, score: 0.6, potential: 5 }], [], [], []],
      academy: { licence: (n) => 2000 * 2 ** (n - 1), blueprintSalary: 0.75 },
      league: { tierOf: [0, 1, 0, 1], tiers: 2, size: 8 },
    });
    const lg = r.league!;
    expect(lg.matchdays).toBe(14);
    expect(lg.clubs).toHaveLength(16);
    for (const c of lg.clubs) expect(c.row.played).toBe(14);
    // Two managers per tier: 2 games with managers per matchday and tier (when they do not meet).
    expect(lg.realGames + lg.simulatedGames).toBe(2 * 14 * 4);
    expect(lg.clubs.filter((c) => c.nextTier === 0)).toHaveLength(8);
    expect(
      lg.clubs
        .filter((c) => c.final)
        .map((c) => c.final)
        .sort(),
    ).toEqual([1, 2, 3, 4]);
    expect(lg.clubs.filter((c) => c.final).every((c) => c.tier === 0)).toBe(true);
    // Table money on Mondays, the cup bonus for the best of the cup ranking.
    expect(r.totals.some((t) => t.leagueMoney > 0)).toBe(true);
    expect(r.totals.reduce((s, t) => s + t.cupBonus, 0)).toBeGreaterThan(0);
    // The keeper is an own bot (a candidate for the next season).
    expect(r.ownEnd![0]!.length).toBeGreaterThanOrEqual(2);
  });
});
