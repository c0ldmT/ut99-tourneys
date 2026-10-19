import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { Client, startApi, startSeason, tournamentBody } from './helpers.js';
import { LedgerService } from '../src/ledger/ledger.service.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe('Dream Team test mode', () => {
  it('does not exist without TEST_MODE', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    expect((await admin.get('/udt/test')).status).toBe(404);
  });

  it('moves the clock through market days, simulates a cup, ends the season', async () => {
    ({ api } = await startApi({ TEST_MODE: 'true' }));
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    expect((await mario.get('/udt/test')).status).toBe(403);
    await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
    for (let i = 0; i < 12; i++) await admin.post('/bots', { name: `Lib${i}`, skill: 1 + (i % 6) });
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    const made = await admin.post('/udt/test/managers', { count: 3 });
    expect(made.body.created).toHaveLength(3);
    // First market day, then two more by moving the clock 48 hours.
    expect((await admin.post('/udt/test/market-day')).status).toBe(200);
    const before = (await admin.get('/udt/test')).body;
    const moved = await admin.post('/udt/test/advance', { hours: 48 });
    expect(moved.body.offsetHours).toBe(before.offsetHours + 48);
    // Test managers act: bids and sign-ups.
    const cup = await admin.post(
      '/tournaments',
      tournamentBody({ name: 'Test Cup', botPool: [], kind: 'udt' }, { size: 4, format: 'single' }),
    );
    const acted = (await admin.post('/udt/test/managers/act')).body;
    expect(acted.managers).toBe(3);
    expect(acted.entries).toBe(3);
    const sim = await admin.post(`/udt/test/simulate/${cup.body.id}`);
    expect(sim.status, JSON.stringify(sim.body)).toBe(200);
    expect(sim.body).toMatchObject({ phase: 'finished', results: 3 });
    const table = (await admin.get('/udt/table')).body as { points: number }[];
    expect(table).toHaveLength(3);
    expect((await admin.post('/udt/test/season-end')).status).toBe(200);
    expect((await admin.get('/udt/test')).body.season).toBeNull();
  });
});

describe('Dream Team high stakes', () => {
  it('takes tickets, gives them back on leaving or too few teams, pays the pot', async () => {
    ({ api } = await startApi({ TEST_MODE: 'true' }));
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    const tim = await Client.login(api, 'Tim');
    const anna = await Client.login(api, 'Anna');
    await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
    for (let i = 0; i < 6; i++) await admin.post('/bots', { name: `Lib${i}`, skill: 2 + (i % 3) });
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    const ids: Record<string, string> = {};
    for (const [c, n, tag] of [
      [mario, 'Nexus', 'NX'],
      [tim, 'Iron', 'IG'],
      [anna, 'Aces', 'AC'],
    ] as const) {
      await c.post('/udt/team', { name: n, tag, starter: { name: `${tag}bot`, skill: 3 } });
      ids[tag] = (await c.get('/me')).body.id as string;
    }
    const ledger = api.app.get(LedgerService);
    const bal = (tag: string) => ledger.spendable(ids[tag]!).balance;
    const cup = async (minTeams: number) =>
      (
        await admin.post(
          '/tournaments',
          tournamentBody(
            {
              name: `High Stakes ${minTeams}`,
              botPool: [],
              kind: 'udt',
              udt: { ticket: 300, ticketIndexed: false, minTeams },
            },
            { size: 4, format: 'single' },
          ),
        )
      ).body.id as string;
    // Too few teams: the tickets go back and the seeding fails.
    const a = await cup(3);
    expect((await mario.get('/udt/events')).body[0]).toMatchObject({ ticketNow: 300, pot: 0 });
    expect((await mario.post(`/udt/events/${a}/enter`)).status).toBe(200);
    expect(bal('NX')).toBe(700);
    expect((await mario.req('DELETE', `/udt/events/${a}/enter`)).status).toBe(200);
    expect(bal('NX')).toBe(1000);
    await mario.post(`/udt/events/${a}/enter`);
    await tim.post(`/udt/events/${a}/enter`);
    const failed = await admin.post(`/tournaments/${a}/seed`, { mode: 'auto', rngSeed: 's' });
    expect(failed.status).toBe(409);
    expect(JSON.stringify(failed.body)).toMatch(/high stakes needs 3/);
    expect(bal('NX')).toBe(1000);
    expect(bal('IG')).toBe(1000);
    // Three teams: the winner takes 60 % + one ticket, the second best team 20 %.
    const b = await cup(2);
    for (const c of [mario, tim, anna])
      expect((await c.post(`/udt/events/${b}/enter`)).status).toBe(200);
    expect((await mario.get('/udt/events')).body.find((e: { id: string }) => e.id === b).pot).toBe(
      900,
    );
    const sim = await admin.post(`/udt/test/simulate/${b}`);
    expect(sim.status, JSON.stringify(sim.body)).toBe(200);
    const pots = ['NX', 'IG', 'AC'].flatMap((t) =>
      ledger
        .entries(ids[t]!, 1)
        .filter((e) => e.kind === 'udt_pot')
        .map((e) => e.amount),
    );
    expect(pots.sort((x, y) => y - x)).toEqual([840, 180]);
  });
});
