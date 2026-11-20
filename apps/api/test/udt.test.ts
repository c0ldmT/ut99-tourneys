import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { xpForLevel } from '@tourney/udt';
import type { RunningApi } from '../src/app.js';
import { DB, type Db } from '../src/db/database.js';
import { udtBots, udtRoster } from '../src/db/schema.js';
import { BotsService } from '../src/bots/bots.service.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { Client, startApi, startSeason } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const team = (over: Record<string, unknown> = {}) => ({
  name: 'Nexus Rising',
  tag: '[NX]',
  starter: { name: 'Mira', skill: 3, traits: { accuracy: 0, alertness: 0, strafing: 0 } },
  ...over,
});

describe('Unreal Dream Team: teams and rosters', () => {
  it('is off by default, then founds a team with a starter bot within the budget', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    expect((await mario.get('/udt')).body).toMatchObject({ enabled: false, team: null });
    expect((await mario.post('/udt/team', team())).status).toBe(403);
    expect((await admin.req('PUT', '/settings/udt', { enabled: true })).status).toBe(200);
    expect((await mario.post('/udt/team', team())).status).toBe(409); // no season
    await startSeason(admin);
    // Over the budget (all values at 100 cost 1,800 at skill 3).
    const tooGood = await mario.post(
      '/udt/team',
      team({ starter: { name: 'Ace', traits: { accuracy: 1, alertness: 1, strafing: 1 } } }),
    );
    expect(tooGood.status).toBe(400);
    expect(JSON.stringify(tooGood.body)).toMatch(/points/);
    // Every starter has skill 3: skill 2 with top values would be skill 3 with them after 3 points.
    const low = await mario.post(
      '/udt/team',
      team({
        starter: { name: 'Ace', skill: 2, traits: { accuracy: 1, alertness: 1, strafing: 1 } },
      }),
    );
    expect(low.status).toBe(400);
    expect(JSON.stringify(low.body)).toMatch(/has skill 3/);
    // Whole skill steps only: 2.68 with top values would play as skill 3 for less than its price.
    const fraction = await mario.post(
      '/udt/team',
      team({
        starter: {
          name: 'Ace',
          skill: 2.68,
          traits: { accuracy: 1, alertness: 1, strafing: 1 },
        },
      }),
    );
    expect(fraction.status).toBe(400);
    const made = await mario.post('/udt/team', team());
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body).toMatchObject({
      enabled: true,
      season: 1,
      team: { name: 'Nexus Rising', tag: '[NX]' },
      roster: [
        { name: 'Mira', gameName: '[NX]Mira', starter: true, dmSlot: 1, rarity: 'uncommon' },
      ],
    });
    expect((await mario.post('/udt/team', team())).status).toBe(409);
    // Names and tags are unique per season.
    const tim = await Client.login(api, 'Tim');
    expect((await tim.post('/udt/team', team({ starter: { name: 'Tox' } }))).status).toBe(409);
    const t2 = await tim.post(
      '/udt/team',
      team({ name: 'Iron Guard', tag: '[IG]', starter: { name: 'Tox' } }),
    );
    expect(t2.status).toBe(201);
    expect((await tim.get('/udt/teams')).body.map((t: { tag: string }) => t.tag).sort()).toEqual([
      '[IG]',
      '[NX]',
    ]);
    // The starter bot is in the library, but inactive, owned and not in the control center.
    const lib = api.app.get(BotsService).list();
    expect(lib.find((b) => b.name === 'Mira')).toMatchObject({ active: false });
    expect(lib.find((b) => b.name === 'Mira')?.udtOwner).toBeTruthy();
    const cc = (await admin.get('/bots')).body.bots as { name: string }[];
    expect(cc.some((b) => b.name === 'Mira')).toBe(false);
  });

  it('leaves 50 extra points on top of the default starter (setting)', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    const v = (await mario.get('/udt')).body;
    expect(v).toMatchObject({ starterBudget: 1500, starterExtra: 50 });
    // Skill 3 with accuracy 62.5 costs 1,534: within 1,500 + 50; accuracy 75 (1,568) is not.
    const over = await mario.post(
      '/udt/team',
      team({
        starter: { name: 'Mira', skill: 3, traits: { accuracy: 0.5, alertness: 0, strafing: 0 } },
      }),
    );
    expect(over.status).toBe(400);
    const ok = await mario.post(
      '/udt/team',
      team({
        starter: { name: 'Mira', skill: 3, traits: { accuracy: 0.25, alertness: 0, strafing: 0 } },
      }),
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await admin.req('PUT', '/settings/udt', { starterExtra: 0 })).status).toBe(200);
    expect((await admin.get('/settings')).body.udt.starterExtra).toBe(0);
  });

  it('takes the tag as it is: any signs, no brackets added', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    const made = await mario.post('/udt/team', team({ tag: "td'" }));
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.roster[0]).toMatchObject({ gameName: "td'Mira" });
    // Too long for the game together with the bot name.
    const tim = await Client.login(api, 'Tim');
    const long = await tim.post(
      '/udt/team',
      team({ name: 'Long', tag: '<<XXXX>>', starter: { name: 'Abcdefghijklmnopq' } }),
    );
    expect(long.status).toBe(400);
  });

  it('sets lineups and the bench with own bots only', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    const v = (await mario.post('/udt/team', team())).body;
    const mira = v.roster[0].botId as string;
    const put = await mario.req('PUT', '/udt/lineup', { dm: [null, mira], mh: [mira], bench: [] });
    expect(put.status).toBe(200);
    expect((put.body as unknown[])[0]).toMatchObject({ dmSlot: 2, mhSlot: 1, bench: null });
    expect((await mario.req('PUT', '/udt/lineup', { dm: [mira, mira] })).status).toBe(400);
    expect((await mario.req('PUT', '/udt/lineup', { dm: ['bNope'] })).status).toBe(400);
  });
});

