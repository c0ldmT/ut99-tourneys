import { roundNeuro } from './economy.js';

/**
 * Challenges (decision 334): a manager challenges another manager's team to a match at a fixed
 * start time inside the challenge window of the administration, with a stake both pay into a pot.
 * Pure rules: modes, Monster Hunt difficulties, how long a challenge keeps a server, the stake
 * cap, the pot and the fee, the window and the league evening.
 */

export const CHALLENGE_MODES = ['dm', 'mh'] as const;
export type ChallengeMode = (typeof CHALLENGE_MODES)[number];

/** Monster Hunt difficulties (the showcase mode): monster skill, lives (0 = unlimited), penalty. */
export const MH_HARDNESS = {
  normal: { monsterSkill: 5, lives: 0, penaltySec: 5 },
  hard: { monsterSkill: 6, lives: 3, penaltySec: 8 },
  nightmare: { monsterSkill: 7, lives: 1, penaltySec: 10 },
} as const;
export type MhHardness = keyof typeof MH_HARDNESS;
export const MH_HARDNESS_IDS = Object.keys(MH_HARDNESS) as MhHardness[];

/** Team sizes and best of a deathmatch challenge can have; Monster Hunt is always 5v5, one race. */
export const CHALLENGE_TEAM_SIZES = [1, 3, 5] as const;
export const CHALLENGE_BEST_OF = [1, 3, 5] as const;
export const MH_TEAM_SIZE = 5;

/** Start times lie on this grid (minutes). */
export const SLOT_MIN = 15;
/** A deathmatch game with its breaks (minutes), as the server calendar plans games. */
export const DM_GAME_MIN = 6;
/** The time limit of a Monster Hunt run (minutes): a race is two runs. */
export const MH_RUN_MIN = 20;
/** Map changes and the countdown around a challenge (minutes). */
export const CHALLENGE_BUFFER_MIN = 5;

/**
 * How long a challenge keeps its server (minutes, on the start grid): best of × a game plus a
 * buffer for deathmatch (Bo1 15, Bo3 30, Bo5 45), two runs plus a buffer for Monster Hunt (45).
 */
export function challengeMinutes(f: { mode: ChallengeMode; bestOf: number }): number {
  const raw =
    f.mode === 'mh'
      ? 2 * MH_RUN_MIN + CHALLENGE_BUFFER_MIN
      : Math.max(1, f.bestOf) * DM_GAME_MIN + CHALLENGE_BUFFER_MIN;
  return Math.ceil(raw / SLOT_MIN) * SLOT_MIN;
}

/** The highest stake per team: the base at the index like the rewards (index^0.2), in tens. */
export function stakeCap(base: number, index: number, exp = 0.2): number {
  return roundNeuro(base * Math.max(0, index) ** exp);
}

/** Stakes are 0 (a friendly) or at least this. */
export const MIN_STAKE = 100;

/** Why a stake is not allowed (null: it is). */
export function stakeProblem(stake: number, cap: number): 'step' | 'low' | 'high' | null {
  if (!Number.isInteger(stake) || stake < 0 || stake % 10 !== 0) return 'step';
  if (stake === 0) return null;
  if (stake < MIN_STAKE) return 'low';
  if (stake > cap) return 'high';
  return null;
}

/** The pot of both stakes, the fee (percent of the pot, in tens) and what the winner gets. */
export function challengePot(
  stake: number,
  feePct: number,
): { pot: number; fee: number; prize: number } {
  const pot = 2 * stake;
  const fee = Math.min(pot, roundNeuro((pot * feePct) / 100));
  return { pot, fee, prize: pot - fee };
}

/** "HH:MM" as minutes after midnight. */
export const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Minutes after midnight as "HH:MM". */
export const hhmmOf = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** The weekday of a date (YYYY-MM-DD), 0 = Monday (as the league's slot days). */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export interface ChallengeWindow {
  /** Weekdays, 0 = Monday. */
  days: readonly number[];
  from: string;
  to: string;
}

/**
 * The start times of a day's window for a challenge of `minutes`: on the grid from `from`, so
 * that it ends by `to`.
 */
