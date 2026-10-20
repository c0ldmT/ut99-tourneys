/**
 * Unreal Dream Team economy: pure rules, no database. All Neuro amounts are reference values at
 * index 1.0 and are multiplied by the economy index (see `economyIndex`), so prices follow the
 * wealth that betting creates in a season.
 */

export type Bracket = 'weak' | 'mid' | 'strong';
export type PackBox = 'standard' | 'premium' | 'elite';
/** Rarity order: common, uncommon, rare, epic, legendary. */
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
export type Rarity = (typeof RARITIES)[number];

export interface PackConfig {
  price: number;
  /** Chances in percent per rarity (common … legendary), sum 100. */
  rates: readonly [number, number, number, number, number];
  /** An epic (or better) at the latest after this many boxes without one. */
  pityEpic: number;
  /** A legendary at the latest after this many boxes without one. */
  pityLegendary: number;
}

export interface EconomyConfig {
  /** Index 1.0 = this median net worth of the active managers. */
  indexRef: number;
  indexMin: number;
  indexMax: number;
  /** Largest change of the index per market day (fraction). */
  indexStep: number;
  /** Base value range per skill 0..7 at index 1.0: [weakest values, best values]. */
  skillValue: readonly (readonly [number, number])[];
  formMin: number;
  formMax: number;
  /** Largest demand surcharge or discount (fraction). */
  demandMax: number;
  /** Weekly salary in percent of the market value per bracket. */
  salaryRate: Readonly<Record<Bracket, number>>;
  /** Selling to the market pays this share of the market value. */
  sellBack: number;
  rewards: {
    game: number;
    win: number;
    mvp: number;
    /** Places 1, 2, 3/4 of an 8-team knockout. */
    places: readonly [number, number, number];
    /** Wins against teams of base bots only count this much. */
    baseBotWin: number;
    /** Place rewards when every opponent was a base-bot team. */
    soloPlaces: number;
  };
  /** Reward factor per team size (more bots invested). */
  formatFactor: Readonly<Record<number, number>>;
  stamina: { perGame: number; perDay: number; tiredBelow: number };
  packs: Readonly<Record<PackBox, PackConfig>>;
  /** A 10-pull costs this many boxes. */
  tenPullBoxes: number;
  scouting: number;
  /** Creation licenses of a season: the first is free, then these prices. */
  licenses: readonly number[];
}

