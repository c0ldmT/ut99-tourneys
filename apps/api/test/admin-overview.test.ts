import { afterEach, describe, expect, it } from 'vitest';
import { ServerProblems } from '../src/admin/problems.js';
import type { RunningApi } from '../src/app.js';
import { DB, type Db } from '../src/db/database.js';
import { events, tournaments } from '../src/db/schema.js';
import { Client, startApi } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

function tournament(id: string, name: string, phase: string, registrationOpen = true) {
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
    registrationOpen,
  };
}

describe('administration start page (decision 319)', () => {
  it('sums up servers, moderation, tournaments, users and problems for admins', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    expect((await mario.get('/admin/overview')).status).toBe(403);

    await admin.post('/agents', { id: 'pi', name: 'Main server' });
    const db = api.app.get<Db>(DB);
    db.insert(tournaments)
      .values([
        tournament('t1', 'Friday Cup', 'running'),
        tournament('t2', 'Open Night', 'draft'),
        tournament('t3', 'Closed Draft', 'draft', false),
        tournament('t4', 'Old Cup', 'aborted'),
      ])
      .run();
    const now = new Date().toISOString();
    db.insert(events)
      .values({
        tournamentId: 't4',
        seq: 1,
        type: 'tournament.aborted',
        at: now,
        json: JSON.stringify({
          type: 'tournament.aborted',
          at: now,
          data: { reason: 'server gone' },
        }),
      })
      .run();
    api.app.get(ServerProblems).add('pi', 'error', 'UT crashed');

    const r = await admin.get('/admin/overview');
    expect(r.status).toBe(200);
    expect(r.body.servers).toEqual([
      expect.objectContaining({
        id: 'pi',
        name: 'Main server',
        online: false,
        playing: { id: 't1', name: 'Friday Cup' },
      }),
    ]);
    expect(r.body.moderation).toEqual({ open: 0 });
    expect(r.body.tournaments).toMatchObject({ live: 1, open: 1, drafts: 2 });
    expect(r.body.users).toMatchObject({ total: 2, inactive: 0 });
    expect(r.body.problems.map((p: { kind: string; text: string }) => [p.kind, p.text])).toEqual(
      expect.arrayContaining([
        ['aborted', 'server gone'],
        ['error', 'UT crashed'],
      ]),
    );
    const aborted = r.body.problems.find((p: { kind: string }) => p.kind === 'aborted');
    expect(aborted.tournament).toEqual({ id: 't4', name: 'Old Cup' });
  });
});
