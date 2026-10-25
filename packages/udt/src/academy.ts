/**
 * Unreal Dream Team academy (phase 5): scouting talents, creation licences, mentors and
 * apprentices, developing a manager's own bots with points from their levels up to their
 * potential. Pure rules; the API stores the results.
 */
import {
  baseValue,
  DEFAULT_ECONOMY,
  RARITIES,
  roundNeuro,
  valueScore,
  type Rarity,
} from './economy.js';

/** Play-style values of a talent (-1..1; camping 0..1). */
export interface TalentValues {
  accuracy: number;
  alertness: number;
  strafing: number;
  combatStyle: number;
  camping: number;
}

/** A scouted talent: what the scout report shows and what the bot really is. */
export interface Talent {
  name: string;
  skill: number;
  /** The real values; the report shows ranges around them. */
  values: TalentValues;
  /** Highest skill the bot can be developed to (hidden: the report shows a range). */
  potential: number;
}

export interface TalentReport {
  name: string;
  skill: number;
  /** 0..100 ranges as the scout saw them. */
  ranges: Record<'accuracy' | 'alertness' | 'strafing', [number, number]>;
  potential: [number, number];
}

/** Suggested names for talents (the manager can rename before signing). */
export const TALENT_NAMES = [
  'Ash',
  'Bolt',
  'Cinder',
  'Dash',
  'Echo',
  'Flint',
  'Gale',
  'Halo',
  'Ion',
  'Jinx',
  'Kestrel',
  'Lumen',
  'Mako',
  'Nova',
  'Onyx',
  'Pike',
  'Quill',
  'Rook',
  'Sable',
  'Talon',
  'Umbra',
  'Vex',
  'Wisp',
  'Xeno',
  'Yara',
  'Zephyr',
  'Argo',
  'Blaze',
  'Crux',
  'Drift',
  'Ember',
  'Fable',
  'Grit',
  'Hex',
  'Iris',
  'Jolt',
  'Karma',
  'Lynx',
  'Moth',
  'Nyx',
] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const pct = (v: number) => Math.round((clamp(v, -1, 1) + 1) * 50);

/** Weighted pick: weights per option. */
function pick<T>(options: readonly T[], weights: readonly number[], rng: () => number): T {
  const sum = weights.reduce((a, b) => a + b, 0);
  let x = rng() * sum;
  for (let i = 0; i < options.length; i++) {
    x -= weights[i]!;
    if (x < 0) return options[i]!;
  }
  return options[options.length - 1]!;
}

/**
 * Three talents of a scout: skill 1-3 (mostly low), values around average, potential 1-4 skill
 * steps above (higher steps rarer), at most Godlike.
 */
export function scoutTalents(rng: () => number, taken: readonly string[] = []): Talent[] {
  const names = TALENT_NAMES.filter((n) => !taken.includes(n));
  const out: Talent[] = [];
  for (let i = 0; i < 3; i++) {
    const skill = pick([1, 2, 3], [3, 4, 2], rng);
    const up = pick([1, 2, 3, 4], [30, 40, 22, 8], rng);
    const v = () => r3((rng() * 2 - 1) * 0.6);
    const name = names.length
      ? names.splice(Math.floor(rng() * names.length), 1)[0]!
      : `Talent${i + 1}`;
    out.push({
      name,
      skill,
      values: {
        accuracy: v(),
        alertness: v(),
        strafing: v(),
        combatStyle: v(),
        camping: r3(rng() * 0.5),
      },
      potential: Math.min(7, skill + up),
    });
  }
  return out;
}

/** What the scout report shows: values ±8 on the 0..100 scale, the potential ±1. */
export function talentReport(t: Talent, rng: () => number): TalentReport {
  const range = (v: number): [number, number] => {
    const c = pct(v) + Math.round((rng() * 2 - 1) * 4);
    return [clamp(c - 8, 0, 100), clamp(c + 8, 0, 100)];
  };
  return {
    name: t.name,
    skill: t.skill,
    ranges: {
      accuracy: range(t.values.accuracy),
      alertness: range(t.values.alertness),
      strafing: range(t.values.strafing),
    },
    potential: drawPotentialWindow(t.potential, t.skill, [t.skill, 7], rng),
  };
}

/**
 * A window of two skill steps that holds the potential, drawn at random (side not tied to
 * anything public) and kept inside `range` (the public range of the bot's origin, never below
 * its skill), so the window never tells more than the range. Stored with the bot: the roster
 * shows the same window as the scout report.
 */
