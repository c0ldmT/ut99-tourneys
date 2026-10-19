import { today, zonedMs } from '../seasons/season-time.js';

/**
 * When a series' tournaments start (pure). A series runs on some weekdays (all seven: daily) at
 * fixed local times or every n hours within a window, in the season time zone; the weekdays
 * repeat every n weeks counted from the week of its anchor date.
 */

/** Every n hours from `from` up to `to` (local times "HH:MM", `to` included). */
export interface HourInterval {
  hours: number;
  from: string;
  to: string;
}

export interface SeriesSchedule {
  /** ISO weekdays 1 (Monday) .. 7 (Sunday). */
  days: number[];
  /** Local start times "HH:MM" (or `every`). */
  times: string[];
  every?: HourInterval | null;
  everyWeeks: number;
  /** A date of the series (YYYY-MM-DD): the weeks count from its week. */
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
const monday = (d: string) => addDays(d, 1 - isoWeekday(d));
const minutes = (t: string) => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
};
const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Start instant (epoch ms) of a local date and time in the time zone. */
export const localStart = (date: string, time: string, timeZone: string) =>
  zonedMs(date, time, timeZone);

/** The first date on the weekday on or after `from`. */
export function firstDate(from: string, weekday: number): string {
  const diff = (weekday - isoWeekday(from) + 7) % 7;
  return addDays(from, diff);
}

/** The start times of a day, sorted, without doubles (`every` expanded). */
export function dayTimes(s: Pick<SeriesSchedule, 'times' | 'every'>): string[] {
  const list = [...s.times];
  if (s.every) {
    const step = Math.max(1, s.every.hours) * 60;
    const end = minutes(s.every.to);
    for (let t = minutes(s.every.from); t <= end && t < 24 * 60; t += step) list.push(hhmm(t));
  }
  return [...new Set(list)].sort();
}

/** The first start of the series strictly after `afterMs` (NaN without days or times). */
export function nextStart(s: SeriesSchedule, afterMs: number, timeZone: string): number {
  const times = dayTimes(s);
  const days = new Set(s.days);
  if (!times.length || !days.size) return NaN;
  const weeks = Math.max(1, s.everyWeeks);
  const anchorWeek = dateUtc(monday(s.anchorDate));
  // One day before (time zones), then day by day: at most every n weeks plus a week.
  let d = addDays(today(afterMs, timeZone), -1);
  for (let i = 0; i < 7 * weeks + 9; i++, d = addDays(d, 1)) {
    if (!days.has(isoWeekday(d))) continue;
    const week = Math.round((dateUtc(monday(d)) - anchorWeek) / (7 * DAY));
    if (((week % weeks) + weeks) % weeks !== 0) continue;
    for (const t of times) {
      const at = localStart(d, t, timeZone);
      if (at > afterMs) return at;
    }
  }
  return NaN;
}

/**
 * When the tournament of a start is created: `leadMinutes` before it; whole days count in local
 * time (7 days before 20:00 is 20:00, also across a daylight saving change).
 */
export function createTime(startMs: number, leadMinutes: number, timeZone: string): number {
  if (!leadMinutes || leadMinutes % 1440 !== 0) return startMs - leadMinutes * 60_000;
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(startMs));
  return localStart(addDays(today(startMs, timeZone), -leadMinutes / 1440), time, timeZone);
}

/** The next `count` starts after `afterMs`. */
export function nextStarts(
  s: SeriesSchedule,
  afterMs: number,
  timeZone: string,
  count: number,
): number[] {
  const out: number[] = [];
  let after = afterMs;
  for (let i = 0; i < count; i++) {
    const t = nextStart(s, after, timeZone);
    if (!Number.isFinite(t)) break;
    out.push(t);
    after = t;
  }
  return out;
}

/**
 * Fills the name pattern: {n} the number, {date} the start date (DD.MM.), {time} the start time
 * (HH:MM); without {n} and {date} " #n" is added.
 */
export function seriesName(pattern: string, n: number, startMs: number, timeZone: string): string {
  const part = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('de-DE', { timeZone, ...o }).format(new Date(startMs));
  const name = pattern
    .replace(/\{n\}/g, String(n))
    .replace(/\{date\}/g, part({ day: '2-digit', month: '2-digit' }))
    .replace(/\{time\}/g, part({ hour: '2-digit', minute: '2-digit', hour12: false }));
  return /\{n\}|\{date\}/.test(pattern) ? name : `${name} #${n}`;
}
