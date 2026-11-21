/**
 * Unreal Dream Team club house (concept section 8, decisions 264 and 266; plan
 * `claude/Plan-Vereinshaus-Scouting.md`): buildings a manager buys for a season (reset at the
 * season change), some in levels. Prices × the full index (luxury), each level dearer.
 */
import { roundNeuro } from './economy.js';

export type ClubUpgrade =
  | 'training'
  | 'physio'
  | 'scouting'
  | 'analysis'
  | 'boarding'
  | 'workshop'
  | 'fanshop'
  | 'mentor'
  | 'psych'
  | 'trophy';

/** In the order of the club house page. */
export const CLUB_UPGRADES: readonly ClubUpgrade[] = [
  'training',
  'physio',
  'scouting',
  'analysis',
  'boarding',
  'workshop',
  'fanshop',
  'mentor',
  'psych',
  'trophy',
];

/** Price of each level (× index); one level after the other. */
export const CLUB_LEVEL_PRICES: Readonly<Record<ClubUpgrade, readonly number[]>> = {
  training: [3000, 5000, 9000],
  physio: [2000, 3500, 6000],
  scouting: [1500, 3000, 5000],
  analysis: [2500],
  boarding: [5000],
  workshop: [3000],
  fanshop: [6000],
  mentor: [3000],
  psych: [3000],
  trophy: [2000],
};

export const clubMaxLevel = (kind: ClubUpgrade): number => CLUB_LEVEL_PRICES[kind].length;

/** The price of the next level (null: at the top). `level`: the level it has now (0: none). */
export function clubUpgradePrice(kind: ClubUpgrade, level: number, index: number): number | null {
  const p = CLUB_LEVEL_PRICES[kind][Math.max(0, level)];
  return p === undefined ? null : roundNeuro(p * Math.max(0, index));
}

/** What the fan shop pays (× index): each home league game played, each cup won. */
export const FANSHOP_PAYS = { home: 500, cupWin: 250 } as const;

/** Roster places (decision 266: the boarding school adds one for own bots below this level). */
export const ROSTER_PLACES = 7;
export const BOARDING_BELOW_LEVEL = 10;

export type ClubLevels = Partial<Record<ClubUpgrade, number>>;

export interface ClubEffects {
  /** Experience × (games, training camp). */
  xp: number;
  /** Rest price ×. */
  rest: number;
  /** Scouting price ×, half width of a value's range in a report, talents per report extra. */
  scout: number;
  spread: number;
  extraTalent: number;
  /** Chance of a talent's hidden trait (decision 267). */
  anlage: number;
  analysis: boolean;
  /** An 8th roster place for own bots below level 10. */
  boarding: boolean;
  /** Trait workshop and crafting ×. */
  workshop: number;
  craft: number;
  fanshop: boolean;
  /** Lessons per mentor and season. */
  mentorLessons: number;
  /** The cold form's accuracy (−10 without) and the stamina below which a bot is tired. */
  coldForm: number;
  tiredBelow: number;
  trophy: boolean;
}

/** The base talent hidden-trait chance (decision 267). */
export const ANLAGE_CHANCE = 0.3;

/** The effects of a club's buildings (levels; missing: none). */
export function clubEffects(levels: ClubLevels = {}): ClubEffects {
  const lv = (k: ClubUpgrade) => Math.max(0, Math.min(clubMaxLevel(k), levels[k] ?? 0));
  const t = lv('training');
  const p = lv('physio');
  const s = lv('scouting');
  return {
    xp: 1 + 0.05 * t,
    rest: 1 - 0.1 * p,
    scout: s > 0 ? 0.8 : 1,
    spread: s >= 2 ? 4 : 8,
    extraTalent: s >= 3 ? 1 : 0,
    anlage: s >= 3 ? 0.45 : ANLAGE_CHANCE,
    analysis: lv('analysis') > 0,
    boarding: lv('boarding') > 0,
    workshop: lv('workshop') > 0 ? 0.8 : 1,
    craft: lv('workshop') > 0 ? 0.9 : 1,
    fanshop: lv('fanshop') > 0,
    mentorLessons: lv('mentor') > 0 ? 2 : 1,
    coldForm: lv('psych') > 0 ? -5 : -10,
    tiredBelow: lv('psych') > 0 ? 30 : 40,
    trophy: lv('trophy') > 0,
  };
}

/** Crest of the trophy room: a shape and a colour (shown next to the team name). */
export const CREST_SHAPES = ['shield', 'round', 'diamond', 'star'] as const;
export const CREST_COLORS = [
  '#b26bff',
  '#22d3ee',
  '#f5c75e',
  '#4ade80',
  '#ff7a87',
  '#4f9dff',
  '#f0468c',
  '#e2e8f0',
] as const;
export interface Crest {
  shape: (typeof CREST_SHAPES)[number];
  color: (typeof CREST_COLORS)[number];
}