export function drawPotentialWindow(
  potential: number,
  skill: number,
  range: readonly [number, number],
  rng: () => number,
): [number, number] {
  const s = Math.max(0, Math.min(7, Math.round(skill)));
  const p = Math.max(s, Math.min(7, potential));
  const fits = (lo: number, hi: number) => (w: [number, number]) => w[0] >= lo && w[1] <= hi;
  const all: [number, number][] = [
    [p - 1, p],
    [p, p + 1],
  ];
  const inRange = all.filter(fits(Math.max(s, range[0]), Math.min(7, range[1])));
  const pool = inRange.length ? inRange : all.filter(fits(s, 7));
  if (!pool.length) return [p, p];
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]!;
}

/** The stored window as the roster shows it: never below the skill reached since. */
export function shownWindow(window: readonly [number, number], skill: number): [number, number] {
  const lo = Math.max(window[0], Math.round(skill));
  return [lo, Math.max(window[1], lo)];
}

/**
 * What a manager sees of an own bot's potential before level 5: two skill steps that hold it,
 * never below the bot's skill (so a blueprint's range is not left); whether the potential is the
 * lower or the upper step is fixed per bot (`seed`, e.g. its id), so the range does not give it
 * away. From level 5 the roster shows the potential itself.
 */
export function potentialWindow(potential: number, skill: number, seed: string): [number, number] {
  const s = Math.max(0, Math.min(7, Math.round(skill)));
  const p = Math.max(s, Math.min(7, potential));
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  let lo = Math.max(s, p - (h % 2));
  let hi = lo + 1;
  if (hi > 7) {
    hi = 7;
    lo = Math.max(s, 6);
  }
  return [Math.min(lo, p), hi];
}

/** Every starter bot has skill 3, like the blueprints (a lower skill would make the values cheap). */
export const STARTER_SKILL = 3;

/** Potential of a starter bot: two skill steps above (at most Godlike). */
export const starterPotential = (skill: number): number => Math.min(7, Math.round(skill) + 2);

/** The chance that an apprentice inherits one of its mentor's traits (the mentor trait: 50 %). */
export const apprenticeTraitChance = (hasMentorTrait: boolean): number =>
  hasMentorTrait ? 0.5 : 0.25;

/** How far an apprentice moves towards its mentor: half the way, three quarters with the trait. */
export const mentorLean = (hasMentorTrait: boolean): number => (hasMentorTrait ? 0.75 : 0.5);

/**
 * What a bot the team made learns as the apprentice of a mentor (owner, 25.10.: a mentor takes
 * an existing own bot, no new bot): accuracy, alertness and strafing rise towards the mentor's in
 * steps of 5 (never down, never above the mentor), the play style (combat style, camping) moves
 * towards the mentor's. Skill and potential stay.
 */
export function mentorLesson(
  mentor: Partial<TalentValues>,
  pupil: Partial<TalentValues>,
  hasMentorTrait: boolean,
): TalentValues {
  const lean = mentorLean(hasMentorTrait);
  const up = (p = 0, m = 0) =>
    m <= p ? p : r3(clamp(p + Math.floor((m - p) * lean * 10 + 1e-9) / 10, -1, 1));
  const toward = (p = 0, m = 0, lo = -1) => r3(clamp(p + (m - p) * lean, lo, 1));
  return {
    accuracy: up(pupil.accuracy, mentor.accuracy),
    alertness: up(pupil.alertness, mentor.alertness),
    strafing: up(pupil.strafing, mentor.strafing),
    combatStyle: toward(pupil.combatStyle, mentor.combatStyle),
    camping: toward(pupil.camping, mentor.camping, 0),
  };
}

/** The mentor's trait an apprentice inherits by chance (not one it has, never the mentor trait). */
export function inheritedTrait(
  mentorTraits: readonly string[],
  pupilTraits: readonly string[],
  hasMentorTrait: boolean,
  rng: () => number,
): string | null {
  const passable = mentorTraits.filter((c) => c !== 'mentor' && !pupilTraits.includes(c));
  return passable.length && rng() < apprenticeTraitChance(hasMentorTrait)
    ? passable[Math.floor(rng() * passable.length)]!
    : null;
}

// ---------- licences ----------

