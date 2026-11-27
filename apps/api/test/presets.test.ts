import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { MAX_PRESETS } from '../src/tournaments/presets.js';
import { Client, startApi, tournamentBody } from './helpers.js';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function setup(): Promise<{ api: RunningApi; boss: Client; other: Client; player: Client }> {
  const { api } = await startApi();
  cleanups.push(() => api.close());
  const boss = await Client.login(api, 'Boss', true);
  const other = await Client.login(api, 'Other', true);
  const player = await Client.login(api, 'Mario');
  return { api, boss, other, player };
}

/** The form's template: a tournament body without name and date. */
function template(over: Record<string, unknown> = {}, settings: Record<string, unknown> = {}) {
  const { name: _n, botPool: _b, ...rest } = tournamentBody({ parallel: 3, ...over }, settings);
  return rest;
}

describe('tournament presets per admin (decision 325)', () => {
  it('keeps each admin their own presets, sorted by name', async () => {
    const { boss, other, player } = await setup();
    expect((await boss.get('/tournament-presets')).body).toEqual([]);
    const r = await boss.post('/tournament-presets', {
      name: 'Testturnier',
      body: template({}, { size: 4, format: 'single' }),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await boss.post('/tournament-presets', { name: 'DT-Cup', body: template() });
    const list = (await boss.get('/tournament-presets')).body as {
      id: string;
      name: string;
      body: { parallel: number; settings: { size: number } };
    }[];
    expect(list.map((p) => p.name)).toEqual(['DT-Cup', 'Testturnier']);
    expect(list[1]!.body.parallel).toBe(3);
    expect(list[1]!.body.settings.size).toBe(4);
    // No server set up yet: the preset keeps empty ids.
    expect(
      (
        await boss.post('/tournament-presets', {
          name: 'Empty',
          body: { ...template(), agentId: '', profileId: '' },
        })
      ).status,
    ).toBe(200);
    await boss.del(
      `/tournament-presets/${(await boss.get('/tournament-presets')).body.find((p: { name: string }) => p.name === 'Empty').id}`,
    );
    // Another admin sees none of them and cannot delete them; players have no access.
    expect((await other.get('/tournament-presets')).body).toEqual([]);
    expect((await other.del(`/tournament-presets/${list[0]!.id}`)).status).toBe(404);
    expect((await player.get('/tournament-presets')).status).toBe(403);
    expect((await boss.del(`/tournament-presets/${list[0]!.id}`)).status).toBe(204);
    expect((await boss.get('/tournament-presets')).body).toHaveLength(1);
  });

  it('replaces a preset of the same name only when asked', async () => {
    const { boss } = await setup();
    await boss.post('/tournament-presets', { name: 'Friday', body: template() });
    const again = await boss.post('/tournament-presets', {
      name: 'friday',
      body: template({ parallel: 1 }),
    });
    expect(again.status).toBe(409);
    expect((again.body as { key: string }).key).toBe('a preset named {name} already exists');
    const ok = await boss.post('/tournament-presets', {
      name: 'friday',
      body: template({ parallel: 1 }),
      replace: true,
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveLength(1);
    expect((ok.body as { name: string; body: { parallel: number } }[])[0]).toMatchObject({
      name: 'friday',
      body: { parallel: 1 },
    });
  });

  it('checks the name, the settings and the limit', async () => {
    const { boss } = await setup();
    expect((await boss.post('/tournament-presets', { name: ' ', body: template() })).status).toBe(
      400,
    );
    expect(
      (await boss.post('/tournament-presets', { name: 'x'.repeat(41), body: template() })).status,
    ).toBe(400);
    expect(
      (
        await boss.post('/tournament-presets', {
          name: 'Bad',
          body: { ...template(), parallel: 9 },
        })
      ).status,
    ).toBe(400);
    for (let i = 0; i < MAX_PRESETS; i++)
      expect(
        (await boss.post('/tournament-presets', { name: `P${i}`, body: template() })).status,
      ).toBe(200);
    const full = await boss.post('/tournament-presets', { name: 'One more', body: template() });
    expect(full.status).toBe(409);
    expect((full.body as { key: string }).key).toBe('at most {n} presets');
    // Replacing one still works at the limit.
    expect(
      (await boss.post('/tournament-presets', { name: 'P0', body: template(), replace: true }))
        .status,
    ).toBe(200);
  });
});