describe('Unreal Dream Team: training camp (decision 254)', () => {
  it('gives a roster bot experience for Neuro, once a day per bot', async () => {
    ({ api } = await startApi({ TEST_MODE: 'true' }));
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    await mario.post('/udt/team', team());
    const v = (await mario.get('/udt')).body;
    const bot = v.roster[0];
    // At index 0.3 (a season's start) the index itself: 300 × 0.3.
    expect(v.camp).toEqual({ price: 90, xp: 60, done: [] });
    const before = (await mario.get('/me')).body.id as string;
    const spend = api.app.get(LedgerService).spendable(before).spendable;
    const r = await mario.post(`/udt/roster/${bot.botId}/camp`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.roster[0].xp).toBe(bot.xp + 60);
    expect(r.body.camp.done).toEqual([bot.botId]);
    expect(api.app.get(LedgerService).spendable(before).spendable).toBe(spend - 90);
    // Once a day per bot; the next day again.
    expect((await mario.post(`/udt/roster/${bot.botId}/camp`)).status).toBe(409);
    await admin.post('/udt/test/advance', { hours: 24 });
    expect((await mario.post(`/udt/roster/${bot.botId}/camp`)).status).toBe(200);
    // Only own roster bots.
    const tim = await Client.login(api, 'Tim');
    expect((await tim.post(`/udt/roster/${bot.botId}/camp`)).status).toBe(404);
  });
});

describe('Unreal Dream Team: fully developed bots (decision 256)', () => {
  it('have no points to give any more: not in the roster, not in the hub; they are kept', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    await mario.post('/udt/team', team());
    const bot = (await mario.get('/udt')).body.roster[0];
    const db = api.app.get<Db>(DB);
    // Level 10 (9 points), 2 spent; skill at the potential, every value at 100, breakthrough done.
    db.update(udtRoster)
      .set({ xp: xpForLevel(10) })
      .where(eq(udtRoster.botId, bot.botId))
      .run();
    db.update(udtBots)
      .set({ potential: 3, breakthrough: true, pointsSpent: 2 })
      .where(eq(udtBots.botId, bot.botId))
      .run();
    api.app.get(BotsService).update(bot.botId, {
      traits: { ...bot.traits, accuracy: 1, alertness: 1, strafing: 1 },
    });
    const own = (await mario.get('/udt')).body.roster[0].own;
    expect(own).toMatchObject({ maxed: true, points: 0, banked: 7 });
    expect((await mario.get('/udt/hub')).body.team.points).toBe(0);
    // One value below 100: the points are to give again.
    api.app.get(BotsService).update(bot.botId, {
      traits: { ...bot.traits, accuracy: 0.9, alertness: 1, strafing: 1 },
    });
    expect((await mario.get('/udt')).body.roster[0].own).toMatchObject({
      maxed: false,
      points: 7,
      banked: 0,
    });
    expect((await mario.get('/udt/hub')).body.team.points).toBe(7);
  });
});

