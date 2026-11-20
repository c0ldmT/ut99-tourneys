/**
 * Unreal Dream Team prestige (plan Season 3 P3, concept section 2): an own bot at the end of its
 * development spends prestige points on small edges - the endgame is strength, not a skill
 * above Godlike. Pure rules; the API stores the points, the mod plays the edges (`bprs`).
 */
import { roundNeuro } from './economy.js';

/** The prestige menu: what a point buys (at most `PRESTIGE_STAT_MAX` per stat). */
export type PrestigeStat =
  'aim' | 'react' | 'dodge' | 'view' | 'tough' | 'fire' | 'armour' | 'sprint' | 'ammo';

/** In the order of the menu and of the mod's `bprs` line (one digit each). */
export const PRESTIGE_STATS: readonly PrestigeStat[] = [
  'aim',
  'react',
  'dodge',
  'view',
  'tough',
  'fire',
  'armour',
  'sprint',
  'ammo',
];

export const PRESTIGE_STAT_MAX = 3;

/**
 * What one point does (concept section 2, sizes by `bot:sim` at Inhuman against Inhuman, a point
 * about 4-7 % of the step to Godlike where the duel shows it): aim error −3 %, reaction time −6 %,
 * dodge chance +8 %, view +4° and turning +5 %, damage taken −3 %, damage dealt +3 %, +5 armour
 * at the spawn, +5 % speed on the way to items and on the retreat, +15 % ammo from pickups and
 * the start weapon. Reaction, view, sprint and ammo show on maps more than in a duel; armour a
 * little more in the duel (one life). Sets of the stages: mature 4 points ≈ 27 % of a step,
 * Godlike 6 ≈ 38 %, ascended with five stars 11 ≈ 60 %.
 */
export const PRESTIGE_EFFECT: Readonly<Record<PrestigeStat, number>> = {
  aim: 0.03,
  react: 0.06,
  dodge: 0.08,
  view: 0.05,
  tough: 0.03,
  fire: 0.03,
  armour: 5,
  sprint: 0.05,
  ammo: 0.15,
};

/** Degrees of view a point of `view` adds (besides turning +5 %). */
export const PRESTIGE_VIEW_DEGREES = 4;

/** A bot's prestige points per stat (missing: 0). */
export type PrestigeAlloc = Partial<Record<PrestigeStat, number>>;

/** The stages at the end of the development: mature (potential below Godlike reached), Godlike, ascended. */
export type PrestigeStage = 'mature' | 'godlike' | 'ascended';

/** Points a stage holds (stars come on top of `ascended`). */
export const PRESTIGE_CAP: Readonly<Record<PrestigeStage, number>> = {
  mature: 4,
  godlike: 6,
  ascended: 6,
};

/** Stars of an ascended bot (one prestige point each); Claudius' heir one more. */
export const MAX_STARS = 5;

/** An ascension needs this level (and Godlike with every value at 100). */
export const ASCEND_LEVEL = 30;

/** Left-over level points of a fully developed bot that make one prestige point. */
export const BANKED_PER_PRESTIGE = 2;

/**
 * The stage of an own bot (null: still developing): ascended once ascended, Godlike at skill 7,
 * mature at its potential below Godlike (a breakthrough may still come; the stage stays). Not
 * before level 5, when the potential shows exactly (`level` given).
 */
export function prestigeStage(b: {
  skill: number;
  potential: number;
  ascended?: boolean;
  level?: number;
}): PrestigeStage | null {
  if (b.level !== undefined && b.level < 5) return null;
  const s = Math.round(b.skill);
  if (s >= 7) return b.ascended ? 'ascended' : 'godlike';
  return s >= b.potential ? 'mature' : null;
}

/** How many points a bot can hold: its stage's cap plus its stars. */
export function prestigeCap(stage: PrestigeStage | null, stars = 0): number {
  if (!stage) return 0;
  return PRESTIGE_CAP[stage] + (stage === 'ascended' ? Math.max(0, stars) : 0);
}

export const maxStars = (claudius: boolean): number => MAX_STARS + (claudius ? 1 : 0);

/** Points spent on the menu. */
export const prestigeSpent = (a: PrestigeAlloc | null | undefined): number =>
  PRESTIGE_STATS.reduce((n, k) => n + (a?.[k] ?? 0), 0);

/** Prestige points from left-over level points (2 → 1; only a fully developed bot has them). */
export const bankedPrestige = (banked: number): number =>
  Math.floor(Math.max(0, banked) / BANKED_PER_PRESTIGE);

/**
 * The points a bot has: from left-over level points and bought ones, at most its cap. Bought
 * points never go over the cap (the API refuses), left-over ones above it are simply not used.
 */
export function prestigePoints(b: {
  stage: PrestigeStage | null;
  stars?: number;
  banked: number;
  bought: number;
}): { cap: number; points: number; fromLevels: number } {
  const cap = prestigeCap(b.stage, b.stars);
  const fromLevels = Math.min(cap, bankedPrestige(b.banked));
  return { cap, points: Math.min(cap, fromLevels + Math.max(0, b.bought)), fromLevels };
}

