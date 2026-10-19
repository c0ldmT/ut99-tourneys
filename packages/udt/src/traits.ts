/**
 * Unreal Dream Team traits, phase 2: category A (play-style values, sent to the game as the bot's
 * effective values) and D (manager: economy and career on the website). Body (B) and behaviour
 * (C) traits need the mod and come later. Traits only work in Dream Team games and last one
 * season.
 */
import { baseValue, DEFAULT_ECONOMY, RARITIES, valueScore, type Rarity } from './economy.js';

export type TraitCategory = 'values' | 'manager';

export type TraitCode =
  | 'steady-hand'
  | 'watchdog'
  | 'side-stepper'
  | 'bouncer'
  | 'gun-nut'
  | 'daredevil'
  | 'patient-hunter'
  | 'eagle-eye'
  | 'all-rounder'
  | 'claudius'
  | 'quick-recovery'
  | 'iron-lung'
  | 'penny-pincher'
  | 'crowd-favourite'
  | 'market-darling'
  | 'training-champion'
  | 'midas';

export interface TraitDef {
  code: TraitCode;
  rarity: Rarity;
  category: TraitCategory;
  /** The trait needs a choice when it is put on a bot (gun nut: the weapon). */
  needsWeapon?: boolean;
}

/** The catalogue v1 (owner approved), phase 2 part: values and manager traits. */
export const TRAITS: readonly TraitDef[] = [
  { code: 'steady-hand', rarity: 'common', category: 'values' },
  { code: 'bouncer', rarity: 'common', category: 'values' },
  { code: 'watchdog', rarity: 'uncommon', category: 'values' },
  { code: 'side-stepper', rarity: 'uncommon', category: 'values' },
  { code: 'gun-nut', rarity: 'uncommon', category: 'values', needsWeapon: true },
  { code: 'daredevil', rarity: 'rare', category: 'values' },
  { code: 'patient-hunter', rarity: 'rare', category: 'values' },
  { code: 'eagle-eye', rarity: 'rare', category: 'values' },
  { code: 'all-rounder', rarity: 'epic', category: 'values' },
  { code: 'claudius', rarity: 'legendary', category: 'values' },
  { code: 'quick-recovery', rarity: 'common', category: 'manager' },
  { code: 'iron-lung', rarity: 'uncommon', category: 'manager' },
  { code: 'penny-pincher', rarity: 'uncommon', category: 'manager' },
  { code: 'crowd-favourite', rarity: 'rare', category: 'manager' },
  { code: 'market-darling', rarity: 'rare', category: 'manager' },
  { code: 'training-champion', rarity: 'rare', category: 'manager' },
  { code: 'midas', rarity: 'legendary', category: 'manager' },
];

const BY_CODE = new Map(TRAITS.map((t) => [t.code, t]));

export function traitDef(code: string): TraitDef | undefined {
  return BY_CODE.get(code as TraitCode);
}

export const isTraitCode = (code: string): code is TraitCode => BY_CODE.has(code as TraitCode);

/**
 * A pack draws a trait of the rolled rarity. Epic has a single trait in phase 2 and the rarities
 * without one of their own fall back to the next lower rarity that has traits.
 */
export function traitOfRarity(rarity: Rarity, rng: () => number): TraitDef {
  for (let i = RARITIES.indexOf(rarity); i >= 0; i--) {
    const pool = TRAITS.filter((t) => t.rarity === RARITIES[i]);
    if (pool.length) return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!;
  }
  return TRAITS[0]!;
}

// ---------- levels and slots ----------

/** Experience needed for a level: 5·(L−1)·(L+4) – level 5 after about 15 games, 10 after 50. */
export const xpForLevel = (level: number): number => 5 * (level - 1) * (level + 4);

export function levelOf(xp: number): number {
  let l = 1;
  while (l < 99 && xp >= xpForLevel(l + 1)) l++;
  return l;
}

/** Trait slots: 1, +2 from level 5, +2 from level 10 (at most 5). */
export const traitSlots = (level: number): number => (level >= 10 ? 5 : level >= 5 ? 3 : 1);

/** Why a trait cannot go on a bot (null: it can). */
export function cannotAssign(
  code: TraitCode,
  onBot: readonly TraitCode[],
  level: number,
): 'slots' | 'same' | 'legendary' | null {
  if (onBot.includes(code)) return 'same';
  if (onBot.length >= traitSlots(level)) return 'slots';
  if (
    traitDef(code)?.rarity === 'legendary' &&
    onBot.some((c) => traitDef(c)?.rarity === 'legendary')
  )
    return 'legendary';
  return null;
}

// ---------- scrap ----------

/** Scrap for a duplicate or a removed trait, by rarity; crafting costs four times as much. */
export const SCRAP: Readonly<Record<Rarity, number>> = {
  common: 5,
  uncommon: 10,
  rare: 25,
  epic: 60,
  legendary: 150,
};
export const CRAFT_FACTOR = 4;
export const craftCost = (code: TraitCode): number =>
  SCRAP[traitDef(code)?.rarity ?? 'common'] * CRAFT_FACTOR;

