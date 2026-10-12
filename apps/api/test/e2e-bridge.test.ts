import {
  BridgeConfigSchema,
  FakeClock,
  memoryLogger,
  ModServer,
  ModSimulator,
  WebsiteAgent,
} from '@tourney/bridge';
import { afterEach, describe, expect, it } from 'vitest';
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

async function setup(
  opts: { players?: string[]; size?: number; settings?: Record<string, unknown> } = {},
) {
  const clock = new FakeClock();
  const { api } = await startApi({}, { clock });
  cleanups.push(() => api.close());
  const admin = await Client.login(api, 'Boss', true);
  const { token } = (await admin.post('/agents', { id: 'pi', name: 'Raspberry' })).body;

  const blog = memoryLogger();
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
    agentId: 'pi',
    mod: { host: '127.0.0.1', port: 7790, sharedKey: KEY },
    server: {
      id: 'local',
      name: 'Test server',
      os: 'linux',
      installDir: '/nonexistent',
      lobbyMap: 'DM-Deck16][',
      publicAddress: 'ut.test:7777',
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
  await until(async () => (await admin.get('/agents')).body[0]?.online === true);

  const names = opts.players ?? ['Mario', 'Anna', 'Jonas'];
  const players = await Promise.all(names.map((n) => Client.login(api, n)));
  const created = await admin.post(
    '/tournaments',
    tournamentBody({}, { ...(opts.size ? { size: opts.size } : {}), ...opts.settings }),
  );
  expect(created.status).toBe(201);
  const id: string = created.body.id;
  if (!opts.settings?.['teamSize'])
    for (const p of players) await p.post(`/tournaments/${id}/registration`);
  const tokens = await Promise.all(players.map(async (p) => (await p.get('/me')).body));

  const startSim = (absent: string[] = []) => {
    const sim = new ModSimulator({
      host: '127.0.0.1',
      port: mod.address!.port,
      sharedKey: KEY,
      players: tokens.map((t) => ({ token: t.joinToken, name: t.displayName })),
      clock,
      log: blog,
      behaviour: {
        gameDurationMs: 10_000,
        scoreIntervalMs: 3_000,
        absent: absent.map((n) => tokens.find((t) => t.displayName === n)!.joinToken),
      },
    });
    sim.start();
    cleanups.push(() => sim.stop());
    return sim;
  };

  const settle = async () => {
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 2));
    await agent.director?.idle();
  };
  const run = async (cond: () => Promise<boolean>, maxSteps = 8_000) => {
    for (let i = 0; i < maxSteps; i++) {
      await settle();
      if (i % 4 === 0 && (await cond())) return;
      clock.advance(500);
    }
    throw new Error(`condition not reached\n${blog.lines.slice(-40).join('\n')}`);
  };
  return { api, clock, admin, players, agent, id, startSim, run, blog, tokens };
}