/** Why a point cannot go on a stat (null: it can). */
export function cannotAllocate(
  stat: PrestigeStat,
  alloc: PrestigeAlloc,
  points: number,
): 'free' | 'max' | null {
  if ((alloc[stat] ?? 0) >= PRESTIGE_STAT_MAX) return 'max';
  if (prestigeSpent(alloc) >= points) return 'free';
  return null;
}

/** An allocation as the API stores it: known stats, 0..3, nothing above `points` (cut from the end). */
export function cleanAlloc(a: unknown, points: number): PrestigeAlloc {
  const out: PrestigeAlloc = {};
  let left = Math.max(0, Math.floor(points));
  const src = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
  for (const k of PRESTIGE_STATS) {
    const v = Math.max(0, Math.min(PRESTIGE_STAT_MAX, Math.floor(Number(src[k]) || 0), left));
    if (v > 0) out[k] = v;
    left -= v;
  }
  return out;
}

/** The mod's `bprs` code: one digit per stat in `PRESTIGE_STATS` order ("" without points). */
export function prestigeCode(a: PrestigeAlloc | null | undefined): string {
  if (!prestigeSpent(a)) return '';
  return PRESTIGE_STATS.map((k) => String(Math.min(PRESTIGE_STAT_MAX, a?.[k] ?? 0))).join('');
}

export function prestigeFromCode(code: string | null | undefined): PrestigeAlloc {
  const out: PrestigeAlloc = {};
  if (!code) return out;
  PRESTIGE_STATS.forEach((k, i) => {
    const v = Number(code[i]);
    if (v > 0 && v <= PRESTIGE_STAT_MAX) out[k] = v;
  });
  return out;
}

// ---------- strength ----------

/**
 * A prestige point in the game model, as frags a minute (`botStrength`'s trait term): about
 * 6 % of a skill step (≈ 1.7 frags a minute; `bot:sim`) - a mature bot with 4 points ≈ ¼ step,
 * Godlike with 6 ≈ ⅓-0.4, ascended with 11 ≈ ⅔ (concept section 2: at most ¾).
 */
export const PRESTIGE_FRAGS = 0.1;

export const prestigeEffect = (points: number): number => Math.max(0, points) * PRESTIGE_FRAGS;

/** The same from a game's bot (`BotSpec.prestige`, the mod code). */
export const prestigeCodeEffect = (code: string | null | undefined): number =>
  prestigeEffect(prestigeSpent(prestigeFromCode(code)));

// ---------- prices (Neuro, luxury: the full index, progressive by what the team holds) ----------

export interface PrestigePrices {
  /** A bought point: base × growth^(prestige points the team holds). */
  pointBase: number;
  pointGrowth: number;
  /** Ascension: base × growth^(bots of the team ascended this season). */
  ascendBase: number;
  ascendGrowth: number;
  /** A star: base × growth^(stars of the team). */
  starBase: number;
  starGrowth: number;
  /** Reset of a bot's menu: per point set. */
  respecPerPoint: number;
}

export const PRESTIGE_PRICES: PrestigePrices = {
  pointBase: 300,
  pointGrowth: 1.08,
  ascendBase: 4000,
  ascendGrowth: 1.5,
  starBase: 1500,
  starGrowth: 1.25,
  respecPerPoint: 100,
};

const priced = (v: number, index: number) => roundNeuro(v * Math.max(0, index));

/** The next bought prestige point of a team that holds `teamPoints` points. */
export const prestigePointPrice = (
  teamPoints: number,
  index: number,
  p = PRESTIGE_PRICES,
): number => priced(p.pointBase * p.pointGrowth ** Math.max(0, teamPoints), index);

export const ascendPrice = (teamAscended: number, index: number, p = PRESTIGE_PRICES): number =>
  priced(p.ascendBase * p.ascendGrowth ** Math.max(0, teamAscended), index);

export const starPrice = (teamStars: number, index: number, p = PRESTIGE_PRICES): number =>
  priced(p.starBase * p.starGrowth ** Math.max(0, teamStars), index);

export const respecPrice = (spent: number, index: number, p = PRESTIGE_PRICES): number =>
  spent > 0 ? priced(p.respecPerPoint * spent, index) : 0;

/** Why a bot cannot ascend (null: it can). */
export function cannotAscend(b: {
  stage: PrestigeStage | null;
  level: number;
  fullyDeveloped: boolean;
}): 'done' | 'godlike' | 'level' | 'values' | null {
  if (b.stage === 'ascended') return 'done';
  if (b.stage !== 'godlike') return 'godlike';
  if (b.level < ASCEND_LEVEL) return 'level';
  if (!b.fullyDeveloped) return 'values';
  return null;
}
