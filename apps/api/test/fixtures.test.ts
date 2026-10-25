import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { EventLogService } from '../src/tournaments/event-log.service.js';
import { Client, startApi, startSeason, tournamentBody } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe('fixtures bracket (league matchday)', () => {
  it('seeds independent pairings and finishes without a champion', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
    const bad = await admin.post(
      '/tournaments',
      tournamentBody({ name: 'Bad' }, { format: 'single', size: 6 }),
    );
    expect(bad.status).toBe(400);
    const made = await admin.post(
      '/tournaments',
      tournamentBody({ name: 'Matchday' }, { format: 'fixtures', size: 6 }),
    );
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = made.body.id as string;
    const seeded = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', rngSeed: 's' });
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
    const log = api.app.get(EventLogService);
    let p = log.projection(id)!;
    expect(p.bracket!.matches.map((m) => m.id)).toEqual(['W1-1', 'W1-2', 'W1-3']);
    const actor = { kind: 'system' as const };
    const append = (batch: Parameters<EventLogService['append']>[2]) => {
      const res = log.append(id, log.load(id).length, batch);
      if (!res.accepted) throw new Error(res.reason);
      return res.projection;
    };
    append([
      { type: 'checkin.opened', actor, data: { serverProfileId: 'local' } },
      { type: 'tournament.started', actor, data: {} },
    ]);
    for (const m of p.bracket!.matches) {
      const [a, b] = m.entrants as [string, string];
      p = append([
        {
          type: 'match.result',
          actor,
          data: { result: { matchId: m.id, entrants: [a, b], winnerId: a, outcome: 'simulated' } },
        },
      ]);
    }
    expect(p.bracket!.status).toBe('finished');
    p = append([{ type: 'tournament.finished', actor, data: {} }]);
    expect(p.phase).toBe('finished');
    expect(p.championId).toBeUndefined();
    const page = await admin.get(`/tournaments/${id}`);
    expect(page.status).toBe(200);
    expect((await admin.get('/tournaments?scope=done')).status).toBe(200);
  });
});

describe('a Dream Team league matchday', () => {
  it('pays no game or place money, counts no table points, costs stamina and gives XP', async () => {
    ({ api } = await startApi({ TEST_MODE: 'true' }));
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    const tim = await Client.login(api, 'Tim');
    await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
    for (let i = 0; i < 6; i++) await admin.post('/bots', { name: `Lib${i}`, skill: 2 + (i % 3) });
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    for (const [c, n, tag] of [
      [mario, 'Nexus', 'NX'],
      [tim, 'Iron', 'IG'],
    ] as const)
      await c.post('/udt/team', { name: n, tag, starter: { name: `${tag}bot` } });
    const made = await admin.post(
      '/tournaments',
      tournamentBody(
        { name: 'Matchday', botPool: [], kind: 'udt' },
        { format: 'fixtures', size: 4 },
      ),
    );
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const id = made.body.id as string;
    for (const c of [mario, tim])
      expect((await c.post(`/udt/events/${id}/enter`)).status).toBe(200);
    const sim = await admin.post(`/udt/test/simulate/${id}`);
    expect(sim.status, JSON.stringify(sim.body)).toBe(200);
    expect(sim.body).toMatchObject({ phase: 'finished', results: 2, championId: null });
    const ledger = api.app.get(LedgerService);
    const marioId = (await mario.get('/me')).body.id as string;
    const kinds = ledger.entries(marioId, 1, 50).map((e) => e.kind);
    expect(kinds).not.toContain('udt_reward');
    expect(kinds).not.toContain('udt_place');
    expect((await mario.get('/udt/table')).body).toEqual([]);
    const bot = (await mario.get('/udt')).body.roster[0] as { stamina: number; xp: number };
    expect(bot.stamina).toBeLessThan(100);
    expect(bot.xp).toBeGreaterThan(0);
  });
});
