import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { DB, type Db } from '../src/db/database.js';
import { eq } from 'drizzle-orm';
import { BotsService } from '../src/bots/bots.service.js';
import { udtBots, udtRoster, udtTraits } from '../src/db/schema.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { Client, startApi, startSeason } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const OLD = '2020-01-01T00:00:00.000Z';

async function setup() {
  ({ api } = await startApi());
  const admin = await Client.login(api, 'Boss', true);
  const mario = await Client.login(api, 'Mario');
  const tim = await Client.login(api, 'Tim');
  await admin.req('PUT', '/settings/udt', { enabled: true });
  await startSeason(admin);
  const lib: Record<string, string> = {};
  for (const [name, skill] of [
    ['Alpha', 4],
    ['Bravo', 4],
    ['Charlie', 6],
    ['Delta', 2],
  ] as const)
    lib[name] = (await admin.post('/bots', { name, skill })).body.id as string;
  await mario.post('/udt/team', {
    name: 'Nexus',
    tag: '[NX]',
    starter: { name: 'Mira', skill: 3 },
  });
  await tim.post('/udt/team', { name: 'Iron', tag: '[IG]', starter: { name: 'Tox' } });
  const marioId = (await mario.get('/me')).body.id as string;
  const timId = (await tim.get('/me')).body.id as string;
  const db = api.app.get<Db>(DB);
  const own = (botId: string, userId: string, acquiredAt = OLD) =>
    db.insert(udtRoster).values({ season: 1, botId, userId, price: 1000, acquiredAt }).run();
  own(lib.Alpha!, marioId);
  own(lib.Bravo!, timId);
  own(lib.Charlie!, timId);
  own(lib.Delta!, marioId, new Date().toISOString()); // just bought: locked
  const ledger = api.app.get(LedgerService);
  for (const u of [marioId, timId])
    ledger.book({ season: 1, userId: u, kind: 'udt_reward', amount: 50_000, ref: `gift:${u}` });
  return { admin, mario, tim, marioId, timId, lib, db, ledger };
}

