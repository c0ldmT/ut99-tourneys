import { describe, expect, it } from 'vitest';
import {
  apprentice,
  cannotDevelop,
  developPoints,
  licencePrice,
  scoutPrice,
  scoutTalents,
  starterPotential,
  talentReport,
} from '../src/index.js';

const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length]!;
};

describe('academy', () => {
  it('scouts three different talents with a potential above their skill', () => {
    let s = 7;
    const rng = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 50; n++) {
      const t = scoutTalents(rng);
      expect(t).toHaveLength(3);
      expect(new Set(t.map((x) => x.name)).size).toBe(3);
      for (const x of t) {
        expect(x.skill).toBeGreaterThanOrEqual(1);
        expect(x.skill).toBeLessThanOrEqual(3);
        expect(x.potential).toBeGreaterThan(x.skill);
        expect(x.potential).toBeLessThanOrEqual(7);
        const r = talentReport(x, rng);
        expect(r.potential[0]).toBeLessThanOrEqual(x.potential);
        expect(r.potential[1]).toBeGreaterThanOrEqual(x.potential);
        expect(r.ranges.accuracy[1] - r.ranges.accuracy[0]).toBeLessThanOrEqual(16);
      }
    }
  });

  it('prices licences and scouting at the index', () => {
    expect(licencePrice(0, 1)).toBe(0);
    expect(licencePrice(1, 1)).toBe(2000);
    expect(licencePrice(3, 0.5)).toBe(4000);
    expect(licencePrice(4, 1)).toBeNull();
    expect(scoutPrice(2)).toBe(2400);
    expect(starterPotential(3)).toBe(5);
    expect(starterPotential(6)).toBe(7);
  });

  it('makes apprentices that lean towards the mentor', () => {
    const m = { skill: 6, values: { accuracy: 0.8, strafing: -0.5 }, traitCodes: ['eagle-eye'] };
    const a = apprentice(m, 'Pip', true, seq(0.1));
    expect(a).toMatchObject({ name: 'Pip', skill: 3, potential: 6, inherited: 'eagle-eye' });
    expect(a.values.accuracy).toBe(0.8);
    const b = apprentice(m, 'Pop', false, seq(0.9));
    expect(b.inherited).toBeNull();
    expect(b.values.accuracy).toBeGreaterThan(0.5);
  });

  it('develops with points up to the potential', () => {
    expect(developPoints(5, 1)).toBe(3);
    expect(developPoints(1, 0)).toBe(0);
    const bot = { skill: 3, potential: 4, values: { accuracy: 1 } };
    expect(cannotDevelop('skill', bot, 2)).toBe('points');
    expect(cannotDevelop('skill', bot, 3)).toBeNull();
    expect(cannotDevelop('skill', { ...bot, skill: 4 }, 3)).toBe('potential');
    expect(cannotDevelop('accuracy', bot, 1)).toBe('max');
    expect(cannotDevelop('strafing', bot, 1)).toBeNull();
  });
});

describe('blueprints', () => {
  it('limits skill and points by rarity', async () => {
    const { cannotBuild, buildCost, BLUEPRINTS } = await import('../src/index.js');
    expect(cannotBuild('common', 3, {})).toBeNull();
    expect(cannotBuild('common', 4, {})).toBe('skill');
    expect(cannotBuild('common', 3, { accuracy: 1, alertness: 1, strafing: 1 })).toBe('budget');
    expect(cannotBuild('epic', 5, {})).toBeNull();
    expect(buildCost(5, {})).toBeLessThanOrEqual(BLUEPRINTS.epic.budget);
    expect(BLUEPRINTS.legendary.startTrait).toBe('epic');
  });
});
