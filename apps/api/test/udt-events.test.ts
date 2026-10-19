import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
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
  await mario.post('/udt/team', { name: 'Nexus', tag: 'NX', starter: { name: 'Mira', skill: 3 } });
  await tim.post('/udt/team', { name: 'Iron', tag: 'IG', starter: { name: 'Tox', skill: 2 } });
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
      bot: { name: '[NX]Mira' },
    });
    // Two free library bots fill the bracket (not the managers' starter bots).
    const fill = entrants.filter((e) => !e.id.startsWith('udt-'));
    expect(fill).toHaveLength(2);
    expect(fill.every((e) => e.kind === 'bot' && /^Lib/.test(e.bot.name))).toBe(true);
    // The manager does not bet on the own match.
    const bets = (await mario.get(`/bets/tournaments/${id}`)).body;
    const own = bets.matches.find((m: any) => m.entrants.includes(nx.id));
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