describe('Unreal Dream Team: trades', () => {
  it('swaps bots with Neuro, holds the offer, pays fees and moves the traits', async () => {
    const { mario, tim, marioId, timId, lib, db, ledger } = await setup();
    db.insert(udtTraits)
      .values({
        id: 'tE',
        season: 1,
        userId: marioId,
        code: 'eagle-eye',
        botId: lib.Alpha!,
        source: 'pack',
        createdAt: OLD,
        assignedAt: OLD,
      })
      .run();
    const partners = (await mario.get('/udt/trades/partners')).body;
    expect(partners).toHaveLength(1);
    const timRoster = partners[0].roster as {
      name: string;
      blocked: string | null;
      value: number;
    }[];
    // The starter can be traded too (decision 207), after the lock like every new bot.
    expect(timRoster.find((r) => r.name === 'Tox')?.blocked).toBe('locked');
    expect(timRoster.find((r) => r.name === 'Bravo')?.blocked).toBeNull();
    const body = { to: timId, give: [lib.Alpha], take: [lib.Bravo], giveNeuro: 100 };
    const pre = await mario.post('/udt/trades/preview', body);
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    expect(pre.body).toMatchObject({ feePct: 5, balancePct: 50 });
    const before = { m: ledger.spendable(marioId).balance, t: ledger.spendable(timId).balance };
    const made = await mario.post('/udt/trades', { ...body, message: 'fair?' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const offer = made.body.open[0];
    expect(offer).toMatchObject({ incoming: false, giveNeuro: 100, message: 'fair?' });
    // Held: the Neuro and the proposer's fee.
    expect(ledger.spendable(marioId).balance).toBe(before.m - 100 - offer.feeFrom);
    expect((await tim.get('/udt')).body.tradesIn).toBe(1);
    expect((await mario.post(`/udt/trades/${offer.id}/accept`)).status).toBe(403);
    const ok = await tim.post(`/udt/trades/${offer.id}/accept`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.done[0]).toMatchObject({ status: 'accepted' });
    expect(ledger.spendable(timId).balance).toBe(before.t + 100 - offer.feeTo);
    const m = (await mario.get('/udt')).body.roster.map((r: { name: string }) => r.name);
    const t = (await tim.get('/udt')).body.roster as { name: string; udtTraits: unknown[] }[];
    expect(m).toContain('Bravo');
    expect(m).not.toContain('Alpha');
    expect(t.find((r) => r.name === 'Alpha')?.udtTraits).toMatchObject([{ code: 'eagle-eye' }]);
    // Traded bots are locked again.
    const again = await tim.post('/udt/trades/preview', {
      to: marioId,
      give: [lib.Alpha],
      take: [lib.Bravo],
    });
    expect(again.status).toBe(409);
    expect(JSON.stringify(again.body)).toMatch(/days ago/);
  });

  it('refuses unbalanced trades, starters, locked bots and full rosters', async () => {
    const { mario, timId, lib } = await setup();
    // A skill 6 bot for nothing: Neuro moved to a friend.
    const gift = await mario.post('/udt/trades/preview', { to: timId, take: [lib.Charlie] });
    expect(gift.status).toBe(409);
    expect(JSON.stringify(gift.body)).toMatch(/unbalanced/);
    const starter = (await mario.get('/udt')).body.roster.find(
      (r: { starter: boolean }) => r.starter,
    ).botId;
    expect((await mario.post('/udt/trades/preview', { to: timId, give: [starter] })).status).toBe(
      409,
    );
    const locked = await mario.post('/udt/trades/preview', {
      to: timId,
      give: [lib.Delta],
      take: [lib.Bravo],
    });
    expect(JSON.stringify(locked.body)).toMatch(/days ago/);
    expect(
      (await mario.post('/udt/trades/preview', { to: timId, giveNeuro: 5, takeNeuro: 5 })).status,
    ).toBe(400);
  });

  it('trades own bots: the owner changes, the maker stays (licences, breeder)', async () => {
    const { admin, mario, tim, marioId, timId, lib, db } = await setup();
    await admin.req('PUT', '/settings/udt', { tradeLockDays: 0 });
    const mira = (await mario.get('/udt')).body.roster.find(
      (r: { starter: boolean }) => r.starter,
    ) as { botId: string };
    const before = (await mario.get('/udt/academy')).body.licence;
    const mine = (await mario.get('/udt/trades')).body.mine as {
      botId: string;
      value: number;
      homemade: boolean;
      blocked: string | null;
    }[];
    const m = mine.find((b) => b.botId === mira.botId)!;
    // The starter shows no market value on the roster, but is worth it in a trade.
    expect(m).toMatchObject({ homemade: true, blocked: null });
    expect(m.value).toBeGreaterThan(0);
    const offer = await mario.post('/udt/trades', {
      to: timId,
      give: [mira.botId],
      take: [lib.Bravo],
      giveNeuro: 600,
    });
    expect(offer.status, JSON.stringify(offer.body)).toBe(201);
    const id = offer.body.open[0].id as string;
    const ok = await tim.post(`/udt/trades/${id}/accept`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    // Tim owns Mira now: an own bot of his team (develops, no salary), no starter any more.
    const timView = (await tim.get('/udt')).body.roster.find(
      (r: { botId: string }) => r.botId === mira.botId,
    );
    expect(timView).toMatchObject({ starter: false, own: { origin: 'starter' } });
    const row = db.select().from(udtBots).where(eq(udtBots.botId, mira.botId)).get()!;
    expect(row).toMatchObject({ userId: timId, madeBy: marioId });
    expect(api!.app.get(BotsService).get(mira.botId)?.udtOwner).toBe(timId);
    // Mario's licences still count Mira as made by him.
    expect((await mario.get('/udt/academy')).body.licence).toEqual(before);
    // Tim may change its look; Mario no longer.
    expect((await mario.req('PUT', `/udt/bots/${mira.botId}`, {})).status).toBe(403);
    // Nominated for the graduation: not tradable.
    db.update(udtBots).set({ status: 'nominated' }).where(eq(udtBots.botId, mira.botId)).run();
    const nom = await tim.post('/udt/trades/preview', {
      to: marioId,
      give: [mira.botId],
      take: [lib.Bravo],
    });
    expect(nom.status).toBe(409);
    expect(JSON.stringify(nom.body)).toMatch(/nominated/);
  });

  it('declines, withdraws and voids with the held Neuro back', async () => {
    const { mario, tim, marioId, timId, lib, ledger } = await setup();
    const start = ledger.spendable(marioId).balance;
    const body = { to: timId, give: [lib.Alpha], take: [lib.Bravo], giveNeuro: 200 };
    const a = (await mario.post('/udt/trades', body)).body.open[0].id as string;
    expect((await tim.post(`/udt/trades/${a}/decline`)).status).toBe(200);
    expect(ledger.spendable(marioId).balance).toBe(start);
    const b = (await mario.post('/udt/trades', body)).body.open[0].id as string;
    expect((await mario.req('DELETE', `/udt/trades/${b}`)).status).toBe(200);
    expect(ledger.spendable(marioId).balance).toBe(start);
    // Selling the offered bot voids the offer.
    const c = (await mario.post('/udt/trades', body)).body.open[0].id as string;
    expect((await mario.post(`/udt/roster/${lib.Alpha}/sell`)).status).toBe(200);
    const list = (await mario.get('/udt/trades')).body;
    expect(list.done.find((t: { id: string }) => t.id === c)).toMatchObject({ status: 'void' });
    expect(list.open).toHaveLength(0);
    // Only the sale is left on top of the start balance.
    expect(ledger.spendable(marioId).balance).toBeGreaterThan(start);
    expect((await tim.post(`/udt/trades/${c}/accept`)).status).toBe(409);
  });

  it('books nothing when the fee fails, so the next accept pays in full', async () => {
    const { mario, tim, marioId, timId, lib, ledger } = await setup();
    const body = { to: timId, give: [lib.Alpha], takeNeuro: 500 };
    const made = await mario.post('/udt/trades', body);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const offer = made.body.open[0] as { id: string; feeTo: number };
    expect(offer.feeTo).toBeGreaterThan(0);
    // Tim can pay the 500 but not the fee on top.
    const short = ledger.spendable(timId).spendable - (500 + offer.feeTo - 1);
    ledger.book({ season: 1, userId: timId, kind: 'udt_reward', amount: -short, ref: 'cut' });
    const before = { m: ledger.spendable(marioId).balance, t: ledger.spendable(timId).balance };
    expect((await tim.post(`/udt/trades/${offer.id}/accept`)).status).toBe(409);
    expect(ledger.spendable(timId).balance).toBe(before.t);
    expect(ledger.spendable(marioId).balance).toBe(before.m);
    const names = (await tim.get('/udt')).body.roster.map((r: { name: string }) => r.name);
    expect(names).not.toContain('Alpha');
    // One Neuro more: the accept goes through and charges the 500 and the fee.
    ledger.book({ season: 1, userId: timId, kind: 'udt_reward', amount: 1, ref: 'plus' });
    const ok = await tim.post(`/udt/trades/${offer.id}/accept`);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ledger.spendable(timId).balance).toBe(before.t + 1 - 500 - offer.feeTo);
    expect(ledger.spendable(marioId).balance).toBe(before.m + 500);
  });

  it('limits trades per pair and week', async () => {
    const { admin, mario, tim, timId, lib } = await setup();
    await admin.req('PUT', '/settings/udt', { tradePairPerWeek: 1, tradeLockDays: 0 });
    const body = { to: timId, give: [lib.Alpha], take: [lib.Bravo] };
    const made = await mario.post('/udt/trades', body);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const a = made.body.open[0].id as string;
    expect((await tim.post(`/udt/trades/${a}/accept`)).status).toBe(200);
    const back = await mario.post('/udt/trades/preview', {
      to: timId,
      give: [lib.Bravo],
      take: [lib.Alpha],
    });
    expect(back.status).toBe(409);
    expect(JSON.stringify(back.body)).toMatch(/per week/);
    await admin.req('PUT', '/settings/udt', { tradeEnabled: false });
    expect((await mario.get('/udt/trades/partners')).status).toBe(403);
  });
});
