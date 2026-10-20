import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { BotsService } from '../src/bots/bots.service.js';
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
    // Over the budget (skill 5 is far above 1500 points).
    const tooGood = await mario.post('/udt/team', team({ starter: { name: 'Ace', skill: 5 } }));
    expect(tooGood.status).toBe(400);
    expect(JSON.stringify(tooGood.body)).toMatch(/points/);
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
    expect((await tim.post('/udt/team', team({ starter: { name: 'Tox', skill: 2 } }))).status).toBe(
      409,
    );
    const t2 = await tim.post(
      '/udt/team',
      team({ name: 'Iron Guard', tag: '[IG]', starter: { name: 'Tox', skill: 2 } }),
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

  it('leaves 100 extra points on top of the default starter (setting)', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin);
    const v = (await mario.get('/udt')).body;
    expect(v).toMatchObject({ starterBudget: 1500, starterExtra: 100 });
    // Skill 3 with accuracy 75 costs 1,568: within 1,500 + 100; accuracy 100 (1,635) is not.
    const over = await mario.post(
      '/udt/team',
      team({
        starter: { name: 'Mira', skill: 3, traits: { accuracy: 1, alertness: 0, strafing: 0 } },
      }),
    );
    expect(over.status).toBe(400);
    const ok = await mario.post(
      '/udt/team',
      team({
        starter: { name: 'Mira', skill: 3, traits: { accuracy: 0.5, alertness: 0, strafing: 0 } },
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
      team({ name: 'Long', tag: '<<XXXX>>', starter: { name: 'Abcdefghijklmnopq', skill: 2 } }),
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
      face: 'SGirlSkins.Lilith',
      voice: 'BotPack.VoiceFemaleTwo',
      personality: { lines: [{ kind: 'death', text: 'Not again' }] },
    });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body).toMatchObject({
      face: 'SGirlSkins.Lilith',
      skill: 3,
      traits: { voice: 'BotPack.VoiceFemaleTwo' },
      personality: { talk: 60, lines: [{ kind: 'death', text: 'Not again' }] },
    });
    // Only the owner.
    expect((await tim.req('PUT', `/udt/bots/${miraId}`, { skin: 'X.y' })).status).toBe(403);
    // Squads: everybody sees every team and its roster.
    await tim.post(
      '/udt/team',
      team({ name: 'Iron', tag: '[IG]', starter: { name: 'Tox', skill: 2 } }),
    );
    const squads = (await tim.get('/udt/squads')).body;
    expect(squads.map((s: any) => s.name).sort()).toEqual(['Iron', 'Nexus Rising']);
    const marioId = (await mario.get('/me')).body.id as string;
    const sq = (await tim.get(`/udt/teams/${marioId}`)).body;
    expect(sq).toMatchObject({ manager: 'Mario', ai: false, team: { name: 'Nexus Rising' } });
    expect(sq.roster[0]).toMatchObject({ name: 'Mira', gameName: '[NX]Mira' });
    expect((await tim.get('/udt/teams/nobody')).status).toBe(404);
  });
});
