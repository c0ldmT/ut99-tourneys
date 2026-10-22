import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { DB, type Db } from '../src/db/database.js';
import { eq } from 'drizzle-orm';
import { udtRoster, udtTraits } from '../src/db/schema.js';
import { Client, startApi, startSeason, tournamentBody } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

async function setup() {
  ({ api } = await startApi());
  const admin = await Client.login(api, 'Boss', true);
  const mario = await Client.login(api, 'Mario');
  const tim = await Client.login(api, 'Tim');
  const anna = await Client.login(api, 'Anna');
  await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
  for (let i = 0; i < 10; i++)
    await admin.post('/bots', { name: `Lib${i}`, skill: [1, 2, 2, 3, 3, 4, 5, 6, 7, 2][i] });
  await admin.req('PUT', '/settings/udt', { enabled: true });
  await startSeason(admin);
  await mario.post('/udt/team', {
    name: 'Nexus',
    tag: '[NX]',
    starter: { name: 'Mira', skill: 3 },
  });
  await tim.post('/udt/team', { name: 'Iron', tag: '[IG]', starter: { name: 'Tox', skill: 2 } });
  return { admin, mario, tim, anna };
}

const udtCup = (teamSize: number, udt: Record<string, unknown> = {}) =>
  tournamentBody(
    { name: `Daily Cup ${teamSize}`, botPool: [], kind: 'udt', udt },
    { size: 4, format: 'single', teamSize },
  );

