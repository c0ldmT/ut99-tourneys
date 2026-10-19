import { today, zonedMs } from '../seasons/season-time.js';

/**
 * When a series' tournaments start (pure). A series runs on one weekday at a local time in the
 * season time zone, every n weeks counted from its anchor date.
 */

export interface SeriesSchedule {
  /** ISO weekday 1 (Monday) .. 7 (Sunday). */
  weekday: number;
  /** "HH:MM", local time. */
  time: string;
  everyWeeks: number;
  /** A date of the series (YYYY-MM-DD, on its weekday): the weeks count from it. */
  anchorDate: string;
}

const DAY = 86_400_000;

const dateUtc = (d: string) => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
};
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => fmt(dateUtc(d) + n * DAY);
/** ISO weekday of a date. */
export const isoWeekday = (d: string) => ((new Date(dateUtc(d)).getUTCDay() + 6) % 7) + 1;

/** Start instant (epoch ms) of a local date and time in the time zone. */
export const localStart = (date: string, time: string, timeZone: string) =>
  zonedMs(date, time, timeZone);

/** The first date on the weekday on or after `from` (the anchor of a new series). */
export function firstDate(from: string, weekday: number): string {
  const diff = (weekday - isoWeekday(from) + 7) % 7;
  return addDays(from, diff);
}

/** The first start of the series strictly after `afterMs`. */
export function nextStart(s: SeriesSchedule, afterMs: number, timeZone: string): number {
  const step = 7 * Math.max(1, s.everyWeeks);
  // Start from the anchor (moved to the weekday), jump close to `afterMs`, then step on.
  let d = firstDate(s.anchorDate, s.weekday);
  const fromDay = today(afterMs, timeZone);
  const gap = Math.floor((dateUtc(fromDay) - dateUtc(d)) / DAY);
  if (gap > step) d = addDays(d, Math.floor((gap - 1) / step) * step);
  for (let i = 0; i < 60; i++) {
    const t = localStart(d, s.time, timeZone);
    if (t > afterMs) return t;
    d = addDays(d, step);
  }
  return localStart(d, s.time, timeZone);
}

/** Fills the name pattern: {n} the number, {date} the start date (DD.MM.). */
export function seriesName(pattern: string, n: number, startMs: number, timeZone: string): string {
  const date = new Intl.DateTimeFormat('de-DE', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(startMs));
  const name = pattern.replace(/\{n\}/g, String(n)).replace(/\{date\}/g, date);
  return /\{n\}|\{date\}/.test(pattern) ? name : `${name} #${n}`;
}
