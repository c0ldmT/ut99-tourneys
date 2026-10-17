import {
  BridgeConfigSchema,
  FakeClock,
  memoryLogger,
  ModServer,
  ModSimulator,
  WebsiteAgent,
} from '@tourney/bridge';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { DB, type Db } from '../src/db/database.js';
import { users } from '../src/db/schema.js';
import { TournamentsService } from '../src/tournaments/tournaments.service.js';
import type { DiscordOut } from '../src/notify/discord-out.js';
import { Client, startApi, startSeason, tournamentBody } from './helpers.js';
import { eq } from 'drizzle-orm';

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
  opts: {
    players?: string[];
    size?: number;
    settings?: Record<string, unknown>;
    env?: Record<string, string>;
    discordOut?: DiscordOut;
    beforeCreate?: (api: RunningApi) => void;
    /** Out of season: no season is started before the tournament is created. */
    noSeason?: boolean;
  } = {},
) {
  const clock = new FakeClock();
  const { api } = await startApi(opts.env ?? {}, {
    clock,
    ...(opts.discordOut ? { discordOut: opts.discordOut } : {}),
  });
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
  opts.beforeCreate?.(api);
  if (!opts.noSeason) await startSeason(admin);
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

    // Statistics: team players with kills from the mod; the champion team's players got a title.
    const stats = (await mario!.get('/stats/players?mode=tdm')).body as any[];
    // (who is in the list comes from the server's statistics: players who really played)
    const marioRow = stats.find((r) => r.name === 'Jonas');
    expect(marioRow).toMatchObject({ tournaments: 1, bot: false });
    expect(marioRow.statGames).toBeGreaterThan(0);
    expect(stats.some((r) => r.bot)).toBe(false); // bots only on request
    const withBots = (await mario!.get('/stats/players?mode=tdm&bots=1')).body as any[];
    expect(withBots.length).toBeGreaterThanOrEqual(stats.length);
    expect(withBots.reduce((n, r) => n + r.titles, 0)).toBe(2); // the two players of the winning team
    const detail = (await mario!.get(`/stats/players/${encodeURIComponent(marioRow.key)}`)).body;
    expect(detail.row.key).toBe(marioRow.key);
    expect(detail.recent.length).toBeGreaterThan(0);
    const rec = (await mario!.get('/stats/records')).body;
    expect(rec.records.map((r: { id: string }) => r.id)).toContain('game.frags');
  });

  it('sends the Monster Hunt map records with the log (HUD)', async () => {
    const env = await setup({ players: ['Mario'] });
    const body = tournamentBody({ name: 'Hunt' }, { teamSize: 2 });
    const rules = { mapPool: ['MH-NaliVillage'], timeLimitMin: 20, fragLimit: 0 };
    const created = await env.admin.post('/tournaments', {
      ...body,
      settings: { ...body.settings, game: { adapter: 'ut99-mh', rules } },
    });
    expect(created.status).toBe(201);
    const id: string = created.body.id;
    const service = env.api.app.get(TournamentsService);
    const records = () => (env.agent as any).records.get(id);
    service.syncToAgent(service.get(id)!, 0);
    await until(() => records() !== undefined);
    expect(records()).toEqual({ counts: true, maps: [] });
    // Not counted for the statistics: records are shown, a better time is no new record.
    expect((await env.admin.req('PATCH', `/tournaments/${id}`, { seasonal: false })).status).toBe(
      200,
    );
    service.syncToAgent(service.get(id)!, 0);
    await until(() => records()?.counts === false);
    // Other games carry no records.
    service.syncToAgent(service.get(env.id)!, 0);
    await new Promise((r) => setTimeout(r, 50));
    expect((env.agent as any).records.get(env.id)).toBeUndefined();
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
    // A tournament counts for the statistics unless switched off.
    expect(d.seasonal).toBe(true);
    expect(d.season).toBe(1);
    expect(((await admin.get('/stats/players?mode=dm')).body as any[]).length).toBeGreaterThan(0);
    // Ranked: every game played on the server changed ratings (simulated bot games do not).

    const rated = (await admin.get(`/tournaments/${id}/ratings`)).body as any[];
    expect(rated.length).toBeGreaterThan(0);
    expect(rated.every((g) => g.changes.length === 2)).toBe(true);
    const list = (await admin.get('/stats/ratings?mode=dm')).body as any[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((r) => r.bot)).toBe(true);
    expect(
      ((await admin.get('/stats/ratings?mode=dm&bots=0')).body as any[]).every((r) => !r.bot),
    ).toBe(true);
    // Games with bots switched off in the settings: only human-only games would count.
    await admin.req('PUT', '/settings/rating', { botGames: false });
    expect(
      ((await admin.get(`/tournaments/${id}/ratings`)).body as any[]).every((g) =>
        g.changes.every((c: { bot: boolean }) => !c.bot),
      ),
    ).toBe(true);
    // No season tournament: out of the season statistics, records and ratings; lifetime keeps it.
    await admin.req('PUT', '/settings/rating', { botGames: true });
    await admin.req('PATCH', `/tournaments/${id}`, { seasonal: false });
    expect((await admin.get('/stats/ratings?mode=dm')).body).toEqual([]);
    expect((await admin.get('/stats/players?mode=dm')).body).toEqual([]);
    expect((await admin.get('/stats/records')).body.records).toEqual([]);
    const lifetime = (await admin.get('/stats/players?mode=dm&season=lifetime')).body as any[];
    expect(lifetime.length).toBeGreaterThan(0);
    expect((await admin.get('/stats/records?season=lifetime')).body).toEqual({
      records: [],
      maps: [],
    });
    // Out of season it cannot be switched on again.
    await admin.post('/seasons/1/end');
    expect((await admin.req('PATCH', `/tournaments/${id}`, { seasonal: true })).status).toBe(409);
    // The agent reported its status.
    const agents = (await admin.get('/agents')).body;
    expect(agents[0].status.modConnected).toBe(true);
    expect(env.blog.lines.filter((l) => /^error:/.test(l))).toEqual([]);
  });

  it('runs a tournament of bots only (nobody registered)', async () => {
    const env = await setup({ players: [], size: 4 });
    const { admin, id } = env;
    const seeded = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', rngSeed: 'b' });
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
    const entrants = Object.values(seeded.body.projection.entrants) as { kind: string }[];
    expect(entrants).toHaveLength(4);
    expect(entrants.every((e) => e.kind === 'bot')).toBe(true);
    // By rating works too (strengths come from the bots' difficulty).
    expect(
      (await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', humanOrder: 'rating' })).status,
    ).toBe(200);
    expect((await admin.post(`/tournaments/${id}/run`)).status).toBe(204);
    env.startSim();
    await env.run(async () => (await admin.get(`/tournaments/${id}`)).body.phase === 'finished');
    const d = (await admin.get(`/tournaments/${id}`)).body;
    expect(d.projection.championId).toMatch(/^bot-/);
    expect(d.projection.results.some((r: { outcome: string }) => r.outcome === 'played')).toBe(
      true,
    );
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

  it('restarts a game and sets results through the organizer tools', async () => {
    const env = await setup({ players: ['Mario', 'Anna'] });
    const { admin, id } = env;
    await admin.post(`/tournaments/${id}/seed`, { mode: 'auto' });
    // Not running yet: no results, no restart.
    expect(
      (await admin.post(`/tournaments/${id}/override`, { matchId: 'W1-1', winnerId: 'x' })).status,
    ).toBe(409);
    await admin.post(`/tournaments/${id}/run`);
    env.startSim();
    await env.run(async () => (await admin.get(`/tournaments/${id}`)).body.live?.phase === 'live');

    let d = (await admin.get(`/tournaments/${id}`)).body;
    const cm = d.projection.currentMatch;
    expect((await admin.post(`/tournaments/${id}/command`, { kind: 'restart' })).status).toBe(204);
    await until(() => env.blog.lines.some((l) => l.includes(`restarting ${cm.matchId}`)));

    // A player may not set results; a stranger is no winner.
    const mario = await Client.login(env.api, 'Mario');
    const body = { matchId: cm.matchId, winnerId: cm.entrants[1] };
    expect((await mario.post(`/tournaments/${id}/override`, body)).status).toBe(403);
    expect(
      (await admin.post(`/tournaments/${id}/override`, { ...body, winnerId: 'nobody' })).status,
    ).toBe(400);
    expect((await admin.post(`/tournaments/${id}/override`, body)).status).toBe(204);
    await until(() =>
      env.blog.lines.some((l) => l.includes(`The organizer decided ${cm.matchId}`)),
    );
    await env.run(async () => (await admin.get(`/tournaments/${id}`)).body.phase === 'finished');
    d = (await admin.get(`/tournaments/${id}`)).body;
    expect(d.projection.bracket.byId[cm.matchId].winnerId).toBe(cm.entrants[1]);
    expect(d.projection.results.find((r: any) => r.matchId === cm.matchId).outcome).toBe(
      'override',
    );
  });

  it('sends Discord notifications when they are configured', async () => {
    const posts: string[] = [];
    const dms: { to: string; text: string }[] = [];
    const out: DiscordOut = {
      webhook: (_url, text) => void posts.push(text),
      dm: (to, text) => void dms.push({ to, text }),
      idle: async () => {},
    };
    const env = await setup({
      players: ['Mario', 'Anna'],
      env: {
        DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456/abc-DEF_1',
        DISCORD_BOT_TOKEN: 'bot-token',
        NOTIFY_LANG: 'en',
      },
      discordOut: out,
      // The players log in with Discord: give them Discord ids (dev logins have none).
      beforeCreate: (api) => {
        const db = api.app.get<Db>(DB);
        db.update(users)
          .set({ discordId: '300000000000000001' })
          .where(eq(users.displayName, 'Mario'))
          .run();
        db.update(users)
          .set({ discordId: '300000000000000002' })
          .where(eq(users.displayName, 'Anna'))
          .run();
      },
    });
    const { admin, id } = env;
    expect(posts[0]).toMatch(/Friday Cup.*registration is open/);
    // Anna does not want direct messages.
    expect((await env.players[1]!.patch('/me', { notifyDm: false })).body.notifyDm).toBe(false);

    await admin.post(`/tournaments/${id}/seed`, { mode: 'auto' });
    await admin.post(`/tournaments/${id}/run`);
    env.startSim();
    await env.run(async () => (await admin.get(`/tournaments/${id}`)).body.phase === 'finished');
    const d = (await admin.get(`/tournaments/${id}`)).body;

    expect(posts.some((p) => p.startsWith('🟢 Check-in for **Friday Cup**'))).toBe(true);
    const results = posts.filter((p) => /^`[WLG]/.test(p));
    expect(results).toHaveLength(d.projection.results.length);
    expect(posts.at(-1)).toMatch(/^🏆 \*\*.+\*\* wins \*\*Friday Cup\*\*/);

    // Only Mario gets DMs: check-in with his connect command, his matches, his place.
    expect(dms.every((m) => m.to === '300000000000000001')).toBe(true);
    const mario = env.tokens.find((t) => t.displayName === 'Mario')!;
    expect(dms[0]!.text).toContain(`open ut.test:7777?tk=${mario.joinToken}`);
    expect(dms.some((m) => m.text.startsWith('Your match'))).toBe(true);
    expect(dms.some((m) => /place \d|won \*\*Friday Cup/.test(m.text))).toBe(true);
    expect(d.notify).toMatchObject({ mode: 'default', defaultChannel: true, directMessages: true });
  });

  it('keeps working without and with broken notification settings', async () => {
    const env = await setup({
      players: ['Mario', 'Anna'],
      env: { DISCORD_WEBHOOK_URL: 'https://example.com/hook', NOTIFY_REMIND_MIN: 'soon' },
    });
    const { admin, id } = env;
    // A wrong webhook URL on a tournament is refused; "off" is fine.
    expect(
      (await admin.patch(`/tournaments/${id}`, { notifyMode: 'custom', webhookUrl: 'https://x.y' }))
        .status,
    ).toBe(400);
    expect((await admin.patch(`/tournaments/${id}`, { notifyMode: 'off' })).status).toBe(200);
    await admin.post(`/tournaments/${id}/seed`, { mode: 'auto' });
    await admin.post(`/tournaments/${id}/run`);
    env.startSim();
    await env.run(async () => (await admin.get(`/tournaments/${id}`)).body.phase === 'finished');
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
