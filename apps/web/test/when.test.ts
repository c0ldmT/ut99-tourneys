import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { I18n as I18nType } from '../src/app/core/i18n';

let i18n: I18nType;

beforeAll(async () => {
  // I18n touches the document and the storage of the browser.
  vi.stubGlobal('document', { documentElement: { lang: '' } });
  vi.stubGlobal('localStorage', { getItem: () => 'de', setItem: () => undefined });
  const { I18n } = await import('../src/app/core/i18n');
  i18n = new I18n();
});

describe('I18n.when (decision 298)', () => {
  it('writes days and dates the same way everywhere', () => {
    expect(i18n.whenDay('2026-12-05', 'date')).toBe('05.12.2026');
    expect(i18n.whenDay('2026-12-05', 'day')).toBe('Sa., 05.12.');
    expect(i18n.whenDay('2026-12-05', 'dayLong')).toBe('Samstag, 5. Dezember');
    expect(i18n.whenDay('2026-12-05', 'weekday')).toBe('Samstag');
    expect(i18n.whenDay('2026-12-15', 'monthYear')).toBe('Dezember 2026');
    expect(i18n.when('2026-12-05T17:00:00Z', 'time', 'Europe/Berlin')).toBe('18:00');
    expect(i18n.when('2026-12-05T17:00:00Z', 'dateTime', 'Europe/Berlin')).toBe(
      '05.12.2026, 18:00',
    );
    expect(i18n.when(null)).toBe('');
    expect(i18n.when('no date')).toBe('');
  });

  it('says today, tomorrow and yesterday', () => {
    const at = (days: number) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      d.setHours(18, 0, 0, 0);
      return d.toISOString();
    };
    expect(i18n.when(at(0), 'relShort')).toBe('heute 18:00');
    expect(i18n.when(at(1), 'relShort')).toBe('morgen 18:00');
    expect(i18n.when(at(-1), 'relative')).toBe('Gestern, 18:00');
    expect(i18n.when(at(0), 'relDay')).toBe('Heute');
  });

  it('keeps the old date() and day() of the callers', () => {
    expect(i18n.day('2026-10-17')).toBe('17.10.2026');
    i18n.set('en');
    expect(i18n.whenDay('2026-12-05', 'date')).toBe('5 Dec 2026');
  });
});
