import type { I18n } from './i18n';

/** The schedule of a series (as the API stores it). */
export interface ScheduleLike {
  days: number[];
  times: string[];
  every: { hours: number; from: string; to: string } | null;
  everyWeeks: number;
}

/** Short weekday names, Monday first (1 = Monday). */
export function weekdayNames(i18n: I18n, style: 'short' | 'long' = 'short'): string[] {
  const loc = i18n.lang() === 'de' ? 'de-DE' : 'en-GB';
  // 2026-10-19 is a Monday.
  return [1, 2, 3, 4, 5, 6, 7].map((n) =>
    new Date(Date.UTC(2026, 9, 18 + n))
      .toLocaleDateString(loc, { weekday: style, timeZone: 'UTC' })
      .replace('.', ''),
  );
}

/** "Mon, Wed, Fri · 18:00" / "daily · every 4 h (00:00–23:59)" / "every 2 weeks: Mon · 20:00". */
export function scheduleText(i18n: I18n, s: ScheduleLike): string {
  const names = weekdayNames(i18n);
  const days =
    s.days.length === 7
      ? i18n.t('series.daily')
      : [...s.days]
          .sort()
          .map((d) => names[d - 1])
          .join(', ');
  const when = s.everyWeeks > 1 ? i18n.t('series.everyNWeeks', { n: s.everyWeeks, days }) : days;
  const times = [...s.times].sort();
  if (s.every) times.push(i18n.t('series.everyHours', { n: s.every.hours, ...s.every }));
  return `${when} · ${times.join(', ')}`;
}

/** A lead time in the largest unit that fits: "30 min", "3 h", "7 days". */
export function leadText(i18n: I18n, minutes: number): string {
  if (minutes && minutes % 1440 === 0) return i18n.t('unit.days', { n: minutes / 1440 });
  if (minutes && minutes % 60 === 0) return i18n.t('unit.hours', { n: minutes / 60 });
  return i18n.t('unit.minutes', { n: minutes });
}
