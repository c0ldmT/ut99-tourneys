import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ECONOMY,
  baseValue,
  botRarity,
  bracketOf,
  demandFactor,
  economyIndex,
  formFactor,
  marketValue,
  matchReward,
  packPrice,
  placeReward,
  rollBox,
  rollTen,
  sellPrice,
  staminaAfterGames,
  staminaRecovered,
  tiredPenalty,
  valueScore,
  weeklySalary,
} from '../src/index.js';

const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('economy index', () => {
  it('is the median net worth over the reference, clamped and slow', () => {
    expect(economyIndex([], undefined)).toBe(0.3);
    expect(economyIndex([1000, 1000, 1000], undefined)).toBe(0.3);
    expect(economyIndex([5000, 20_000, 18_000], undefined)).toBe(1.8);
    expect(economyIndex([5000, 20_000, 18_000, 100_000], undefined)).toBe(1.9);
    // At most 10 % per day.
    expect(economyIndex([50_000], 1)).toBe(1.1);
    expect(economyIndex([1000], 1)).toBe(0.9);
    expect(economyIndex([1_000_000], 5)).toBe(5);
  });
});

describe('market values', () => {
  it('follow skill brackets and values', () => {
    expect(bracketOf(3)).toBe('weak');
    expect(bracketOf(4)).toBe('mid');
    expect(bracketOf(5.4)).toBe('mid');
    expect(bracketOf(6)).toBe('strong');
    expect(botRarity(2)).toBe('common');
    expect(botRarity(3)).toBe('uncommon');
    expect(botRarity(5)).toBe('rare');
    expect(botRarity(6)).toBe('epic');
    expect(botRarity(7)).toBe('legendary');
    expect(valueScore({})).toBe(0.5);
    expect(valueScore({ accuracy: 1, alertness: 1, strafing: 1 })).toBe(1);
    expect(baseValue(7, 0)).toBe(18_000);
    expect(baseValue(7, 1)).toBe(28_000);
    expect(baseValue(6, 0.5)).toBe(13_500);
    // Real skill between two levels.
    expect(baseValue(6.5, 0)).toBe(14_500);
  });

  it('form, demand and index scale the value', () => {
    expect(formFactor({ games: 0, wins: 0 })).toBe(1);
    expect(formFactor({ games: 30, wins: 30 })).toBeCloseTo(1.4, 2);
    expect(formFactor({ games: 30, wins: 0 })).toBe(0.7);
    expect(formFactor({ games: 2, wins: 2 })).toBeLessThan(1.2);
    expect(demandFactor(5, 0)).toBe(1.15);
    expect(demandFactor(0, 2)).toBe(0.9);
    expect(marketValue(14_500, 1.1, 1.05, 1.84)).toBe(30_820);
    expect(sellPrice(1000)).toBe(850);
  });

  it('salaries rise with the bracket', () => {
    expect(weeklySalary(22_000, 7)).toBe(1760);
    expect(weeklySalary(7000, 5)).toBe(350);
    expect(weeklySalary(1500, 3)).toBe(50);
  });
});

describe('rewards and stamina', () => {
  it('pays games, wins, MVPs and places by format and index', () => {
    expect(matchReward({ won: true, mvp: true, teamSize: 1, vsBaseBots: false }, 1)).toBe(380);
    expect(matchReward({ won: true, mvp: false, teamSize: 1, vsBaseBots: true }, 1)).toBe(210);
    expect(matchReward({ won: false, mvp: false, teamSize: 5, vsBaseBots: false }, 2)).toBe(720);
    expect(placeReward(1, 1, 1, false)).toBe(1200);
    expect(placeReward(2, 2, 1, false)).toBe(900);
    expect(placeReward(3, 1, 1, false)).toBe(300);
    expect(placeReward(5, 1, 1, false)).toBe(0);
    expect(placeReward(1, 1, 1, true)).toBe(360);
  });

  it('tires bots and lets them rest', () => {
    expect(staminaAfterGames(100, 3)).toBe(82);
    expect(staminaAfterGames(15, 3)).toBe(0);
    expect(staminaRecovered(55, 1)).toBe(85);
    expect(staminaRecovered(90, 1)).toBe(100);
    expect(tiredPenalty(39)).toBe(1);
    expect(tiredPenalty(40)).toBe(0);
  });
});

describe('packs', () => {
  it('prices boxes and 10-pulls with the index', () => {
    expect(packPrice('premium', 1.84)).toBe(7360);
    expect(packPrice('premium', 1.84, true)).toBe(66_240);
    expect(packPrice('elite', 1)).toBe(DEFAULT_ECONOMY.packs.elite.price);
  });

  it('rolls by the chances and keeps the pity promises', () => {
    expect(rollBox('standard', { sinceEpic: 0, sinceLegendary: 0 }, seq([0.1])).rarity).toBe(
      'common',
    );
    expect(rollBox('standard', { sinceEpic: 0, sinceLegendary: 0 }, seq([0.995])).rarity).toBe(
      'legendary',
    );
    expect(rollBox('elite', { sinceEpic: 0, sinceLegendary: 0 }, seq([0])).rarity).toBe('uncommon');
    // Pity: the 10th standard box without an epic is epic, the 50th without a legendary legendary.
    expect(rollBox('standard', { sinceEpic: 9, sinceLegendary: 9 }, seq([0.1])).rarity).toBe(
      'epic',
    );
    const l = rollBox('standard', { sinceEpic: 3, sinceLegendary: 49 }, seq([0.1]));
    expect(l).toEqual({ rarity: 'legendary', pity: { sinceEpic: 0, sinceLegendary: 0 } });
    const c = rollBox('standard', { sinceEpic: 3, sinceLegendary: 7 }, seq([0.1]));
    expect(c.pity).toEqual({ sinceEpic: 4, sinceLegendary: 8 });
  });

  it('10-pulls guarantee their minimum', () => {
    const low = seq([0.1]);
    const s = rollTen('standard', { sinceEpic: 0, sinceLegendary: 0 }, low);
    expect(s.rarities).toHaveLength(10);
    // Ten commons in a row: the pity makes the 10th epic, which also covers the rare promise.
    expect(s.rarities.slice(0, 9).every((r) => r === 'common')).toBe(true);
    expect(s.rarities[9]).toBe('epic');
    const after = rollTen('standard', { sinceEpic: 0, sinceLegendary: 0 }, seq([0.1]), {
      ...DEFAULT_ECONOMY,
      packs: {
        ...DEFAULT_ECONOMY.packs,
        standard: { ...DEFAULT_ECONOMY.packs.standard, pityEpic: 99 },
      },
    });
    expect(after.rarities.filter((r) => r === 'rare')).toHaveLength(1);
    const p = rollTen('premium', { sinceEpic: 0, sinceLegendary: 0 }, seq([0.1]));
    expect(p.rarities.some((r) => r === 'epic' || r === 'legendary')).toBe(true);
  });
});