describe('website + bridge + simulated UT server', () => {
  it('runs a 2on2 team tournament with a line-up change during a game', async () => {
    const env = await setup({
      players: ['Mario', 'Anna', 'Jonas', 'Lea', 'Tim'],
      settings: { size: 4, teamSize: 2, format: 'single' },
    });
    const { admin, id, players } = env;
    const [mario, anna, jonas, lea, tim] = players;
    const team = (await mario!.post(`/tournaments/${id}/teams`, { name: 'Red' })).body.teams[0];
    await anna!.post(`/tournaments/${id}/teams/join`, { code: team.inviteCode });
    await jonas!.post(`/tournaments/${id}/teams/join`, { code: team.inviteCode }); // substitute
    for (const p of [lea, tim]) await p!.post(`/tournaments/${id}/registration`);
    expect(
      (await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', rngSeed: 't' })).status,
    ).toBe(200);
    expect((await admin.post(`/tournaments/${id}/run`)).status).toBe(204);
    await until(async () => (await admin.get(`/tournaments/${id}`)).body.phase === 'checkIn');
    env.startSim();

    let changed = false;
    await env.run(async () => {
      const d = (await admin.get(`/tournaments/${id}`)).body;
      if (!changed && d.live?.phase === 'live') {
        // Mario puts Jonas in for Anna; applies from Red's next game.
        const ids = d.teams[0].members.map((m: { userId: string }) => m.userId);
        const res = await mario!.req('PUT', `/tournaments/${id}/teams/${team.id}/lineup`, {
          starters: [ids[0], ids[2]],
        });
        expect(res.status).toBe(204);
        changed = true;
      }
      return d.phase === 'finished';
    });
    const d = (await admin.get(`/tournaments/${id}`)).body;
    expect(changed).toBe(true);
    expect(d.projection.results).toHaveLength(3);
    expect(d.projection.results.every((r: { outcome: string }) => r.outcome === 'played')).toBe(
      true,
    );
    const events = (await admin.get(`/tournaments/${id}/events`)).body as any[];
    expect(events.some((e) => e.type === 'team.lineupSet' && e.actor.kind === 'player')).toBe(true);
    expect(events.filter((e) => e.type === 'match.started').every((e) => e.data.lineups)).toBe(
      true,
    );
    expect(env.blog.lines.some((l) => l.includes('re-planning'))).toBe(false);
  });

  it('runs a whole tournament started from the website', async () => {
    const env = await setup();
    const { admin, id } = env;
    expect(
      (await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', rngSeed: 's1' })).status,
    ).toBe(200);
    // Players see where to connect.
    const view = (await env.players[0]!.get(`/tournaments/${id}`)).body;
    expect(view.connectAddress).toBe('ut.test:7777');
    expect(view.me.hasAccess).toBe(true);

    const run = await admin.post(`/tournaments/${id}/run`);
    expect(run.status, JSON.stringify(run.body)).toBe(204);
    await until(async () => (await admin.get(`/tournaments/${id}`)).body.phase === 'checkIn');
    env.startSim();

    let sawLive = false;
    await env.run(async () => {
      const d = (await admin.get(`/tournaments/${id}`)).body;
      if (d.live) sawLive = true;
      return d.phase === 'finished';
    });
    const d = (await admin.get(`/tournaments/${id}`)).body;
    expect(d.projection.championId).toBeDefined();
    expect(d.projection.bracket.status).toBe('finished');
    expect(d.projection.checkedIn).toHaveLength(3);
    expect([14, 15]).toContain(d.projection.results.length);
    expect(d.projection.results.some((r: { outcome: string }) => r.outcome === 'played')).toBe(
      true,
    );
    expect(sawLive).toBe(true);
    const events = (await admin.get(`/tournaments/${id}/events`)).body as {
      actor: { kind: string; id?: string };
    }[];
    expect(events.filter((e) => e.actor.kind === 'bridge').every((e) => e.actor.id === 'pi')).toBe(
      true,
    );
    // The agent reported its status.
    const agents = (await admin.get('/agents')).body;
    expect(agents[0].status.modConnected).toBe(true);
    expect(env.blog.lines.filter((l) => /^error:/.test(l))).toEqual([]);
  });

  it('pauses, resumes and aborts through admin commands; spectators get access by watching', async () => {
    const env = await setup({ players: ['Mario', 'Anna'] });
    const { admin, id } = env;
    await admin.post(`/tournaments/${id}/seed`, { mode: 'auto' });
    await admin.post(`/tournaments/${id}/run`);
    await until(async () => (await admin.get(`/tournaments/${id}`)).body.phase === 'checkIn');

    // A spectator clicks "watch": the bridge gets the new access list.
    const guest = await Client.login(env.api, 'Guest');
    expect((await guest.post(`/tournaments/${id}/watch`)).status).toBe(204);
    expect((await guest.get(`/tournaments/${id}`)).body.me.hasAccess).toBe(true);

    env.startSim();
    await env.run(async () => (await admin.get(`/tournaments/${id}`)).body.phase === 'running');

    expect(
      (await admin.post(`/tournaments/${id}/command`, { kind: 'pause', reason: 'pizza' })).status,
    ).toBe(204);
    expect((await admin.get(`/tournaments/${id}`)).body.phase).toBe('paused');
    expect((await admin.post(`/tournaments/${id}/command`, { kind: 'resume' })).status).toBe(204);
    expect((await admin.get(`/tournaments/${id}`)).body.phase).toBe('running');
    expect(
      (await admin.post(`/tournaments/${id}/command`, { kind: 'announce', message: 'hi all' }))
        .status,
    ).toBe(204);
    expect(env.blog.lines.some((l) => l.includes('say: hi all'))).toBe(true);

    expect(
      (await admin.post(`/tournaments/${id}/command`, { kind: 'abort', reason: 'server on fire' }))
        .status,
    ).toBe(204);
    const d = (await admin.get(`/tournaments/${id}`)).body;
    expect(d.phase).toBe('aborted');
    expect(env.agent.active).toBeUndefined();
  });

  it('resumes a running tournament after the bridge reconnects', async () => {
    const env = await setup({ players: ['Mario', 'Anna'] });
    const { admin, id } = env;
    await admin.post(`/tournaments/${id}/seed`, { mode: 'auto' });
    await admin.post(`/tournaments/${id}/run`);
    env.startSim();
    await env.run(async () => (await admin.get(`/tournaments/${id}`)).body.phase === 'running');

    // Connection drop: the bridge keeps the director; the website re-sends run on hello.
    env.agent.link.stop();
    await until(async () => (await admin.get('/agents')).body[0]?.online === false);
    env.agent.link.start();
    await until(async () => (await admin.get('/agents')).body[0]?.online === true);
    await env.run(async () => (await admin.get(`/tournaments/${id}`)).body.phase === 'finished');
  });
});
