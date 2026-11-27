import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import type { RunningApi } from '../src/app.js';
import { AgentsService } from '../src/agents/agents.service.js';
import { DB, type Db } from '../src/db/database.js';
import { eq } from 'drizzle-orm';
import { settings } from '../src/db/schema.js';
import { SettingsService } from '../src/settings/settings.service.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { TournamentsService } from '../src/tournaments/tournaments.service.js';
import { Client, startApi, startSeason, tournamentBody } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const HOUR = 3_600_000;
/** Friday, 27.11.2026, 13:00 in Berlin: the window 19:00-22:00 is 18:00-21:00 UTC. */
const NOW = Date.parse('2026-11-27T12:00:00Z');
const at = (hhmmUtc: string, day = '2026-11-27') => `${day}T${hhmmUtc}:00.000Z`;

const profile = (port: number) => ({
  id: 'local',
  name: 'UT server',
  os: 'linux' as const,
  port,
  lobbyMap: 'DM-Deck16][',
  manage: true,
});

async function setup(servers = 2) {
  const clock = new FakeClock(NOW);
  ({ api } = await startApi({}, { clock }));
  const admin = await Client.login(api, 'Boss', true);
  const agents = api.app.get(AgentsService);
  for (let i = 1; i <= servers; i++) {
    await admin.post('/agents', { id: `s${i}`, name: `Server ${i}` });
    agents.saveHello(`s${i}`, { profiles: [profile(7777 + 10 * i)] });
  }
  const put = await admin.put('/settings/udt', { enabled: true, challenge: { enabled: true } });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
  await startSeason(admin);
  const mario = await Client.login(api, 'Mario');
  const tim = await Client.login(api, 'Tim');
  const ana = await Client.login(api, 'Ana');
  for (const [c, name, tag] of [
    [mario, 'Nexus', '[NX]'],
    [tim, 'Iron', '[IG]'],
    [ana, 'Comets', '[RC]'],
  ] as const)
    expect((await c.post('/udt/team', { name, tag, starter: { name: `${name}1` } })).status).toBe(
      201,
    );
  const id = async (c: Client) => (await c.get('/me')).body.id as string;
  const [marioId, timId, anaId] = [await id(mario), await id(tim), await id(ana)];
  const ledger = api.app.get(LedgerService);
  for (const u of [marioId, timId, anaId])
    ledger.book({ season: 1, userId: u, kind: 'udt_reward', amount: 10_000, ref: `gift:${u}` });
  const base = ledger.spendable(marioId).spendable;
  /** Neuro spent on challenges (everybody starts with the same). */
  const free = (u: string) => base - ledger.spendable(u).spendable;
  return {
    clock,
    admin,
    mario,
    tim,
    ana,
    marioId,
    timId,
    anaId,
    ledger,
    free,
    db: api.app.get<Db>(DB),
  };
}

const body = (over: Record<string, unknown> = {}) => ({
  mode: 'dm',
  teamSize: 5,
  bestOf: 1,
  stake: 500,
  at: at('18:30'),
  ...over,
});

