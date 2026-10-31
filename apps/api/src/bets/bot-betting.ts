import type { Rng } from '@tourney/bracket';

/**
 * How the control center's bots bet (pure). A bot judges a match from the entrants' ratings,
 * with noise that shrinks with its difficulty and accuracy; its play style decides how much
 * and how boldly it bets; clan mates, rivals, its nemesis and the player who beat it most
 * often this season (revenge) bend the judgement.
 */

/**
 * How a bot bets. The first five follow its play values (classic); the others are drawn by its
 * id for some bots (Mario 31.10.: more bots that make mistakes, so bets are not all on one side):
 * hunch (gut feeling, often heads or tails), halfway (looks at the ratings only a little),
 * underdog (likes the outsider), value (bets where the pool pays more than its belief), drunk
 * (anything goes).
 */
export type BettingStyle =
  | 'analyst'
  | 'average'
  | 'careful'
  | 'gambler'
  | 'lurker'
  | 'hunch'
  | 'halfway'
  | 'underdog'
  | 'value'
  | 'drunk';

export interface BettingBot {
  id: string;
  /** Its betting style (`bettingStyle`); without: classic, by the play values. */
  style?: BettingStyle;
  /** Difficulty 0 (Novice) .. 7 (Godlike). */
  skill: number;
  accuracy: number; // -1..1
  alertness: number; // -1..1
  combatStyle: number; // -1 avoidant .. 1 berserk
  camping: number; // 0..1
  jumpy: boolean;
  clanId: string | null;
}

/** What the bot knows about one side of a match. */
export interface BetSide {
  entrantId: string;
  /** Rating of the entrant at the seeding (team: average); 1500 if unknown. */
  rating?: number;
  /** Clans of the control center's bots playing for this side. */
  clans: string[];
  /** Bettor keys playing for this side: user ids and `bot:<id>`. */
  players: string[];
}

export interface BotFeelings {
  /** Bettor keys the bot sees as rival (1) or nemesis (2). */
  rivals: ReadonlyMap<string, 1 | 2>;
  /** The player who beat the bot most often this season (revenge), if any. */
  revenge?: string;
}

export interface BotBetDecision {
  pick: string;
  amount: number;
  allIn: boolean;
  /** For tests and the log: the bot's own estimate that `pick` wins. */
  belief: number;
}

/** Normal distributed number (Box-Muller). */
export function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Chance of side A by the ratings (Elo formula, 400 points = 10:1). */
export function ratingChance(a?: number, b?: number): number {
  return 1 / (1 + 10 ** (((b ?? 1500) - (a ?? 1500)) / 400));
}

/** How far the bot's judgement scatters (logit scale): Godlike + accurate ~0.2, Novice ~0.95. */
export function judgementNoise(bot: Pick<BettingBot, 'skill' | 'accuracy'>): number {
  return 0.2 + 0.5 * (1 - clamp(bot.skill, 0, 7) / 7) * (1 - 0.5 * clamp(bot.accuracy, -1, 1));
}

/**
 * Base share of the free Neuro by combat style: 12 % (avoidant) .. 30 % (normal) .. 48 % (berserk).
 * A bet takes 0.5x of it at a sure 50:50 up to 1.5x at full confidence (see botBet); with the
 * bot's own uncertainty a normal bot bets about 20 % on an even match.
 */
export function stakeShare(combatStyle: number): number {
  return 0.12 + 0.18 * (clamp(combatStyle, -1, 1) + 1);
}

/** Weight in the draw of the bots that bet on a match: alert bots bet more often. */
export function betAppetite(bot: Pick<BettingBot, 'alertness'>): number {
  return 0.5 + 0.4 * clamp(bot.alertness, -1, 1);
}

/** Draws up to `n` bots, weighted by appetite, without repetition. */
export function drawBettors<T extends Pick<BettingBot, 'alertness'>>(
  bots: readonly T[],
  n: number,
  rng: Rng,
): T[] {
  const pool = [...bots];
  const out: T[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, b) => s + betAppetite(b), 0);
    let x = rng() * total;
    let i = 0;
    for (; i < pool.length - 1; i++) {
      x -= betAppetite(pool[i]!);
      if (x <= 0) break;
    }
    out.push(pool.splice(i, 1)[0]!);
  }
  return out;
}

