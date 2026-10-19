import { describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import { SeriesService } from '../src/series/series.service.js';
import { AutoStartService } from '../src/tournaments/auto-start.service.js';
import {
  createTime,
  dayTimes,
  firstDate,
  isoWeekday,
  nextStart,
  nextStarts,
  seriesName,
} from '../src/series/series-time.js';
import { Client, startApi, tournamentBody } from './helpers.js';

const TZ = 'Europe/Berlin';
const iso = (ms: number) => new Date(ms).toISOString();

describe('series times (pure)', () => {
  it('finds the next start on the weekday, in local time, across the DST change', () => {
    expect(isoWeekday('2026-10-19')).toBe(1); // Monday
    expect(firstDate('2026-10-19', 5)).toBe('2026-10-23');
    const s = { days: [5], times: ['20:00'], everyWeeks: 1, anchorDate: '2026-10-23' };
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

  it('runs on several weekdays, at several times or every n hours', () => {
    const at = (x: number) => iso(x);
    const mwf = { days: [1, 3, 5], times: ['18:00'], everyWeeks: 1, anchorDate: '2026-10-19' };
    expect(nextStarts(mwf, Date.parse('2026-10-19T17:00:00Z'), TZ, 4).map(at)).toEqual([
      '2026-10-21T16:00:00.000Z', // Wed (Mon 18:00 CEST = 16:00Z has passed)
      '2026-10-23T16:00:00.000Z', // Fri
      '2026-10-26T17:00:00.000Z', // Mon, CET
      '2026-10-28T17:00:00.000Z',
    ]);
    const daily = { days: [1, 2, 3, 4, 5, 6, 7], times: ['22:00', '12:00', '16:00'] };
    const d = { ...daily, everyWeeks: 1, anchorDate: '2026-10-19' };
    expect(nextStarts(d, Date.parse('2026-10-19T13:00:00Z'), TZ, 4).map(at)).toEqual([
      '2026-10-19T14:00:00.000Z',
      '2026-10-19T20:00:00.000Z',
      '2026-10-20T10:00:00.000Z',
      '2026-10-20T14:00:00.000Z',
    ]);
    const every = { hours: 4, from: '00:00', to: '23:59' };
    expect(dayTimes({ times: [], every })).toEqual([
      '00:00',
      '04:00',
      '08:00',
      '12:00',
      '16:00',
      '20:00',
    ]);
    expect(dayTimes({ times: ['13:30'], every: { hours: 3, from: '12:00', to: '18:00' } })).toEqual(
      ['12:00', '13:30', '15:00', '18:00'],
    );
    // Every second week on Mon and Thu.
    const two = { days: [1, 4], times: ['20:00'], everyWeeks: 2, anchorDate: '2026-10-21' };
    expect(nextStarts(two, Date.parse('2026-10-23T00:00:00Z'), TZ, 2).map(at)).toEqual([
      '2026-11-02T19:00:00.000Z',
      '2026-11-05T19:00:00.000Z',
    ]);
  });

  it('creates whole days ahead in local time', () => {
    const start = Date.parse('2026-10-30T19:00:00Z'); // Fri 20:00 CET
    expect(iso(createTime(start, 7 * 1440, TZ))).toBe('2026-10-23T18:00:00.000Z'); // 20:00 CEST
    expect(iso(createTime(start, 30, TZ))).toBe('2026-10-30T18:30:00.000Z');
  });

  it('names the tournaments', () => {
    const t = Date.parse('2026-10-23T18:00:00Z');
    expect(seriesName('Friday Cup #{n}', 3, t, TZ)).toBe('Friday Cup #3');
    expect(seriesName('Cup {date}', 3, t, TZ)).toBe('Cup 23.10.');
    expect(seriesName('Friday Cup', 3, t, TZ)).toBe('Friday Cup #3');
    expect(seriesName('Bot Brawl {date} {time}', 3, t, TZ)).toBe('Bot Brawl 23.10. 20:00');
    expect(seriesName('Brawl #{n} {time}', 3, t, TZ)).toBe('Brawl #3 20:00');
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
        nextCreateAt: '2026-10-23T18:00:00.000Z', // 20:00 local, a week before
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

  it('is created and changed with its settings (form "New tournament")', async () => {
    const clock = new FakeClock(Date.parse('2026-10-19T10:00:00Z'));
    const { api } = await startApi({}, { clock });
    try {
      const admin = await Client.login(api, 'Boss', true);
      await admin.post('/agents', { id: 'pi', name: 'Pi' });
      const { name: _n, botPool: _b, ...template } = tournamentBody();
      const when = { weekday: 1, time: '20:00', leadDays: 3 };
      // Either a tournament or the settings, not both or none.
      expect((await admin.post('/series', { name: 'X', ...when })).status).toBe(400);
      const bad = { ...template, settings: { ...template.settings, size: 3 } };
      expect((await admin.post('/series', { name: 'X', ...when, template: bad })).status).toBe(400);
      const s = await admin.post('/series', { name: 'Monday Cup #{n}', ...when, template });
      expect(s.status, JSON.stringify(s.body)).toBe(201);
      expect(s.body.template).toMatchObject({ agentId: 'pi', settings: { size: 8 } });
      const changed = await admin.patch(`/series/${s.body.id}`, {
        template: { ...template, settings: { ...template.settings, size: 16 } },
      });
      expect(changed.body.settings.size).toBe(16);
      // Created today (the start is in the lead time): bots from the control center.
      const t = ((await admin.get('/tournaments')).body as any[])[0];
      const d = (await admin.get(`/tournaments/${t.id}`)).body;
      expect(d).toMatchObject({
        name: 'Monday Cup #1',
        seriesId: s.body.id,
        botsFromLibrary: true,
      });
    } finally {
      await api.close();
    }
  });
});

describe('series schedules and autostart', () => {
  it('creates bot tournaments every 4 hours and starts them by themselves', async () => {
    const clock = new FakeClock(Date.parse('2026-10-19T09:10:00Z')); // 11:10 in Berlin
    const { api } = await startApi({}, { clock });
    try {
      const admin = await Client.login(api, 'Boss', true);
      await admin.post('/agents', { id: 'pi', name: 'Pi' });
      const { name: _n, botPool: _b, ...template } = tournamentBody({}, { size: 4 });
      const sched = {
        days: [1, 2, 3, 4, 5, 6, 7],
        every: { hours: 4, from: '00:00', to: '23:59' },
      };
      const pv = await admin.post('/series/preview', { ...sched, name: 'Brawl {time}' });
      expect(pv.status, JSON.stringify(pv.body)).toBe(200);
      expect(pv.body).toMatchObject({ perDay: 6, timeZone: TZ });
      expect(pv.body.next.slice(0, 2)).toEqual([
        { start: '2026-10-19T10:00:00.000Z', name: 'Brawl 12:00 #1' },
        { start: '2026-10-19T14:00:00.000Z', name: 'Brawl 16:00 #2' },
      ]);
      // No time at all, or more than 24 a day: refused.
      const none = { days: [1], times: [] };
      expect((await admin.post('/series/preview', none)).status).toBe(400);
      const s = await admin.post('/series', {
        name: 'Brawl {time}',
        ...sched,
        leadMinutes: 60,
        template: { ...template, autoStart: true },
      });
      expect(s.status, JSON.stringify(s.body)).toBe(201);
      expect(s.body).toMatchObject({ leadMinutes: 60, autoStart: true, times: [] });
      // 12:00 is less than an hour away: created at once, with autostart.
      const list = async () => (await admin.get('/tournaments')).body as any[];
      expect((await list()).map((t) => [t.name, t.autoStart])).toEqual([['Brawl 12:00 #1', true]]);
      const svc = api.app.get(SeriesService);
      svc.tick();
      expect(await list()).toHaveLength(1);
      // At the start: seeded; the server is offline, so it waits …
      const auto = api.app.get(AutoStartService);
      clock.advance(51 * 60_000); // 12:01
      await auto.tick();
      const id = (await list())[0].id;
      expect((await admin.get(`/tournaments/${id}`)).body.phase).toBe('seeded');
      // … and the next one of the series came (16:00 is less than an hour away later).
      clock.advance(3 * 3_600_000); // 15:01
      svc.tick();
      expect((await list()).map((t) => t.name)).toContain('Brawl 16:00 #2');
      // After an hour without a server it is called off.
      await auto.tick();
      const d = (await admin.get(`/tournaments/${id}`)).body;
      expect(d.phase).toBe('aborted');
      // Changing the schedule: Mon, Wed and Fri at 18:00.
      const ch = await admin.patch(`/series/${s.body.id}`, { days: [1, 3, 5], times: ['18:00'] });
      expect(ch.body).toMatchObject({ days: [1, 3, 5], times: ['18:00'], every: null });
    } finally {
      await api.close();
    }
  });
});

describe('bot pool from the control center', () => {
  it('follows the active bots until the seeding, then stays', async () => {
    const { api } = await startApi();
    try {
      const admin = await Client.login(api, 'Boss', true);
      await admin.post('/agents', { id: 'pi', name: 'Pi' });
      const { botPool: _b, ...body } = tournamentBody({}, { size: 4 });
      // No website bots yet: the stock bots.
      const t = (await admin.post('/tournaments', body)).body;
      expect(t.botsFromLibrary).toBe(true);
      expect(t.botPool.map((b: any) => b.name)).toContain('Xan');
      const ids: string[] = [];
      for (const [name, skill] of [
        ['Gorn', 2],
        ['Sara', 6],
        ['Rankin', 5],
        ['Vex', 3],
        ['Ada', 4],
      ] as const)
        ids.push((await admin.post('/bots', { name, skill })).body.id);
      const pool = async () => (await admin.get(`/tournaments/${t.id}`)).body.botPool;
      expect((await pool()).map((b: any) => [b.name, b.skill])).toEqual([
        ['Ada', 4],
        ['Gorn', 2],
        ['Rankin', 5],
        ['Sara', 6],
        ['Vex', 3],
      ]);
      await admin.patch(`/bots/${ids[1]}`, { active: false });
      const four = ['Ada', 'Gorn', 'Rankin', 'Vex'];
      expect((await pool()).map((b: any) => b.name)).toEqual(four);
      const seeded = await admin.post(`/tournaments/${t.id}/seed`, { mode: 'auto' });
      expect(seeded.status).toBe(200);
      await admin.patch(`/bots/${ids[1]}`, { active: true });
      expect((await pool()).map((b: any) => b.name)).toEqual(four);
      // An old tournament with its own pool switches with an empty pool.
      const own = (await admin.post('/tournaments', tournamentBody({ name: 'Own' }))).body;
      expect(own.botsFromLibrary).toBe(false);
      const sw = await admin.patch(`/tournaments/${own.id}`, { botPool: [] });
      expect(sw.body).toMatchObject({ botsFromLibrary: true });
      expect(sw.body.botPool).toHaveLength(5);
    } finally {
      await api.close();
    }
  });
});
