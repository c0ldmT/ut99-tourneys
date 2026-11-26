import { inject, Injectable, Pipe, signal, type PipeTransform } from '@angular/core';
import { DICT, translate, type Lang } from './i18n-dict';

const KEY = 'tourney.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'de' || saved === 'en') return saved;
  } catch {
    // storage unavailable
  }
  return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export type WhenStyle =
  | 'time'
  | 'date'
  | 'dateTime'
  | 'day'
  | 'dayTime'
  | 'dayLong'
  | 'weekday'
  | 'weekdayShort'
  | 'dayMonth'
  | 'monthYear'
  | 'relDay'
  | 'relative'
  | 'relShort';

const WHEN: Record<
  Exclude<WhenStyle, 'relDay' | 'relative' | 'relShort'>,
  Intl.DateTimeFormatOptions
> = {
  time: { hour: '2-digit', minute: '2-digit' },
  date: { dateStyle: 'medium' },
  dateTime: { dateStyle: 'medium', timeStyle: 'short' },
  day: { weekday: 'short', day: '2-digit', month: '2-digit' },
  dayTime: {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  },
  dayLong: { weekday: 'long', day: 'numeric', month: 'long' },
  weekday: { weekday: 'long' },
  weekdayShort: { weekday: 'short' },
  dayMonth: { day: '2-digit', month: '2-digit' },
  monthYear: { month: 'long', year: 'numeric' },
};

/** Runtime translations (English and German), switchable without reloading. */
@Injectable({ providedIn: 'root' })
export class I18n {
  readonly lang = signal<Lang>(initialLang());
  readonly languages: Lang[] = Object.keys(DICT) as Lang[];

  constructor() {
    document.documentElement.lang = this.lang();
  }

  set(lang: Lang): void {
    this.lang.set(lang);
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(KEY, lang);
    } catch {
      // storage unavailable
    }
  }

  t(key: string, params?: Record<string, string | number>): string {
    return translate(this.lang(), key, params);
  }

  /** The language's locale for numbers and dates. */
  locale(): string {
    return this.lang() === 'de' ? 'de-DE' : 'en-GB';
  }

  /**
   * Every date and time on the website (decision 298), in one of a few styles:
   * time "18:00" · date "05.12.2026" · dateTime "05.12.2026, 18:00" · day "Sa., 05.12." ·
   * dayTime "Sa., 05.12., 18:00" · dayLong "Samstag, 5. Dezember" · weekday "Samstag" ·
   * weekdayShort "Sa." · dayMonth "05.12." · monthYear "Dezember 2026" ·
   * relDay "Heute" / "Morgen" / "Gestern" / a weekday within a week / "Sa., 5. Dezember" ·
   * relative relDay + time · relShort "heute 18:00" / "morgen 18:00" / "Sa., 05.12. 18:00".
   * `timeZone`: the zone to show (default the browser's; days of the calendar use UTC).
   */
  when(iso: string | null | undefined, style: WhenStyle = 'dateTime', timeZone?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const fmt = (o: Intl.DateTimeFormatOptions) =>
      d.toLocaleString(this.locale(), { ...o, ...(timeZone ? { timeZone } : {}) });
    if (style === 'relDay' || style === 'relative' || style === 'relShort')
      return this.relative(d, style, fmt);
    return fmt(WHEN[style]);
  }

  /** A day (YYYY-MM-DD) in a style of `when` (without times), e.g. "05.12.2026". */
  whenDay(day: string | null | undefined, style: WhenStyle = 'date'): string {
    return day ? this.when(`${day.slice(0, 10)}T12:00:00Z`, style, 'UTC') : '';
  }

  private relative(
    d: Date,
    style: 'relDay' | 'relative' | 'relShort',
    fmt: (o: Intl.DateTimeFormatOptions) => string,
  ): string {
    const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const n = Math.round((midnight(d) - midnight(new Date())) / 86_400_000);
    const time = fmt(WHEN.time);
    if (style === 'relShort') {
      if (n === 0) return this.t('when.todayAt', { t: time });
      if (n === 1) return this.t('when.tomorrowAt', { t: time });
      if (n === -1) return this.t('when.yesterdayAt', { t: time });
      return `${fmt(WHEN.day)} ${time}`;
    }
    let day: string;
    if (n === 0) day = this.t('when.today');
    else if (n === 1) day = this.t('when.tomorrow');
    else if (n === -1) day = this.t('when.yesterday');
    else if (n > 1 && n < 7) day = fmt({ weekday: 'long', day: '2-digit', month: '2-digit' });
    else if (n < 0 && n > -7) day = fmt({ weekday: 'long' });
    else
      day = fmt({
        weekday: 'short',
        day: 'numeric',
        month: 'long',
        year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
      });
    return style === 'relDay' ? day : `${day}, ${time}`;
  }

  /** @deprecated use `when` (kept for the existing callers): date and time, or only the day. */
  date(iso: string | null | undefined, opts: { dateOnly?: boolean } = {}): string {
    return opts.dateOnly ? this.when(iso, 'date', 'UTC') : this.when(iso, 'dateTime');
  }

  /** A day (YYYY-MM-DD) as a date, e.g. "17.10.2026". */
  day(d: string): string {
    return this.whenDay(d, 'date');
  }
}

/** {{ iso | when }} or {{ iso | when: 'day' }} (I18n.when); re-evaluated when the language changes. */
@Pipe({ name: 'when', pure: false })
export class WhenPipe implements PipeTransform {
  private readonly i18n = inject(I18n);
  transform(iso: string | null | undefined, style: WhenStyle = 'dateTime'): string {
    return this.i18n.when(iso, style);
  }
}

/** {{ 'key' | t }} or {{ 'key' | t: { n: 3 } }}; re-evaluated when the language changes. */
@Pipe({ name: 't', pure: false })
export class TPipe implements PipeTransform {
  private readonly i18n = inject(I18n);
  transform(key: string, params?: Record<string, string | number>): string {
    return this.i18n.t(key, params);
  }
}
