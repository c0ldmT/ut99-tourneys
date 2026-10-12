import { shuffle, type Rng } from '@tourney/bracket';
import type { BotSpec } from './domain.js';

/**
 * Bots for the starter places nobody fills. Walks through a shuffled pool, wrapping around when
 * it runs out, so bots spread over the teams; a team never gets the same bot twice.
 * `need` holds the number of bots per team in bracket order.
 */
export function assignBots(
  need: readonly number[],
  pool: readonly BotSpec[],
  rng: Rng,
): BotSpec[][] {
  const unique = pool.filter((b, i) => pool.findIndex((x) => x.name === b.name) === i);
  const order = shuffle(unique, rng);
  let cursor = 0;
  return need.map((n) => {
    if (n > order.length) throw new Error(`need ${n} different bots, the pool has ${order.length}`);
    const picked: BotSpec[] = [];
    while (picked.length < n) {
      const bot = order[cursor++ % order.length] as BotSpec;
      if (!picked.some((b) => b.name === bot.name)) picked.push(bot);
    }
    return picked;
  });
}
