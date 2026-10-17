import type { SeasonsOverview, StatScope } from './types';

/** Seasons to look at: the running one and the archive (newest first); planned ones not. */
export const startedSeasons = (o: SeasonsOverview | null) =>
  [...(o?.seasons ?? [])].filter((s) => s.status !== 'planned').reverse();

/** What the statistics show first: the running season, else the last one, else lifetime. */
export function defaultScope(o: SeasonsOverview | null): StatScope {
  return o?.current ?? startedSeasons(o)[0]?.number ?? 'lifetime';
}

/** "lifetime" or a season number from a select value. */
export const parseScope = (v: string): StatScope => (v === 'lifetime' ? 'lifetime' : Number(v));
