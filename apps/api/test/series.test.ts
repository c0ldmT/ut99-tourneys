import { describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import { SeriesService } from '../src/series/series.service.js';
import { firstDate, isoWeekday, nextStart, seriesName } from '../src/series/series-time.js';
import { Client, startApi, tournamentBody } from './helpers.js';

const TZ = 'Europe/Berlin';
const iso = (ms: number) => new Date(ms).toISOString();

describe('series times (pure)', () => {
  it('finds the next start on the weekday, in local time, across the DST change', () => {
    expect(isoWeekday('2026-10-19')).toBe(1); // Monday
    expect(firstDate('2026-10-19', 5)).toBe('2026-10-23');
    const s = { weekday: 5, time: '20:00', everyWeeks: 1, anchorDate: '2026-10-23' };
    expect(iso(nextStart(s, Date.parse('2026-10-19T10:00:00Z'), TZ))).toBe(
      '2026-10-23T18:00:00.000Z', // 20:00 CEST
    );
    expect(iso(nextStart(s, Date.parse('2026-10-23T18:00:00Z'), TZ))).toBe(
      '2026-10-30T19:00:00.000Z', // 20:00 CET after the change
    );
    const two = { ...s, everyWeeks: 2 };
    expect(iso(nextStart(two, Date.parse('2026-10-24T00:00:00Z'), TZ))).toBe(
      '2026-11-06T19:00:00.000Z',
    );
    // Far later: still on the rhythm.
    expect(iso(nextStart(two, Date.parse('2027-03-01T00:00:00Z'), TZ))).toBe(
      '2027-03-12T19:00:00.000Z',
    );
  });

  it('names the tournaments', () => {
    const t = Date.parse('2026-10-23T18:00:00Z');
    expect(seriesName('Friday Cup #{n}', 3, t, TZ)).toBe('Friday Cup #3');
    expect(seriesName('Cup {date}', 3, t, TZ)).toBe('Cup 23.10.');
    expect(seriesName('Friday Cup', 3, t, TZ)).toBe('Friday Cup #3');
  });
});

describe('series', () => {
  it('creates the next tournament a few days before its start, once', async () => {
    const clock = new FakeClock(Date.parse('2026-10-19T10:00:00Z'));
    const { api } = await startApi({}, { clock });
    try {
      const admin = await Client.login(api, 'Boss', true);
      await admin.post('/agents', { id: 'pi', name: 'Pi' });
      const t = await admin.post('/tournaments', tournamentBody({ name: 'Template Cup' }));
      const created = await admin.post('/series', {
        fromTournament: t.body.id,
        name: 'Friday Cup #{n}',
        weekday: 5,
        time: '20:00',
        leadDays: 7,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      // The first start is this Friday: within the lead time, so it was created at once.
      const list = (await admin.get('/tournaments')).body as any[];
      const first = list.find((x) => x.name === 'Friday Cup #1');
      expect(first).toMatchObject({
        scheduledAt: '2026-10-23T18:00:00.000Z',
        registrationOpen: true,
      });
      const view = (await admin.get('/series')).body[0];
      expect(view).toMatchObject({
        nextNumber: 2,
        nextName: 'Friday Cup #2',
        nextStart: '2026-10-30T19:00:00.000Z',
        nextCreateAt: '2026-10-23T19:00:00.000Z',
        tournaments: 1,
      });
      const svc = api.app.get(SeriesService);
      svc.tick();
      expect((await admin.get('/tournaments')).body).toHaveLength(2);
      clock.advance(4 * 86_400_000 + 10 * 3_600_000); // Friday 23.10., 20:00 UTC
      svc.tick();
      const after = (await admin.get('/tournaments')).body as any[];
      expect(after.map((x) => x.name)).toContain('Friday Cup #2');
      // Paused: nothing more; "now" creates the next one anyway.
      const id = view.id as string;
      expect((await admin.patch(`/series/${id}`, { active: false })).body.active).toBe(false);
      clock.advance(7 * 86_400_000);
      svc.tick();
      expect((await admin.get('/tournaments')).body).toHaveLength(3);
      expect((await admin.post(`/series/${id}/run`)).body.nextNumber).toBe(4);
      // Players cannot see or change series.
      const mario = await Client.login(api, 'Mario');
      expect((await mario.get('/series')).status).toBe(403);
    } finally {
      await api.close();
    }
  });
});
