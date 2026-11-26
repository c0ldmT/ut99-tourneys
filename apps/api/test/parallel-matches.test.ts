import {
  BridgeConfigSchema,
  FakeClock,
  memoryLogger,
  ModServer,
  ModSimulator,
  WebsiteAgent,
} from '@tourney/bridge';
import { afterEach, describe, expect, it } from 'vitest';
import { EventLogService } from '../src/tournaments/event-log.service.js';
import { LiveHub } from '../src/tournaments/hub.js';
import { Client, startApi, tournamentBody } from './helpers.js';

const KEY = 'test-shared-key';
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function until(cond: () => boolean | Promise<boolean>, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('timeout');
}

describe('parallel matches on extra servers (decision 291)', () => {
  it('plays the bot matches of a tournament on three servers at once', async () => {
    const clock = new FakeClock();
    const { api } = await startApi({}, { clock });
    cleanups.push(() => api.close());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    const me = (await mario.get('/me')).body as { joinToken: string; displayName: string };

    const blog = memoryLogger();
    const servers: { id: string; agent: WebsiteAgent; sim: ModSimulator }[] = [];
    for (const [i, id] of ['pi', 's2', 's3'].entries()) {
      const { token } = (await admin.post('/agents', { id, name: `Server ${id}` })).body;
      const mod = new ModServer({
        host: '127.0.0.1',
        port: 0,
        sharedKey: KEY,
        log: blog,
        idleTimeoutMs: 600_000,
      });
      await mod.listen();
      cleanups.push(() => mod.close());
      const config = BridgeConfigSchema.parse({
        agentId: id,
        mod: { host: '127.0.0.1', port: 7790 + i, sharedKey: KEY },
        server: {
          id: 'local',
          name: `UT ${id}`,
          os: 'linux',
          installDir: '/nonexistent',
          lobbyMap: 'DM-Deck16][',
          publicAddress: `ut.test:${7777 + 10 * i}`,
          manage: false,
        },
        website: { url: `${api.url.replace('http', 'ws')}/api/agent`, token },
      });
      const agent = new WebsiteAgent({
        config: { ...config, website: config.website! },
        baseDir: '.',
        mod,
        clock,
        log: blog,
        memoryOnly: true,
        timing: { postGameDelayMs: 2_000, simulateDelayMs: 1_000, loadingTimeoutMs: 30_000 },
      });
      agent.start();
      cleanups.push(() => agent.stop());
      const sim = new ModSimulator({
        host: '127.0.0.1',
        port: mod.address!.port,
        sharedKey: KEY,
        // Mario plays on the tournament's own server only.
        players: i === 0 ? [{ token: me.joinToken, name: me.displayName }] : [],
        clock,
        log: blog,
        behaviour: { gameDurationMs: 10_000, scoreIntervalMs: 3_000 },
      });
      sim.start();
      cleanups.push(() => sim.stop());
      servers.push({ id, agent, sim });
    }
    await until(
      async () =>
        ((await admin.get('/agents')).body as { online: boolean }[]).filter((a) => a.online)
          .length === 3,
    );

    const created = await admin.post(
      '/tournaments',
      tournamentBody({ serverAuto: true, parallel: 3 }, { size: 8, format: 'single' }),
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    expect(created.body.parallel).toBe(3);
    await mario.post(`/tournaments/${id}/registration`);
    expect((await admin.post(`/tournaments/${id}/seed`, { mode: 'auto' })).status).toBe(200);
    expect((await admin.post(`/tournaments/${id}/run`)).status).toBe(204);
    const started = (await admin.get(`/tournaments/${id}`)).body;
    expect(started.lanes.map((l: { agentId: string }) => l.agentId)).toEqual(['s2', 's3']);
    expect(started.lanes[0].connectAddress).toBe('ut.test:7787');

    const hub = api.app.get(LiveHub);
    let maxLive = 0;
    let maxTele = 0;
    let maxCount = 0;
    const log = api.app.get(EventLogService);
    let lanesDuring = 2;
    const settle = async () => {
      for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 2));
      for (const s of servers) await s.agent.director?.idle();
    };
    for (let i = 0; i < 8_000; i++) {
      await settle();
      if (i % 4 === 0) {
        const d = (await admin.get(`/tournaments/${id}`)).body;
        if (d.phase === 'finished') break;
        if (d.projection?.liveMatches)
          maxLive = Math.max(maxLive, Object.keys(d.projection.liveMatches).length);
        maxTele = Math.max(maxTele, hub.allLive(id).length);
        maxCount = Math.max(maxCount, log.liveCount());
        if (d.phase === 'running' && d.projection.results.length >= 4)
          lanesDuring = Math.min(lanesDuring, d.lanes.length);
      }
      clock.advance(500);
    }
    const d = (await admin.get(`/tournaments/${id}`)).body;
    expect(d.phase, blog.lines.slice(-40).join('\n')).toBe('finished');
    expect(d.projection.results).toHaveLength(7);
    expect(d.projection.results.every((r: { outcome: string }) => r.outcome === 'played')).toBe(
      true,
    );
    // Round one ran on all three servers; the live data of each match was kept apart.
    expect(maxLive).toBe(3);
    expect(maxTele).toBeGreaterThanOrEqual(2);
    // The live counter in the header counts matches, not tournaments (decision 294).
    expect(maxCount).toBe(3);
    expect(log.liveCount()).toBe(0);
    // Extra servers were released once fewer matches were left than servers, all at the end.
    expect(lanesDuring).toBeLessThan(2);
    expect(d.lanes).toEqual([]);
    const events = (await admin.get(`/tournaments/${id}/events`)).body as {
      type: string;
      data: { server?: string; entrants?: string[] };
    }[];
    const called = events.filter((e) => e.type === 'match.called');
    expect(called).toHaveLength(7);
    const marioEntrant = Object.values(d.projection.entrants).find(
      (e: any) => e.kind === 'human',
    ) as { id: string };
    for (const e of called)
      if (e.data.entrants!.includes(marioEntrant.id)) expect(e.data.server).toBeUndefined();
    // The main server knew about the extra servers from the start: it played Mario's match first.
    expect(called.find((e) => !e.data.server)!.data.entrants).toContain(marioEntrant.id);
    expect(called.some((e) => e.data.server === 's2')).toBe(true);
    // The extra servers stopped; nothing went wrong on the way.
    await settle();
    expect(servers[1]!.agent.active).toBeUndefined();
    expect(servers[2]!.agent.active).toBeUndefined();
    expect(blog.lines.filter((l) => /^error:/.test(l))).toEqual([]);
    // Each game was loaded on the server that played it.
    const games = Object.values(d.projection.games).flat().length;
    expect(servers.reduce((n, s) => n + s.sim.travels.length, 0)).toBe(games);
  });

  it('takes 1 to 8 parallel matches, changeable before the start', async () => {
    const clock = new FakeClock();
    const { api } = await startApi({}, { clock });
    cleanups.push(() => api.close());
    const admin = await Client.login(api, 'Boss', true);
    await admin.post('/agents', { id: 'pi', name: 'Server pi' });
    const bad = await admin.post(
      '/tournaments',
      tournamentBody({ parallel: 9 }, { size: 8, format: 'single' }),
    );
    expect(bad.status).toBe(400);
    const r = await admin.post('/tournaments', tournamentBody({}, { size: 8, format: 'single' }));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.parallel).toBe(1);
    expect((await admin.patch(`/tournaments/${r.body.id}`, { parallel: 4 })).body.parallel).toBe(4);
  });
});