/** Stable 0..99 of a bot id (FNV-1a). */
function idBucket(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/**
 * The bot's betting style: about 6 % drunk, 11 % value hunters, 8 % underdog fans, 10 % halfway,
 * 8 % more on a hunch (by the id, so it stays); the rest by its play values (`bettingType`).
 */
export function bettingStyle(bot: Omit<BettingBot, 'clanId' | 'style'>): BettingStyle {
  const h = idBucket(bot.id);
  if (h >= 94) return 'drunk';
  if (h >= 83) return 'value';
  if (h >= 75) return 'underdog';
  if (h >= 65) return 'halfway';
  if (h >= 57) return 'hunch';
  return bettingType(bot);
}

/** What is on each side of the match so far (all bettors), for value hunters. */
export interface BetPool {
  a: number;
  b: number;
}

/**
 * One bot's bet on a match (null: it lets this one pass). `free` is what it can stake; `pool`
 * what others staked on the two sides so far.
 */
export function botBet(
  bot: BettingBot,
  sides: readonly [BetSide, BetSide],
  feelings: BotFeelings,
  free: number,
  rng: Rng,
  pool: BetPool = { a: 0, b: 0 },
): BotBetDecision | null {
  if (free < 10) return null;
  const [a, b] = sides;
  const style = bot.style;
  // 1. Judgement: the ratings plus noise on the logit scale (halfway bettors only half look).
  const p = clamp(ratingChance(a.rating, b.rating), 0.01, 0.99);
  const logit = Math.log(p / (1 - p)) * (style === 'halfway' ? 0.35 : 1);
  const noise = style === 'halfway' ? 0.8 : judgementNoise(bot);
  let pa = 1 / (1 + Math.exp(-(logit + noise * gauss(rng))));
  // 2. Feelings: clan mates, rivals, revenge; the nemesis decides alone.
  const feel = (side: BetSide) => {
    let x = 0;
    if (bot.clanId && side.clans.includes(bot.clanId)) x += 0.15;
    for (const pl of side.players) {
      const r = feelings.rivals.get(pl);
      if (r === 1 || pl === feelings.revenge) x -= 0.15;
    }
    return x;
  };
  pa = clamp(pa + feel(a) - feel(b), 0.02, 0.98);
  const nemesisIn = (side: BetSide) => side.players.some((pl) => feelings.rivals.get(pl) === 2);
  let pick: BetSide;
  let forced = false;
  if (style === 'drunk') {
    // Anything goes: a side at random, a stake at random, now and then everything.
    const side = rng() < 0.5 ? a : b;
    const belief = side === a ? pa : 1 - pa;
    if (rng() < 0.04) return { pick: side.entrantId, amount: free, allIn: true, belief };
    const amount = clamp(Math.round((free * (0.1 + 0.5 * rng())) / 10) * 10, 10, free);
    return { pick: side.entrantId, amount, allIn: amount === free, belief };
  }
  if (nemesisIn(a) !== nemesisIn(b)) {
    pick = nemesisIn(a) ? b : a;
    forced = true;
  } else if (style === 'value') {
    // The pool pays (all stakes) / (stakes on the side): bet where that beats the belief, with
    // the stake it will place (its usual share). An empty side pays the most - so value hunters
    // fill it (no refund for one-sided bets).
    const stake = clamp(Math.round((free * stakeShare(bot.combatStyle)) / 10) * 10, 10, free);
    const total = pool.a + pool.b + stake;
    const ev = (belief: number, on: number) => (belief * total) / (on + stake) - 1;
    const evA = ev(pa, pool.a);
    const evB = ev(1 - pa, pool.b);
    if (Math.max(evA, evB) < 0.05) return null; // nothing worth it
    pick = evA >= evB ? a : b;
    return {
      pick: pick.entrantId,
      amount: stake,
      allIn: stake === free,
      belief: pick === a ? pa : 1 - pa,
    };
  } else if (style === 'underdog' && Math.abs(pa - 0.5) > 0.08 && rng() < 0.5) {
    // The outsider's fan: half the time on the side the bot itself thinks weaker.
    pick = pa >= 0.5 ? b : a;
  } else if ((bot.jumpy || style === 'hunch') && rng() < (style === 'hunch' ? 0.4 : 0.15)) {
    // A hunch: heads or tails.
    pick = rng() < 0.5 ? a : b;
    pa = 0.65;
  } else {
    pick = pa >= 0.5 ? a : b;
    // Bold bots sometimes back the underdog for the bigger share of the pool.
    if (bot.combatStyle > 0 && rng() < 0.25 * bot.combatStyle) pick = pick === a ? b : a;
  }
  const belief = pick === a ? pa : 1 - pa;
  const confidence = Math.abs(pa - 0.5) * 2;
  // 3. Patience: campers wait for a clear match.
  if (!forced && style !== 'value' && confidence < 0.4 * clamp(bot.camping, 0, 1)) return null;
  // 4. Stake: share by combat style, more when sure, more for patient campers.
  if (bot.combatStyle >= 1 && rng() < 0.05)
    return { pick: pick.entrantId, amount: free, allIn: true, belief };
  // Never more than 80 % (only the berserker's all-in above stakes everything).
  const share = Math.min(
    0.8,
    stakeShare(bot.combatStyle) * (0.5 + confidence) * (1 + 0.5 * clamp(bot.camping, 0, 1)),
  );
  const amount = clamp(Math.round((free * share) / 10) * 10, 10, free);
  return { pick: pick.entrantId, amount, allIn: amount === free, belief };
}

/** The classic betting style by the play values (`bettingStyle` adds the drawn ones). */
export function bettingType(bot: Omit<BettingBot, 'id' | 'clanId' | 'style'>): BettingStyle {
  if (bot.jumpy) return 'hunch';
  if (bot.camping >= 0.5) return 'lurker';
  if (bot.combatStyle >= 0.5) return 'gambler';
  if (bot.combatStyle <= -0.5) return 'careful';
  if (bot.skill >= 5 && bot.accuracy >= 0.3) return 'analyst';
  return 'average';
}
