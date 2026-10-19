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
  tag: 'NX',
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
      team: { name: 'Nexus Rising', tag: 'NX' },
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
      team({ name: 'Iron Guard', tag: 'IG', starter: { name: 'Tox', skill: 2 } }),
    );
    expect(t2.status).toBe(201);
    expect((await tim.get('/udt/teams')).body.map((t: { tag: string }) => t.tag).sort()).toEqual([
      'IG',
      'NX',
    ]);
    // The starter bot is in the library, but inactive, owned and not in the control center.
    const lib = api.app.get(BotsService).list();
    expect(lib.find((b) => b.name === 'Mira')).toMatchObject({ active: false });
    expect(lib.find((b) => b.name === 'Mira')?.udtOwner).toBeTruthy();
    const cc = (await admin.get('/bots')).body.bots as { name: string }[];
    expect(cc.some((b) => b.name === 'Mira')).toBe(false);
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
