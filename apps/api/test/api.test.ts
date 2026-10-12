import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { Client, startApi, tournamentBody } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe('auth', () => {
  it('requires login, allows dev login and keeps names unique', async () => {
    ({ api } = await startApi());
    const anon = new Client(api);
    expect((await anon.get('/config')).body).toMatchObject({ devLogin: true, discordLogin: false });
    expect((await anon.get('/me')).status).toBe(401);
    expect((await anon.get('/tournaments')).status).toBe(401);

    const mario = await Client.login(api, 'Mario');
    const me = (await mario.get('/me')).body;
    expect(me).toMatchObject({ displayName: 'Mario', isAdmin: false });
    expect(me.joinToken).toMatch(/^[A-Za-z0-9]{24}$/);

    const rotated = (await mario.post('/me/token')).body;
    expect(rotated.joinToken).not.toBe(me.joinToken);

    const anna = await Client.login(api, 'Anna');
    expect((await anna.patch('/me', { displayName: 'mario' })).status).toBe(409);
    expect((await anna.patch('/me', { displayName: 'Änna Ü.' })).body.displayName).toBe('Anna U.');

    // Admin endpoints
    expect((await mario.get('/users')).status).toBe(403);
    const admin = await Client.login(api, 'Boss', true);
    expect((await admin.get('/users')).body).toHaveLength(3);

    await mario.post('/auth/logout');
    expect((await mario.get('/me')).status).toBe(401);
  });

  it('rejects state-changing requests without the CSRF header', async () => {
    ({ api } = await startApi());
    const res = await fetch(`${api.url}/api/auth/dev-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Eve' }),
    });
    expect(res.status).toBe(403);
  });

  it('refuses dev login when it is disabled', async () => {
    ({ api } = await startApi({ DEV_LOGIN: 'false' }));
    expect((await new Client(api).post('/auth/dev-login', { name: 'Eve' })).status).toBe(403);
  });
});

describe('tournaments', () => {
  it('creates a draft, takes registrations, seeds and resets', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    expect((await admin.post('/agents', { id: 'pi', name: 'Raspberry' })).status).toBe(201);

    const created = await admin.post('/tournaments', tournamentBody());
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect(id).toBe('friday-cup');
    expect(created.body.phase).toBe('draft');

    // Invalid rules are rejected.
    const bad = await admin.post('/tournaments', tournamentBody({}, { size: 12 }));
    expect(bad.status).toBe(400);

    // Monster Hunt: teams only, MH maps only; listed with its game mode.
    const mh = (teamSize: number, mapPool = ['MH-NaliVillage']) => {
      const body = tournamentBody({ name: `Hunt ${teamSize}` }, { teamSize });
      const rules = { mapPool, timeLimitMin: 20, fragLimit: 0 };
      return { ...body, settings: { ...body.settings, game: { adapter: 'ut99-mh', rules } } };
    };
    expect((await admin.post('/tournaments', mh(1))).status).toBe(400);
    expect((await admin.post('/tournaments', mh(2, ['DM-Deck16][']))).status).toBe(400);
    const hunt = await admin.post('/tournaments', mh(2));
    expect(hunt.status).toBe(201);
    const listed = (await admin.get('/tournaments')).body as { id: string; game: string }[];
    expect(listed.find((x) => x.id === hunt.body.id)?.game).toBe('mh');
    expect((await admin.req('DELETE', `/tournaments/${hunt.body.id}`)).status).toBe(204);

    const players = await Promise.all(['Mario', 'Anna', 'Jonas'].map((n) => Client.login(api!, n)));
    for (const p of players)
      expect((await p.post(`/tournaments/${id}/registration`)).status).toBe(204);
    const d1 = (await players[0]!.get(`/tournaments/${id}`)).body;
    expect(d1.registrations.map((r: { displayName: string }) => r.displayName)).toEqual([
      'Mario',
      'Anna',
      'Jonas',
    ]);
    expect(d1.me.registered).toBe(true);

    // Only admins seed.
    expect((await players[0]!.post(`/tournaments/${id}/seed`, { mode: 'auto' })).status).toBe(403);
    const seeded = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', rngSeed: 'x' });
    expect(seeded.status).toBe(200);
    expect(seeded.body.phase).toBe('seeded');
    const proj = seeded.body.projection;
    expect(proj.bracketDefinition.slots).toHaveLength(8);
    expect(Object.values(proj.entrants).filter((e: any) => e.kind === 'human')).toHaveLength(3);

    // Registration is closed now; settings are frozen.
    expect((await players[0]!.del(`/tournaments/${id}/registration`)).status).toBe(409);
    expect(
      (await admin.patch(`/tournaments/${id}`, { settings: tournamentBody().settings })).status,
    ).toBe(409);

    // Manual stacking: humans on the first slots, the rest random bots.
    const u = (n: number) => `u-${(d1.registrations[n] as { userId: string }).userId}`;
    const manual = await admin.post(`/tournaments/${id}/seed`, {
      mode: 'manual',
      slots: [u(0), null, u(1), null, u(2), null, null, 'bot-Xan'],
    });
    expect(manual.status).toBe(200);
    expect(manual.body.projection.bracketDefinition.slots.slice(0, 1)).toEqual([u(0)]);
    expect(manual.body.projection.bracketDefinition.slots[7]).toBe('bot-Xan');

    const missingHuman = await admin.post(`/tournaments/${id}/seed`, {
      mode: 'manual',
      slots: [u(0), null, u(1), null, null, null, null, null],
    });
    expect(missingHuman.status).toBe(400);

    const reset = await admin.post(`/tournaments/${id}/reset`);
    expect(reset.body.phase).toBe('draft');
    expect(reset.body.projection).toBeNull();
    expect((await admin.get(`/tournaments/${id}/events`)).body).toEqual([]);

    // Running needs the agent.
    await admin.post(`/tournaments/${id}/seed`, { mode: 'auto' });
    const run = await admin.post(`/tournaments/${id}/run`);
    expect(run.status).toBe(409);
    expect(run.body.message).toMatch(/offline/);
  });
});
