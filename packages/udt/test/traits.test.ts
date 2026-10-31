import { describe, expect, it } from 'vitest';
import {
  cannotAssign,
  craftCost,
  edgeScore,
  effectiveValues,
  gameEdge,
  NO_EDGE,
  levelOf,
  modCodes,
  managerEffects,
  rewardFactor,
  traitDef,
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
  it('raises strafing and camping; aim and perception traits leave the values alone', () => {
    const e = effectiveValues(3, { accuracy: 0.95, alertness: 0, strafing: 0.9 }, [
      { code: 'steady-hand' },
      { code: 'watchdog' },
      { code: 'side-stepper' },
      { code: 'patient-hunter' },
    ]);
    expect(e.values.accuracy).toBe(0.95);
    expect(e.values.alertness).toBe(0);
    expect(e.values.strafing).toBe(1);
    expect(e.values.camping).toBe(0.8);
    expect(e.skill).toBe(3);
  });

  it('turns values traits into edges on the skill curve', () => {
    expect(gameEdge([])).toEqual(NO_EDGE);
    const e = gameEdge([{ code: 'eagle-eye' }, { code: 'steady-hand' }, { code: 'watchdog' }]);
    expect(e.aim).toBeCloseTo(0.86 * 0.93);
    expect(e.react).toBeCloseTo(0.5);
    expect(e.view).toBe(40);
    expect(gameEdge([{ code: 'side-stepper' }]).dodge).toBe(2);
    // The market value moves as much as with the old value boosts (+15 accuracy).
    expect(edgeScore([{ code: 'eagle-eye' }])).toBeCloseTo(0.45 * 0.15);
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
    expect(traitOfRarity('epic', () => 0).code).toBe('watchdog');
    expect(traitOfRarity('epic', () => 0.99).code).toBe('item-controller');
    expect(traitOfRarity('legendary', () => 0).rarity).toBe('legendary');
    for (const r of ['common', 'uncommon', 'rare'] as const)
      expect(traitOfRarity(r, () => 0.99).rarity).toBe(r);
    // Review 31.10. (decision 236).
    expect(traitDef('watchdog')?.rarity).toBe('epic');
    expect(traitDef('starter-armour')?.rarity).toBe('rare');
    for (const c of ['berserker', 'revenant', 'daredevil'])
      expect(traitDef(c)?.rarity).toBe('uncommon');
  });

  it('crafting costs four times the scrap', () => {
    expect(craftCost('midas')).toBe(600);
    expect(craftCost('steady-hand')).toBe(20);
    expect(TRAITS.length).toBe(33);
  });

  it('gives the mod the game trait codes and values them', () => {
    expect(
      modCodes([
        { code: 'phoenix' },
        { code: 'watchdog' },
        { code: 'revenant' },
        { code: 'bouncer' },
      ]),
    ).toEqual(['px', 'wd', 'rg', 'bo']);
    expect(traitValueFactor(4, {}, [{ code: 'phoenix' }])).toBeCloseTo(1.2);
  });
});
