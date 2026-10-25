import { describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import { SeriesService } from '../src/series/series.service.js';
import { AutoStartService } from '../src/tournaments/auto-start.service.js';
import { ServerCalendar, estimateMs } from '../src/tournaments/server-calendar.js';
import { Client, startApi, tournamentBody } from './helpers.js';

const H = 3_600_000;
// 2026-10-19 is a Monday; 18:00-20:00 in Berlin (CEST) is 16:00-18:00Z.
const SLOT = { from: Date.parse('2026-10-19T16:00:00Z'), to: Date.parse('2026-10-19T18:00:00Z') };

describe('server calendar', () => {
  it('estimates a tournament by its matches', () => {
    const s = tournamentBody({}, { size: 8, format: 'single' }).settings as never;
    expect(estimateMs(s)).toBe(7 * 6 * 60_000);
  });

  it('keeps tournaments out of a reservation, moves series and autostart behind it', async () => {
    const clock = new FakeClock(Date.parse('2026-10-19T13:00:00Z')); // 15:00 in Berlin
    const { api } = await startApi({}, { clock });
    try {
      const admin = await Client.login(api, 'Boss', true);
      await admin.post('/agents', { id: 'pi', name: 'Pi' });
      const cal = api.app.get(ServerCalendar);
      cal.registerSource((agent, from, to) =>
        agent === 'pi' && SLOT.from < to && SLOT.to > from
          ? [{ ...SLOT, label: 'league', allows: (t) => t.id.startsWith('league-') }]
          : [],
      );
      const at = (iso: string, over: Record<string, unknown> = {}, size = 8) =>
        admin.post('/tournaments', {
          ...tournamentBody(
            { name: `T ${iso}`, scheduledAt: iso, ...over },
            { size, format: 'single' },
          ),
        });
      // In the slot, or running into it: refused with the reserved times.
      const inSlot = await at('2026-10-19T16:30:00.000Z');
      expect(inSlot.status).toBe(409);
      expect(inSlot.body.key).toBe('the server is reserved for {label} from {from} to {to}');
      expect(inSlot.body.params).toMatchObject({ label: 'league', from: '19.10. 18:00' });
      expect((await at('2026-10-19T15:30:00.000Z')).status).toBe(409); // 42 min into 18:00
      const small = await at('2026-10-19T15:30:00.000Z', {}, 4);
      expect(small.status, JSON.stringify(small.body)).toBe(201); // 18 min: ends 17:48
      expect((await at('2026-10-19T18:00:00.000Z')).status).toBe(201);
      // The reservation's own tournaments may start in it; another server is free.
      expect((await at('2026-10-19T16:00:00.000Z', { id: 'league-1' })).status).toBe(201);
      await admin.post('/agents', { id: 'pc', name: 'PC' });
      expect((await at('2026-10-19T16:10:00.000Z', { agentId: 'pc' })).status).toBe(201);
      // Moving a draft into the slot is refused too.
      const later = (await at('2026-10-19T19:00:00.000Z', { name: 'Late' })).body.id as string;
      const moved = await admin.patch(`/tournaments/${later}`, {
        scheduledAt: '2026-10-19T16:15:00.000Z',
      });
      expect(moved.status).toBe(409);

      // A series at 18:30 is made for 20:00 (behind the slot).
      const {
        name: _n,
        botPool: _b,
        ...template
      } = tournamentBody({}, { size: 4, format: 'single' });
      const s = await admin.post('/series', {
        name: 'Evening {time}',
        days: [1],
        times: ['18:30'],
        leadMinutes: 1440,
        template: { ...template, autoStart: true },
      });
      expect(s.status, JSON.stringify(s.body)).toBe(201);
      api.app.get(SeriesService).tick();
      const list = (await admin.get('/tournaments')).body as {
        name: string;
        id: string;
        scheduledAt: string;
      }[];
      const evening = list.find((t) => t.name.startsWith('Evening'))!;
      expect(evening.scheduledAt).toBe('2026-10-19T18:00:00.000Z');

      // Autostart: a tournament due just before the slot that would run into it waits behind
      // it and is not called off an hour after its start.
      const early = (await at('2026-10-19T15:00:00.000Z', { autoStart: true }, 4)).body
        .id as string;
      clock.advance(2.9 * H); // 15:54Z: 18 min would reach into the slot
      const auto = api.app.get(AutoStartService);
      await auto.tick();
      expect((await admin.get(`/tournaments/${early}`)).body.phase).toBe('draft');
      clock.advance(1.2 * H); // 17:06Z: inside the slot, 2 h after its start
      await auto.tick();
      expect((await admin.get(`/tournaments/${early}`)).body.phase).toBe('draft');
      clock.advance(H); // 18:06Z: after the slot it is seeded (no server: it waits)
      await auto.tick();
      expect((await admin.get(`/tournaments/${early}`)).body.phase).toBe('seeded');
    } finally {
      await api.close();
    }
  });
});