export function windowStarts(w: Pick<ChallengeWindow, 'from' | 'to'>, minutes: number): string[] {
  const from = Math.ceil(minutesOf(w.from) / SLOT_MIN) * SLOT_MIN;
  const to = minutesOf(w.to);
  const out: string[] = [];
  for (let t = from; t + minutes <= to; t += SLOT_MIN) out.push(hhmmOf(t));
  return out;
}

/** Whether a local time is a start time of the window for a challenge of `minutes`. */
export function isWindowStart(
  w: Pick<ChallengeWindow, 'from' | 'to'>,
  time: string,
  minutes: number,
) {
  return windowStarts(w, minutes).includes(time);
}

/**
 * The weekdays on which the challenge window runs into the league evening (Mario: the window must
 * never collide with the league). The evening starts at `slotTime` on the league's weekdays and
 * keeps its servers about `spanMin` minutes; the window must end by its start or begin after it.
 */
export function leagueClashDays(
  w: ChallengeWindow,
  league: { enabled: boolean; slotDays: readonly number[]; slotTime: string },
  spanMin: number,
): number[] {
  if (!league.enabled) return [];
  const from = minutesOf(w.from);
  const to = minutesOf(w.to);
  const start = minutesOf(league.slotTime);
  const end = start + Math.max(0, spanMin);
  if (to <= start || from >= end) return [];
  return w.days.filter((d) => league.slotDays.includes(d)).sort((a, b) => a - b);
}

/** A Monster Hunt run as the record check needs it. */
export interface RecordRun {
  entrantId: string;
  map: string;
  monsterSkill: number;
  finalMs: number;
  finished: boolean;
  forfeit?: boolean;
}

/**
 * The run of a Monster Hunt challenge that broke a season map record (decision 335): its best
 * finished run beats the record of the same map and monster skill held before (maps compared
 * case-insensitively). A first run on a map without a record breaks none (the bonus is for
 * beating someone). Null: no record broken.
 */
export function brokenRecord<R extends RecordRun>(
  runs: readonly R[],
  before: readonly { map: string; monsterSkill: number; finalMs: number }[],
): R | null {
  const best = runs
    .filter((r) => r.finished && !r.forfeit)
    .sort((a, b) => a.finalMs - b.finalMs)[0];
  if (!best) return null;
  const held = before.find(
    (r) => r.map.toLowerCase() === best.map.toLowerCase() && r.monsterSkill === best.monsterSkill,
  );
  return held && best.finalMs < held.finalMs ? best : null;
}

/** The Monster Hunt difficulty of a monster skill (null: none of the three). */
export function hardnessOfSkill(skill: number): MhHardness | null {
  return MH_HARDNESS_IDS.find((h) => MH_HARDNESS[h].monsterSkill === skill) ?? null;
}

/** The chance to win a best of `bestOf` series with a chance `p` per game (games independent). */
export function seriesChance(p: number, bestOf: number): number {
  const need = Math.floor(Math.max(1, bestOf) / 2) + 1;
  let out = 0;
  let ways = 1; // C(need - 1 + k, k)
  for (let k = 0; k < need; k++) {
    if (k > 0) ways = (ways * (need - 1 + k)) / k;
    out += ways * p ** need * (1 - p) ** k;
  }
  return out;
}

/**
 * AI managers and challenges (decision 336): the least win chance a personality takes a
 * challenge with, and the band of its own chance in which it challenges a human. With the fee
 * of 5 % a human's best case is +0.10 × stake against the gambler (0.42), otherwise at most
 * +0.05; AI managers are no source of Neuro.
 */
export const AI_CHALLENGE_TAKE = {
  gambler: 0.42,
  tactician: 0.5,
  breeder: 0.5,
  saver: 0.58,
} as const;
export const AI_CHALLENGE_BAND = [0.45, 0.6] as const;

/** A human's expected gain per staked Neuro against a side with win chance `p` (the pot less the fee). */
export function humanEdge(p: number, feePct: number): number {
  return (1 - p) * 2 * (1 - feePct / 100) - 1;
}
