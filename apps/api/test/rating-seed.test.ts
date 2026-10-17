import { createRng } from '@tourney/bracket';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import {
  balanceBots,
  byStrength,
  pickBotsNear,
  ratingSlots,
  type RatedBot,
} from '../src/tournaments/rating-seed.js';
import { Client, startApi, tournamentBody } from './helpers.js';

const bot = (name: string, strength: number, skill = 4): RatedBot => ({
  spec: { name, skill },
  strength,
});
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('seeding by rating (pure)', () => {
  it('puts the strongest far apart and bots last with "byes"', () => {
    const s: Record<string, number> = { a: 1800, b: 1700, c: 1600, d: 1500, x: 2000, y: 1000 };
    const slots = ratingSlots({
      humans: ['d', 'b', 'a', 'c', 'e', 'f'],
      bots: ['x', 'y'],
      strength: (id) => s[id] ?? 1400,
      botPlacement: 'byes',
      rng: createRng(1),
    });
    // Seeds 1 (a) and 2 (b) can only meet in the final: different halves.
    expect(slots.indexOf('a') < 4).not.toBe(slots.indexOf('b') < 4);
    // Bots are seeds 7 and 8 although x is the strongest: they face the top two players.
    expect(slots.slice(0, 2)).toEqual(['a', 'y']);
    expect(slots.slice(4, 6)).toEqual(['b', 'x']);
    const all = ratingSlots({
      humans: ['d', 'c'],
      bots: ['x', 'y'],
      strength: (id) => s[id]!,
      botPlacement: 'random',
      rng: createRng(1),
    });
    expect(all).toEqual(['x', 'y', 'c', 'd']);
  });

  it('decides equal ratings by lot', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++)
      seen.add(byStrength(['a', 'b', 'c'], () => 1500, createRng(i))[0]!);
    expect(seen.size).toBeGreaterThan(1);
    expect(byStrength(['a', 'b'], (id) => (id === 'b' ? 1600 : 1500), createRng(1))).toEqual([
      'b',
      'a',
    ]);
  });

  it('picks 1v1 bots close to the players', () => {
    const pool = [bot('weak', 1000), bot('near', 1520), bot('strong', 2100), bot('ok', 1450)];
    const picked = pickBotsNear(pool, 2, [1500, 1540], createRng(1)).map((b) => b.spec.name);
    expect(picked).toEqual(['near', 'ok']);
  });

  it('spreads the bots so that the teams come out equally strong', () => {
    // Two human teams with one place open each, two bot teams of three.
    const pool = [
      bot('g1', 1800, 7),
      bot('g2', 1780, 7),
      bot('m1', 1500),
      bot('m2', 1520),
      bot('m3', 1480),
      bot('n1', 1200, 1),
      bot('n2', 1220, 1),
      bot('n3', 1190, 1),
      bot('n4', 1210, 1),
    ];
    const teams = [
      { humans: [1700, 1650], need: 1 },
      { humans: [1300, 1350], need: 1 },
      { humans: [], need: 3 },
      { humans: [], need: 3 },
    ];
    const fills = balanceBots(teams, pool, 3, createRng(1));
    const strength = (name: string) => pool.find((b) => b.spec.name === name)!.strength;
    const totals = fills.map((f, i) =>
      avg([...teams[i]!.humans, ...f.map((b) => strength(b.name))]),
    );
    // The weak human team gets a strong bot, the strong one a weak bot.
    expect(strength(fills[1]![0]!.name)).toBeGreaterThan(strength(fills[0]![0]!.name));
    // The bot teams are within 100 points of each other.
    expect(Math.abs(totals[2]! - totals[3]!)).toBeLessThan(100);
    // No team has a bot twice; every place is filled.
    fills.forEach((f, i) => {
      expect(f).toHaveLength(teams[i]!.need);
      expect(new Set(f.map((b) => b.name)).size).toBe(f.length);
    });
    expect(() => balanceBots([{ humans: [], need: 3 }], pool.slice(0, 2), 3, createRng(1))).toThrow(
      /need 3 different bots/,
    );
  });
});

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe('ratings on the website', () => {
  it('keeps the rating settings (admins only) and a ranked flag per tournament', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    expect((await admin.get('/settings')).body).toEqual({
      rating: { botGames: true, levelPoints: 100 },
    });
    expect((await mario.get('/settings')).status).toBe(403);
    expect((await mario.req('PUT', '/settings/rating', { botGames: false })).status).toBe(403);
    const put = await admin.req('PUT', '/settings/rating', { levelPoints: 150 });
    expect(put.body).toEqual({ rating: { botGames: true, levelPoints: 150 } });
    expect((await admin.req('PUT', '/settings/rating', { levelPoints: 999 })).status).toBe(400);

    await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
    const created = await admin.post('/tournaments', tournamentBody({}, { size: 4 }));
    const id = created.body.id as string;
    expect((await admin.get(`/tournaments/${id}`)).body.ranked).toBe(true);
    await admin.req('PATCH', `/tournaments/${id}`, { ranked: false });
    expect((await admin.get(`/tournaments/${id}`)).body.ranked).toBe(false);
    expect((await admin.get(`/tournaments/${id}/ratings`)).body).toEqual([]);
    expect((await mario.get('/stats/ratings?mode=dm')).body).toEqual([]);
  });

  it('seeds a team tournament without any team (bots only)', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
    const body = tournamentBody({ name: 'Bot Cup' }, { size: 4, teamSize: 2, format: 'single' });
    const id = (await admin.post('/tournaments', body)).body.id as string;
    for (const humanOrder of ['random', 'rating']) {
      const seeded = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', humanOrder });
      expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
      const teams = Object.values(seeded.body.projection.entrants) as any[];
      expect(teams).toHaveLength(4);
      expect(teams.every((t) => t.members.length === 0 && t.bots.length === 2)).toBe(true);
    }
  });

  it('seeds a team tournament by rating with balanced bot teams', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
    const body = tournamentBody({ name: 'Team Cup' }, { size: 4, teamSize: 2, format: 'single' });
    const created = await admin.post('/tournaments', body);
    const id = created.body.id as string;
    const mario = await Client.login(api, 'Mario');
    await mario.post(`/tournaments/${id}/teams`, { name: 'Red Devils' });
    const seeded = await admin.post(`/tournaments/${id}/seed`, {
      mode: 'auto',
      humanOrder: 'rating',
      rngSeed: 's',
    });
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
    const events = (await admin.get(`/tournaments/${id}/events`)).body as any[];
    const seeding = events.find((e) => e.type === 'seeding.set').data;
    const teams = seeding.entrants as any[];
    expect(teams).toHaveLength(4);
    expect(teams.every((t) => t.members.length + t.bots.length === 2)).toBe(true);
    // Unrated: strengths come from the difficulty (pool: Godlike .. Novice, 100 per step).
    const ratings = seeding.ratings as Record<string, number>;
    expect(Object.keys(ratings).sort()).toEqual(teams.map((t) => t.id).sort());
    const botTeams = teams.filter((t) => !t.members.length).map((t) => ratings[t.id]!);
    expect(Math.max(...botTeams) - Math.min(...botTeams)).toBeLessThanOrEqual(100);
    // The strongest two are in different halves of the bracket.
    const order = [...teams].sort((a, b) => ratings[b.id]! - ratings[a.id]!).map((t) => t.id);
    const slots = seeding.bracket.slots as string[];
    expect(slots.indexOf(order[0]!) < 2).not.toBe(slots.indexOf(order[1]!) < 2);
  });
});
