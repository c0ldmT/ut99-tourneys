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

describe('potential window', () => {
  it('holds the potential, never below the skill, two steps until Godlike', async () => {
    const { potentialWindow } = await import('../src/index.js');
    for (const seed of ['a', 'b', 'c', 'd'])
      for (let skill = 0; skill <= 7; skill++)
        for (let p = skill; p <= 7; p++) {
          const [lo, hi] = potentialWindow(p, skill, seed);
          expect(lo).toBeGreaterThanOrEqual(skill);
          expect(lo).toBeLessThanOrEqual(p);
          expect(hi).toBeGreaterThanOrEqual(p);
          expect(hi).toBeLessThanOrEqual(7);
          expect(hi - lo).toBeLessThanOrEqual(1);
          if (p < 7) expect(hi - lo).toBe(1);
        }
    // An uncommon bot with potential 3 at skill 3 shows 3-4, not 2-4.
    for (const seed of ['a', 'b']) expect(potentialWindow(3, 3, seed)).toEqual([3, 4]);
    // Which side the potential is on depends on the bot, not on the potential.
    const sides = new Set(['a', 'b', 'c', 'd', 'e'].map((s) => potentialWindow(5, 3, s)[0]));
    expect([...sides].sort()).toEqual([4, 5]);
  });
});

describe('blueprints', () => {
  it("build skill 3 with the rarity's points for the values", async () => {
    const { cannotBuild, buildCost, BLUEPRINTS, blueprintRarity } = await import('../src/index.js');
    expect(cannotBuild('common', 3, {})).toBeNull();
    expect(cannotBuild('common', 4, {})).toBe('skill');
    // A lower skill would make the values cheap: blueprints always build skill 3.
    expect(cannotBuild('legendary', 2, {})).toBe('skill');
    expect(cannotBuild('common', 3, { accuracy: 1, alertness: 1, strafing: 1 })).toBe('budget');
    // A default starter plus 50 / 75 / 125 / 225 points.
    expect(
      [BLUEPRINTS.uncommon, BLUEPRINTS.rare, BLUEPRINTS.epic, BLUEPRINTS.legendary].map(
        (b) => b.budget,
      ),
    ).toEqual([1550, 1575, 1625, 1725]);
    // Not even a legendary one puts every value at 100.
    expect(buildCost(3, { accuracy: 1, alertness: 1, strafing: 1 })).toBeGreaterThan(
      BLUEPRINTS.legendary.budget,
    );
    expect(cannotBuild('rare', 3, { accuracy: 1, alertness: 1, strafing: 1 })).toBe('budget');
    expect(cannotBuild('rare', 3, { accuracy: 0.2, alertness: 0.2, strafing: 0.2 })).toBeNull();
    expect(BLUEPRINTS.legendary.startTrait).toBe('epic');
    // Packs bring them one rarity above the draw.
    expect(blueprintRarity('common')).toBe('uncommon');
    expect(blueprintRarity('epic')).toBe('legendary');
    expect(blueprintRarity('legendary')).toBe('legendary');
  });

  it("draws the potential from the rarity's range", async () => {
    const { blueprintPotential, BLUEPRINTS } = await import('../src/index.js');
    expect(BLUEPRINTS.uncommon.potential).toEqual([3, 4]);
    expect(BLUEPRINTS.rare.potential).toEqual([3, 5]);
    expect(BLUEPRINTS.epic.potential).toEqual([4, 6]);
    expect(BLUEPRINTS.legendary.potential).toEqual([6, 7]);
    for (const r of ['uncommon', 'rare', 'epic', 'legendary'] as const) {
      const seen = new Set<number>();
      for (let i = 0; i < 40; i++) seen.add(blueprintPotential(r, () => i / 40));
      seen.add(blueprintPotential(r, () => 0.999999));
      const [lo, hi] = BLUEPRINTS[r].potential;
      expect([...seen].sort()).toEqual(Array.from({ length: hi - lo + 1 }, (_, k) => lo + k));
    }
  });
});