describe('Unreal Dream Team: events', () => {
  it('1v1: managers enter, the seeding plays their lineups and fills up with library bots', async () => {
    const { admin, mario, tim, anna } = await setup();
    const t = await admin.post('/tournaments', udtCup(1));
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const id = t.body.id as string;
    expect((await admin.get(`/tournaments/${id}`)).body).toMatchObject({ kind: 'udt' });
    const ev = (await mario.get('/udt/events')).body;
    expect(ev[0]).toMatchObject({ id, teamSize: 1, open: true, entered: false });
    expect(ev[0].lineup).toMatchObject({ bots: ['Mira'], problems: [] });
    // Traits reach the game: Claudius' heir gives the starter (skill 3) one step more.
    const mid = (await mario.get('/me')).body.id as string;
    const mira = (await mario.get('/udt')).body.roster[0].botId as string;
    const db = api!.app.get<Db>(DB);
    db.insert(udtTraits)
      .values({
        id: 'tC',
        season: 1,
        userId: mid,
        code: 'claudius',
        source: 'pack',
        createdAt: 'x',
      })
      .run();
    expect((await mario.post('/udt/traits/tC/assign', { botId: mira })).status).toBe(200);
    expect((await mario.post(`/udt/events/${id}/enter`)).status).toBe(200);
    expect((await tim.post(`/udt/events/${id}/enter`)).status).toBe(200);
    expect((await anna.post(`/udt/events/${id}/enter`)).status).toBe(409); // no team
    const seeded = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', rngSeed: 's' });
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
    const entrants = Object.values(seeded.body.projection.entrants) as any[];
    expect(entrants).toHaveLength(4);
    const marioId = (await mario.get('/me')).body.id as string;
    const nx = entrants.find((e) => e.id === `udt-${marioId}`);
    expect(nx, JSON.stringify(nx)).toMatchObject({
      kind: 'bot',
      displayName: 'Nexus',
      bot: { name: '[NX]Mira', skill: 4 },
    });
    // Two free library bots fill the bracket (not the managers' starter bots).
    const fill = entrants.filter((e) => !e.id.startsWith('udt-'));
    expect(fill).toHaveLength(2);
    expect(fill.every((e) => e.kind === 'bot' && /^Lib/.test(e.bot.name))).toBe(true);
    // The manager does not bet on the own match.
    const bets = (await mario.get(`/bets/tournaments/${id}`)).body;
    const own = bets.matches.find((m: any) => m.entrants.includes(nx.id));
    // The expert tip names the side, not the entrant id.
    for (const m of bets.matches) if (m.expert) expect(m.expert.pickName).not.toMatch(/^udt-/);
    if (own) {
      const r = await mario.req('PUT', `/bets/tournaments/${id}/${own.matchId}`, {
        pick: own.entrants[0],
        amount: 10,
      });
      expect(r.status).toBe(403);
    }
    // Sign-up closed after the seeding.
    expect((await mario.req('DELETE', `/udt/events/${id}/enter`)).status).toBe(409);
  });

  it('a bot in a seeded or running Dream Team tournament cannot be sold until it ends', async () => {
    const { admin, mario, tim } = await setup();
    const marioId = (await mario.get('/me')).body.id as string;
    const lib = (await admin.get('/bots')).body.bots as { id: string; name: string }[];
    const bought = lib.find((b) => b.name === 'Lib5')!.id;
    const db = api!.app.get<Db>(DB);
    const mira = (await mario.get('/udt')).body.roster[0].botId as string;
    db.update(udtRoster).set({ dmSlot: null }).where(eq(udtRoster.botId, mira)).run();
    db.insert(udtRoster)
      .values({ season: 1, botId: bought, userId: marioId, price: 500, acquiredAt: 'x', dmSlot: 1 })
      .run();
    const id = (await admin.post('/tournaments', udtCup(1))).body.id as string;
    expect((await mario.post(`/udt/events/${id}/enter`)).status).toBe(200);
    expect((await tim.post(`/udt/events/${id}/enter`)).status).toBe(200);
    const seeded = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', rngSeed: 's' });
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
    const nx = seeded.body.projection.entrants[`udt-${marioId}`];
    expect(nx.bot.id).toBe(bought);
    const sell = await mario.post(`/udt/roster/${bought}/sell`);
    expect(sell.status).toBe(409);
    expect(JSON.stringify(sell.body)).toMatch(/plays in a running Dream Team tournament/);
    // Called off: the bot is free again.
    const off = await admin.post(`/tournaments/${id}/command`, { kind: 'abort', reason: 'test' });
    expect(off.status, JSON.stringify(off.body)).toBe(204);
    expect((await mario.post(`/udt/roster/${bought}/sell`)).status).toBe(200);
  });

  it('the tournament page signs up through the Dream Team: one count, one season', async () => {
    const { admin, mario, tim, anna } = await setup();
    // No season switch of its own: a Dream Team tournament always belongs to the season.
    const t = await admin.post('/tournaments', { ...udtCup(1), seasonal: false });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const id = t.body.id as string;
    expect((await admin.get(`/tournaments/${id}`)).body.seasonal).toBe(true);
    // Register on the tournament page = enter the team.
    expect((await mario.post(`/tournaments/${id}/registration`)).status).toBeLessThan(300);
    expect((await anna.post(`/tournaments/${id}/registration`)).status).toBe(409); // no team
    const ev = (await mario.get('/udt/events')).body.find((e: any) => e.id === id);
    expect(ev).toMatchObject({ entered: true });
    const page = (await mario.get(`/tournaments/${id}`)).body;
    expect(page.me.registered).toBe(true);
    expect(page.registrations).toEqual([
      expect.objectContaining({ label: '[NX] Nexus', displayName: 'Mario' }),
    ]);
    // Entered on the Dream Team page: the tournament page and list count it too.
    expect((await tim.post(`/udt/events/${id}/enter`)).status).toBe(200);
    expect((await tim.get(`/tournaments/${id}`)).body.registrations).toHaveLength(2);
    const row = (await tim.get('/tournaments')).body.find((x: any) => x.id === id);
    expect(row).toMatchObject({ registered: 2, registeredMe: true, kind: 'udt' });
    // Withdraw on the tournament page = the team leaves; an admin can take a team out.
    expect((await mario.req('DELETE', `/tournaments/${id}/registration`)).status).toBeLessThan(300);
    expect((await mario.get('/udt/events')).body.find((e: any) => e.id === id).entered).toBe(false);
    const timId = (await tim.get('/me')).body.id as string;
    expect((await admin.req('DELETE', `/tournaments/${id}/registrations/${timId}`)).status).toBe(
      204,
    );
    expect((await admin.get(`/tournaments/${id}`)).body.registrations).toHaveLength(0);
  });

  it('AI managers enter when the sign-up opens; a human takes the place of the last AI team', async () => {
    const { admin, mario, tim } = await setup();
    await admin.req('PUT', '/settings/udt', { aiEnabled: true, aiCount: 4 });
    // The cup opens: the four AI teams fill it at once.
    const t = await admin.post('/tournaments', udtCup(1));
    const id = t.body.id as string;
    let page = (await admin.get(`/tournaments/${id}`)).body;
    expect(page.registrations).toHaveLength(4);
    expect(page.registrations.every((r: any) => r.ai)).toBe(true);
    expect(page.signup).toMatchObject({ aiOn: true, aiCount: 4 });
    // Humans first: Mario and Tim enter the full bracket, two AI teams make room.
    expect((await mario.post(`/tournaments/${id}/registration`)).status).toBe(204);
    expect((await tim.post(`/udt/events/${id}/enter`)).status).toBe(200);
    page = (await admin.get(`/tournaments/${id}`)).body;
    expect(page.registrations).toHaveLength(4);
    expect(page.registrations.filter((r: any) => !r.ai)).toHaveLength(2);
    // The seeding plays them all.
    const seeded = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', rngSeed: 's' });
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
    expect(
      Object.keys(seeded.body.projection.entrants).filter((k) => k.startsWith('udt-')),
    ).toHaveLength(4);
  });

  it('the seeding lets AI managers fill free places (AI switched on later)', async () => {
    const { admin, mario } = await setup();
    const t = await admin.post('/tournaments', udtCup(1));
    const id = t.body.id as string;
    expect((await mario.post(`/udt/events/${id}/enter`)).status).toBe(200);
    await admin.req('PUT', '/settings/udt', { aiEnabled: true, aiCount: 2 });
    const seeded = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', rngSeed: 's' });
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
    const ids = Object.keys(seeded.body.projection.entrants);
    expect(ids.filter((k) => k.startsWith('udt-'))).toHaveLength(3); // Mario and two AI teams
  });

  it('bot teams that fill the bracket never take the name of an AI team', async () => {
    const { admin, mario } = await setup();
    await admin.req('PUT', '/settings/team-names', { names: ['Kack', 'Bratz', 'Zeta'] });
    await admin.req('PUT', '/settings/udt', { aiEnabled: true, aiCount: 2 });
    await admin.post('/udt/ai/ensure');
    const aiNames = ((await admin.get('/udt/ai')).body as { team: { name: string } }[]).map(
      (a) => a.team.name,
    );
    expect(aiNames).toHaveLength(2);
    // Mario gets a second bot for a 2v2 cup; the AI teams (starter only) cannot play it.
    const marioId = (await mario.get('/me')).body.id as string;
    const lib = (await admin.get('/bots')).body.bots as { id: string; name: string }[];
    api!.app
      .get<Db>(DB)
      .insert(udtRoster)
      .values({
        season: 1,
        botId: lib.find((b) => b.name === 'Lib0')!.id,
        userId: marioId,
        price: 100,
        acquiredAt: new Date().toISOString(),
      })
      .run();
    const roster = (await mario.get('/udt')).body.roster as { botId: string }[];
    await mario.req('PUT', '/udt/lineup', { dm: roster.map((r) => r.botId) });
    const id = (await admin.post('/tournaments', udtCup(2))).body.id as string;
    const entered = await mario.post(`/udt/events/${id}/enter`);
    expect(entered.status, JSON.stringify(entered.body)).toBe(200);
    const seeded = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', rngSeed: 's' });
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
    const fill = Object.values(seeded.body.projection.entrants as Record<string, any>)
      .filter((e) => !e.id.startsWith('udt-'))
      .map((e) => e.displayName as string);
    expect(fill.length).toBeGreaterThan(0);
    expect(new Set(fill).size).toBe(fill.length);
    for (const n of fill) expect(aiNames).not.toContain(n);
  });

  it('enters automatically where possible; rests bots with Neuro', async () => {
    const { admin, mario, tim } = await setup();
    const cup1 = (await admin.post('/tournaments', udtCup(1))).body.id as string;
    const duo = (await admin.post('/tournaments', udtCup(2))).body.id as string;
    const on = await mario.req('PUT', '/udt/auto-enter', { on: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body).toMatchObject({ team: { autoEnter: true }, entered: 1 });
    const ev = (await mario.get('/udt/events')).body;
    expect(ev.find((e: any) => e.id === cup1).entered).toBe(true);
    // Only one bot: no 2v2.
    expect(ev.find((e: any) => e.id === duo).entered).toBe(false);
    // A new cup: in at once, even when Mario is not on the page; Tim (switch off) is not.
    const cup2 = (await admin.post('/tournaments', { ...udtCup(1), name: 'Cup Two' })).body
      .id as string;
    const page = (await admin.get(`/tournaments/${cup2}`)).body;
    expect(page.registrations.map((r: any) => r.displayName)).toEqual(['Mario']);
    expect((await tim.get('/udt')).body.team.autoEnter).toBe(false);
    // Rest with Neuro: 2 per point, not above 100.
    const db = api!.app.get<Db>(DB);
    const marioId = (await mario.get('/me')).body.id as string;
    db.update(udtRoster).set({ stamina: 60 }).where(eq(udtRoster.userId, marioId)).run();
    const before = (await mario.get('/udt')).body;
    const bot = before.roster[0].botId as string;
    const rested = await mario.post(`/udt/roster/${bot}/rest`, { points: 50 });
    expect(rested.status, JSON.stringify(rested.body)).toBe(201);
    expect(rested.body.roster[0].stamina).toBe(100);
    expect(before.wallet.spendable - rested.body.wallet.spendable).toBe(280); // 40 points × 7
    expect((await mario.post(`/udt/roster/${bot}/rest`, { points: 5 })).status).toBe(409);
  });

  it('2v2: a team needs two playable bots; value cap and star limit apply', async () => {
    const { admin, mario } = await setup();
    const t = await admin.post('/tournaments', udtCup(2, { starLimit: 0 }));
    const id = t.body.id as string;
    const ev = (await mario.get('/udt/events')).body.find((e: any) => e.id === id);
    expect(ev.lineup.problems.join(' ')).toMatch(/1 of 2/);
    expect((await mario.post(`/udt/events/${id}/enter`)).status).toBe(409);
    // A team of base bots only can still be seeded (bots against bots).
    const seeded = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', rngSeed: 's' });
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
    const entrants = Object.values(seeded.body.projection.entrants) as any[];
    expect(entrants.every((e) => e.kind === 'team' && e.bots.length === 2)).toBe(true);
  });
});
