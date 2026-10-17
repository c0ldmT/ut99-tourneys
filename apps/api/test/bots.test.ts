import { createRng } from '@tourney/bracket';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { AgentsService } from '../src/agents/agents.service.js';
import { randomBot, randomName } from '../src/bots/bot-random.js';
import { BotsService, spreadLines } from '../src/bots/bots.service.js';
import { headToHead } from '../src/stats/aggregate.js';
import { extractFacts } from '../src/stats/facts.js';
import { Client, startApi, tournamentBody } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

async function setup() {
  ({ api } = await startApi());
  const admin = await Client.login(api, 'Boss', true);
  const mario = await Client.login(api, 'Mario');
  await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
  return { admin, mario, api: api! };
}

describe('bot randomizer (pure)', () => {
  it('makes unique pronounceable names and a matching stock look', () => {
    const taken = new Set<string>();
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      const n = randomName(taken, rng);
      expect(taken.has(n.toLowerCase())).toBe(false);
      expect(n).toMatch(/^[A-Z][a-z]{3,9}$/);
      taken.add(n.toLowerCase());
    }
    const b = randomBot(new Set(), createRng(2));
    expect(b.skin.split('.')[0]).toBe(b.face ? b.face.split('.')[0] : b.skin.split('.')[0]);
    expect(b.traits.camping).toBeGreaterThanOrEqual(0);
  });

  it('spreads chat lines over the occasions', () => {
    const lines = [
      ...Array.from({ length: 10 }, (_, i) => ({ kind: 'kill', text: `k${i}` })),
      { kind: 'death', text: 'd' },
      { kind: 'win', text: 'w' },
    ];
    const out = spreadLines(lines, 5);
    expect(out.map((l) => l.kind)).toEqual(['kill', 'death', 'win', 'kill', 'kill']);
  });
});

describe('bot statistics', () => {
  it('follows the library id and counts head to head', () => {
    const at = (m: number) => new Date(Date.UTC(2026, 9, 17, 20, m)).toISOString();
    let seq = 0;
    const ev = (type: string, data: unknown, m: number) =>
      ({ type, seq: ++seq, at: at(m), actor: { kind: 'bridge' }, data }) as never;
    const bot = { name: '[TC]Loque', skill: 6, id: 'bAbc123' };
    const events = [
      ev(
        'seeding.set',
        {
          entrants: [
            { id: 'u-1', kind: 'human', displayName: 'Mario', userId: '1' },
            { id: 'bot-bAbc123', kind: 'bot', displayName: bot.name, bot },
          ],
          bracket: {
            format: 'single',
            size: 2,
            slots: ['u-1', 'bot-bAbc123'],
            grandFinalReset: false,
            bestOf: { default: 1 },
          },
          rngSeed: 's',
        },
        0,
      ),
      ev('match.started', { matchId: 'W1-1', game: 1, map: 'DM-Deck16][' }, 1),
      ev(
        'match.gameFinished',
        {
          matchId: 'W1-1',
          game: 1,
          map: 'DM-Deck16][',
          winnerId: 'bot-bAbc123',
          scores: { 'u-1': 5, 'bot-bAbc123': 20 },
          endReason: 'fraglimit',
        },
        2,
      ),
    ];
    const f = extractFacts(
      {
        id: 't',
        name: 'T',
        settings: {
          format: 'single',
          size: 2,
          teamSize: 1,
          game: { adapter: 'ut99-dm', rules: {} },
        } as never,
      },
      events,
    );
    expect(f.players.map((p) => p.key).sort()).toEqual(['b:babc123', 'u:1']);
    expect(headToHead([f], 'b:babc123', ['u:1'])).toEqual({ 'u:1': { games: 1, wins: 1 } });
    expect(headToHead([f], 'u:1', ['b:babc123'])).toEqual({ 'b:babc123': { games: 1, wins: 0 } });
  });
});