/** Price of the next creation licence of a season (`made` bots so far, the starter is the first). */
export function licencePrice(made: number, index: number, cfg = DEFAULT_ECONOMY): number | null {
  const p = cfg.licenses[made];
  if (p === undefined) return null;
  return roundNeuro(p * index);
}

export const scoutPrice = (index: number, cfg = DEFAULT_ECONOMY): number =>
  roundNeuro(cfg.scouting * index);

// ---------- development ----------

export type DevelopStat = 'accuracy' | 'alertness' | 'strafing' | 'skill';

/** Points a level brings and what a step costs: +5 on a value for 1, a skill step for 3. */
export const DEVELOP_COST: Readonly<Record<DevelopStat, number>> = {
  accuracy: 1,
  alertness: 1,
  strafing: 1,
  skill: 3,
};

/** Development points of an own bot: one per level above 1, minus the spent ones. */
export const developPoints = (level: number, spent: number): number =>
  Math.max(0, level - 1 - spent);

/** The values development points raise. */
export const DEVELOP_VALUES = ['accuracy', 'alertness', 'strafing'] as const;

/** A value at 100 on the 0..100 scale (development ends there; "fully developed"). */
export const valueAtTop = (v: number | undefined): boolean => pct(v ?? 0) >= 100;

/** Why a development step is not possible (null: it is). */
export function cannotDevelop(
  stat: DevelopStat,
  bot: { skill: number; potential: number; values: Partial<TalentValues> },
  points: number,
): 'points' | 'potential' | 'max' | null {
  if (points < DEVELOP_COST[stat]) return 'points';
  if (stat === 'skill') return Math.round(bot.skill) >= bot.potential ? 'potential' : null;
  return valueAtTop(bot.values[stat]) ? 'max' : null;
}

/** The value after a development step (+5 on the 0..100 scale). */
export const developValue = (v: number | undefined): number => r3(clamp((v ?? 0) + 0.1, -1, 1));

// ---------- breakthrough ----------

/** A breakthrough needs this level (the potential shows exactly from level 5). */
export const BREAKTHROUGH_LEVEL = 10;

/**
 * A breakthrough needs every value at least this (0..100; owner, 23.10.: not 100). With the cut
 * the bot still comes out a bit stronger (duel simulator, 600 meetings: skill +1 with the values
 * cut from 60 to 40 wins 60-64 % against the old bot; from 100 to 65/75 55-57 %), and a starter
 * reaches it within a season of regular games instead of needing about level 40.
 */
export const BREAKTHROUGH_VALUE = 60;

/** A value high enough for a breakthrough. */
export const valueReady = (v: number | undefined): boolean => pct(v ?? 0) >= BREAKTHROUGH_VALUE;

export interface BreakthroughStep {
  /** Development points it costs. */
  cost: number;
  /** Share the three values lose (0..1, of the 0..100 scale). */
  cut: number;
}

/**
 * A breakthrough from `skill` to the next step (owner, 22.10.): dearer the higher it goes. The
 * cut keeps the bot a bit stronger than before (duel simulator, mod 0.15.0, all weapons: skill +1
 * with every value at 65 wins about 56 % against the old bot with all at 100 from 3 to 6, with
 * the values at 60 (`BREAKTHROUGH_VALUE`) cut to 40 about 60-64 %; Godlike and a step to skill 3
 * or below lose 25 %).
 */
export function breakthroughStep(skill: number): BreakthroughStep {
  const s = Math.round(skill);
  if (s >= 6) return { cost: 8, cut: 0.25 };
  if (s === 5) return { cost: 6, cut: 0.35 };
  if (s === 4) return { cost: 5, cut: 0.35 };
  if (s === 3) return { cost: 4, cut: 0.35 };
  return { cost: 3, cut: 0.25 };
}

export type BreakthroughBlock = 'done' | 'godlike' | 'potential' | 'level' | 'values' | 'points';

/**
 * Why an own bot cannot break through (null: it can): once per bot, below Godlike, the potential
 * reached, level 10, every value at 60 or more (`BREAKTHROUGH_VALUE`), the points.
 */
export function cannotBreakthrough(
  bot: {
    skill: number;
    potential: number;
    level: number;
    done: boolean;
    values: Partial<TalentValues>;
  },
  points: number,
): BreakthroughBlock | null {
  if (bot.done) return 'done';
  if (Math.round(bot.skill) >= 7) return 'godlike';
  if (Math.round(bot.skill) < bot.potential) return 'potential';
  if (bot.level < BREAKTHROUGH_LEVEL) return 'level';
  if (DEVELOP_VALUES.some((k) => !valueReady(bot.values[k]))) return 'values';
  if (points < breakthroughStep(bot.skill).cost) return 'points';
  return null;
}

