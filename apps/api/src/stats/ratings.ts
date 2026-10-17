import { rate } from 'openskill';
import { thurstoneMostellerFull } from 'openskill/models';
import type { PlayerRef, StatMode, TournamentFacts } from './facts.js';

/**
 * Ratings (OpenSkill, Weng-Lin with the Thurstone-Mosteller model), one per mode (dm, tdm, mh), as a read model of the facts
 * (pure, no database): every game that was really played counts on its own, in time order.
 *
 * - Players and bots have their own rating. A bot's rating is stored without its difficulty:
 *   for the expected outcome a bot plays with its rating plus a bonus for its difficulty
 *   (`levelPoints` per step above or below Adept). A Godlike bot that beats a Novice bot of the
 *   same rating gains little; a human who beats a Novice bot gains little.
 * - The margin scales the change: 0.75 for a close game up to 1.5 for a clear one.
 * - A season is a time window (`from`, `to`): ratings start fresh at `from`.
 *
 * Shown is an Elo-like number: 1500 at the start, 50 points per OpenSkill mu.
 *
 * Thurstone-Mosteller (instead of OpenSkill's default Plackett-Luce) because it weighs a clear
 * favourite more: a win that was expected moves the ratings much less.
 */

export interface RatingOptions {
  /** Games with bots count (website setting). Off: only games between humans count. */
  botGames: boolean;
  /** Rating points per bot difficulty step above or below Adept (4). */
  levelPoints: number;
  /** Season window (ISO timestamps): games at or after `from` and before `to`. */
  from?: string;
  to?: string;
}

export const RATING_DEFAULTS: RatingOptions = { botGames: true, levelPoints: 100 };

/** OpenSkill's defaults. */
const MU = 25;
const SIGMA = 25 / 3;
/**
 * Bots start with less uncertainty: their strength mostly comes from the difficulty, so a few
 * games must not throw their rating around (and humans cannot farm points from weak bots).
 */
export const BOT_SIGMA = 4;
export const RATING_START = 1500;
/** Shown points per OpenSkill mu. */
export const RATING_SCALE = 50;
/** Difficulty without bonus (Adept). */
export const NEUTRAL_SKILL = 4;
/** Fewer games: the rating is provisional. */
export const PROVISIONAL_GAMES = 5;

export const shownRating = (mu: number) => Math.round(RATING_START + RATING_SCALE * (mu - MU));

/** Bonus of a bot's difficulty in OpenSkill mu (0 for humans). */
export const levelBonusMu = (skill: number | undefined, levelPoints: number) =>
  skill === undefined ? 0 : ((skill - NEUTRAL_SKILL) * levelPoints) / RATING_SCALE;

export interface PlayerRating {
  key: string;
  name: string;
  bot: boolean;
  userId?: string;
  mu: number;
  sigma: number;
  /** Shown rating (without the difficulty bonus for bots). */
  rating: number;
  games: number;
  wins: number;
  provisional: boolean;
  lastAt: string;
}

export interface RatingChange {
  key: string;
  name: string;
  bot: boolean;
  entrantId: string;
  /** Bots: the difficulty they played with. */
  skill?: number;
  before: number;
  after: number;
  delta: number;
}

export interface RatedGame {
  tournamentId: string;
  matchId: string;
  game: number;
  at: string;
  mode: StatMode;
  winnerEntrantId: string;
  /** Margin factor applied (0.75 .. 1.5). */
  factor: number;
  changes: RatingChange[];
}