describe('bot control center', () => {
  it('keeps bots and clans (admins), names in the game with the clan tag', async () => {
    const { admin, mario } = await setup();
    expect((await mario.get('/bots')).status).toBe(403);
    const clan = (await admin.post('/bot-clans', { name: 'Thunder Crash', tag: '[TC]' })).body;
    const loque = await admin.post('/bots', {
      name: 'Loque',
      clanId: clan.id,
      skill: 6,
      botClass: 'Botpack.TMale1Bot',
      skin: 'CommandoSkins.cmdo',
      face: 'CommandoSkins.Blake',
      traits: {
        accuracy: 0.5,
        combatStyle: 1,
        camping: 0,
        jumpy: true,
        voice: 'BotPack.VoiceMaleOne',
      },
      personality: { talk: 50, lines: [{ kind: 'kill', text: 'Too easy, {victim}!' }] },
    });
    expect(loque.status, JSON.stringify(loque.body)).toBe(201);
    expect(loque.body).toMatchObject({ gameName: '[TC]Loque', skill: 6, active: true });
    // Unique names, names that fit into UT's 24 characters with the tag.
    expect((await admin.post('/bots', { name: 'loque' })).status).toBe(409);
    expect((await admin.post('/bots', { name: 'Ünïcödé' })).status).toBe(400);
    // A longer tag must still fit for every member.
    expect((await admin.req('PATCH', `/bot-clans/${clan.id}`, { tag: '[TCTCTC]' })).status).toBe(
      200,
    );
    expect((await admin.post('/bots', { name: 'A'.repeat(20), clanId: clan.id })).status).toBe(400);
    const xan = (await admin.post('/bots', { name: 'Xan' })).body;
    // Rivals: players and bots, rival or nemesis.
    const marioId = (await mario.get('/me')).body.id;
    const upd = await admin.req('PATCH', `/bots/${xan.id}`, {
      personality: {
        rivals: [
          { kind: 'bot', id: loque.body.id, level: 'nemesis' },
          { kind: 'user', id: marioId, level: 'rival' },
        ],
      },
    });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    expect(
      (
        await admin.req('PATCH', `/bots/${xan.id}`, {
          personality: { rivals: [{ kind: 'bot', id: xan.id, level: 'rival' }] },
        })
      ).status,
    ).toBe(400);
    // Profiles are for everybody logged in.
    const profile = (await mario.get(`/bots/${xan.id}`)).body;
    expect(profile.rivals.map((r: { name: string; level: string }) => [r.name, r.level])).toEqual([
      ['[TCTCTC]Loque', 'nemesis'],
      ['Mario', 'rival'],
    ]);
    expect(profile.rivals[0].record).toEqual({ games: 0, wins: 0 });
    expect((await mario.get(`/bots/${loque.body.id}`)).body.rivalOf).toEqual([
      { id: xan.id, name: 'Xan' },
    ]);
    // Personalities for the game: names resolved.
    const svc = api!.app.get(BotsService);
    expect(svc.personalities([xan.id, loque.body.id])).toEqual([
      {
        name: 'Xan',
        talk: 30,
        lines: [],
        rivals: [
          { name: '[TCTCTC]Loque', level: 'nemesis' },
          { name: 'Mario', level: 'rival' },
        ],
      },
      {
        name: '[TCTCTC]Loque',
        talk: 50,
        lines: [{ kind: 'kill', text: 'Too easy, {victim}!' }],
        rivals: [],
      },
    ]);
    // Deleting a bot removes it as a rival; deleting a clan keeps its bots.
    expect((await admin.req('DELETE', `/bots/${loque.body.id}`)).status).toBe(204);
    expect((await admin.get(`/bots/${xan.id}`)).body.rivals).toHaveLength(1);
    expect((await admin.req('DELETE', `/bot-clans/${clan.id}`)).status).toBe(204);
  });

  it('creates random bots and imports the server configuration', async () => {
    const { admin } = await setup();
    const made = (await admin.post('/bots-random', { count: 5, skill: 3, seed: 's' })).body;
    expect(made).toHaveLength(5);
    expect(new Set(made.map((b: { name: string }) => b.name)).size).toBe(5);
    const agents = api!.app.get(AgentsService);
    agents.saveInventory(
      'pi',
      'local',
      {
        bots: [
          { name: 'Malcolm', skill: 5, botClass: 'Botpack.TMale2Bot', skin: 'SoldierSkins.blkt' },
          { name: made[0].name, skill: 2 },
        ],
      },
      new Date().toISOString(),
    );
    // The test agent has no profile list; import reads the given profile.
    const res = (await admin.post('/bots-import', { agentId: 'pi', profileId: 'local' })).body;
    expect(res.created.map((b: { name: string }) => b.name)).toEqual(['Malcolm']);
    expect(res.skipped).toEqual([made[0].name]);
    const list = (await admin.get('/bots')).body.bots as { name: string }[];
    expect(list).toHaveLength(6);
    agents.saveInventory(
      'pi',
      'local',
      {
        bots: [],
        assets: {
          botClasses: [{ name: 'MyPkg.NinjaBot', label: 'Ninja' }],
          textures: [
            { name: 'NinjaSkins.ninj1', label: 'Ninja' },
            { name: 'NinjaSkins.ninj5Kenji', label: 'Kenji' },
          ],
          voices: [],
          weapons: [],
        },
      },
      new Date().toISOString(),
    );
    const assets = (await admin.get('/bots/assets')).body;
    expect(assets.botClasses.map((c: { name: string }) => c.name)).toContain('Botpack.TBossBot');
    expect(assets.botClasses.map((c: { name: string }) => c.name)).toContain('MyPkg.NinjaBot');
    // Skins and faces from the texture names (UT's naming).
    expect(assets.skins).toContainEqual({ name: 'NinjaSkins.ninj', label: 'Ninja' });
    expect(assets.faces).toContainEqual({
      name: 'NinjaSkins.Kenji',
      label: 'Kenji',
      pkg: 'NinjaSkins',
    });
    expect(assets.faces).toContainEqual({
      name: 'CommandoSkins.Blake',
      label: 'Blake',
      pkg: 'CommandoSkins',
    });
  });

  it('uses library bots in the pool, the team names and clan teams', async () => {
    const { admin } = await setup();
    const clan = (await admin.post('/bot-clans', { name: 'Iron Guard', tag: '[IG]' })).body;
    const ids: string[] = [];
    for (const [i, name] of ['Abe', 'Bea', 'Cid', 'Dot', 'Eli', 'Fay'].entries())
      ids.push(
        (await admin.post('/bots', { name, ...(i < 2 ? { clanId: clan.id } : {}), skill: 4 })).body
          .id,
      );
    expect(
      (
        (await admin.req('PUT', '/settings/team-names', { names: ['Alpha', 'Beta', 'Gamma'] }))
          .body as any
      ).teamNames,
    ).toEqual(['Alpha', 'Beta', 'Gamma']);
    const body = tournamentBody(
      { name: 'Clan Cup' },
      { size: 4, teamSize: 2, format: 'single', clanTeams: true },
    );
    const created = await admin.post('/tournaments', {
      ...body,
      botPool: ids.map((id) => ({ id, name: 'old name', skill: 5 })),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    // The pool shows the current names (with clan tag), the tournament's difficulty stays.
    expect(
      created.body.botPool.map((b: { name: string; skill: number }) => [b.name, b.skill]),
    ).toContainEqual(['[IG]Abe', 5]);
    await admin.req('PATCH', `/bots/${ids[2]}`, { name: 'Cyd' });
    expect(
      (await admin.get(`/tournaments/${id}`)).body.botPool.map((b: { name: string }) => b.name),
    ).toContain('Cyd');
    for (const humanOrder of ['random', 'rating']) {
      const seeded = await admin.post(`/tournaments/${id}/seed`, {
        mode: 'auto',
        humanOrder,
        rngSeed: 'x',
      });
      expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
      const teams = Object.values(seeded.body.projection.entrants) as any[];
      const clanTeam = teams.find((t) => t.displayName === 'Iron Guard');
      expect(clanTeam.tag).toBe('[IG]');
      expect(clanTeam.bots.map((b: { name: string }) => b.name).sort()).toEqual([
        '[IG]Abe',
        '[IG]Bea',
      ]);
      // The other teams take names from the list and no clan bot twice.
      const others = teams.filter((t) => t !== clanTeam);
      expect(others.every((t) => ['Alpha', 'Beta', 'Gamma'].includes(t.displayName))).toBe(true);
      expect(
        others.flatMap((t) => t.bots).some((b: { name: string }) => b.name.startsWith('[IG]')),
      ).toBe(false);
      expect(teams.flatMap((t) => t.bots).every((b: { id?: string }) => b.id)).toBe(true);
    }
  });
});
