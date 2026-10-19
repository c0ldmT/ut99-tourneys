/**
 * Season dates (pure): a season runs from the start of its first day to the end of its last day
 * in the season time zone, or until an admin ended it early.
 */

export interface SeasonDates {
  number: number;
  startDate: string;
  endDate: string;
  endedAt?: string | null;
}

export type SeasonStatus = 'planned' | 'running' | 'ended';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
}

/** Offset of the time zone from UTC at an instant, in ms (Berlin in summer: +2 h). */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Midnight at the start of a day (YYYY-MM-DD) in the time zone, as epoch ms. */
export function dayStartMs(date: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(guess, timeZone);
  t = guess - offsetMs(t, timeZone); // corrects a guess on the other side of a DST change
  return t;
}

/** A local date and time ("HH:MM") in the time zone, as epoch ms. */
export function zonedMs(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [h, min] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - offsetMs(guess, timeZone);
  t = guess - offsetMs(t, timeZone);
  return t;
}

/** The day after (YYYY-MM-DD). */
export function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Today (YYYY-MM-DD) in the time zone. */
export function today(now: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
}

/** [start, end) of a season in epoch ms. */
export function seasonWindow(s: SeasonDates, timeZone: string): { from: number; to: number } {
  const from = dayStartMs(s.startDate, timeZone);
  const end = dayStartMs(nextDay(s.endDate), timeZone);
  const ended = s.endedAt ? Date.parse(s.endedAt) : Infinity;
  return { from, to: Math.max(from, Math.min(end, ended)) };
}

export function seasonStatus(s: SeasonDates, now: number, timeZone: string): SeasonStatus {
  const w = seasonWindow(s, timeZone);
  if (now < w.from) return 'planned';
  return now < w.to ? 'running' : 'ended';
}

/** The season whose window contains the instant. */
export function seasonAt<T extends SeasonDates>(
  seasons: readonly T[],
  instant: number,
  timeZone: string,
): T | undefined {
  return seasons.find((s) => {
    const w = seasonWindow(s, timeZone);
    return instant >= w.from && instant < w.to;
  });
}
