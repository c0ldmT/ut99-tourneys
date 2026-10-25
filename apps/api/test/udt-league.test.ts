import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { RunningApi } from '../src/app.js';
import { DB, type Db } from '../src/db/database.js';
import { leagueFixtures, tournaments } from '../src/db/schema.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { estimateEvening, leaguePlan } from '../src/udt/udt-league.service.js';
import { Client, startApi, startSeason } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const LEAGUE = {
  enabled: true,
  tiers: 2,
  size: 8,
  slotDays: [0, 1, 2, 3, 4, 5, 6],
  agentId: 'pi',
  profileId: 'local',
  mapPool: ['DM-Deck16][', 'DM-Morpheus'],
};

async function setup() {
  ({ api } = await startApi({ TEST_MODE: 'true' }));
  const admin = await Client.login(api, 'Boss', true);
  const mario = await Client.login(api, 'Mario');
  const tim = await Client.login(api, 'Tim');
  await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
  for (let i = 0; i < 6; i++) await admin.post('/bots', { name: `Lib${i}`, skill: 2 + (i % 4) });
  const put = await admin.req('PUT', '/settings/udt', { enabled: true });
  expect(put.status).toBe(200);
  await startSeason(admin, 30);
  for (const [c, n, tag] of [
    [mario, 'Nexus', 'NX'],
    [tim, 'Iron', 'IG'],
  ] as const)
    await c.post('/udt/team', { name: n, tag, starter: { name: `${tag}bot` } });
  const league = await admin.req('PUT', '/settings/udt', { league: LEAGUE });
  expect(league.status, JSON.stringify(league.body)).toBe(200);
  return { admin, mario, tim, db: api.app.get<Db>(DB) };
}

