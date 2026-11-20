import { describe, expect, it } from 'vitest';
import {
  ascendPrice,
  bankedPrestige,
  botStrength,
  cannotAllocate,
  cannotAscend,
  cleanAlloc,
  clubEffects,
  clubUpgradePrice,
  talentReport,
  duelSeries,
  maxStars,
  prestigeCap,
  prestigeCode,
  prestigeCodeEffect,
  prestigeEdge,
  prestigeEffect,
  prestigeFromCode,
  prestigePointPrice,
  prestigePoints,
  prestigeStage,
  respecPrice,
  starPrice,
  NO_EDGE,
  SKILL_STRENGTH,
} from '../src/index.js';

describe('prestige (plan P3)', () => {
  it('knows the stage at the end of the development', () => {
    expect(prestigeStage({ skill: 4, potential: 5 })).toBeNull();
    // Not before level 5: the stage would tell the hidden potential.
    expect(prestigeStage({ skill: 5, potential: 5, level: 4 })).toBeNull();
    expect(prestigeStage({ skill: 5, potential: 5, level: 5 })).toBe('mature');
    expect(prestigeStage({ skill: 5, potential: 5 })).toBe('mature');
    // A breakthrough above the potential stays mature below Godlike.
    expect(prestigeStage({ skill: 6, potential: 5 })).toBe('mature');
    expect(prestigeStage({ skill: 7, potential: 6 })).toBe('godlike');
    expect(prestigeStage({ skill: 7, potential: 7, ascended: true })).toBe('ascended');
    expect(prestigeCap(null)).toBe(0);
    expect(prestigeCap('mature')).toBe(4);
    expect(prestigeCap('godlike', 3)).toBe(6);
    expect(prestigeCap('ascended', 5)).toBe(11);
    expect(maxStars(false)).toBe(5);
    expect(maxStars(true)).toBe(6);
  });

  it('turns left-over level points into prestige points, never above the cap', () => {
    expect(bankedPrestige(5)).toBe(2);
    expect(prestigePoints({ stage: 'mature', banked: 3, bought: 1 })).toEqual({
      cap: 4,
      points: 2,
      fromLevels: 1,
    });
    expect(prestigePoints({ stage: 'mature', banked: 20, bought: 2 }).points).toBe(4);
    expect(prestigePoints({ stage: null, banked: 20, bought: 0 }).points).toBe(0);
    expect(prestigePoints({ stage: 'ascended', stars: 2, banked: 0, bought: 8 }).points).toBe(8);
  });

  it('allocates at most 3 per stat and the points it has', () => {
    expect(cannotAllocate('aim', { aim: 3 }, 6)).toBe('max');
    expect(cannotAllocate('react', { aim: 3, dodge: 1 }, 4)).toBe('free');
    expect(cannotAllocate('react', { aim: 3 }, 4)).toBeNull();
    // Unknown stats, values above 3 and points above the bot's are cut.
    expect(cleanAlloc({ aim: 5, nope: 2, react: 2, ammo: 3 }, 4)).toEqual({ aim: 3, react: 1 });
    expect(cleanAlloc(null, 4)).toEqual({});
  });

  it('codes the menu for the mod (one digit per stat)', () => {
    expect(prestigeCode({})).toBe('');
    expect(prestigeCode({ aim: 2, ammo: 1 })).toBe('200000001');
    expect(prestigeFromCode('200000001')).toEqual({ aim: 2, ammo: 1 });
    expect(prestigeFromCode('9x0')).toEqual({});
    expect(prestigeCodeEffect('200000001')).toBeCloseTo(0.3);
    expect(prestigeCodeEffect(undefined)).toBe(0);
  });

  it('prices progressively by what the team holds, at the full index', () => {
    expect(prestigePointPrice(0, 1)).toBe(300);
    expect(prestigePointPrice(10, 1)).toBeGreaterThan(600);
    expect(prestigePointPrice(0, 2.7)).toBe(810);
    expect(ascendPrice(1, 1)).toBe(6000);
    expect(starPrice(0, 2)).toBe(3000);
    expect(respecPrice(0, 2)).toBe(0);
    expect(respecPrice(4, 1)).toBe(400);
  });

  it('lets only a fully developed Godlike of level 30 ascend', () => {
    expect(cannotAscend({ stage: 'mature', level: 40, fullyDeveloped: true })).toBe('godlike');
    expect(cannotAscend({ stage: 'godlike', level: 29, fullyDeveloped: true })).toBe('level');
    expect(cannotAscend({ stage: 'godlike', level: 30, fullyDeveloped: false })).toBe('values');
    expect(cannotAscend({ stage: 'godlike', level: 30, fullyDeveloped: true })).toBeNull();
    expect(cannotAscend({ stage: 'ascended', level: 30, fullyDeveloped: true })).toBe('done');
  });

  it('adds the edges and counts in the game model below a skill step', () => {
    const e = prestigeEdge(NO_EDGE, { aim: 3, react: 1, dodge: 2, view: 1 });
    expect(e.aim).toBeCloseTo(0.91);
    expect(e.react).toBeCloseTo(0.94);
    expect(e.dodge).toBeCloseTo(1.16);
    expect(e.view).toBe(4);
    expect(e.turn).toBeCloseTo(1.05);
    // Eleven points (ascended, five stars) stay below the next skill step.
    const full = botStrength(6, 0.5, prestigeEffect(11));
    expect(full).toBeGreaterThan(botStrength(6, 0.5));
    expect(full / botStrength(6, 0.5)).toBeLessThan(SKILL_STRENGTH[7]! / SKILL_STRENGTH[6]!);
  });

  it('club upgrades: prices at the full index, effects for the season (decision 264)', () => {
    expect(clubUpgradePrice('training', 2.7)).toBe(16200);
    expect(clubEffects([])).toEqual({ xp: 1, rest: 1, scout: 1, spread: 8 });
    expect(clubEffects(['training', 'physio', 'scouting'])).toEqual({
      xp: 1.1,
      rest: 0.8,
      scout: 0.75,
      spread: 4,
    });
    // The scouting office's report: value ranges 8 wide instead of 16.
    const t = {
      name: 'X',
      skill: 2,
      potential: 5,
      values: { accuracy: 0, alertness: 0, strafing: 0, combatStyle: 0, camping: 0 },
    };
    const r = talentReport(t, () => 0.5, 4);
    expect(r.ranges.accuracy).toEqual([46, 54]);
    expect(talentReport(t, () => 0.5).ranges.accuracy).toEqual([42, 58]);
  });

  it('makes a bot with prestige win more duels', () => {
    const o = { duels: 300, seed: 3 };
    const plain = duelSeries({ level: 6 }, { level: 6 }, o).winDecided;
    const pres = duelSeries(
      { level: 6, prestige: { aim: 3, dodge: 2, tough: 2, fire: 2, armour: 2 } },
      { level: 6 },
      o,
    ).winDecided;
    expect(pres).toBeGreaterThan(plain);
  });
});
