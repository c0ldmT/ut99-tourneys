import { randomInt, type Rng } from '@tourney/bracket';

/**
 * Resolves a bot vs bot match without playing it ("simulate" bot match mode).
 * Win chance per game grows quadratically with skill: weight = (skill + 1)^2,
 * so Godlike (7) beats Novice (0) about 98% of the time, equal skills are 50/50.
 */
export interface SimulatedGame {
  winner: 0 | 1;
  scores: [number, number];
}

export function winChance(skillA: number, skillB: number): number {
  const wa = (skillA + 1) ** 2;
  const wb = (skillB + 1) ** 2;
  return wa / (wa + wb);
}

export function simulateSeries(opts: {
  skills: [number, number];
  bestOf: number;
  fragLimit: number;
  rng: Rng;
}): { winner: 0 | 1; games: SimulatedGame[] } {
  const needed = Math.ceil(opts.bestOf / 2);
  const target = opts.fragLimit > 0 ? opts.fragLimit : 20;
  const p = winChance(opts.skills[0], opts.skills[1]);
  const wins: [number, number] = [0, 0];
  const games: SimulatedGame[] = [];
  while (wins[0] < needed && wins[1] < needed) {
    const winner: 0 | 1 = opts.rng() < p ? 0 : 1;
    // Closer skill -> closer score.
    const closeness = 1 - Math.abs(p - 0.5) * 2;
    const loserScore = Math.min(
      target - 1,
      Math.round(closeness * (target - 1) * 0.8) + randomInt(opts.rng, 4),
    );
    const scores: [number, number] = winner === 0 ? [target, loserScore] : [loserScore, target];
    wins[winner]++;
    games.push({ winner, scores });
  }
  return { winner: wins[0] === needed ? 0 : 1, games };
}
