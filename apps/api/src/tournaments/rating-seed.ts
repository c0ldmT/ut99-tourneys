import { shuffle, slotsFromSeeds, type Rng } from '@tourney/bracket';
import type { BotSpec } from '@tourney/protocol';

/**
 * Seeding by rating (pure): the strongest meet late (standard seed order), bots are chosen and
 * spread so that the teams of bots come out about as strong as the rest.
 *
 * Strengths are shown ratings; a bot's strength includes the bonus of its difficulty.
 */

export interface RatedBot {
  spec: BotSpec;
  strength: number;
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Orders entrants best first; equal strengths in random order (the lot decides among players
 * without a rating).
 */
export function byStrength(
  ids: readonly string[],
  strength: (id: string) => number,
  rng: Rng,
): string[] {
  return shuffle(ids, rng)
    .map((id, i) => ({ id, i, s: strength(id) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.id);
}

/**
 * Bracket slots by rating. `byes` (settings.botPlacement): players first, bots take the lowest
 * seeds; `random`: everybody by strength.
 */
export function ratingSlots(opts: {
  humans: readonly string[];
  bots: readonly string[];
  strength: (id: string) => number;
  botPlacement: 'byes' | 'random';
  rng: Rng;
}): string[] {
  const { humans, bots, strength, rng } = opts;
  const seeded =
    opts.botPlacement === 'byes'
      ? [...byStrength(humans, strength, rng), ...byStrength(bots, strength, rng)]
      : byStrength([...humans, ...bots], strength, rng);
  return slotsFromSeeds(seeded);
}

/**
 * 1v1: the bots for the free places, those closest to the players' average first (a bracket of
 * similar strength); without players the pool's average.
 */
export function pickBotsNear(
  pool: readonly RatedBot[],
  count: number,
  humanStrengths: readonly number[],
  rng: Rng,
): RatedBot[] {
  const unique = pool.filter((b, i) => pool.findIndex((x) => x.spec.name === b.spec.name) === i);
  const target = humanStrengths.length ? mean(humanStrengths) : mean(unique.map((b) => b.strength));
  return shuffle(unique, rng)
    .map((b, i) => ({ b, i, d: Math.abs(b.strength - target) }))
    .sort((x, y) => x.d - y.d || x.i - y.i)
    .slice(0, count)
    .map((x) => x.b);
}

/**
 * Teams: bots for every open starter place so that all teams come out close to one target
 * strength (the players' average; without players the pool's average). The team with the most
 * open places picks next, always the bot closest to what it still needs per place. A team never
 * gets the same bot twice; a bot plays for several teams only when the pool is too small.
 *
 * `teams[i].humans` are the strengths of the team's players, `need` its open places.
 */
export function balanceBots(
  teams: readonly { humans: readonly number[]; need: number }[],
  pool: readonly RatedBot[],
  teamSize: number,
  rng: Rng,
): BotSpec[][] {
  const unique = shuffle(
    pool.filter((b, i) => pool.findIndex((x) => x.spec.name === b.spec.name) === i),
    rng,
  );
  const needTotal = teams.reduce((a, t) => a + t.need, 0);
  for (const t of teams)
    if (t.need > unique.length)
      throw new Error(`need ${t.need} different bots, the pool has ${unique.length}`);
  const humans = teams.flatMap((t) => t.humans);
  const target = humans.length ? mean(humans) : mean(unique.map((b) => b.strength));
  const maxUses = Math.max(1, Math.ceil(needTotal / Math.max(1, unique.length)));
  const uses = new Map<string, number>();
  const picked = teams.map(() => [] as RatedBot[]);
  const sum = teams.map((t) => t.humans.reduce((a, b) => a + b, 0));
  const open = teams.map((t) => t.need);
  for (let step = 0; step < needTotal; step++) {
    let ti = -1;
    for (let i = 0; i < teams.length; i++)
      if (open[i]! > 0 && (ti < 0 || open[i]! > open[ti]!)) ti = i;
    const want = (teamSize * target - sum[ti]!) / open[ti]!;
    const fits = (limit: number) =>
      unique.filter(
        (b) =>
          (uses.get(b.spec.name) ?? 0) < limit &&
          !picked[ti]!.some((p) => p.spec.name === b.spec.name),
      );
    // Prefer bots that are used less often; fall back to any bot not yet in this team.
    let candidates = fits(maxUses);
    if (!candidates.length) candidates = fits(Infinity);
    const best = candidates.reduce((a, b) =>
      Math.abs(b.strength - want) < Math.abs(a.strength - want) ? b : a,
    );
    picked[ti]!.push(best);
    uses.set(best.spec.name, (uses.get(best.spec.name) ?? 0) + 1);
    sum[ti]! += best.strength;
    open[ti]!--;
  }
  improve(picked, sum, uses, unique, teamSize, target, maxUses);
  return picked.map((list) => list.map((b) => b.spec));
}

/**
 * Local search after the greedy pass: swaps bots between teams, or with an unused bot of the
 * pool, while that brings the team averages closer to the target (sum of squared distances).
 */
function improve(
  picked: RatedBot[][],
  sum: number[],
  uses: Map<string, number>,
  pool: readonly RatedBot[],
  teamSize: number,
  target: number,
  maxUses: number,
): void {
  const cost = (s: number) => (s / teamSize - target) ** 2;
  const has = (team: number, name: string) => picked[team]!.some((b) => b.spec.name === name);
  for (let round = 0; round < 500; round++) {
    let best: { gain: number; apply: () => void } | undefined;
    const consider = (gain: number, apply: () => void) => {
      if (gain > 1e-6 && (!best || gain > best.gain)) best = { gain, apply };
    };
    for (let a = 0; a < picked.length; a++) {
      for (let i = 0; i < picked[a]!.length; i++) {
        const x = picked[a]![i]!;
        // Swap with a bot of another team.
        for (let b = a + 1; b < picked.length; b++) {
          for (let j = 0; j < picked[b]!.length; j++) {
            const y = picked[b]![j]!;
            if (x.spec.name === y.spec.name || has(a, y.spec.name) || has(b, x.spec.name)) continue;
            const d = y.strength - x.strength;
            const gain = cost(sum[a]!) + cost(sum[b]!) - cost(sum[a]! + d) - cost(sum[b]! - d);
            consider(gain, () => {
              picked[a]![i] = y;
              picked[b]![j] = x;
              sum[a]! += d;
              sum[b]! -= d;
            });
          }
        }
        // Replace with a bot that is used less.
        for (const y of pool) {
          if (has(a, y.spec.name) || (uses.get(y.spec.name) ?? 0) >= maxUses) continue;
          const d = y.strength - x.strength;
          const gain = cost(sum[a]!) - cost(sum[a]! + d);
          consider(gain, () => {
            picked[a]![i] = y;
            sum[a]! += d;
            uses.set(x.spec.name, (uses.get(x.spec.name) ?? 1) - 1);
            uses.set(y.spec.name, (uses.get(y.spec.name) ?? 0) + 1);
          });
        }
      }
    }
    if (!best) return;
    best.apply();
  }
}

/** Average strength of a team: its players and bots. */
export const teamStrength = (members: readonly number[]) => Math.round(mean(members));