/** The values after a breakthrough: each loses the step's share, in steps of 5 (0..100). */
export function breakthroughValues(
  skill: number,
  values: Partial<TalentValues>,
): Record<'accuracy' | 'alertness' | 'strafing', number> {
  const { cut } = breakthroughStep(skill);
  const one = (v: number | undefined) =>
    r3(clamp((Math.round((pct(v ?? 0) * (1 - cut)) / 5) * 5) / 50 - 1, -1, 1));
  return {
    accuracy: one(values.accuracy),
    alertness: one(values.alertness),
    strafing: one(values.strafing),
  };
}

// ---------- blueprints (from packs) ----------

export interface BlueprintRule {
  /** Points for the values at index 1.0, as the starter budget (base value). */
  budget: number;
  /** What the blueprint gives on top of a default starter (BLUEPRINT_BASE). */
  extra: number;
  /** The skill every blueprint builds (the points only go into the values). */
  skill: number;
  /** The potential is drawn from this range when the bot is built (hidden like a talent's). */
  potential: readonly [number, number];
  /** The bot class (model) can be chosen. */
  models: boolean;
  /** Signature blueprints: the bot starts with a trait of this rarity. */
  startTrait: 'rare' | 'epic' | null;
}

/** The points of a default starter bot (skill 3, average values): what blueprints add to. */
export const BLUEPRINT_BASE = 1500;

/** The skill blueprints build: a lower one would make the values cheap (a skill step is 3 points). */
export const BLUEPRINT_SKILL = 3;

const rule = (
  extra: number,
  r: Omit<BlueprintRule, 'budget' | 'extra' | 'skill'>,
): BlueprintRule => ({
  budget: BLUEPRINT_BASE + extra,
  extra,
  skill: BLUEPRINT_SKILL,
  ...r,
});

/**
 * Uncommon blank+, rare blueprint, epic and legendary signature blueprints (owner, 22.10.: a
 * default starter plus 50 / 75 / 125 / 225 points for the values, potential 3-4 / 3-5 / 4-6 /
 * 6-7; 300 extra let a rare one put every value at 100). All of them build skill 3. Packs bring
 * blueprints one rarity above the draw, so a common one only remains from before.
 */
export const BLUEPRINTS: Readonly<Record<Rarity, BlueprintRule>> = {
  common: rule(0, { potential: [3, 4], models: false, startTrait: null }),
  uncommon: rule(50, { potential: [3, 4], models: false, startTrait: null }),
  rare: rule(75, { potential: [3, 5], models: true, startTrait: null }),
  epic: rule(125, { potential: [4, 6], models: true, startTrait: 'rare' }),
  legendary: rule(225, { potential: [6, 7], models: true, startTrait: 'epic' }),
};

/** The potential of a bot built from a blueprint: any step of the rarity's range. */
export function blueprintPotential(rarity: Rarity, rng: () => number): number {
  const [lo, hi] = BLUEPRINTS[rarity].potential;
  return Math.min(hi, lo + Math.floor(rng() * (hi - lo + 1)));
}

/** Share of pack draws that bring a blueprint instead of a trait. */
export const BLUEPRINT_CHANCE = 0.12;

/** A blueprint drawn at a rarity is one rarity better (at most legendary). */
export function blueprintRarity(drawn: Rarity): Rarity {
  return RARITIES[Math.min(RARITIES.length - 1, RARITIES.indexOf(drawn) + 1)]!;
}
/** Unused blueprints a manager can keep per season; more turn into scrap. */
export const BLUEPRINTS_MAX = 3;

/** Points a build costs: the base value of skill and values (like the starter bot). */
export function buildCost(
  skill: number,
  values: { accuracy?: number; alertness?: number; strafing?: number },
): number {
  return Math.round(baseValue(skill, valueScore(values)));
}

/** Why a build from a blueprint is not possible (null: it is). */
export function cannotBuild(
  rarity: Rarity,
  skill: number,
  values: { accuracy?: number; alertness?: number; strafing?: number },
): 'skill' | 'budget' | null {
  const r = BLUEPRINTS[rarity];
  if (Math.round(skill) !== r.skill) return 'skill';
  if (buildCost(skill, values) > r.budget) return 'budget';
  return null;
}