describe('Dream Team challenges (decision 334)', () => {
  it('lists the start times of the window with their state', async () => {
    const { mario, timId } = await setup();
    const r = await mario.get(`/udt/challenges/slots?mode=dm&bestOf=1&opponent=${timId}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const day = r.body.days[0];
    expect(day.date).toBe('2026-11-27');
    expect(day.starts).toHaveLength(12);
    expect(day.starts[0]).toMatchObject({ time: '19:00', at: at('18:00'), state: 'free' });
    expect(day.starts.at(-1).time).toBe('21:45');
    // Monster Hunt: a race keeps the server 45 minutes, the last start is 21:15.
    const mh = await mario.get('/udt/challenges/slots?mode=mh');
    expect(mh.body.minutes).toBe(45);
    expect(mh.body.days[0].starts.at(-1).time).toBe('21:15');
  });

  it('holds the stake, reserves a server, takes the answer and gives stakes back', async () => {
    const { mario, tim, marioId, timId, free, clock } = await setup();
    const sent = await mario.post('/udt/challenges', body({ to: timId, message: 'Revanche?' }));
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(free(marioId)).toBe(500);
    const id = sent.body.id as string;
    expect(sent.body.outgoing[0]).toMatchObject({ id, stake: 500, pot: 1000, prize: 950 });
    // The challenged team sees it; it keeps the start (both teams busy then).
    const inbox = await tim.get('/udt/challenges');
    expect(inbox.body.incoming.map((c: { id: string }) => c.id)).toEqual([id]);
    expect((await tim.get('/udt/hub')).body.challengesIn).toBe(1);
    const slots = await tim.get(`/udt/challenges/slots?opponent=${marioId}`);
    expect(slots.body.days[0].starts[2]).toMatchObject({ time: '19:30', state: 'mine' });
    // The server calendar keeps a cup out of the challenge's server.
    const tours = api!.app.get(TournamentsService);
    const probe = {
      id: 'x',
      agentId: 's1',
      kind: 'standard',
      udtJson: null,
      settings: tours.settings({
        settingsJson: JSON.stringify(tournamentBody({}, { size: 4, format: 'single' }).settings),
      } as never),
    };
    expect(tours.calendar.blocking(probe, Date.parse(at('18:25')))?.label).toBe('challenge');
    // Accept: Tim's stake is held too.
    const acc = await tim.post(`/udt/challenges/${id}/accept`);
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect(free(timId)).toBe(500);
    expect(acc.body.upcoming[0]).toMatchObject({ id, status: 'accepted' });
    // A second one from Mario to Tim: declined, Mario gets his stake back.
    const two = await mario.post(
      '/udt/challenges',
      body({ to: timId, at: at('20:00'), stake: 300 }),
    );
    expect(two.status, JSON.stringify(two.body)).toBe(201);
    expect(free(marioId)).toBe(800);
    expect((await tim.post(`/udt/challenges/${two.body.id}/decline`)).status).toBe(200);
    expect(free(marioId)).toBe(500);
    // A third one is withdrawn; a fourth expires at its deadline (lock 60 minutes before).
    const three = await mario.post(
      '/udt/challenges',
      body({ to: timId, at: at('19:00'), stake: 0 }),
    );
    expect(three.status, JSON.stringify(three.body)).toBe(201);
    expect((await mario.del(`/udt/challenges/${three.body.id}`)).status).toBe(200);
    const four = await mario.post(
      '/udt/challenges',
      body({ to: timId, at: at('19:30'), stake: 200 }),
    );
    expect(four.status, JSON.stringify(four.body)).toBe(201);
    expect(four.body.outgoing[0].expiresAt).toBe(at('18:30'));
    clock.advance(7 * HOUR);
    const later = await mario.get('/udt/challenges');
    expect(later.body.outgoing).toHaveLength(0);
    expect(later.body.recent.find((c: { id: string }) => c.id === four.body.id).status).toBe(
      'expired',
    );
    expect(free(marioId)).toBe(500);
  });

  it('keeps the limits: pair per week, stake cap and steps, the window, the season', async () => {
    const { mario, tim, timId, anaId } = await setup();
    const cap = (await mario.get('/udt/challenges')).body.rules.stakeCap as number;
    expect((await mario.post('/udt/challenges', body({ to: timId, stake: cap + 10 }))).status).toBe(
      409,
    );
    expect((await mario.post('/udt/challenges', body({ to: timId, stake: 55 }))).status).toBe(400);
    expect((await mario.post('/udt/challenges', body({ to: timId, stake: 50 }))).status).toBe(400);
    // Off the grid, outside the window, too late.
    expect((await mario.post('/udt/challenges', body({ to: timId, at: at('18:10') }))).status).toBe(
      409,
    );
    expect((await mario.post('/udt/challenges', body({ to: timId, at: at('21:00') }))).status).toBe(
      409,
    );
    const late = await mario.post('/udt/challenges', body({ to: timId, at: at('12:30') }));
    expect(late.status).toBe(409);
    // Two per pair and week (counter offers and declined ones do not count).
    expect((await mario.post('/udt/challenges', body({ to: timId, at: at('18:00') }))).status).toBe(
      201,
    );
    const second = await mario.post(
      '/udt/challenges',
      body({ to: timId, at: at('19:00', '2026-11-28') }),
    );
    expect(second.status).toBe(201);
    const third = await mario.post(
      '/udt/challenges',
      body({ to: timId, at: at('20:00', '2026-11-29') }),
    );
    expect(third.status).toBe(409);
    expect(third.body.key).toBe('at most {n} challenges between two managers per week');
    // A third waiting challenge is allowed (max 3), a fourth not.
    expect((await mario.post('/udt/challenges', body({ to: anaId, at: at('20:30') }))).status).toBe(
      201,
    );
    const ana2 = await mario.post(
      '/udt/challenges',
      body({ to: anaId, at: at('18:30', '2026-11-28') }),
    );
    expect(ana2.status).toBe(409);
    expect(ana2.body.key).toBe('at most {max} challenges can wait for an answer at once');
    // Monster Hunt needs five bots in both lineups.
    const mh = await tim.post('/udt/challenges', body({ to: anaId, mode: 'mh', at: at('18:15') }));
    expect(mh.status).toBe(409);
    expect(mh.body.key).toBe('Monster Hunt needs {n} bots in your lineup');
  });

  it('fills the servers: two challenges at once, a third start is full', async () => {
    const { mario, ana, timId, marioId } = await setup(3);
    await mario.post('/udt/challenges', body({ to: timId, at: at('18:00') }));
    const busy = await ana.post('/udt/challenges', body({ to: timId, at: at('18:00') }));
    expect(busy.body.key).toBe('the other team plays another challenge then');
    const dan = await Client.login(api!, 'Dan');
    await dan.post('/udt/team', { name: 'Dawn', tag: '[DW]', starter: { name: 'D1' } });
    expect(
      (
        await ana.post(
          '/udt/challenges',
          body({ to: (await dan.get('/me')).body.id, at: at('18:00') }),
        )
      ).status,
    ).toBe(201);
    // Two challenges at 19:00 (setting "servers" 2, though the pool has three).
    const eve = await Client.login(api!, 'Eve');
    await eve.post('/udt/team', { name: 'Eden', tag: '[ED]', starter: { name: 'E1' } });
    const s = await eve.get(`/udt/challenges/slots?opponent=${marioId}`);
    expect(s.body.days[0].starts[0]).toMatchObject({ time: '19:00', state: 'opponent' });
    const s2 = await eve.get('/udt/challenges/slots');
    expect(s2.body.days[0].starts[0]).toMatchObject({ time: '19:00', state: 'full' });
    expect(s2.body.days[0].starts[1]).toMatchObject({ time: '19:15', state: 'free' });
  });

  it('answers with a counter offer, an open challenge is taken by the first', async () => {
    const { mario, tim, ana, marioId, timId, free } = await setup();
    const sent = await mario.post('/udt/challenges', body({ to: timId, stake: 1000 }));
    const counter = await tim.post(`/udt/challenges/${sent.body.id}/counter`, body({ stake: 400 }));
    expect(counter.status, JSON.stringify(counter.body)).toBe(201);
    expect(free(marioId)).toBe(0); // his stake came back
    expect(free(timId)).toBe(400);
    const mine = await mario.get('/udt/challenges');
    expect(mine.body.incoming[0]).toMatchObject({ round: 2, stake: 400, counterOf: sent.body.id });
    expect(mine.body.recent[0]).toMatchObject({ id: sent.body.id, status: 'countered' });
    expect((await mario.post(`/udt/challenges/${counter.body.id}/accept`)).status).toBe(200);
    // Open challenge: every manager sees it, the first to accept plays.
    const open = await ana.post(
      '/udt/challenges',
      body({ to: null, open: 'all', at: at('20:00'), stake: 0 }),
    );
    expect(open.status, JSON.stringify(open.body)).toBe(201);
    expect((await tim.get('/udt/challenges')).body.open.map((c: { id: string }) => c.id)).toEqual([
      open.body.id,
    ]);
    expect((await tim.post(`/udt/challenges/${open.body.id}/accept`)).status).toBe(200);
    const taken = await mario.post(`/udt/challenges/${open.body.id}/accept`);
    expect(taken.status).toBe(409);
  });

  it('checks the window: it ends after it starts; with the league off anything goes', async () => {
    const { admin } = await setup();
    const league = { enabled: true, slotTime: '22:00', slotDays: [0, 1, 2, 3, 4, 5] };
    // 19:00-22:00 ends when the evening starts: fine (the league itself may not fit the season).
    const ok = await admin.put('/settings/udt', {
      challenge: { enabled: true, from: '19:00', to: '22:00' },
    });
    expect(ok.status).toBe(200);
    const clash = await admin.put('/settings/udt', {
      league: { ...league, enabled: false },
      challenge: { enabled: true, from: '20:00', to: '23:00' },
    });
    expect(clash.status).toBe(200); // the league is off
    const r = await admin.put('/settings/udt', {
      challenge: { enabled: true, from: '23:30', to: '23:00' },
    });
    expect(r.status).toBe(400);
    expect(r.body.key).toBe('the challenge window must end after it starts ({from} - {to})');
  });
});

describe('challenge window and league', () => {
  it('refuses a window into the league evening when the league is on', async () => {
    const { admin, db } = await setup();
    // The league on at 22:00 (stored directly: its own fit check needs a league season).
    const svc = api!.app.get(SettingsService);
    const udt = svc.get().udt;
    udt.league = { ...udt.league, enabled: true, slotTime: '22:00', slotDays: [0, 1, 2, 3, 4, 5] };
    db.update(settings)
      .set({ valueJson: JSON.stringify(udt) })
      .where(eq(settings.key, 'udt'))
      .run();
    svc.version++;
    expect(
      (
        await admin.put('/settings/udt', {
          challenge: { enabled: true, from: '19:00', to: '22:00' },
        })
      ).status,
    ).toBe(200);
    expect(svc.get().udt.league.enabled).toBe(true);
    const r = await admin.put('/settings/udt', {
      challenge: { enabled: true, from: '21:00', to: '23:00' },
    });
    expect(r.status).toBe(409);
    expect(r.body.key).toBe(
      'the challenge window {from} - {to} runs into the league evening at {time}',
    );
  });
});
