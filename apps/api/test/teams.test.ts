import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { Client, startApi, tournamentBody } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

async function setup(settings: Record<string, unknown> = {}) {
  ({ api } = await startApi());
  const admin = await Client.login(api, 'Boss', true);
  await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
  const created = await admin.post(
    '/tournaments',
    tournamentBody({ name: 'Team Cup' }, { size: 4, teamSize: 2, format: 'single', ...settings }),
  );
  expect(created.status).toBe(201);
  const login = (n: string) => Client.login(api!, n);
  return { admin, id: created.body.id as string, login };
}

describe('team tournaments', () => {
  it('validates team settings and the bot pool', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
    const tooBig = await admin.post('/tournaments', tournamentBody({}, { size: 32, teamSize: 2 }));
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.message).toMatch(/at most 16 teams/);
    // 5on5 needs ten different bots; the default pool has nine.
    const fewBots = await admin.post('/tournaments', tournamentBody({}, { size: 4, teamSize: 5 }));
    expect(fewBots.status).toBe(400);
    expect(fewBots.body.message).toMatch(/at least 10 different bots/);
    const ok = await admin.post('/tournaments', tournamentBody({}, { size: 4, teamSize: 1 }));
    expect(ok.status).toBe(201);
  });

  it('creates teams, joins by invite, forms teams from solo players and seeds', async () => {
    const { admin, id, login } = await setup();
    const [mario, anna, jonas, lea, max, tom, paul] = await Promise.all(
      ['Mario', 'Anna', 'Jonas', 'Lea', 'Max', 'Tom', 'Paul'].map(login),
    );

    const created = await mario!.post(`/tournaments/${id}/teams`, {
      name: 'Red Devils',
      tag: '[RD]',
    });
    expect(created.status).toBe(201);
    const red = created.body.teams[0];
    expect(red).toMatchObject({ name: 'Red Devils', tag: '[RD]' });
    expect(red.inviteCode).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(created.body.me).toMatchObject({ teamId: red.id, captain: true, registered: true });

    // Others do not see the code, but can preview a link they were given.
    const annaView = (await anna!.get(`/tournaments/${id}`)).body;
    expect(annaView.teams[0].inviteCode).toBeNull();
    const preview = (await anna!.get(`/tournaments/${id}/teams/invite/${red.inviteCode}`)).body;
    expect(preview).toMatchObject({ name: 'Red Devils', members: [{ displayName: 'Mario' }] });

    // Two starters, then two substitutes, then the team is full.
    for (const p of [anna, jonas, lea]) {
      expect(
        (await p!.post(`/tournaments/${id}/teams/join`, { code: red.inviteCode })).status,
      ).toBe(200);
    }
    expect(
      (await max!.post(`/tournaments/${id}/teams/join`, { code: red.inviteCode })).status,
    ).toBe(409);
    let d = (await admin.get(`/tournaments/${id}`)).body;
    expect(d.teams[0].members.map((m: any) => [m.displayName, m.sub])).toEqual([
      ['Mario', false],
      ['Anna', false],
      ['Jonas', true],
      ['Lea', true],
    ]);

    // Names are unique per tournament.
    expect((await paul!.post(`/tournaments/${id}/teams`, { name: 'red devils' })).status).toBe(409);
    expect((await paul!.post(`/tournaments/${id}/teams`, { name: 'Blue Steel' })).status).toBe(201);

    // Only the captain sets the lineup.
    const jonasId = d.teams[0].members[2].userId;
    const marioId = d.teams[0].members[0].userId;
    expect(
      (await anna!.put(`/tournaments/${id}/teams/${red.id}/lineup`, { starters: [jonasId] }))
        .status,
    ).toBe(403);
    expect(
      (
        await mario!.put(`/tournaments/${id}/teams/${red.id}/lineup`, {
          starters: [jonasId, marioId],
        })
      ).status,
    ).toBe(204);

    // Solo players.
    for (const p of [max, tom])
      expect((await p!.post(`/tournaments/${id}/registration`)).status).toBe(204);
    d = (await admin.get(`/tournaments/${id}`)).body;
    expect(d.registrations.filter((r: any) => r.teamId === null)).toHaveLength(2);
    expect(d.registrations.find((r: any) => r.userId === jonasId)).toMatchObject({ sub: false });

    // Building teams fills Blue Steel first, the last solo gets a new team.
    const built = await admin.post(`/tournaments/${id}/teams/build`);
    expect(built.status).toBe(200);
    expect(built.body.teams).toHaveLength(3);
    expect(built.body.teams.find((t: any) => t.name === 'Blue Steel').members).toHaveLength(2);
    expect(built.body.teams[2].name).toMatch(/^Team (Max|Tom)$/);
    const listed = (await admin.get('/tournaments')).body.find((x: any) => x.id === id);
    expect(listed).toMatchObject({ teamSize: 2, teams: 3, registered: 7 });

    // Seeding: three human teams and one bot team; short teams get bots.
    const seeded = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', rngSeed: 's' });
    expect(seeded.status).toBe(200);
    const entrants = Object.values(seeded.body.projection.entrants) as any[];
    expect(entrants).toHaveLength(4);
    expect(entrants.every((e) => e.kind === 'team')).toBe(true);
    const redE = entrants.find((e) => e.id === red.id);
    expect(redE.members.filter((m: any) => !m.sub).map((m: any) => m.displayName)).toEqual([
      'Mario',
      'Jonas',
    ]);
    expect(redE.bots).toEqual([]);
    const solo = entrants.find((e) => e.displayName.startsWith('Team '));
    expect(solo.bots).toHaveLength(1);
    const bots = entrants.find((e) => e.members.length === 0);
    expect(bots.displayName).toBe('Thunder Crash');
    expect(bots.bots).toHaveLength(2);
    expect(seeded.body.me).toBeDefined();
    expect((await mario!.get(`/tournaments/${id}`)).body.me).toMatchObject({
      entrantId: red.id,
      captain: true,
    });

    // Teams are frozen; lineup changes become events.
    expect((await max!.post(`/tournaments/${id}/teams`, { name: 'Late' })).status).toBe(409);
    const annaId = d.teams[0].members.find((m: any) => m.displayName === 'Anna').userId;
    expect(
      (
        await mario!.put(`/tournaments/${id}/teams/${red.id}/lineup`, {
          starters: [annaId, marioId],
        })
      ).status,
    ).toBe(204);
    const events = (await admin.get(`/tournaments/${id}/events`)).body;
    expect(events.at(-1)).toMatchObject({
      type: 'team.lineupSet',
      actor: { kind: 'player' },
      data: { entrantId: red.id, starters: [annaId, marioId] },
    });
    const after = (await admin.get(`/tournaments/${id}`)).body.projection.entrants[red.id];
    expect(after.members.filter((m: any) => !m.sub).map((m: any) => m.displayName)).toEqual([
      'Anna',
      'Mario',
    ]);
  });

  it('keeps players registered when they leave a team and hands over the captaincy', async () => {
    const { admin, id, login } = await setup();
    const [mario, anna, jonas] = await Promise.all(['Mario', 'Anna', 'Jonas'].map(login));
    const team = (await mario!.post(`/tournaments/${id}/teams`, { name: 'Alpha' })).body.teams[0];
    await anna!.post(`/tournaments/${id}/teams/join`, { code: team.inviteCode });
    const d = (await admin.get(`/tournaments/${id}`)).body;
    const [marioId, annaId] = d.teams[0].members.map((m: any) => m.userId);

    // Leaving the tournament passes the captaincy on.
    expect((await mario!.del(`/tournaments/${id}/registration`)).status).toBe(204);
    let t = (await admin.get(`/tournaments/${id}`)).body.teams[0];
    expect(t.captainId).toBe(annaId);
    expect(t.members).toHaveLength(1);

    // Leaving only the team keeps the registration.
    expect((await anna!.del(`/tournaments/${id}/teams/${team.id}/members/${annaId}`)).status).toBe(
      204,
    );
    const after = (await admin.get(`/tournaments/${id}`)).body;
    expect(after.teams).toHaveLength(0);
    expect(after.registrations.map((r: any) => [r.userId, r.teamId])).toEqual([[annaId, null]]);

    // Admins move players around; strangers cannot remove members.
    const beta = (await jonas!.post(`/tournaments/${id}/teams`, { name: 'Beta' })).body.teams[0];
    expect(
      (await admin.put(`/tournaments/${id}/registrations/${annaId}`, { teamId: beta.id })).status,
    ).toBe(204);
    expect((await mario!.post(`/tournaments/${id}/registration`)).status).toBe(204);
    expect((await mario!.del(`/tournaments/${id}/teams/${beta.id}/members/${annaId}`)).status).toBe(
      403,
    );
    expect(
      (await admin.put(`/tournaments/${id}/registrations/${marioId}`, { teamId: beta.id })).status,
    ).toBe(409); // two starters already
    expect(
      (
        await admin.put(`/tournaments/${id}/registrations/${marioId}`, {
          teamId: beta.id,
          sub: true,
        })
      ).status,
    ).toBe(204);
    t = (await admin.get(`/tournaments/${id}`)).body.teams[0];
    expect(t.members.map((m: any) => [m.displayName, m.sub])).toEqual([
      ['Anna', false],
      ['Jonas', false],
      ['Mario', true],
    ]);

    // Switching to 1v1 dissolves the teams.
    const s = (await admin.get(`/tournaments/${id}`)).body.settings;
    expect(
      (await admin.patch(`/tournaments/${id}`, { settings: { ...s, teamSize: 1 } })).status,
    ).toBe(200);
    const solo = (await admin.get(`/tournaments/${id}`)).body;
    expect(solo.teams).toEqual([]);
    expect(solo.registrations).toHaveLength(3);
  });

  it('refuses solo players once every starter place is taken', async () => {
    const { id, login } = await setup({ size: 4 });
    const players = await Promise.all(Array.from({ length: 9 }, (_, i) => login(`P${i}`)));
    for (const p of players.slice(0, 8)) {
      expect((await p.post(`/tournaments/${id}/registration`)).status).toBe(204);
    }
    expect((await players[8]!.post(`/tournaments/${id}/registration`)).status).toBe(409);
  });
});