describe('Unreal Dream Team: website reset', () => {
  it('wipes teams, rosters and the bots managers made; graduated library bots stay', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    expect((await mario.post('/udt/team', team())).status).toBe(201);
    const lib = api.app.get(BotsService);
    expect(lib.list().some((b) => b.name === 'Mira')).toBe(true);
    expect((await admin.post('/settings/reset', { confirm: 'RESET' })).status).toBe(200);
    expect(lib.list().some((b) => b.name === 'Mira')).toBe(false);
    expect((await mario.get('/udt')).body).toMatchObject({ team: null });
    // A fresh start: the same name and tag can be founded again in the new season.
    await startSeason(admin);
    const again = await mario.post('/udt/team', team());
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.season).toBe(1);
  });
});

describe('Unreal Dream Team: looks, chat lines and squads', () => {
  it('sets look and lines of own bots, shows every squad', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    const tim = await Client.login(api, 'Tim');
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    const made = await mario.post(
      '/udt/team',
      team({
        starter: {
          name: 'Mira',
          skill: 3,
          botClass: 'BotPack.TFemale2Bot',
          skin: 'SGirlSkins.army',
          traits: { voice: 'BotPack.VoiceFemaleOne' },
          personality: { talk: 60, lines: [{ kind: 'kill', text: 'Gotcha, {victim}!' }] },
        },
      }),
    );
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const miraId = made.body.roster[0].botId as string;
    const bot = (await mario.get(`/bots/${miraId}`)).body;
    expect(bot).toMatchObject({ skin: 'SGirlSkins.army', personality: { talk: 60 } });
    expect(bot.personality.lines).toEqual([{ kind: 'kill', text: 'Gotcha, {victim}!' }]);
    // Looks to choose from.
    const looks = (await mario.get('/udt/looks')).body;
    expect(looks.skins.length).toBeGreaterThan(0);
    // Later: new lines, face and voice; the values stay.
    const edited = await mario.req('PUT', `/udt/bots/${miraId}`, {
      face: 'SGirlSkins.Lauren',
      voice: 'BotPack.VoiceFemaleTwo',
      personality: { lines: [{ kind: 'death', text: 'Not again' }] },
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({
      face: 'SGirlSkins.Lauren',
      skill: 3,
      traits: { voice: 'BotPack.VoiceFemaleTwo' },
      personality: { talk: 60, lines: [{ kind: 'death', text: 'Not again' }] },
    });
    // Skin, face and voice must fit the model (as in UT's setup menu).
    const wrong = await mario.req('PUT', `/udt/bots/${miraId}`, { skin: 'CommandoSkins.cmdo' });
    expect((wrong.body as { key: string }).key).toBe('the skin {value} does not fit the model');
    expect(
      (await mario.req('PUT', `/udt/bots/${miraId}`, { face: 'SGirlSkins.Lilith' })).status,
    ).toBe(400);
    expect(
      (await mario.req('PUT', `/udt/bots/${miraId}`, { voice: 'BotPack.VoiceMaleOne' })).status,
    ).toBe(400);
    // An older look that does not fit stays: lines can still be saved.
    api.app.get(BotsService).update(miraId, { face: 'Old.Face' });
    const lines = await mario.req('PUT', `/udt/bots/${miraId}`, {
      personality: { lines: [{ kind: 'death', text: 'Again?' }] },
    });
    expect(lines.status, JSON.stringify(lines.body)).toBe(200);
    // Only the owner.
    expect((await tim.req('PUT', `/udt/bots/${miraId}`, { skin: 'X.y' })).status).toBe(403);
    // Squads: everybody sees every team and its roster.
    await tim.post('/udt/team', team({ name: 'Iron', tag: '[IG]', starter: { name: 'Tox' } }));
    const squads = (await tim.get('/udt/squads')).body;
    expect(squads.map((s: any) => s.name).sort()).toEqual(['Iron', 'Nexus Rising']);
    const marioId = (await mario.get('/me')).body.id as string;
    const sq = (await tim.get(`/udt/teams/${marioId}`)).body;
    expect(sq).toMatchObject({ manager: 'Mario', ai: false, team: { name: 'Nexus Rising' } });
    expect(sq.roster[0]).toMatchObject({ name: 'Mira', gameName: '[NX]Mira' });
    expect((await tim.get('/udt/teams/nobody')).status).toBe(404);
  });
});
