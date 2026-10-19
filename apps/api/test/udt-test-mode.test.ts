import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { Client, startApi, startSeason, tournamentBody } from './helpers.js';

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
