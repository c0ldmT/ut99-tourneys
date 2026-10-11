import { shuffle, type Rng } from './rng.js';
import { BRACKET_SIZES, type BracketSize, type EntrantId } from './types.js';

/**
 * Seed number for every first-round slot, so that seed 1 meets seed `size` first,
 * and seeds 1 and 2 can only meet in the final.
 *
 * 8 -> [1, 8, 4, 5, 2, 7, 3, 6]
 */
export function standardSeedOrder(size: number): number[] {
  if (size < 2 || (size & (size - 1)) !== 0)
    throw new Error(`size must be a power of two, got ${size}`);
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** Places entrants given in seed order (best first) into first-round slots. */
export function slotsFromSeeds(seeded: readonly EntrantId[]): EntrantId[] {
  const order = standardSeedOrder(seeded.length);
  return order.map((seed) => seeded[seed - 1] as EntrantId);
}

export function smallestBracketSize(entrantCount: number): BracketSize {
  const size = BRACKET_SIZES.find((s) => s >= entrantCount);
  if (!size)
    throw new Error(`at most ${BRACKET_SIZES[BRACKET_SIZES.length - 1]} entrants supported`);
  return size;
}

export interface BuildSlotsInput {
  size: BracketSize;
  /** Human entrants. In 'seeded' order mode the order is the seed order (best first). */
  humans: readonly EntrantId[];
  /** Pool of bot entrant ids to fill empty slots from. Must be at least size - humans.length. */
  botPool: readonly EntrantId[];
  /**
   * - 'random':  humans get shuffled before seeding.
   * - 'seeded':  humans keep the given order as seed order.
   */
  humanOrder: 'random' | 'seeded';
  /**
   * - 'byes':    bots take the lowest seeds, so as long as there are at least size/2 humans,
   *              every bot plays a human in round one (classic bye placement).
   * - 'random':  bots and humans are mixed completely at random.
   */
  botPlacement: 'byes' | 'random';
  rng: Rng;
}

/**
 * Builds first-round slots for a bracket, filling empty slots with randomly chosen bots.
 * For manual stacking the organizer edits the returned slots directly.
 */
export function buildSlots(input: BuildSlotsInput): EntrantId[] {
  const { size, humans, botPool, rng } = input;
  if (humans.length > size) throw new Error(`${humans.length} humans do not fit into size ${size}`);
  const missing = size - humans.length;
  if (botPool.length < missing) throw new Error(`need ${missing} bots, pool has ${botPool.length}`);
  const bots = shuffle(botPool, rng).slice(0, missing);
  const orderedHumans = input.humanOrder === 'random' ? shuffle(humans, rng) : [...humans];

  if (input.botPlacement === 'random') {
    return shuffle([...orderedHumans, ...bots], rng);
  }
  return slotsFromSeeds([...orderedHumans, ...bots]);
}

/** Fills the empty (null) slots of a manually stacked bracket with random bots from the pool. */
export function fillEmptySlots(
  slots: readonly (EntrantId | null)[],
  botPool: readonly EntrantId[],
  rng: Rng,
): EntrantId[] {
  const used = new Set(slots.filter((s): s is EntrantId => s !== null));
  const available = shuffle(
    botPool.filter((b) => !used.has(b)),
    rng,
  );
  const missing = slots.filter((s) => s === null).length;
  if (available.length < missing)
    throw new Error(`need ${missing} bots, pool has ${available.length}`);
  let next = 0;
  return slots.map((s) => (s === null ? (available[next++] as EntrantId) : s));
}