export const DEFAULT_ECONOMY: EconomyConfig = {
  indexRef: 10_000,
  indexMin: 0.3,
  indexMax: 5,
  indexStep: 0.1,
  skillValue: [
    [300, 450],
    [450, 600],
    [700, 1000],
    [1200, 1800],
    [2500, 4000],
    [5000, 9000],
    [11_000, 16_000],
    [18_000, 28_000],
  ],
  formMin: 0.7,
  formMax: 1.4,
  demandMax: 0.15,
  salaryRate: { weak: 3, mid: 5, strong: 8 },
  sellBack: 0.85,
  // Doubled on 20.10. (owner: at least +50 %); the simulator keeps the index moderate up to
  // twice the rewards (about 1.7 at the season's end), beyond that it runs away (3.8 at 2.5x).
  rewards: {
    game: 120,
    win: 180,
    mvp: 80,
    places: [1200, 600, 300],
    baseBotWin: 0.5,
    soloPlaces: 0.3,
  },
  formatFactor: { 1: 1, 2: 1.5, 3: 2, 5: 3 },
  // 6 per game (was 15): a 4-team double elimination (up to 5 games) leaves a bot at 70.
  stamina: { perGame: 6, perDay: 30, tiredBelow: 40 },
  packs: {
    standard: { price: 1500, rates: [60, 25, 10, 4, 1], pityEpic: 10, pityLegendary: 50 },
    premium: { price: 4000, rates: [35, 35, 20, 8, 2], pityEpic: 7, pityLegendary: 30 },
    elite: { price: 10_000, rates: [0, 30, 40, 22, 8], pityEpic: 4, pityLegendary: 15 },
  },
  tenPullBoxes: 9,
  scouting: 1200,
  licenses: [0, 2000, 4000, 8000],
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Neuro amounts are shown and charged in steps of 10. */
export const roundNeuro = (n: number): number => Math.max(0, Math.round(n / 10) * 10);

/** Skill brackets (owner's experience): 0-3 weak, 4-5 middle, 6-7 strong. */
export function bracketOf(skill: number): Bracket {
  const s = Math.round(skill);
  if (s <= 3) return 'weak';
  if (s <= 5) return 'mid';
  return 'strong';
}

/** The card rarity of a bot follows its skill: 0-2 common … 7 legendary. */
export function botRarity(skill: number): Rarity {
  const s = Math.round(clamp(skill, 0, 7));
  if (s <= 2) return 'common';
  if (s === 3) return 'uncommon';
  if (s <= 5) return 'rare';
  if (s === 6) return 'epic';
  return 'legendary';
}

/**
 * Index of a market day: median net worth (balance + what the roster cost, not its market value,
 * which would feed the index back into itself) of the active managers over
 * `indexRef`, within [indexMin, indexMax] and at most `indexStep` away from the day before.
 */
export function economyIndex(
  netWorths: readonly number[],
  previous: number | undefined,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): number {
  const sorted = [...netWorths].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  let target = cfg.indexMin;
  if (sorted.length) {
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    target = median / cfg.indexRef;
  }
  target = clamp(target, cfg.indexMin, cfg.indexMax);
  if (previous === undefined) return round3(target);
  const lo = previous * (1 - cfg.indexStep);
  const hi = previous * (1 + cfg.indexStep);
  return round3(clamp(clamp(target, lo, hi), cfg.indexMin, cfg.indexMax));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Play-style values of the control center (-1..1; camping 0..1). */
export interface BotValues {
  accuracy?: number;
  alertness?: number;
  strafing?: number;
  combatStyle?: number;
  camping?: number;
}

/**
 * How good the values of a bot are, 0..1: accuracy counts most, then alertness and strafing.
 * Missing values count as average (0).
 */
export function valueScore(v: BotValues = {}): number {
  const n = (x: number | undefined) => (clamp(x ?? 0, -1, 1) + 1) / 2;
  return round3(0.45 * n(v.accuracy) + 0.3 * n(v.alertness) + 0.25 * n(v.strafing));
}

/** Base value at index 1.0: the skill's range, positioned by the value score (skill may be real). */
export function baseValue(
  skill: number,
  score: number,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): number {
  const s = clamp(skill, 0, cfg.skillValue.length - 1);
  const lo = Math.floor(s);
  const hi = Math.min(cfg.skillValue.length - 1, lo + 1);
  const at = (i: number) => {
    const [a, b] = cfg.skillValue[i]!;
    return a + (b - a) * clamp(score, 0, 1);
  };
  return at(lo) + (at(hi) - at(lo)) * (s - lo);
}

/** A bot's season so far (all its games, also in normal tournaments). */
export interface BotForm {
  games: number;
  wins: number;
  /** Rating change over the last games (rating points, 0 if unknown). */
  trend?: number;
}

/** Form factor: win rate and trend, pulled towards 1 while the bot played few games. */
export function formFactor(f: BotForm, cfg: EconomyConfig = DEFAULT_ECONOMY): number {
  if (f.games <= 0) return 1;
  const weight = f.games / (f.games + 6);
  const raw = 1 + (f.wins / f.games - 0.5) * 1.2 + clamp((f.trend ?? 0) / 400, -0.25, 0.25);
  return round3(clamp(1 + (raw - 1) * weight, cfg.formMin, cfg.formMax));
}

/** Demand: +5 % per bid of the last market day (up to 3), −5 % per day unsold on offer (up to 3). */
export function demandFactor(
  bids: number,
  daysUnsold: number,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): number {
  const d = 0.05 * Math.min(Math.max(bids, 0), 3) - 0.05 * Math.min(Math.max(daysUnsold, 0), 3);
  return round3(1 + clamp(d, -cfg.demandMax, cfg.demandMax));
}

/** Market value in Neuro: base × form × demand × index, in steps of 10. */
export function marketValue(base: number, form: number, demand: number, index: number): number {
  return roundNeuro(base * form * demand * index);
}

/** Weekly salary of a roster bot (the starter bot is free; the caller decides that). */
export function weeklySalary(
  value: number,
  skill: number,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): number {
  return roundNeuro((value * cfg.salaryRate[bracketOf(skill)]) / 100);
}

/** What selling a bot to the market pays. */
export function sellPrice(value: number, cfg: EconomyConfig = DEFAULT_ECONOMY): number {
  return roundNeuro(value * cfg.sellBack);
}

const factor = (teamSize: number, cfg: EconomyConfig) =>
  cfg.formatFactor[teamSize] ?? Math.max(1, teamSize * 0.6);

/** Reward of one match for a manager's team. */
export function matchReward(
  m: { won: boolean; mvp: boolean; teamSize: number; vsBaseBots: boolean },
  index: number,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): number {
  const r = cfg.rewards;
  let n = r.game + (m.mvp ? r.mvp : 0);
  if (m.won) n += r.win * (m.vsBaseBots ? r.baseBotWin : 1);
  return roundNeuro(n * factor(m.teamSize, cfg) * index);
}

/**
 * Place reward of a tournament (1 = champion, 2 = final, 3 = semifinal). Only human teams get one;
 * `onlyBaseBots` = every opponent was a base-bot team.
 */
export function placeReward(
  place: number,
  teamSize: number,
  index: number,
  onlyBaseBots: boolean,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): number {
  const p = cfg.rewards.places;
  const base = place === 1 ? p[0] : place === 2 ? p[1] : place <= 4 ? p[2] : 0;
  const solo = onlyBaseBots ? cfg.rewards.soloPlaces : 1;
  return roundNeuro(base * factor(teamSize, cfg) * index * solo);
}

/** Stamina after `games` UDT games. */
export function staminaAfterGames(stamina: number, games: number, cfg = DEFAULT_ECONOMY): number {
  return clamp(stamina - games * cfg.stamina.perGame, 0, 100);
}

/** Stamina after `days` of rest. */
export function staminaRecovered(stamina: number, days: number, cfg = DEFAULT_ECONOMY): number {
  return clamp(stamina + days * cfg.stamina.perDay, 0, 100);
}

/** A tired bot plays one step worse in accuracy (0 = fit). */
export const tiredPenalty = (stamina: number, cfg = DEFAULT_ECONOMY): number =>
  stamina < cfg.stamina.tiredBelow ? 1 : 0;

/** Price of a box or a 10-pull at the index. */
export function packPrice(box: PackBox, index: number, ten = false, cfg = DEFAULT_ECONOMY): number {
  return roundNeuro(cfg.packs[box].price * (ten ? cfg.tenPullBoxes : 1) * index);
}

/** Boxes opened since the last epic and since the last legendary (per box kind and season). */
export interface Pity {
  sinceEpic: number;
  sinceLegendary: number;
}

/**
 * One box: rarity by the box's chances, raised by the pity counters (`rng` returns 0..1).
 * Returns the rarity and the new counters.
 */
export function rollBox(
  box: PackBox,
  pity: Pity,
  rng: () => number,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): { rarity: Rarity; pity: Pity } {
  const p = cfg.packs[box];
  let i = 0;
  let roll = rng() * 100;
  for (; i < RARITIES.length - 1; i++) {
    roll -= p.rates[i]!;
    if (roll < 0) break;
  }
  if (pity.sinceLegendary + 1 >= p.pityLegendary) i = 4;
  else if (i < 3 && pity.sinceEpic + 1 >= p.pityEpic) i = 3;
  const rarity = RARITIES[i]!;
  return {
    rarity,
    pity: {
      sinceEpic: i >= 3 ? 0 : pity.sinceEpic + 1,
      sinceLegendary: i === 4 ? 0 : pity.sinceLegendary + 1,
    },
  };
}

/**
 * A 10-pull: ten boxes; standard guarantees a rare, premium an epic, elite an epic and rolls the
 * last box twice for a legendary.
 */
export function rollTen(
  box: PackBox,
  pity: Pity,
  rng: () => number,
  cfg: EconomyConfig = DEFAULT_ECONOMY,
): { rarities: Rarity[]; pity: Pity } {
  const out: Rarity[] = [];
  let cur = pity;
  for (let i = 0; i < 10; i++) {
    let r = rollBox(box, cur, rng, cfg);
    if (i === 9 && box === 'elite' && r.rarity !== 'legendary') {
      const again = rollBox(box, cur, rng, cfg);
      if (again.rarity === 'legendary') r = again;
    }
    out.push(r.rarity);
    cur = r.pity;
  }
  const min: Rarity = box === 'standard' ? 'rare' : 'epic';
  const rank = (r: Rarity) => RARITIES.indexOf(r);
  if (!out.some((r) => rank(r) >= rank(min))) {
    const worst = out.reduce((w, r, i) => (rank(r) < rank(out[w]!) ? i : w), 0);
    out[worst] = min;
    if (rank(min) >= 3) cur = { ...cur, sinceEpic: 0 };
  }
  return { rarities: out, pity: cur };
}
