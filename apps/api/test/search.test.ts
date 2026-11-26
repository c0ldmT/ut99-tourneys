import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { DB, type Db } from '../src/db/database.js';
import { tournaments } from '../src/db/schema.js';
import { Client, startApi, startSeason } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

function tournament(id: string, name: string, phase: string, udtJson: string | null = null) {
  return {
    id,
    name,
    agentId: 'pi',
    profileId: 'local',
    settingsJson: '{}',
    botPoolJson: '[]',
    createdBy: 'x',
    createdAt: new Date().toISOString(),
    phase,
    udtJson,
  };
}

describe('quick search (decision 313)', () => {
  it('finds bots, teams, players and tournaments by name; admins find every user', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    await Client.login(api, 'Novak');
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    await admin.post('/bots', { name: 'Nova', skill: 5 });
    await admin.post('/bots', { name: 'Supernova', skill: 3 });
    await mario.post('/udt/team', {
      name: 'Nexus',
      tag: 'NX',
      starter: { name: 'Mira', skill: 3 },
    });
    const db = api.app.get<Db>(DB);
    db.insert(tournaments)
      .values([
        tournament('t1', 'Nova Cup', 'finished'),
        tournament('t2', 'Nova Draft', 'draft'),
        tournament('t3', 'Nova League', 'finished', '{"league":{"day":1}}'),
      ])
      .run();

    const r = await mario.get('/search?q=nov');
    expect(r.status).toBe(200);
    // Starts with the query before contains it.
    expect(r.body.bots.map((b: { name: string }) => b.name)).toEqual(['Nova', 'Supernova']);
    expect(r.body.tournaments.map((t: { id: string }) => t.id)).toEqual(['t1']);
    // Novak has no statistics: only admins find him.
    expect(r.body.players).toEqual([]);
    const a = await admin.get('/search?q=nov');
    expect(a.body.players.map((p: { name: string }) => p.name)).toEqual(['Novak']);
    expect(a.body.players[0].key).toBeNull();
    expect(a.body.tournaments.map((t: { id: string }) => t.id).sort()).toEqual(['t1', 't2']);

    const teams = (await mario.get('/search?q=nx')).body.teams;
    expect(teams).toEqual([
      expect.objectContaining({ name: 'Nexus', tag: 'NX', manager: 'Mario' }),
    ]);
    expect((await mario.get('/search?q=')).status).toBe(400);
    expect((await new Client(api).get('/search?q=nova')).status).toBe(401);
  });
});
