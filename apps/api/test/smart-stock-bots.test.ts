import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { AgentsService } from '../src/agents/agents.service.js';
import { Client, startApi, tournamentBody } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

/** SmartStockBots of the tournament's first event (what the bridge plays by). */
async function ssbAtSeed(admin: Client, name: string): Promise<unknown> {
  const t = await admin.post('/tournaments', tournamentBody({ name }));
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  const id = (t.body as { id: string }).id;
  const s = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto' });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  const events = (await admin.get(`/tournaments/${id}/events`)).body as {
    type: string;
    data: { settings?: { game: { rules: Record<string, unknown> } } };
  }[];
  return events.find((e) => e.type === 'tournament.created')?.data.settings?.game.rules[
    'smartStockBots'
  ];
}

describe('SmartStockBots (website setting)', () => {
  it('auto follows the server packages, on and off apply to every tournament', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
    // Auto without a scanned server: off.
    expect(await ssbAtSeed(admin, 'A')).toBe(false);
    api.app
      .get(AgentsService)
      .saveInventory('pi', 'local', { maps: [], packages: ['Botpack', 'SmartStockBots'] }, '');
    expect(await ssbAtSeed(admin, 'B')).toBe(true);
    const off = await admin.req('PUT', '/settings/bot-ai', { smartStockBots: 'off' });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(await ssbAtSeed(admin, 'C')).toBe(false);
    await admin.req('PUT', '/settings/bot-ai', { smartStockBots: 'on' });
    expect(await ssbAtSeed(admin, 'D')).toBe(true);
    // On, but the scanned server lacks it: without (the bridge would refuse the game).
    api.app.get(AgentsService).saveInventory('pi', 'local', { maps: [], packages: [] }, '');
    expect(await ssbAtSeed(admin, 'E')).toBe(false);
  });
});