// ---------- category A: effective values ----------

export interface PlayValues {
  accuracy?: number;
  alertness?: number;
  strafing?: number;
  combatStyle?: number;
  camping?: number;
  jumpy?: boolean;
  favoriteWeapon?: string;
}

export interface TraitOnBot {
  code: TraitCode;
  /** Gun nut: the chosen weapon. */
  weapon?: string | null;
}

export interface Effective<T extends PlayValues> {
  skill: number;
  values: T;
  /** Claudius' heir on a Godlike bot: all values at the maximum, shown as "7+". */
  overflow: boolean;
}

/** Values are -1..1 (camping 0..1); "+5 %" on the 0..100 scale of the website is +0.1. */
const up = (v: number | undefined, points: number, lo = -1, hi = 1) =>
  Math.round(Math.min(hi, Math.max(lo, (v ?? 0) + points / 50)) * 1000) / 1000;

/**
 * The bot's skill and play-style values with its active traits (category A). Skill above
 * Godlike overflows: the values go to their maximum instead (owner's choice (b)).
 */
export function effectiveValues<T extends PlayValues>(
  skill: number,
  values: T,
  traits: readonly TraitOnBot[],
): Effective<T & PlayValues> {
  const v: T & PlayValues = { ...values };
  let s = skill;
  const has = (c: TraitCode) => traits.find((t) => t.code === c);
  if (has('steady-hand')) v.accuracy = up(v.accuracy, 5);
  if (has('watchdog')) v.alertness = up(v.alertness, 10);
  if (has('side-stepper')) v.strafing = up(v.strafing, 10);
  if (has('bouncer')) v.jumpy = true;
  const gun = has('gun-nut');
  if (gun?.weapon) v.favoriteWeapon = gun.weapon;
  if (has('daredevil')) v.combatStyle = up(v.combatStyle, 25);
  if (has('patient-hunter')) {
    v.camping = Math.max(v.camping ?? 0, 0.8);
    v.accuracy = up(v.accuracy, 8);
  }
  if (has('eagle-eye')) v.accuracy = up(v.accuracy, 15);
  if (has('all-rounder')) {
    v.accuracy = up(v.accuracy, 8);
    v.alertness = up(v.alertness, 8);
    v.strafing = up(v.strafing, 8);
  }
  let overflow = false;
  if (has('claudius')) {
    if (s + 1 > 7) {
      overflow = true;
      v.accuracy = 1;
      v.alertness = 1;
      v.strafing = 1;
    }
    s = Math.min(7, s + 1);
  }
  return { skill: s, values: v, overflow };
}

// ---------- category D: manager effects ----------

export interface ManagerEffects {
  /** Stamina recovered per day × this. */
  recovery: number;
  /** Stamina lost per game × this. */
  fatigue: number;
  salary: number;
  /** Rewards of the games this bot plays × this (its share of the team). */
  rewards: number;
  marketValue: number;
  xp: number;
  /** Midas: every Dream Team reward of the team × this while the bot is in the roster. */
  team: number;
}

export function managerEffects(traits: readonly TraitOnBot[]): ManagerEffects {
  const has = (c: TraitCode) => traits.some((t) => t.code === c);
  return {
    recovery: has('quick-recovery') ? 1.5 : 1,
    fatigue: has('iron-lung') ? 0.6 : 1,
    salary: has('penny-pincher') ? 0.7 : 1,
    rewards: has('crowd-favourite') ? 1.25 : 1,
    marketValue: has('market-darling') ? 1.15 : 1,
    xp: has('training-champion') ? 1.3 : 1,
    team: has('midas') ? 1.1 : 1,
  };
}

/**
 * How much the traits raise a bot's market value: its base value with the effective skill and
 * values (category A) over its own base value, times the market darling.
 */
export function traitValueFactor(
  skill: number,
  values: PlayValues,
  traits: readonly TraitOnBot[],
  cfg = DEFAULT_ECONOMY,
): number {
  if (!traits.length) return 1;
  const e = effectiveValues(skill, values, traits);
  const plain = baseValue(skill, valueScore(values), cfg);
  const eff = baseValue(e.skill, valueScore(e.values), cfg) * (e.overflow ? 1.1 : 1);
  return (plain > 0 ? eff / plain : 1) * managerEffects(traits).marketValue;
}

/**
 * Reward factor of a match for a lineup: crowd favourites raise their share (1/team size each),
 * Midas anywhere in the roster raises everything.
 */
export function rewardFactor(
  lineup: readonly (readonly TraitOnBot[])[],
  teamSize: number,
  roster: readonly (readonly TraitOnBot[])[],
): number {
  const share = lineup.reduce(
    (n, t) => n + (managerEffects(t).rewards - 1) / Math.max(1, teamSize),
    0,
  );
  const midas = roster.some((t) => t.some((x) => x.code === 'midas')) ? 1.1 : 1;
  return (1 + share) * midas;
}
