import { describe, expect, it } from 'vitest';
import {
  cannotAssign,
  craftCost,
  effectiveValues,
  levelOf,
  modCodes,
  managerEffects,
  rewardFactor,
  traitOfRarity,
  traitSlots,
  traitValueFactor,
  TRAITS,
  xpForLevel,
} from '../src/index.js';

describe('levels and slots', () => {
  it('reaches level 5 after about 15 games and level 10 after about 50', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(5)).toBe(180);
    expect(xpForLevel(10)).toBe(630);
    expect(levelOf(0)).toBe(1);
    expect(levelOf(179)).toBe(4);
    expect(levelOf(180)).toBe(5);
    expect(levelOf(15 * 12.5)).toBe(5);
    expect(levelOf(50 * 12.5)).toBe(9);
    expect(levelOf(630)).toBe(10);
  });

  it('gives 1, 3 and 5 slots', () => {
    expect(traitSlots(1)).toBe(1);
    expect(traitSlots(4)).toBe(1);
    expect(traitSlots(5)).toBe(3);
    expect(traitSlots(10)).toBe(5);
  });

  it('checks slots, the same trait and one legendary per bot', () => {
    expect(cannotAssign('steady-hand', [], 1)).toBeNull();
    expect(cannotAssign('watchdog', ['steady-hand'], 1)).toBe('slots');
    expect(cannotAssign('steady-hand', ['steady-hand'], 10)).toBe('same');
    expect(cannotAssign('midas', ['claudius'], 10)).toBe('legendary');
    expect(cannotAssign('watchdog', ['claudius'], 5)).toBeNull();
    expect(cannotAssign('vampire', ['thick-skin'], 10)).toBe('body');
    expect(cannotAssign('vampire', ['watchdog'], 5)).toBeNull();
  });
});

describe('values traits', () => {
  it('raises the values on the 0..100 scale and clamps them', () => {
    const e = effectiveValues(3, { accuracy: 0.95, alertness: 0 }, [
      { code: 'steady-hand' },
      { code: 'watchdog' },
    ]);
    expect(e.values.accuracy).toBe(1);
    expect(e.values.alertness).toBe(0.2);
    expect(e.skill).toBe(3);
  });

  it('gives the gun nut its weapon and the bouncer its jumps', () => {
    const e = effectiveValues(2, {}, [
      { code: 'gun-nut', weapon: 'Botpack.ShockRifle' },
      { code: 'bouncer' },
    ]);
    expect(e.values.favoriteWeapon).toBe('Botpack.ShockRifle');
    expect(e.values.jumpy).toBe(true);
  });

  it("lets Claudius' heir add a skill step and overflow at Godlike", () => {
    expect(effectiveValues(5, {}, [{ code: 'claudius' }])).toMatchObject({
      skill: 6,
      overflow: false,
    });
    const g = effectiveValues(7, { accuracy: 0 }, [{ code: 'claudius' }]);
    expect(g).toMatchObject({ skill: 7, overflow: true });
    expect(g.values).toMatchObject({ accuracy: 1, alertness: 1, strafing: 1 });
  });

  it('values traits raise the market value', () => {
    expect(traitValueFactor(4, {}, [])).toBe(1);
    expect(traitValueFactor(4, {}, [{ code: 'eagle-eye' }])).toBeGreaterThan(1);
    expect(traitValueFactor(5, {}, [{ code: 'claudius' }])).toBeGreaterThan(1.5);
    expect(traitValueFactor(4, {}, [{ code: 'market-darling' }])).toBeCloseTo(1.15);
  });
});

describe('manager traits', () => {
  it('maps the traits to factors', () => {
    expect(managerEffects([{ code: 'penny-pincher' }, { code: 'iron-lung' }])).toMatchObject({
      salary: 0.7,
      fatigue: 0.6,
      recovery: 1,
    });
  });

  it('shares the crowd favourite by team size and adds Midas', () => {
    const fav = [{ code: 'crowd-favourite' as const }];
    expect(rewardFactor([fav], 1, [fav])).toBeCloseTo(1.25);
    expect(rewardFactor([fav, []], 2, [fav])).toBeCloseTo(1.125);
    expect(rewardFactor([[]], 1, [[{ code: 'midas' }]])).toBeCloseTo(1.1);
  });
});

describe('packs', () => {
  it('draws a trait of the rarity', () => {
    expect(traitOfRarity('epic', () => 0).code).toBe('all-rounder');
    expect(traitOfRarity('epic', () => 0.99).code).toBe('bounty-hunter');
    expect(traitOfRarity('legendary', () => 0).rarity).toBe('legendary');
    for (const r of ['common', 'uncommon', 'rare'] as const)
      expect(traitOfRarity(r, () => 0.99).rarity).toBe(r);
  });

  it('crafting costs four times the scrap', () => {
    expect(craftCost('midas')).toBe(600);
    expect(craftCost('steady-hand')).toBe(20);
    expect(TRAITS.length).toBe(29);
  });

  it('gives the mod the body trait codes and values them', () => {
    expect(modCodes([{ code: 'phoenix' }, { code: 'watchdog' }, { code: 'revenant' }])).toEqual([
      'px',
      'rg',
    ]);
    expect(traitValueFactor(4, {}, [{ code: 'phoenix' }])).toBeCloseTo(1.2);
  });
});
