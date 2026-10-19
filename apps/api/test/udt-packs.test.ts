import { afterEach, describe, expect, it } from 'vitest';
import { effectiveValues } from '@tourney/udt';
import type { RunningApi } from '../src/app.js';
import { DB, type Db } from '../src/db/database.js';
import { udtRoster, udtTraits } from '../src/db/schema.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { UdtService } from '../src/udt/udt.service.js';
import { Client, startApi, startSeason } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

interface Card {
  id: string | null;
  code: string;
  rarity: string;
  duplicate: boolean;
  scrap: number;
}

async function setup() {
  ({ api } = await startApi());
  const admin = await Client.login(api, 'Boss', true);
  const mario = await Client.login(api, 'Mario');
  await admin.req('PUT', '/settings/udt', { enabled: true });
  await startSeason(admin);
  const v = (
    await mario.post('/udt/team', {
      name: 'Nexus Rising',
      tag: '[NX]',
      starter: { name: 'Mira', skill: 3, traits: { accuracy: 0, alertness: 0, strafing: 0 } },
    })
  ).body;
  const marioId = (await mario.get('/me')).body.id as string;
  const ledger = api.app.get(LedgerService);
  ledger.book({ season: 1, userId: marioId, kind: 'udt_reward', amount: 100_000, ref: 'gift' });
  return { admin, mario, marioId, mira: v.roster[0].botId as string, ledger };
}

describe('Unreal Dream Team: packs and traits', () => {
  it('opens boxes and 10-pulls with open rates, pity and duplicates as scrap', async () => {
    const { mario, marioId, ledger } = await setup();
    const view = (await mario.get('/udt/packs')).body;
    expect(view.boxes.map((b: { box: string }) => b.box)).toEqual(['standard', 'premium', 'elite']);
    // Index 0.3 before the first market day: 1500 × 0.3, the 10-pull costs 9 boxes.
    expect(view.boxes[0]).toMatchObject({ price: 450, tenPrice: 4050, epicIn: 10, opened: 0 });
    const before = ledger.spendable(marioId).balance;
    const one = await mario.post('/udt/packs/open', { box: 'standard' });
    expect(one.status, JSON.stringify(one.body)).toBe(200);
    expect(one.body.cards).toHaveLength(1);
    expect(ledger.spendable(marioId).balance).toBe(before - 450);
    const ten = await mario.post('/udt/packs/open', { box: 'premium', ten: true });
    expect(ten.status).toBe(200);
    const cards = ten.body.cards as Card[];
    expect(cards).toHaveLength(10);
    // Premium 10-pull: an epic or better is certain.
    expect(cards.some((c) => c.rarity === 'epic' || c.rarity === 'legendary')).toBe(true);
    // One of each trait in the inventory, the rest is scrap.
    const kept = [...one.body.cards, ...cards].filter(
      (c: Card) => !c.duplicate && c.code !== 'blueprint',
    );
    const codes = new Set(kept.map((c: Card) => c.code));
    expect(codes.size).toBe(kept.length);
    const scrap = cards.reduce((n, c) => n + c.scrap, 0);
    expect(ten.body.view.scrap).toBe(scrap + (one.body.cards[0].scrap as number));
    expect(ten.body.view.inventory).toHaveLength(kept.length);
    expect(ten.body.view.boxes[1].opened).toBe(10);
    // Without a team: no packs.
    const tim = await Client.login(api!, 'Tim');
    expect((await tim.post('/udt/packs/open', { box: 'standard' })).status).toBe(409);
  });

  it('puts traits on bots within the slots, changes what the game gets, scraps and crafts', async () => {
    const { mario, marioId, mira } = await setup();
    const db = api!.app.get<Db>(DB);
    const udt = api!.app.get(UdtService);
    // Give Mario two cards directly (packs are random).
    const now = new Date().toISOString();
    for (const [id, code] of [
      ['tA', 'eagle-eye'],
      ['tB', 'claudius'],
    ] as const)
      db.insert(udtTraits)
        .values({ id, season: 1, userId: marioId, code, source: 'pack', createdAt: now })
        .run();
    const put = await mario.post('/udt/traits/tA/assign', { botId: mira });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const bot = put.body.roster[0];
    expect(bot).toMatchObject({ level: 1, slots: 1, udtTraits: [{ code: 'eagle-eye' }] });
    expect(bot.effective.traits.accuracy).toBeCloseTo(0.3);
    // Level 1: one slot only.
    expect((await mario.post('/udt/traits/tB/assign', { botId: mira })).status).toBe(409);
    db.update(udtRoster).set({ xp: 180 }).run(); // level 5: three slots
    const two = await mario.post('/udt/traits/tB/assign', { botId: mira });
    expect(two.status).toBe(200);
    expect(two.body.roster[0]).toMatchObject({ level: 5, slots: 3, effective: { skill: 4 } });
    expect(two.body.roster[0].effective).toEqual({
      skill: effectiveValues(3, { accuracy: 0, alertness: 0, strafing: 0 }, [
        { code: 'eagle-eye' },
        { code: 'claudius' },
      ]).skill,
      traits: expect.objectContaining({ accuracy: 0.3 }),
      overflow: false,
    });
    // The starter bot counts 0 in the team value, but its traits still change its market value.
    expect(udt.value({ id: mira, skill: 3, traits: {} }, 1)).toBeGreaterThan(
      udt.value({ id: mira, skill: 3, traits: {} }, 1, []),
    );
    // Taking a trait off destroys it: 150 scrap for the legendary.
    const off = (await mario.req('DELETE', '/udt/traits/tB/assign')) as {
      status: number;
      body: any;
    };
    expect(off.status).toBe(200);
    expect(off.body.roster[0].udtTraits).toHaveLength(1);
    let packs = (await mario.get('/udt/packs')).body;
    expect(packs.scrap).toBe(150);
    // Crafting: four times the scrap value (common 20); one of each in the inventory.
    const craft = await mario.post('/udt/packs/craft', { code: 'steady-hand' });
    expect(craft.status).toBe(200);
    expect(craft.body.scrap).toBe(130);
    expect((await mario.post('/udt/packs/craft', { code: 'steady-hand' })).status).toBe(409);
    expect((await mario.post('/udt/packs/craft', { code: 'midas' })).status).toBe(409); // 600
    expect((await mario.post('/udt/packs/craft', { code: 'nope' })).status).toBe(400);
    // Scrap an inventory card.
    const card = craft.body.inventory[0].id as string;
    packs = (await mario.req('DELETE', `/udt/traits/${card}`)).body as typeof packs;
    expect(packs.scrap).toBe(135);
    expect(packs.inventory).toHaveLength(0);
  });

  it('needs a weapon for the gun nut', async () => {
    const { mario, marioId, mira } = await setup();
    const db = api!.app.get<Db>(DB);
    db.insert(udtTraits)
      .values({
        id: 'tG',
        season: 1,
        userId: marioId,
        code: 'gun-nut',
        source: 'craft',
        createdAt: new Date().toISOString(),
      })
      .run();
    expect((await mario.post('/udt/traits/tG/assign', { botId: mira })).status).toBe(400);
    const ok = await mario.post('/udt/traits/tG/assign', {
      botId: mira,
      weapon: 'Botpack.ShockRifle',
    });
    expect(ok.body.roster[0].effective.traits.favoriteWeapon).toBe('Botpack.ShockRifle');
  });
});
