import { describe, expect, it, vi } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import { eq } from 'drizzle-orm';
import { AgentsService } from '../src/agents/agents.service.js';
import { AgentConnections } from '../src/agents/connections.js';
import { DB, type Db } from '../src/db/database.js';
import { tournaments } from '../src/db/schema.js';
import { Client, startApi, tournamentBody } from './helpers.js';

const profile = (port: number) => ({
  id: 'local',
  name: 'UT server',
  os: 'linux' as const,
  port,
  lobbyMap: 'DM-Deck16][',
  manage: true,
});

/** Two servers that look online; commands are recorded instead of sent. */
async function poolApi() {
  const clock = new FakeClock(Date.parse('2026-11-25T12:00:00Z'));
  const { api } = await startApi({}, { clock });
  const admin = await Client.login(api, 'Boss', true);
  const agents = api.app.get(AgentsService);
  for (const [id, port] of [
    ['s1', 7777],
    ['s2', 7787],
  ] as const) {
    await admin.post('/agents', { id, name: `Server ${id}` });
    agents.saveHello(id, { profiles: [profile(port)] });
  }
  const conn = api.app.get(AgentConnections);
  const sent: { agentId: string; tournamentId: string }[] = [];
  vi.spyOn(conn, 'isOnline').mockReturnValue(true);
  vi.spyOn(conn, 'send').mockReturnValue('x');
  vi.spyOn(conn, 'command').mockImplementation(async (agentId, cmd) => {
    if (cmd.kind === 'tournament.run') sent.push({ agentId, tournamentId: cmd.tournamentId });
  });
  return { api, admin, clock, sent, db: api.app.get<Db>(DB) };
}

async function seeded(admin: Client, name: string, over: Record<string, unknown> = {}) {
  const r = await admin.post(
    '/tournaments',
    tournamentBody(
      { name, agentId: 's1', serverAuto: true, ...over },
      { size: 4, format: 'single' },
    ),
  );
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const id = r.body.id as string;
  const s = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto' });
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  return id;
}

describe('server pool (decision 282)', () => {
  it('gives automatic tournaments a free server of the pool', async () => {
    const { api, admin, sent } = await poolApi();
    try {
      const a = await seeded(admin, 'A');
      const b = await seeded(admin, 'B');
      const c = await seeded(admin, 'C');
      expect((await admin.post(`/tournaments/${a}/run`)).status).toBe(204);
      // s1 was just sent A (still "seeded"): B takes s2.
      expect((await admin.post(`/tournaments/${b}/run`)).status).toBe(204);
      expect(sent).toEqual([
        { agentId: 's1', tournamentId: a },
        { agentId: 's2', tournamentId: b },
      ]);
      expect((await admin.get(`/tournaments/${b}`)).body).toMatchObject({
        agentId: 's2',
        serverAuto: true,
        serverName: 'Server s2',
      });
      const full = await admin.post(`/tournaments/${c}/run`);
      expect(full.status).toBe(409);
      expect(full.body.key).toBe('no free server in the pool');

      // A server out of the pool is not taken; a fixed tournament still runs on it.
      expect((await admin.patch('/agents/s2', { inPool: false })).body.inPool).toBe(false);
      const pool = api.app.get(AgentsService).pool();
      expect(pool.map((p) => p.agentId)).toEqual(['s1']);
    } finally {
      vi.restoreAllMocks();
      await api.close();
    }
  });

  it('skips servers without the maps and keeps a fixed tournament on its server', async () => {
    const { api, admin, sent } = await poolApi();
    try {
      api.app
        .get(AgentsService)
        .saveInventory('s1', 'local', { maps: [{ id: 'DM-Deck16][' }], bots: [] }, 'now');
      const a = await seeded(admin, 'A');
      expect((await admin.post(`/tournaments/${a}/run`)).status).toBe(204);
      expect(sent[0]).toEqual({ agentId: 's2', tournamentId: a });
      const fixed = await seeded(admin, 'Fixed', { serverAuto: false });
      expect((await admin.post(`/tournaments/${fixed}/run`)).status).toBe(204);
      expect(sent[1]).toEqual({ agentId: 's1', tournamentId: fixed });
    } finally {
      vi.restoreAllMocks();
      await api.close();
    }
  });

  it('lets nobody play in two tournaments at once', async () => {
    const { api, admin, db } = await poolApi();
    try {
      const mario = await Client.login(api, 'Mario');
      const mk = async (name: string, scheduledAt?: string) => {
        const r = await admin.post(
          '/tournaments',
          tournamentBody(
            { name, agentId: 's1', serverAuto: true, ...(scheduledAt ? { scheduledAt } : {}) },
            { size: 4, format: 'single' },
          ),
        );
        return r.body.id as string;
      };
      // Overlapping start times: the second sign-up is refused.
      const t1 = await mk('Evening', '2026-11-25T18:00:00.000Z');
      const t2 = await mk('Late', '2026-11-25T18:10:00.000Z');
      const t3 = await mk('Night', '2026-11-25T21:00:00.000Z');
      expect((await mario.post(`/tournaments/${t1}/registration`)).status).toBe(204);
      const twice = await mario.post(`/tournaments/${t2}/registration`);
      expect(twice.status).toBe(409);
      expect(twice.body).toMatchObject({
        key: 'you are signed up for {name} at the same time',
        params: { name: 'Evening' },
      });
      expect((await mario.post(`/tournaments/${t3}/registration`)).status).toBe(204);

      // Without start times both sign-ups work, but the second start waits for the first.
      const u1 = await mk('Open 1');
      const u2 = await mk('Open 2');
      expect((await mario.post(`/tournaments/${u1}/registration`)).status).toBe(204);
      expect((await mario.post(`/tournaments/${u2}/registration`)).status).toBe(204);
      for (const id of [u1, u2])
        expect((await admin.post(`/tournaments/${id}/seed`, { mode: 'auto' })).status).toBe(200);
      db.update(tournaments).set({ phase: 'running' }).where(eq(tournaments.id, u1)).run();
      const wait = await admin.post(`/tournaments/${u2}/run`);
      expect(wait.status).toBe(409);
      expect(wait.body).toMatchObject({
        key: 'players of this tournament still play in {name}',
        params: { name: 'Open 1' },
      });
    } finally {
      vi.restoreAllMocks();
      await api.close();
    }
  });
});
