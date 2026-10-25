import { afterEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { RunningApi } from '../src/app.js';
import { DB, type Db } from '../src/db/database.js';
import { bots, udtBots, udtKeepers, udtRoster, udtTraits } from '../src/db/schema.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { UdtService } from '../src/udt/udt.service.js';
import { Client, startApi, startSeason } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const OLD = '2020-01-01T00:00:00.000Z';

describe('Dream Team keepers', () => {
  it('keeps two own bots for the next season: skill -1, no traits, no salary, no graduation', async () => {
    ({ api } = await startApi({ TEST_MODE: 'true' }));
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin, 10);
    const db = api.app.get<Db>(DB);
    const lib: Record<string, string> = {};
    for (const [name, skill] of [
      ['Bought', 5],
      ['Blue', 5],
      ['Nomi', 4],
    ] as const)
      lib[name] = (await admin.post('/bots', { name, skill })).body.id as string;
    await mario.post('/udt/team', { name: 'Nexus', tag: '[NX]', starter: { name: 'Mira' } });
    const marioId = (await mario.get('/me')).body.id as string;
    const starter = (await mario.get('/udt')).body.roster[0].botId as string;
    const roster = (botId: string, xp = 0) =>
      db
        .insert(udtRoster)
        .values({ season: 1, botId, userId: marioId, price: 1000, acquiredAt: OLD, xp })
        .run();
    roster(lib.Bought!);
    roster(lib.Blue!, 5000);
    roster(lib.Nomi!);
    for (const [id, status] of [
      [lib.Blue!, 'own'],
      [lib.Nomi!, 'nominated'],
    ] as const) {
      db.insert(udtBots)
        .values({
          botId: id,
          season: 1,
          userId: marioId,
          madeBy: marioId,
          origin: 'blueprint',
          potential: 6,
          windowLo: 5,
          windowHi: 6,
          pointsSpent: 9,
          status,
          createdAt: OLD,
        })
        .run();
      db.update(bots).set({ udtOwner: marioId }).where(eq(bots.id, id)).run();
    }
    db.insert(udtTraits)
      .values({
        id: 'tr1',
        season: 1,
        userId: marioId,
        code: 'eagle',
        botId: lib.Blue!,
        source: 'pack',
        createdAt: OLD,
        assignedAt: OLD,
      })
      .run();

    // Not yet: the choice opens on the season's last two days.
    expect((await mario.get('/udt/keepers')).body.open).toBe(false);
    expect((await mario.req('PUT', '/udt/keepers', { botIds: [starter] })).status).toBe(409);
    await admin.post('/udt/test/advance', { hours: 24 * 9 });
    const v = (await mario.get('/udt/keepers')).body;
    expect(v.open).toBe(true);
    expect(v.max).toBe(2);
    const by = (id: string) => v.bots.find((b: { botId: string }) => b.botId === id);
    expect(by(lib.Bought!)).toMatchObject({ ok: false, why: 'bought' });
    expect(by(lib.Nomi!)).toMatchObject({ ok: false, why: 'nominated' });
    expect(by(lib.Blue!)).toMatchObject({ ok: true, skill: 5, nextSkill: 4 });
    expect(by(starter)).toMatchObject({ ok: true, skill: 3, nextSkill: 3 });

    const bought = await mario.req('PUT', '/udt/keepers', { botIds: [lib.Bought!] });
    expect(bought.status).toBe(409);
    expect(JSON.stringify(bought.body)).toMatch(/was bought/);
    expect((await mario.req('PUT', '/udt/keepers', { botIds: [lib.Nomi!] })).status).toBe(409);
    const ok = await mario.req('PUT', '/udt/keepers', { botIds: [lib.Blue!, starter] });
    expect(ok.status).toBe(200);
    expect((ok.body as { chosen: string[] }).chosen.sort()).toEqual([lib.Blue!, starter].sort());

    // Season over: still open between the seasons; then the next season starts.
    await admin.post('/udt/test/season-end');
    expect((await mario.get('/udt/keepers')).body.open).toBe(true);
    await admin.post('/udt/test/advance', { hours: 24 });
    expect(await startSeason(admin, 10)).toBe(2);
    const before = (await mario.get('/udt')).body;
    expect(before.lastTeam).toMatchObject({ name: 'Nexus', tag: '[NX]' });
    expect(before.keepers.map((k: { botId: string }) => k.botId).sort()).toEqual(
      [lib.Blue!, starter].sort(),
    );
    const founded = await mario.post('/udt/team', {
      name: 'Nexus',
      tag: '[NX]',
      starter: { name: 'Mira2' },
    });
    expect(founded.status, JSON.stringify(founded.body)).toBe(201);
    const after = founded.body.roster as {
      botId: string;
      skill: number;
      xp: number;
      starter: boolean;
      udtTraits: unknown[];
      dmSlot: number;
      own: { keptFrom: number | null; spent: number; potential: [number, number] };
    }[];
    expect(after).toHaveLength(3);
    const blue = after.find((b) => b.botId === lib.Blue)!;
    expect(blue).toMatchObject({ skill: 4, xp: 0, starter: false, udtTraits: [] });
    expect(blue.own).toMatchObject({ keptFrom: 1, spent: 0, potential: [6, 6] });
    expect(after.find((b) => b.botId === starter)).toMatchObject({ skill: 3, starter: false });
    expect(new Set(after.map((b) => b.dmSlot))).toEqual(new Set([1, 2, 3]));
    const row = db.select().from(udtBots).where(eq(udtBots.botId, lib.Blue!)).get()!;
    expect(row).toMatchObject({ season: 2, keptFrom: 1, pointsSpent: 0, status: 'own' });
    // The new starter is the only bot made this season (licences).
    expect(api.app.get(UdtService).madeCount(2, marioId)).toBe(1);
    // A keeper cannot graduate in its first season as a keeper.
    const grad = (await mario.get('/udt/graduation')).body;
    expect(grad.bots.find((b: { botId: string }) => b.botId === lib.Blue)).toMatchObject({
      keeper: true,
      ready: false,
    });
    const nominate = await mario.post(`/udt/graduation/${lib.Blue}`);
    expect(JSON.stringify(nominate.body)).toMatch(/keeper graduates in a later season/);
    // The yearbook of season 1 still lists the kept bots.
    const book = (await mario.get('/udt/yearbook?season=1')).body;
    expect(book.bots.find((b: { botId: string }) => b.botId === lib.Blue)).toMatchObject({
      keptTo: 2,
      season: 1,
    });
    // The keeper rows are applied; the second season keeps nothing yet.
    expect(
      db
        .select()
        .from(udtKeepers)
        .where(and(eq(udtKeepers.season, 1), eq(udtKeepers.userId, marioId)))
        .all()
        .every((k) => k.appliedAt),
    ).toBe(true);
  });

  it('a chosen keeper that is traded leaves the old choice and can be kept by its new team', async () => {
    ({ api } = await startApi({ TEST_MODE: 'true' }));
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    const tim = await Client.login(api, 'Tim');
    await admin.req('PUT', '/settings/udt', { enabled: true });
    await startSeason(admin, 10);
    const db = api.app.get<Db>(DB);
    await mario.post('/udt/team', { name: 'Nexus', tag: '[NX]', starter: { name: 'Mira' } });
    await tim.post('/udt/team', { name: 'Iron', tag: '[IG]', starter: { name: 'Tox' } });
    const marioId = (await mario.get('/me')).body.id as string;
    const timId = (await tim.get('/me')).body.id as string;
    const blue = (await admin.post('/bots', { name: 'Blue', skill: 4 })).body.id as string;
    db.insert(udtRoster)
      .values({ season: 1, botId: blue, userId: marioId, price: 0, acquiredAt: OLD })
      .run();
    db.insert(udtBots)
      .values({
        botId: blue,
        season: 1,
        userId: marioId,
        madeBy: marioId,
        origin: 'academy',
        potential: 5,
        createdAt: OLD,
      })
      .run();
    db.update(bots).set({ udtOwner: marioId }).where(eq(bots.id, blue)).run();
    api.app.get(LedgerService).book({
      season: 1,
      userId: timId,
      kind: 'udt_reward',
      amount: 50_000,
      ref: 'gift',
    });
    await admin.post('/udt/test/advance', { hours: 24 * 9 });
    expect((await mario.req('PUT', '/udt/keepers', { botIds: [blue] })).status).toBe(200);
    const value = (
      (await mario.get('/udt')).body.roster as { botId: string; value: number }[]
    ).find((r) => r.botId === blue)!.value;
    const offer = await mario.post('/udt/trades', { to: timId, give: [blue], takeNeuro: value });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
    const id = (offer.body as { open: { id: string }[] }).open[0]!.id;
    expect((await tim.post(`/udt/trades/${id}/accept`)).status).toBe(200);
    expect((await mario.get('/udt/keepers')).body.chosen).toEqual([]);
    const keep = await tim.req('PUT', '/udt/keepers', { botIds: [blue] });
    expect(keep.status, JSON.stringify(keep.body)).toBe(200);
  });

  it('AI managers keep their strongest own bots by themselves', async () => {
    ({ api } = await startApi({ TEST_MODE: 'true' }));
    const admin = await Client.login(api, 'Boss', true);
    await admin.req('PUT', '/settings/udt', { enabled: true, aiEnabled: true, aiCount: 1 });
    await startSeason(admin, 5);
    await admin.post('/udt/ai/ensure');
    const db = api.app.get<Db>(DB);
    const ai = (await admin.get('/udt/ai')).body[0] as { userId: string };
    await admin.post('/udt/test/season-end');
    await admin.post('/udt/test/advance', { hours: 24 });
    await startSeason(admin, 5);
    await admin.post('/udt/ai/ensure');
    const rows = db
      .select()
      .from(udtRoster)
      .where(and(eq(udtRoster.season, 2), eq(udtRoster.userId, ai.userId)))
      .all();
    // Its new starter and last season's starter as a keeper.
    expect(rows).toHaveLength(2);
    expect(
      db
        .select()
        .from(udtBots)
        .where(and(eq(udtBots.season, 2), eq(udtBots.userId, ai.userId)))
        .all()
        .map((b) => b.keptFrom)
        .sort(),
    ).toEqual([1, null]);
  });
});