/** Plays every league tournament that is due (test mode: results by strength). */
async function playDue(admin: Client, db: Db) {
  const due = db
    .select()
    .from(tournaments)
    .where(eq(tournaments.kind, 'udt'))
    .all()
    .filter(
      (t) => t.udtJson?.includes('"league":{') && (t.phase === 'draft' || t.phase === 'seeded'),
    );
  for (const t of due) {
    const r = await admin.post(`/udt/test/simulate/${t.id}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
  return due.length;
}

describe('league plan (pure)', () => {
  it('puts the matchdays on the league evenings, relegation and final after them', () => {
    const p = leaguePlan({
      start: '2026-10-22',
      end: '2026-12-31',
      weekdays: [0, 1, 2, 3, 4, 5],
      perEvening: 1,
      size: 16,
      slotTime: '18:00',
    })!;
    expect(p.evenings).toHaveLength(30);
    expect(p.evenings.some((e) => e.day === '2026-10-25')).toBe(false); // a Sunday
    expect(p.relegation > p.evenings.at(-1)!.day).toBe(true);
    expect(
      leaguePlan({
        start: '2026-10-22',
        end: '2026-11-01',
        weekdays: [0],
        perEvening: 1,
        size: 16,
        slotTime: '18:00',
      }),
    ).toBeNull();
  });

  it('estimates the server time of an evening', () => {
    const all = estimateEvening({ managers: 6, tiers: 2, size: 16, perEvening: 1, aiGames: 'all' });
    expect(all.realPerMatchday).toBe(16);
    const sim = estimateEvening({
      managers: 6,
      tiers: 2,
      size: 16,
      perEvening: 1,
      aiGames: 'simulate',
    });
    expect(sim.realPerMatchday).toBeGreaterThan(4);
    expect(sim.realPerMatchday).toBeLessThan(6);
    expect(sim.minutes).toBe(Math.round(sim.realPerMatchday * 4));
  });
});

describe('Dream Team league', () => {
  it('runs a season: start, played and simulated games, table money, relegation, final four', async () => {
    const { admin, mario, db } = await setup();
    expect((await mario.get('/udt/league')).body.run).toBeNull();
    // Day 4 (three days later): the league starts.
    await admin.post('/udt/test/advance', { hours: 3 * 24 });
    const v = (await mario.get('/udt/league')).body;
    expect(v.run).toMatchObject({ status: 'running', tiers: 2, size: 8, test: false });
    expect(v.tables).toHaveLength(2);
    expect(v.tables.flatMap((t: { rows: unknown[] }) => t.rows)).toHaveLength(16);
    expect(v.fixtures.filter((f: { kind: string }) => f.kind === 'league')).toHaveLength(
      2 * 14 * 4,
    );
    expect(v.myClub).toMatchObject({ name: 'Nexus', manager: true, me: true });
    expect(v.next).toMatchObject({ real: true, status: 'scheduled' });
    // Games with a manager are tournaments (autostart in the league slot), the rest simulated.
    await admin.post('/udt/test/advance', { hours: 1 });
    const games = db
      .select()
      .from(leagueFixtures)
      .all()
      .filter((f) => f.real && f.tournamentId);
    expect(games.length).toBeGreaterThan(0);
    // A cup cannot take the league slot of the server.
    const t = db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, games[0]!.tournamentId!))
      .get()!;
    expect(JSON.parse(t.settingsJson)).toMatchObject({ format: 'fixtures', size: 2, teamSize: 5 });
    // Play the whole season day by day.
    let played = 0;
    for (let d = 0; d < 20; d++) {
      await admin.post('/udt/test/advance', { hours: 12 });
      played += await playDue(admin, db);
      await admin.post('/udt/test/advance', { hours: 12 });
      played += await playDue(admin, db);
    }
    expect(played).toBeGreaterThan(14);
    const end = (await mario.get('/udt/league')).body;
    expect(end.run.status).toBe('done');
    expect(end.final.map((c: { place: number }) => c.place)).toEqual([1, 2, 3, 4]);
    const rows = db.select().from(leagueFixtures).all();
    const kinds = new Set(rows.map((f) => f.kind));
    expect([...kinds].sort()).toEqual(['final', 'league', 'relegation', 'semi', 'third']);
    expect(rows.filter((f) => f.status === 'scheduled')).toEqual([]);
    // Games of the season's end with a manager were played, not simulated.
    for (const f of rows.filter((x) => x.kind !== 'league' && x.real))
      expect(f.status, f.kind).toBe('played');
    // The league's own games never shrink its map pool.
    expect((await admin.get('/udt/league/admin')).body.mapPool).toEqual(LEAGUE.mapPool);
    for (const tb of end.tables) for (const r of tb.rows) expect(r.played).toBe(14);
    // No game money, but table money on Mondays.
    const marioId = (await mario.get('/me')).body.id as string;
    const kindsOf = api!.app
      .get(LedgerService)
      .entries(marioId, 1, 200)
      .map((e) => e.kind);
    expect(kindsOf).toContain('udt_league');
    expect(kindsOf).not.toContain('udt_reward');
    const hist = (await mario.get('/udt/league/history')).body;
    expect(hist[0]).toMatchObject({ season: 1, test: false });
  });

  it('a test league in the running season: starts tomorrow, can be called off', async () => {
    const { admin, mario } = await setup();
    await admin.req('PUT', '/settings/udt', { league: { ...LEAGUE, enabled: false } });
    expect((await mario.post('/udt/league/test', {})).status).toBe(403);
    const r = await admin.post('/udt/league/test', { placement: 'one' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.run).toMatchObject({ test: true, status: 'running' });
    const v = (await mario.get('/udt/league')).body;
    expect(v.myClub.tier).toBe(0);
    const ab = await admin.req('DELETE', '/udt/league/test');
    expect(ab.status).toBe(200);
    expect((ab.body as { run: unknown }).run).toBeNull();
  });

  it('a manager who founds a team later takes over an AI club of the lowest tier', async () => {
    const { admin } = await setup();
    await admin.post('/udt/test/advance', { hours: 3 * 24 + 1 });
    const anna = await Client.login(api!, 'Anna');
    await anna.post('/udt/team', { name: 'Aces', tag: 'AC', starter: { name: 'ACbot' } });
    const v = (await anna.get('/udt/league')).body;
    expect(v.myClub).toMatchObject({ name: 'Aces', tier: 1 });
  });

  it('test mode: "matchday now" plays the next evening, "league season end" the rest', async () => {
    const { admin, mario } = await setup();
    expect((await admin.post('/udt/test/league/day')).status).toBe(409);
    await admin.post('/udt/test/advance', { hours: 3 * 24 });
    const day = await admin.post('/udt/test/league/day');
    expect(day.status, JSON.stringify(day.body)).toBe(200);
    const v = (await mario.get('/udt/league')).body;
    const first = v.fixtures.filter((f: { day: string }) => f.day === day.body.leagueDay);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((f: { winner: string | null }) => f.winner)).toBe(true);
    const end = await admin.post('/udt/test/league/end');
    expect(end.status, JSON.stringify(end.body)).toBe(200);
    expect(end.body.leagueDone).toBe(true);
    const done = (await mario.get('/udt/league')).body;
    expect(done.run.status).toBe('done');
    expect(done.final.map((c: { place: number }) => c.place)).toEqual([1, 2, 3, 4]);
  });

  it('moves a played game that did not happen on its day to the next evening', async () => {
    const { admin, db } = await setup();
    await admin.post('/udt/test/advance', { hours: 3 * 24 + 1 });
    const first = db
      .select()
      .from(leagueFixtures)
      .all()
      .filter((f) => f.real && f.tournamentId);
    expect(first.length).toBeGreaterThan(0);
    // Nobody plays it: the next day it is on a later evening, its tournament gone.
    await admin.post('/udt/test/advance', { hours: 24 });
    const after = db
      .select()
      .from(leagueFixtures)
      .where(eq(leagueFixtures.id, first[0]!.id))
      .get()!;
    expect(after.status).toBe('scheduled');
    expect(after.postponed).toBe(1);
    expect(after.day > first[0]!.day).toBe(true);
    const t = db
      .select()
      .from(tournaments)
      .where(eq(tournaments.id, first[0]!.tournamentId!))
      .get();
    expect(!t || t.phase === 'aborted').toBe(true);
  });
});
