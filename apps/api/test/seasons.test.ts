import { describe, expect, it } from 'vitest';
import {
  dayStartMs,
  isValidDate,
  nextDay,
  seasonAt,
  seasonStatus,
  seasonWindow,
  today,
} from '../src/seasons/season-time.js';

const TZ = 'Europe/Berlin';

describe('season dates', () => {
  it('starts days at midnight in the season time zone, also around DST', () => {
    expect(new Date(dayStartMs('2026-10-17', TZ)).toISOString()).toBe('2026-10-16T22:00:00.000Z');
    expect(new Date(dayStartMs('2026-12-01', TZ)).toISOString()).toBe('2026-11-30T23:00:00.000Z');
    // The day the clocks go back (25 hours) and forward (23 hours).
    expect(dayStartMs('2026-10-26', TZ) - dayStartMs('2026-10-25', TZ)).toBe(25 * 3600_000);
    expect(dayStartMs('2027-03-29', TZ) - dayStartMs('2027-03-28', TZ)).toBe(23 * 3600_000);
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(today(Date.parse('2026-10-16T22:30:00Z'), TZ)).toBe('2026-10-17');
    expect(isValidDate('2026-02-30')).toBe(false);
    expect(isValidDate('2026-02-28')).toBe(true);
  });

  it('runs from the first to the end of the last day, or until ended early', () => {
    const s = { number: 1, startDate: '2026-10-17', endDate: '2026-10-31' };
    const w = seasonWindow(s, TZ);
    expect(new Date(w.to).toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(seasonStatus(s, w.from - 1, TZ)).toBe('planned');
    expect(seasonStatus(s, w.from, TZ)).toBe('running');
    expect(seasonStatus(s, w.to - 1, TZ)).toBe('running');
    expect(seasonStatus(s, w.to, TZ)).toBe('ended');
    const ended = { ...s, endedAt: '2026-10-20T12:00:00.000Z' };
    expect(seasonStatus(ended, Date.parse('2026-10-20T12:00:01Z'), TZ)).toBe('ended');
    const two = { number: 2, startDate: '2026-11-01', endDate: '2026-11-30' };
    expect(seasonAt([s, two], Date.parse('2026-11-01T00:30:00+01:00'), TZ)?.number).toBe(2);
    expect(seasonAt([s, two], Date.parse('2026-10-31T23:30:00+01:00'), TZ)?.number).toBe(1);
    expect(seasonAt([s, two], Date.parse('2026-12-01T12:00:00Z'), TZ)).toBeUndefined();
  });
});