export interface Ratings {
  players: Record<StatMode, Map<string, PlayerRating>>;
  /** Every rated game in time order. */
  games: RatedGame[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * How clear the win was (0 = close, 1 = clear): the frag difference relative to the winner's
 * score; in Monster Hunt the time difference relative to the winner's time (25 % slower = clear),
 * or clear when the loser did not reach the exit.
 */
export function marginOf(
  mode: StatMode,
  winner: { score: number; finished?: boolean },
  loser: { score: number; finished?: boolean },
): number {
  if (mode === 'mh') {
    if (winner.finished !== false && loser.finished === false) return 1;
    if (winner.finished === false) return 0; // nobody at the exit: decided by points
    if (winner.score <= 0) return 0;
    return clamp01((loser.score - winner.score) / winner.score / 0.25);
  }
  if (winner.score <= 0) return 0;
  return clamp01((winner.score - loser.score) / winner.score);
}

export const marginFactor = (margin: number) => 0.75 + 0.75 * clamp01(margin);

/** Games of all tournaments in time order (stable for equal timestamps). */
function orderedGames(ts: readonly TournamentFacts[]) {
  const out: { t: TournamentFacts; g: TournamentFacts['games'][number] }[] = [];
  for (const t of ts) for (const g of t.games) out.push({ t, g });
  return out.sort((a, b) => a.g.at.localeCompare(b.g.at));
}

/** Players of each side of a game (unique keys; a key on both sides plays for nobody). */
function sidesOf(t: TournamentFacts, matchId: string, game: number, entrants: [string, string]) {
  const side = (entrantId: string) => {
    const seen = new Map<string, PlayerRef & { skill?: number }>();
    for (const p of t.players)
      if (p.matchId === matchId && p.game === game && p.entrantId === entrantId && !seen.has(p.key))
        seen.set(p.key, p);
    return [...seen.values()];
  };
  const a = side(entrants[0]);
  const b = side(entrants[1]);
  const both = new Set(a.filter((p) => b.some((q) => q.key === p.key)).map((p) => p.key));
  return [a.filter((p) => !both.has(p.key)), b.filter((p) => !both.has(p.key))] as const;
}

export function computeRatings(
  tournaments: readonly TournamentFacts[],
  options: Partial<RatingOptions> = {},
): Ratings {
  const o = { ...RATING_DEFAULTS, ...options };
  const players: Ratings['players'] = { dm: new Map(), tdm: new Map(), mh: new Map() };
  const games: RatedGame[] = [];

  for (const { t, g } of orderedGames(tournaments)) {
    if (o.from && g.at < o.from) continue;
    if (o.to && g.at >= o.to) continue;
    const loserId = g.entrants[0] === g.winnerEntrantId ? g.entrants[1] : g.entrants[0];
    if (!g.entrants.includes(g.winnerEntrantId) || !loserId) continue;
    const [a, b] = sidesOf(t, g.matchId, g.game, g.entrants);
    if (!a.length || !b.length) continue;
    if (!o.botGames && [...a, ...b].some((p) => p.bot)) continue;

    const table = players[t.mode];
    const current = (p: PlayerRef) =>
      table.get(p.key) ?? {
        key: p.key,
        name: p.name,
        bot: p.bot,
        ...(p.userId ? { userId: p.userId } : {}),
        mu: MU,
        sigma: p.bot ? BOT_SIGMA : SIGMA,
        rating: RATING_START,
        games: 0,
        wins: 0,
        provisional: true,
        lastAt: g.at,
      };
    const bonus = (p: { skill?: number }) => levelBonusMu(p.skill, o.levelPoints);
    const team = (side: readonly (PlayerRef & { skill?: number })[]) =>
      side.map((p) => {
        const r = current(p);
        return { mu: r.mu + bonus(p), sigma: r.sigma };
      });
    const sides = [a, b] as const;
    const rank = g.entrants.map((id) => (id === g.winnerEntrantId ? 1 : 2));
    const rated = rate([team(a), team(b)], { rank, model: thurstoneMostellerFull });

    const run = (entrantId: string) =>
      t.runs.find((r) => r.matchId === g.matchId && r.game === g.game && r.entrantId === entrantId);
    const factor = marginFactor(
      marginOf(
        t.mode,
        {
          score: g.scores[g.winnerEntrantId] ?? 0,
          ...(run(g.winnerEntrantId) ? { finished: run(g.winnerEntrantId)!.finished } : {}),
        },
        {
          score: g.scores[loserId] ?? 0,
          ...(run(loserId) ? { finished: run(loserId)!.finished } : {}),
        },
      ),
    );

    const changes: RatingChange[] = [];
    sides.forEach((side, si) => {
      side.forEach((p, pi) => {
        const before = current(p);
        const after = rated[si]![pi]!;
        const mu = before.mu + (after.mu - bonus(p) - before.mu) * factor;
        const won = g.entrants[si] === g.winnerEntrantId;
        const next: PlayerRating = {
          ...before,
          name: p.name,
          mu,
          sigma: after.sigma,
          rating: shownRating(mu),
          games: before.games + 1,
          wins: before.wins + (won ? 1 : 0),
          provisional: before.games + 1 < PROVISIONAL_GAMES,
          lastAt: g.at,
        };
        changes.push({
          key: p.key,
          name: p.name,
          bot: p.bot,
          entrantId: g.entrants[si]!,
          ...(p.skill === undefined ? {} : { skill: p.skill }),
          before: before.rating,
          after: next.rating,
          delta: next.rating - before.rating,
        });
        table.set(p.key, next);
      });
    });
    games.push({
      tournamentId: t.tournamentId,
      matchId: g.matchId,
      game: g.game,
      at: g.at,
      mode: t.mode,
      winnerEntrantId: g.winnerEntrantId,
      factor,
      changes,
    });
  }
  return { players, games };
}

/**
 * Strength of a player for seeding and balancing: the shown rating (start value when unrated),
 * bots with the bonus of the difficulty they will play with.
 */
export function strengthOf(
  ratings: Ratings,
  mode: StatMode,
  key: string,
  skill: number | undefined,
  levelPoints: number,
): number {
  const r = ratings.players[mode].get(key);
  return shownRating((r?.mu ?? MU) + levelBonusMu(skill, levelPoints));
}
