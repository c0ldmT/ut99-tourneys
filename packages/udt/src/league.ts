/**
 * Dream Team league (plan "Dream Team Liga", decisions L-E1-L-E18): pure logic without a
 * database - the fixture list (double round robin), the table, promotion, relegation and the
 * Pro Series final four, the rubber band of the AI clubs' strength, the AI clubs' own bots and
 * a simulated game between two clubs. The API (UdtLeagueService), the season simulator and the
 * league simulation script use it alike.
 */
import { SKILL_STRENGTH, botStrength, gameChance } from './model.js';
import { VALUE_WEIGHTS, type BotValues } from './economy.js';

// ---------- random numbers ----------

/** A small seeded generator (mulberry32) from a number or a string. */
export function leagueRng(seed: number | string): () => number {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffled<T>(l: readonly T[], rng: () => number): T[] {
  const a = [...l];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---------- fixture list ----------

/** League sizes (clubs per tier): even, 8-16 (L-E3). */
export const LEAGUE_SIZES = [8, 10, 12, 14, 16] as const;

export interface Pairing {
  home: string;
  away: string;
}

/** Matchdays of a season: 2·(N−1) (each club meets every other one at home and away). */
export const matchdaysOf = (size: number): number => 2 * (size - 1);

/**
 * The fixture list of a tier: a double round robin by Berger tables (circle method) over the
 * clubs in a seeded order; each round's sides alternate, the second half repeats the first with
 * home and away swapped. Every club plays every other one twice, once at home.
 */
export function schedule(clubs: readonly string[], seed: number | string): Pairing[][] {
  const n = clubs.length;
  if (n < 2 || n % 2) throw new Error(`a league needs an even number of clubs, not ${n}`);
  const order = shuffled(clubs, leagueRng(seed));
  const m = n - 1;
  const first: Pairing[][] = [];
  for (let k = 0; k < m; k++) {
    // The last club is fixed and changes sides every round; the others turn around it, the
    // side by their distance (no club plays more than twice in a row at home or away).
    const round: Pairing[] = [
      k % 2 === 0 ? { home: order[k]!, away: order[m]! } : { home: order[m]!, away: order[k]! },
    ];
    for (let i = 1; i < n / 2; i++) {
      const a = order[(k + i) % m]!;
      const b = order[(k - i + m) % m]!;
      round.push(i % 2 === 1 ? { home: a, away: b } : { home: b, away: a });
    }
    first.push(round);
  }
  return [...first, ...first.map((rd) => rd.map((p) => ({ home: p.away, away: p.home })))];
}

// ---------- table ----------

/** Points of a game (L-E1): a win 2 (also after overtime), a loss after overtime 1, else 0. */
export const LEAGUE_POINTS = { win: 2, otWin: 2, otLoss: 1, loss: 0 } as const;

/** A decided league game between two clubs. */
export interface LeagueResult {
  home: string;
  away: string;
  homeFrags: number;
  awayFrags: number;
  /** Decided in the overtime (sudden death). */
  overtime: boolean;
  /** The winner (the higher frags; an overtime game has one too). */
  winner: string;
}

export type FormMark = 'W' | 'OW' | 'OL' | 'L';

export interface TableRow {
  club: string;
  place: number;
  played: number;
  won: number;
  wonOt: number;
  lostOt: number;
  lost: number;
  fragsFor: number;
  fragsAgainst: number;
  points: number;
  /** The last five games, newest last. */
  form: FormMark[];
}

/**
 * The table of a tier from its decided games (in the order they were played): points, then frag
 * difference, frags, the games between the tied clubs (points), then a seeded lot.
 */
export function standings(
  clubs: readonly string[],
  results: readonly LeagueResult[],
  seed: number | string = 0,
): TableRow[] {
  const rows = new Map<string, TableRow>(
    clubs.map((c) => [
      c,
      {
        club: c,
        place: 0,
        played: 0,
        won: 0,
        wonOt: 0,
        lostOt: 0,
        lost: 0,
        fragsFor: 0,
        fragsAgainst: 0,
        points: 0,
        form: [],
      },
    ]),
  );
  for (const g of results) {
    for (const [club, ff, fa] of [
      [g.home, g.homeFrags, g.awayFrags],
      [g.away, g.awayFrags, g.homeFrags],
    ] as const) {
      const r = rows.get(club);
      if (!r) continue;
      const won = g.winner === club;
      r.played++;
      r.fragsFor += ff;
      r.fragsAgainst += fa;
      if (won && g.overtime) {
        r.wonOt++;
        r.points += LEAGUE_POINTS.otWin;
      } else if (won) {
        r.won++;
        r.points += LEAGUE_POINTS.win;
      } else if (g.overtime) {
        r.lostOt++;
        r.points += LEAGUE_POINTS.otLoss;
      } else {
        r.lost++;
        r.points += LEAGUE_POINTS.loss;
      }
      r.form = [
        ...r.form,
        (won ? (g.overtime ? 'OW' : 'W') : g.overtime ? 'OL' : 'L') as FormMark,
      ].slice(-5);
    }
  }
  const lot = new Map(shuffled(clubs, leagueRng(seed)).map((c, i) => [c, i]));
  const headToHead = (a: string, b: string): number => {
    let pa = 0;
    let pb = 0;
    for (const g of results) {
      if (!((g.home === a && g.away === b) || (g.home === b && g.away === a))) continue;
      const pts = (club: string) =>
        g.winner === club ? LEAGUE_POINTS.win : g.overtime ? LEAGUE_POINTS.otLoss : 0;
      pa += pts(a);
      pb += pts(b);
    }
    return pb - pa;
  };
  const list = [...rows.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.fragsFor - b.fragsAgainst - (a.fragsFor - a.fragsAgainst) ||
      b.fragsFor - a.fragsFor ||
      headToHead(a.club, b.club) ||
      lot.get(a.club)! - lot.get(b.club)!,
  );
  list.forEach((r, i) => (r.place = i + 1));
  return list;
}

// ---------- promotion, relegation, final four ----------

/** Clubs that go up and down directly per tier boundary. */
export const DIRECT_MOVES = 2;
/** At most this many relegation pairings per tier boundary (L-E: places 3-6 against N-2 ... N-5). */
export const RELEGATION_PAIRS = 4;
/** Places of the Pro Series that play the final four. */
export const FINAL_FOUR = 4;

/**
 * How many relegation pairings each tier boundary has (index t: between tier t−1 and t; index 0
 * unused): places 3, 4, ... of the lower tier against N−2, N−3, ... of the upper one, at most 4,
 * never touching the upper tier's final four (Pro) or its own direct promotion and relegation
 * places (smaller leagues have fewer pairings: 8 clubs → 2).
 */
export function relegationPairs(tiers: number, size: number): number[] {
  const out = [0];
  let upperUp = 0; // the upper tier's relegation places as the lower side (3 .. 3+upperUp-1)
  for (let t = 1; t < tiers; t++) {
    const protectedTop = t === 1 ? FINAL_FOUR : DIRECT_MOVES + upperUp;
    const r = Math.max(0, Math.min(RELEGATION_PAIRS, size - DIRECT_MOVES - protectedTop));
    out.push(r);
    upperUp = r;
  }
  return out;
}

export interface RelegationTie {
  /** The boundary: between tier `tier − 1` (upper) and `tier` (lower). */
  tier: number;
  /** The upper tier's club (home, keeps its tier on a draw of the fallback). */
  upper: string;
  upperPlace: number;
  lower: string;
  lowerPlace: number;
}

/**
 * The season's end of the tables (tier 0 = Pro Series): who goes up and down directly and the
 * relegation ties (best of three; the winner plays in the upper tier next season).
 */
export function promotion(tables: readonly (readonly TableRow[])[]): {
  up: { club: string; from: number }[];
  down: { club: string; from: number }[];
  relegation: RelegationTie[];
} {
  const size = tables[0]?.length ?? 0;
  const pairs = relegationPairs(tables.length, size);
  const up: { club: string; from: number }[] = [];
  const down: { club: string; from: number }[] = [];
  const relegation: RelegationTie[] = [];
  for (let t = 1; t < tables.length; t++) {
    const upper = tables[t - 1]!;
    const lower = tables[t]!;
    const n = upper.length;
    for (let i = 0; i < DIRECT_MOVES; i++) {
      up.push({ club: lower[i]!.club, from: t });
      down.push({ club: upper[n - 1 - i]!.club, from: t - 1 });
    }
    for (let i = 0; i < pairs[t]!; i++) {
      const u = upper[n - DIRECT_MOVES - 1 - i]!;
      const l = lower[DIRECT_MOVES + i]!;
      relegation.push({
        tier: t,
        upper: u.club,
        upperPlace: u.place,
        lower: l.club,
        lowerPlace: l.place,
      });
    }
  }
  return { up, down, relegation };
}

/** The next season's tier of every club after the moves and the relegation ties' winners. */
export function nextTiers(
  tables: readonly (readonly TableRow[])[],
  /** The winner of each relegation tie, by the tie's upper club (missing: the upper club). */
  relegationWinners: ReadonlyMap<string, string>,
): Map<string, number> {
  const out = new Map<string, number>();
  tables.forEach((tb, t) => tb.forEach((r) => out.set(r.club, t)));
  const p = promotion(tables);
  for (const m of p.up) out.set(m.club, m.from - 1);
  for (const m of p.down) out.set(m.club, m.from + 1);
  for (const tie of p.relegation) {
    const w = relegationWinners.get(tie.upper) ?? tie.upper;
    out.set(tie.upper, w === tie.upper ? tie.tier - 1 : tie.tier);
    out.set(tie.lower, w === tie.lower ? tie.tier - 1 : tie.tier);
  }
  return out;
}

/** The Pro Series final four: semi-finals 1 v 4 and 2 v 3 (best of three each). */
export function finalFour(pro: readonly TableRow[]): [Pairing, Pairing] {
  const c = (place: number) => pro[place - 1]!.club;
  return [
    { home: c(1), away: c(4) },
    { home: c(2), away: c(3) },
  ];
}

/** Wins a best of `games` needs. */
export const winsNeeded = (games = 3): number => Math.floor(games / 2) + 1;

// ---------- AI clubs ----------

export interface RubberBand {
  /** Per tier: the AI clubs' strength relative to the median lineup of the tier's managers. */
  factors: readonly number[];
  /** A tier without managers: this share of the tier above (Pro without managers: all managers). */
  emptyTier: number;
  /** Per tier: the least strength of an AI club's lineup (sum of its five bots). */
  floors: readonly number[];
}

export const DEFAULT_RUBBER_BAND: RubberBand = {
  factors: [1, 1, 1, 1],
  emptyTier: 0.75,
  // Five bots of skill 2 / 1.5 / 1 / 1 with average values (the start of a season).
  floors: [8, 7, 5, 5],
};

const medianOf = (l: readonly number[]): number => {
  const s = [...l].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/**
 * The strength of an average AI club per tier (L-E6, "rubber band"), renewed every league
 * evening: the median lineup strength of the tier's managers × the tier's factor; a tier without
 * managers takes `emptyTier` of the tier above (the Pro Series: of all managers); at least the
 * tier's floor. (The league simulation of 25.10. with the export: the managers of the tier and
 * every evening keep their wins against AI clubs at 51 % in both halves; the median of all
 * managers renewed weekly gave 65 % / 58 %.)
 */
export function rubberBands(
  sides: readonly { tier: number; strength: number }[],
  tiers: number,
  cfg: RubberBand = DEFAULT_RUBBER_BAND,
): number[] {
  const out: number[] = [];
  const all = sides.map((x) => x.strength);
  for (let t = 0; t < tiers; t++) {
    const mine = sides.filter((x) => x.tier === t).map((x) => x.strength);
    const factor = cfg.factors[Math.min(t, cfg.factors.length - 1)] ?? 1;
    const floor = cfg.floors[Math.min(t, cfg.floors.length - 1)] ?? 0;
    const base = mine.length
      ? medianOf(mine) * factor
      : t === 0
        ? all.length
          ? medianOf(all) * factor
          : 0
        : out[t - 1]! * cfg.emptyTier;
    out.push(Math.max(floor, base));
  }
  return out;
}

/**
 * Spread of the AI clubs around the tier's strength: each club gets a fixed factor from its seed
 * (0.8-1.2), so the table has favourites and outsiders.
 */
export function clubFactor(seed: string, spread = 0.2): number {
  return 1 + spread * (2 * leagueRng(`factor:${seed}`)() - 1);
}

/** A league bot of an AI club: never a library bot (R4), never on the market. */
export interface LeagueBotSpec {
  name: string;
  skill: number;
  traits: BotValues;
  /** One of the stock classes (the API picks model and skin from the class profiles). */
  botClass: string;
}

/** Play styles of AI clubs: how the value score is split over the values. */
const PROFILES: readonly {
  accuracy: number;
  alertness: number;
  strafing: number;
  combatStyle: number;
  camping: number;
}[] = [
  { accuracy: 0.15, alertness: -0.1, strafing: -0.15, combatStyle: 0, camping: 0.1 }, // sharpshooters
  { accuracy: -0.1, alertness: 0.2, strafing: 0.05, combatStyle: 0.4, camping: 0 }, // stormers
  { accuracy: 0, alertness: 0, strafing: 0, combatStyle: 0, camping: 0 }, // all-rounders
  { accuracy: -0.05, alertness: -0.1, strafing: 0.25, combatStyle: -0.2, camping: 0 }, // dancers
  { accuracy: 0.05, alertness: 0.1, strafing: -0.2, combatStyle: -0.4, camping: 0.6 }, // campers
];

const SYLLABLES = [
  'ka',
  'ro',
  'vex',
  'tal',
  'mir',
  'dun',
  'zo',
  'rak',
  'el',
  'tor',
  'qui',
  'sar',
  'bel',
  'non',
  'gri',
  'fa',
  'lum',
  'dra',
  'kes',
  'ny',
  'vor',
  'ash',
  'pel',
  'ur',
  'zan',
  'mo',
  'thi',
  'ga',
];

/** A bot name from the club's seed: two or three syllables, capitalised (ASCII, ≤ 10 signs). */
export function leagueBotName(seed: string, i: number): string {
  const rng = leagueRng(`name:${seed}:${i}`);
  const n = 2 + Math.floor(rng() * 2);
  let s = '';
  for (let k = 0; k < n; k++) s += SYLLABLES[Math.floor(rng() * SYLLABLES.length)]!;
  s = s.slice(0, 10);
  return s[0]!.toUpperCase() + s.slice(1);
}

const CLASSES = [
  'BotPack.TMale1Bot',
  'BotPack.TMale2Bot',
  'BotPack.TFemale1Bot',
  'BotPack.TFemale2Bot',
  'BotPack.TBossBot',
];

/** Skill and value score of one bot for a target strength (the inverse of `botStrength`). */
export function botFor(strength: number): { skill: number; score: number } {
  let skill = 0;
  for (let k = SKILL_STRENGTH.length - 1; k >= 0; k--)
    if (SKILL_STRENGTH[k]! * 0.85 <= strength) {
      skill = k;
      break;
    }
  const score = Math.max(0, Math.min(1, (strength / SKILL_STRENGTH[skill]! - 0.85) / 0.3));
  return { skill, score };
}

/** Values (-1..1) for a value score in a play style: the weighted mean stays the score. */
function valuesFor(score: number, p: (typeof PROFILES)[number]): BotValues {
  const base = 2 * score - 1;
  const c = (x: number) => Math.max(-1, Math.min(1, x));
  let v = {
    accuracy: c(base + p.accuracy),
    alertness: c(base + p.alertness),
    strafing: c(base + p.strafing),
  };
  // Clamping moves the weighted mean: shift all three until it is the score again.
  for (let i = 0; i < 6; i++) {
    const mean =
      VALUE_WEIGHTS.accuracy * v.accuracy +
      VALUE_WEIGHTS.alertness * v.alertness +
      VALUE_WEIGHTS.strafing * v.strafing;
    const diff = base - mean;
    if (Math.abs(diff) < 1e-3) break;
    v = {
      accuracy: c(v.accuracy + diff),
      alertness: c(v.alertness + diff),
      strafing: c(v.strafing + diff),
    };
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    accuracy: r2(v.accuracy),
    alertness: r2(v.alertness),
    strafing: r2(v.strafing),
    combatStyle: r2(p.combatStyle),
    camping: r2(Math.max(0, p.camping)),
  };
}

/**
 * The five (team size) bots of an AI club for a lineup strength (sum of the bots' strengths,
 * the rubber band × the club's factor). Names, models and the play style come from the club's
 * seed and stay all season; skill and values follow the strength (new every market week).
 */
export function leagueBots(seed: string, strength: number, teamSize = 5): LeagueBotSpec[] {
  const rng = leagueRng(`bots:${seed}`);
  const profile = PROFILES[Math.floor(rng() * PROFILES.length)]!;
  // A star, solid players and a weaker one: shares around the mean that add up to the team size.
  const raw = Array.from(
    { length: teamSize },
    (_, i) => 1 + 0.3 * (1 - (2 * i) / Math.max(1, teamSize - 1)) * (0.6 + 0.4 * rng()),
  );
  const sumRaw = raw.reduce((a, b) => a + b, 0);
  const shares = raw.map((x) => (x * teamSize) / sumRaw);
  const per = strength / teamSize;
  let targets = shares.map((s) => per * s);
  // Strengths outside what bots can reach are clamped; the rest is spread over the others.
  const lo = SKILL_STRENGTH[0]! * 0.85;
  const hi = SKILL_STRENGTH[SKILL_STRENGTH.length - 1]! * 1.15;
  for (let i = 0; i < 3; i++) {
    const clamped = targets.map((t) => Math.max(lo, Math.min(hi, t)));
    const missing = strength - clamped.reduce((a, b) => a + b, 0);
    const free = clamped.filter((t) => (missing > 0 ? t < hi : t > lo)).length;
    targets = clamped.map((t) =>
      (missing > 0 ? t < hi : t > lo) && free ? t + missing / free : t,
    );
  }
  const classes = shuffled(CLASSES, rng);
  return targets.map((t, i) => {
    const { skill, score } = botFor(Math.max(lo, Math.min(hi, t)));
    return {
      name: leagueBotName(seed, i),
      skill,
      traits: valuesFor(score, profile),
      botClass: classes[i % classes.length]!,
    };
  });
}

/** Strength of a lineup of specs (the model's sum). */
export function lineupStrength(bots: readonly { skill: number; score: number }[]): number {
  return bots.reduce((s, b) => s + botStrength(b.skill, b.score), 0);
}

// ---------- simulated games ----------

/** League rules (L-E16): team frag limit and time limit of a 5v5 league game. */
export const LEAGUE_RULES = { fragLimit: 50, timeLimitMin: 15 } as const;

/** Chance that a game between two clubs of equal strength goes into the overtime. */
export const OVERTIME_EVEN = 0.03;

/**
 * A simulated game (AI against AI; the calibrated model of `model.ts`): the winner by the chance
 * of the strengths, frags that fit the result (the winner reaches the limit, the loser gets
 * closer the closer the strengths are), now and then an overtime between equal clubs.
 */
export function simulateGame(
  home: { club: string; strength: number },
  away: { club: string; strength: number },
  rng: () => number,
  teamSize = 5,
  fragLimit: number = LEAGUE_RULES.fragLimit,
): LeagueResult {
  const p = gameChance(home.strength, away.strength, teamSize);
  const homeWins = rng() < p;
  const pw = homeWins ? p : 1 - p;
  const overtime = rng() < OVERTIME_EVEN * 4 * p * (1 - p);
  // The loser's share of the frags: near the limit for even sides, lower for a clear favourite.
  const share = Math.max(0.15, Math.min(0.96, (1 - pw) / pw)) * (0.8 + 0.25 * rng());
  const loser = overtime
    ? fragLimit - 1 - Math.floor(rng() * 6)
    : Math.min(fragLimit - 1, Math.round(fragLimit * share));
  const winner = overtime ? loser + 1 : fragLimit;
  return {
    home: home.club,
    away: away.club,
    homeFrags: homeWins ? winner : loser,
    awayFrags: homeWins ? loser : winner,
    overtime,
    winner: homeWins ? home.club : away.club,
  };
}

// ---------- league money ----------

/** Weekly table money (index 1): places 1-4 / 5-8 / 9-12 / 13-16 (L-E8). */
export const TABLE_MONEY = [1200, 700, 400, 200] as const;
/** Factor of the table money per tier (Pro ×1.4, Division 1 ×1.0, Division 2 ×0.7, L-E8). */
export const TIER_MULT = [1.4, 1, 0.7, 0.5] as const;
/** Weekly cup bonus (index 1) for places 1-3 of the cup ranking (L-E10). */
export const CUP_BONUS = [1000, 600, 300] as const;

/** Table money of a place in a tier (reference, before the reward index). */
export function tableMoney(
  place: number,
  tier: number,
  money: readonly number[] = TABLE_MONEY,
  mult: readonly number[] = TIER_MULT,
): number {
  const band = money[Math.min(money.length - 1, Math.floor((place - 1) / 4))] ?? 0;
  return band * (mult[Math.min(tier, mult.length - 1)] ?? 1);
}

/** Cup ranking (the former season table, L-E10): points per cup place. */
export const CUP_POINTS = { 1: 10, 2: 6, 3: 4, played: 1 } as const;
/** Cup ranking points per format (team size). */
export const CUP_FORMAT_POINTS: Readonly<Record<number, number>> = { 1: 1, 2: 1.5, 3: 2, 5: 3 };

// ---------- league length ----------

export type LeagueLength = 'short' | 'medium' | 'long';
/** Matchdays per league evening per length (L-E12). */
export const PER_EVENING: Readonly<Record<LeagueLength, number>> = { short: 5, medium: 2, long: 1 };

/** League evenings of a season: matchdays / per evening (rounded up). */
export const eveningsOf = (size: number, perEvening: number): number =>
  Math.ceil(matchdaysOf(size) / Math.max(1, perEvening));

// ---------- keepers ----------

/** The strongest own bots to keep (AI managers, the simulator): by the model's strength. */
export function pickKeepers<T extends { skill: number; score: number }>(
  own: readonly T[],
  max: number,
): T[] {
  return [...own]
    .sort((a, b) => botStrength(b.skill, b.score) - botStrength(a.skill, a.score))
    .slice(0, Math.max(0, max));
}
