import type { Rng } from '@tourney/bracket';

/**
 * How the control center's bots bet (pure). A bot judges a match from the entrants' ratings,
 * with noise that shrinks with its difficulty and accuracy; its play style decides how much
 * and how boldly it bets; clan mates, rivals, its nemesis and the player who beat it most
 * often this season (revenge) bend the judgement.
 */

export interface BettingBot {
  id: string;
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

/** Share of the free Neuro a bot bets at full confidence, by combat style: 3 % .. 15 %. */
export function stakeShare(combatStyle: number): number {
  return 0.03 + 0.06 * (clamp(combatStyle, -1, 1) + 1);
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

/**
 * One bot's bet on a match (null: it lets this one pass). `free` is what it can stake.
 */
export function botBet(
  bot: BettingBot,
  sides: readonly [BetSide, BetSide],
  feelings: BotFeelings,
  free: number,
  rng: Rng,
): BotBetDecision | null {
  if (free < 10) return null;
  const [a, b] = sides;
  // 1. Judgement: the ratings plus noise on the logit scale.
  const p = clamp(ratingChance(a.rating, b.rating), 0.01, 0.99);
  let pa = 1 / (1 + Math.exp(-(Math.log(p / (1 - p)) + judgementNoise(bot) * gauss(rng))));
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
  if (nemesisIn(a) !== nemesisIn(b)) {
    pick = nemesisIn(a) ? b : a;
    forced = true;
  } else if (bot.jumpy && rng() < 0.15) {
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
  if (!forced && confidence < 0.4 * clamp(bot.camping, 0, 1)) return null;
  // 4. Stake: share by combat style, more when sure, more for patient campers.
  if (bot.combatStyle >= 1 && rng() < 0.05)
    return { pick: pick.entrantId, amount: free, allIn: true, belief };
  const share = stakeShare(bot.combatStyle) * (0.5 + confidence) * (1 + clamp(bot.camping, 0, 1));
  const amount = clamp(Math.round((free * share) / 10) * 10, 10, free);
  return { pick: pick.entrantId, amount, allIn: amount === free, belief };
}

/** A label for the bot's betting style (bot profile). */
export function bettingType(bot: Omit<BettingBot, 'id' | 'clanId'>): string {
  if (bot.jumpy) return 'hunch';
  if (bot.camping >= 0.5) return 'lurker';
  if (bot.combatStyle >= 0.5) return 'gambler';
  if (bot.combatStyle <= -0.5) return 'careful';
  if (bot.skill >= 5 && bot.accuracy >= 0.3) return 'analyst';
  return 'average';
}
