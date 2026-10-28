import { describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import { Client, startApi, startSeason, tournamentBody } from './helpers.js';

interface Item {
  id: string;
  kind: string;
  day: string;
  at: string | null;
  state: string;
  mine: boolean;
  title: string | null;
  link: string | null;
  meta: Record<string, unknown>;
}

describe('calendar (decision 231)', () => {
  it('shows seasons, tournaments, planned series starts and the league plan', async () => {
    const clock = new FakeClock(Date.parse('2026-10-19T10:00:00Z'));
    const { api } = await startApi({}, { clock });
    try {
      const admin = await Client.login(api, 'Boss', true);
      const mario = await Client.login(api, 'Mario');
      await admin.post('/agents', { id: 'pi', name: 'Pi' });
      expect((await admin.req('PUT', '/settings/udt', { enabled: true })).status).toBe(200);
      await startSeason(admin, 30);
      const league = await admin.req('PUT', '/settings/udt', {
        league: { enabled: true, size: 8, slotDays: [0, 1, 2, 3, 4, 5, 6], length: 'long' },
      });
      expect(league.status, JSON.stringify(league.body)).toBe(200);
      const t = await admin.post(
        '/tournaments',
        tournamentBody({ name: 'Tuesday Fest', scheduledAt: '2026-10-20T18:00:00.000Z' }),
      );
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      expect((await mario.post(`/tournaments/${t.body.id}/registration`, {})).status).toBe(204);
      const s = await admin.post('/series', {
        fromTournament: t.body.id,
        name: 'Friday Cup #{n}',
        weekday: 5,
        time: '20:00',
        leadDays: 1,
      });
      expect(s.status, JSON.stringify(s.body)).toBe(201);

      const res = await mario.get('/calendar?from=2026-10-19&to=2026-11-15');
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.items as Item[];
      expect(res.body).toMatchObject({ today: '2026-10-19', udt: true });
      expect(items.find((i) => i.kind === 'seasonStart')).toMatchObject({
        day: '2026-10-19',
        meta: { season: 1 },
      });
      expect(items.find((i) => i.title === 'Tuesday Fest')).toMatchObject({
        kind: 'tournament',
        day: '2026-10-20',
        state: 'open',
        mine: true,
        link: `/t/${t.body.id}`,
      });
      // The series: the next Fridays, planned (not made yet), one per week.
      const fridays = items.filter((i) => i.meta.series === s.body.id && i.state === 'projected');
      expect(fridays.map((i) => i.day)).toEqual([
        '2026-10-23',
        '2026-10-30',
        '2026-11-06',
        '2026-11-13',
      ]);
      expect(fridays[0]).toMatchObject({ kind: 'tournament', title: 'Friday Cup', link: null });
      // The league before its start: the plan of this season (day 4, one matchday an evening).
      const evenings = items.filter((i) => i.kind === 'leagueEvening');
      expect(evenings).toHaveLength(14);
      expect(evenings[0]).toMatchObject({
        day: '2026-10-22',
        state: 'projected',
        meta: { start: true, matchdays: [1] },
      });
      expect(items.find((i) => i.kind === 'relegation')?.day).toBe('2026-11-05');
      expect(items.find((i) => i.kind === 'finalFour')?.day).toBe('2026-11-06');
      expect(items.filter((i) => i.kind === 'payday').map((i) => i.day)).toEqual([
        '2026-10-26',
        '2026-11-02',
      ]);
      // Sorted by time.
      const keys = items.map((i) => i.at ?? `${i.day}T00`);
      expect([...keys].sort()).toEqual(keys);

      expect((await mario.get('/calendar?from=2026-11-15&to=2026-11-01')).status).toBe(400);
      expect((await mario.get('/calendar?from=2026-01-01&to=2026-12-31')).status).toBe(400);
      // Default: a week back, six weeks on.
      const def = (await mario.get('/calendar')).body;
      expect(def).toMatchObject({ from: '2026-10-12', to: '2026-11-23' });
    } finally {
      await api.close();
    }
  });

  it('shows a running league with the user’s games', async () => {
    const clock = new FakeClock(Date.parse('2026-10-19T10:00:00Z'));
    const { api } = await startApi({ TEST_MODE: 'true' }, { clock });
    try {
      const admin = await Client.login(api, 'Boss', true);
      const mario = await Client.login(api, 'Mario');
      await admin.post('/agents', { id: 'pi', name: 'Pi' });
      for (let i = 0; i < 6; i++) await admin.post('/bots', { name: `Lib${i}`, skill: 3 });
      await admin.req('PUT', '/settings/udt', { enabled: true });
      await startSeason(admin, 30);
      await mario.post('/udt/team', { name: 'Nexus', tag: 'NX', starter: { name: 'NXbot' } });
      await admin.req('PUT', '/settings/udt', {
        league: {
          enabled: true,
          size: 8,
          slotDays: [0, 1, 2, 3, 4, 5, 6],
          agentId: 'pi',
          profileId: 'local',
        },
      });
      const r = await admin.post('/udt/league/start', { placement: 'one' });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const items = (await mario.get('/calendar?from=2026-10-19&to=2026-11-30')).body
        .items as Item[];
      const evenings = items.filter((i) => i.kind === 'leagueEvening');
      expect(evenings[0]).toMatchObject({ day: '2026-10-20', state: 'planned', mine: true });
      expect(evenings[0]!.meta.myGame).toMatchObject({ kind: 'league' });
      expect(evenings[0]!.meta.games).toBeGreaterThan(0);
      expect(evenings.every((e) => e.state !== 'projected')).toBe(true);
    } finally {
      await api.close();
    }
  });
});
