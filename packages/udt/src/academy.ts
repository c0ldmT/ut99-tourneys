/**
 * Unreal Dream Team academy (phase 5): scouting talents, creation licences, mentors and
 * apprentices, developing a manager's own bots with points from their levels up to their
 * potential. Pure rules; the API stores the results.
 */
import { DEFAULT_ECONOMY, roundNeuro } from './economy.js';

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
  const lo = clamp(t.potential - Math.round(rng()), t.skill, 7);
  return {
    name: t.name,
    skill: t.skill,
    ranges: {
      accuracy: range(t.values.accuracy),
      alertness: range(t.values.alertness),
      strafing: range(t.values.strafing),
    },
    potential: [lo, Math.min(7, lo + 1)],
  };
}

/** Potential of a starter bot: two skill steps above (at most Godlike). */
export const starterPotential = (skill: number): number => Math.min(7, Math.round(skill) + 2);

/**
 * An apprentice of a mentor: skill three steps below the mentor (at least 1), potential the
 * mentor's skill; the values lean towards the mentor's (70 %, all of them with the mentor
 * trait); one of the mentor's traits is passed on by chance (25 %, 50 % with the mentor trait).
 */
export function apprentice(
  mentor: { skill: number; values: Partial<TalentValues>; traitCodes: readonly string[] },
  name: string,
  hasMentorTrait: boolean,
  rng: () => number,
): Talent & { inherited: string | null } {
  const lean = hasMentorTrait ? 1 : 0.7;
  const v = (m: number | undefined) =>
    r3(clamp(lean * (m ?? 0) + (1 - lean) * (rng() * 2 - 1) * 0.6, -1, 1));
  const passable = mentor.traitCodes.filter((c) => c !== 'mentor');
  const chance = hasMentorTrait ? 0.5 : 0.25;
  const inherited =
    passable.length && rng() < chance ? passable[Math.floor(rng() * passable.length)]! : null;
  const skill = Math.max(1, Math.round(mentor.skill) - 3);
  return {
    name,
    skill,
    values: {
      accuracy: v(mentor.values.accuracy),
      alertness: v(mentor.values.alertness),
      strafing: v(mentor.values.strafing),
      combatStyle: v(mentor.values.combatStyle),
      camping: r3(clamp(lean * (mentor.values.camping ?? 0) + (1 - lean) * rng() * 0.5, 0, 1)),
    },
    potential: Math.max(skill, Math.min(7, Math.round(mentor.skill))),
    inherited,
  };
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

/** Why a development step is not possible (null: it is). */
export function cannotDevelop(
  stat: DevelopStat,
  bot: { skill: number; potential: number; values: Partial<TalentValues> },
  points: number,
): 'points' | 'potential' | 'max' | null {
  if (points < DEVELOP_COST[stat]) return 'points';
  if (stat === 'skill') return Math.round(bot.skill) >= bot.potential ? 'potential' : null;
  return (bot.values[stat] ?? 0) >= 1 ? 'max' : null;
}

/** The value after a development step (+5 on the 0..100 scale). */
export const developValue = (v: number | undefined): number => r3(clamp((v ?? 0) + 0.1, -1, 1));
