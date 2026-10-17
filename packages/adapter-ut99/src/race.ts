import type { Rng } from '@tourney/bracket';

/**
 * Monster Hunt time race: in every game both teams run the same map one after the other.
 * Pure rules for the order of the runs and the winner of a game.
 */

export interface RunResult {
  entrantId: string;
  /** Time from the countdown to the exit (or to the time limit), pauses excluded. */
  timeMs: number;
  deaths: number;
  penaltyMs: number;
  /** Monster points of the team. */
  points: number;
  /** Reached the exit (MonsterEnd) before the time limit. */
  finished: boolean;
}

/** Time that counts: raw time plus the penalty for deaths. */
export const finalMs = (r: Pick<RunResult, 'timeMs' | 'penaltyMs'>) => r.timeMs + r.penaltyMs;

export type RaceDecision = 'time' | 'finish' | 'points' | 'deaths' | 'lot';

/**
 * Winner of a game:
 * 1. a team at the exit beats a team that is not;
 * 2. both at the exit: the lower final time (raw time plus penalty, to the millisecond);
 * 3. otherwise (exactly the same final time, or nobody at the exit): more monster points, then
 *    fewer deaths, then the lot.
 */
export function raceWinner(
  a: RunResult,
  b: RunResult,
  rng: Rng,
): { winnerId: string; decidedBy: RaceDecision } {
  if (a.finished !== b.finished)
    return { winnerId: a.finished ? a.entrantId : b.entrantId, decidedBy: 'finish' };
  if (a.finished) {
    const fa = finalMs(a);
    const fb = finalMs(b);
    if (fa !== fb) return { winnerId: fa < fb ? a.entrantId : b.entrantId, decidedBy: 'time' };
  }
  if (a.points !== b.points)
    return { winnerId: a.points > b.points ? a.entrantId : b.entrantId, decidedBy: 'points' };
  if (a.deaths !== b.deaths)
    return { winnerId: a.deaths < b.deaths ? a.entrantId : b.entrantId, decidedBy: 'deaths' };
  return { winnerId: rng() < 0.5 ? a.entrantId : b.entrantId, decidedBy: 'lot' };
}

/**
 * Who runs first in a game: game 1 is drawn, afterwards it alternates (the team that ran second
 * in the previous game starts).
 */
export function firstRunner(
  entrants: readonly [string, string],
  previousGameOrder: readonly string[] | undefined,
  rng: Rng,
): string {
  const lastSecond = previousGameOrder?.[1];
  if (lastSecond && entrants.includes(lastSecond)) return lastSecond;
  return rng() < 0.5 ? entrants[0] : entrants[1];
}

/** "4:07.3" */
export function formatRaceTime(ms: number): string {
  const tenths = Math.floor(ms / 100);
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

/**
 * Simulated bot-vs-bot race series (botMatchMode "simulate"): run times from the average bot
 * skill, the time limit and a little luck.
 */
export function simulateRace(opts: {
  entrants: readonly [string, string];
  skills: readonly [number, number];
  bestOf: number;
  timeLimitMin: number;
  penaltySec: number;
  rng: Rng;
}): { winnerId: string; games: { runs: [RunResult, RunResult]; winnerId: string }[] } {
  const needed = Math.ceil(opts.bestOf / 2);
  const limitMs = opts.timeLimitMin * 60_000;
  const run = (i: 0 | 1): RunResult => {
    const skill = Math.max(0, Math.min(7, opts.skills[i]));
    const raw = limitMs * 0.55 * (1.3 - skill * 0.08) * (0.85 + opts.rng() * 0.3);
    const timeMs = Math.min(limitMs, Math.round(raw / 100) * 100);
    const deaths = Math.floor(opts.rng() * Math.max(1, 9 - skill));
    return {
      entrantId: opts.entrants[i],
      timeMs,
      deaths,
      penaltyMs: deaths * opts.penaltySec * 1000,
      points: 80 + Math.floor(opts.rng() * 60),
      finished: timeMs < limitMs,
    };
  };
  const wins = new Map<string, number>(opts.entrants.map((e) => [e, 0]));
  const games: { runs: [RunResult, RunResult]; winnerId: string }[] = [];
  for (;;) {
    const runs: [RunResult, RunResult] = [run(0), run(1)];
    const { winnerId } = raceWinner(runs[0], runs[1], opts.rng);
    games.push({ runs, winnerId });
    const w = (wins.get(winnerId) ?? 0) + 1;
    wins.set(winnerId, w);
    if (w >= needed) return { winnerId, games };
  }
}
