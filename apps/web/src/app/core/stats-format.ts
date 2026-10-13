import { raceTime } from './race';
import type { StatsRecord } from './types';

/** Play time: "45 min" below an hour, else "3:05 h". */
export function playTime(sec: number): string {
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`;
}

/** A record's value as shown on the page. */
export function recordValue(r: Pick<StatsRecord, 'value' | 'unit'>): string {
  switch (r.unit) {
    case 'ms':
      return raceTime(r.value);
    case 'sec':
      return raceTime(r.value * 1000, false);
    case 'ratio':
      return r.value.toFixed(2);
    default:
      return String(r.value);
  }
}

export const percent = (x: number) => `${Math.round(x * 100)} %`;

/** Route key of a player (keys contain ":"). */
export const playerLink = (key: string) => ['/stats/p', key];
