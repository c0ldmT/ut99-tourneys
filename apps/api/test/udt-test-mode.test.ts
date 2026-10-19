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

describe('Dream Team AI managers', () => {
  it('are off by default; on, they found teams, bid, line up and sign up after market days', async () => {
    ({ api } = await startApi({ TEST_MODE: 'true' }));
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
    for (let i = 0; i < 12; i++) await admin.post('/bots', { name: `Lib${i}`, skill: 1 + (i % 4) });
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    await mario.post('/udt/team', {
      name: 'Nexus',
      tag: 'NX',
      starter: { name: 'Mira', skill: 3 },
    });
    await admin.post('/udt/test/market-day');
    expect((await admin.get('/udt/ai')).body).toEqual([]);
    expect((await admin.get('/udt/teams')).body).toHaveLength(1);
    await admin.req('PUT', '/settings/udt', { aiEnabled: true, aiCount: 3 });
    const made = (await admin.post('/udt/ai/ensure')).body.created as string[];
    expect(made).toHaveLength(3);
    const ai = (await admin.get('/udt/ai')).body;
    expect(ai.map((a: { personality: string }) => a.personality)).toEqual([
      'tactician',
      'gambler',
      'saver',
    ]);
    // Team names from the bot team names of the settings.
    const names = (await admin.get('/settings')).body.teamNames as string[];
    expect(names).toContain(ai[0].team.name);
    // A cup to sign up for; the next market day lets them act.
    const cup = await admin.post(
      '/tournaments',
      tournamentBody({ name: 'AI Cup', botPool: [], kind: 'udt' }, { size: 4, format: 'single' }),
    );
    await admin.post('/udt/test/advance', { hours: 24 });
    const ev = (await mario.get('/udt/events')).body.find(
      (e: { id: string }) => e.id === cup.body.id,
    );
    expect(ev.entries).toBeGreaterThanOrEqual(1);
    // Trade partners include them; the betting ranking does not.
    const partners = (await mario.get('/udt/trades/partners')).body;
    expect(partners.filter((p: { ai: boolean }) => p.ai)).toHaveLength(3);
    const lb = (await mario.get('/bets/leaderboard')).body;
    expect(JSON.stringify(lb)).not.toMatch(/AI 1/);
    // Switched off: no partners, they leave the open sign-ups at the next market day.
    await admin.req('PUT', '/settings/udt', { aiEnabled: false });
    expect((await mario.get('/udt/trades/partners')).body).toHaveLength(0);
    await admin.post('/udt/test/advance', { hours: 24 });
    const ev2 = (await mario.get('/udt/events')).body.find(
      (e: { id: string }) => e.id === cup.body.id,
    );
    expect(ev2.entries).toBe(0);
  });
});

describe('Dream Team season finale', () => {
  it('plays the top of the table and crowns the season champion (shop awards)', async () => {
    ({ api } = await startApi({ TEST_MODE: 'true' }));
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    const tim = await Client.login(api, 'Tim');
    await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
    for (let i = 0; i < 8; i++) await admin.post('/bots', { name: `Lib${i}`, skill: 2 + (i % 2) });
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    await mario.post('/udt/team', {
      name: 'Nexus',
      tag: 'NX',
      starter: { name: 'Mira', skill: 3 },
    });
    await tim.post('/udt/team', { name: 'Iron', tag: 'IG', starter: { name: 'Tox', skill: 3 } });
    const cup = async (udt: Record<string, unknown>, name: string) =>
      (
        await admin.post(
          '/tournaments',
          tournamentBody({ name, botPool: [], kind: 'udt', udt }, { size: 4, format: 'single' }),
        )
      ).body.id as string;
    // A normal cup for the table.
    const a = await cup({}, 'Cup');
    await mario.post(`/udt/events/${a}/enter`);
    await tim.post(`/udt/events/${a}/enter`);
    expect((await admin.post(`/udt/test/simulate/${a}`)).status).toBe(200);
    // The finale: no sign-up, the top of the table plays.
    const f = await cup({ finale: true }, 'Finale');
    const ev = (await mario.get('/udt/events')).body.find((e: { id: string }) => e.id === f);
    expect(ev).toMatchObject({ open: false });
    expect(ev.qualified).toHaveLength(2);
    expect((await mario.post(`/udt/events/${f}/enter`)).status).toBe(409);
    const sim = await admin.post(`/udt/test/simulate/${f}`);
    expect(sim.status, JSON.stringify(sim.body)).toBe(200);
    const seeded = (await admin.get(`/tournaments/${f}`)).body;
    expect(JSON.stringify(seeded)).toMatch(/Nexus/);
    expect(JSON.stringify(seeded)).toMatch(/Iron/);
    // Season over: the champion owns the frame and the title.
    expect((await admin.post('/udt/test/season-end')).status).toBe(200);
    const champs = [];
    for (const c of [mario, tim]) {
      const shop = (await c.get('/shop')).body;
      if ((shop.awards as { id: string }[]).some((x) => x.id === 'award.dreamteam.1'))
        champs.push(c);
    }
    expect(champs).toHaveLength(1);
  });
});
