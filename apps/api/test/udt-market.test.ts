import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import type { RunningApi } from '../src/app.js';
import { buyPrice } from '@tourney/udt';
import { DB, type Db } from '../src/db/database.js';
import { udtBids, udtValues } from '../src/db/schema.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { UdtMarketService } from '../src/udt/udt-market.service.js';
import { Client, startApi, startSeason } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const DAY = 86_400_000;

async function setup() {
  // Monday 19.10.2026, 10:00 UTC (12:00 in Berlin).
  const clock = new FakeClock(Date.parse('2026-10-19T10:00:00Z'));
  ({ api } = await startApi({}, { clock }));
  const admin = await Client.login(api, 'Boss', true);
  const mario = await Client.login(api, 'Mario');
  const tim = await Client.login(api, 'Tim');
  for (let i = 0; i < 6; i++)
    expect((await admin.post('/bots', { name: `Lib${i}`, skill: 1 + i })).status).toBe(201);
  await admin.req('PUT', '/settings/udt', { enabled: true, offersPerDay: 6 });
  await startSeason(admin);
  const starter = (name: string) => ({ name, skill: 3 });
  await mario.post('/udt/team', { name: 'Nexus', tag: '[NX]', starter: starter('Mira') });
  await tim.post('/udt/team', { name: 'Iron', tag: '[IG]', starter: starter('Tox') });
  const market = api.app.get(UdtMarketService);
  const ledger = api.app.get(LedgerService);
  return { clock, admin, mario, tim, market, ledger };
}

interface Offer {
  botId: string;
  demand: number;
  history: { day: string; value: number; index: number }[];
  name: string;
  skill: number;
  price: number;
  value: number;
  sold: boolean;
  buyer: string | null;
  mine: boolean;
}

describe('Unreal Dream Team: transfer market', () => {
  it('sells at once at a fixed price, first come first served; the next market day has new offers', async () => {
    const { clock, mario, tim, market, ledger } = await setup();
    expect(market.tick()).toBe(true); // first market day of the season: right away
    expect(market.tick()).toBe(false);
    const m = (await mario.get('/udt/market')).body;
    expect(m.day).toBe('2026-10-19');
    expect(m.index).toBe(0.3);
    expect(m.offers).toHaveLength(6);
    expect(m).toMatchObject({ rosterSize: 1, rosterMax: 7 });
    const offers = m.offers as Offer[];
    // The price is the market value plus the bracket's surcharge.
    for (const o of offers) {
      expect(o.price).toBe(buyPrice(o.value, o.skill));
      expect(o.price).toBeGreaterThan(o.value);
      // The first market day: no demand yet; the history carries the day's index.
      expect(o.demand).toBe(1);
      expect(o.history).toEqual([{ day: '2026-10-19', value: o.value, index: 0.3 }]);
    }
    const cheap = [...offers].sort((a, b) => a.price - b.price)[0]!;
    const marioId = (await mario.get('/me')).body.id as string;
    const timId = (await tim.get('/me')).body.id as string;
    const bought = await mario.post('/udt/market/buy', { botId: cheap.botId });
    expect(bought.status, JSON.stringify(bought.body)).toBe(200);
    // In the roster at once, paid at once.
    const roster = (await mario.get('/udt')).body.roster as { botId: string; price: number }[];
    expect(roster.find((r) => r.botId === cheap.botId)?.price).toBe(cheap.price);
    expect(ledger.spendable(marioId).balance).toBe(1000 - cheap.price);
    const mine = (bought.body.offers as Offer[]).find((o) => o.botId === cheap.botId)!;
    expect(mine).toMatchObject({ sold: true, mine: true, buyer: '[NX]' });
    // Tim comes too late; the error carries its template for the website.
    const late = await tim.post('/udt/market/buy', { botId: cheap.botId });
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ key: 'the bot is sold', message: 'the bot is sold' });
    const forTim = (await tim.get('/udt/market')).body.offers as Offer[];
    expect(forTim.find((o) => o.botId === cheap.botId)).toMatchObject({
      sold: true,
      mine: false,
      buyer: '[NX]',
    });
    expect(ledger.spendable(timId).balance).toBe(1000);
    // Too expensive: nothing changes.
    const dear = [...offers].sort((a, b) => b.price - a.price)[0]!;
    if (dear.price > 1000 - 100) {
      const no = await tim.post('/udt/market/buy', { botId: dear.botId });
      expect(no.status).toBe(409);
      expect(no.body.key).toBe('not enough Neuro: {spendable} can be spent (rescue floor {floor})');
      expect(no.body.params).toMatchObject({ floor: 100 });
    }
    // Selling pays 85 % of the value; bought again the same day, it is paid again.
    const sold = await mario.post(`/udt/roster/${cheap.botId}/sell`);
    expect(sold.status).toBe(200);
    const afterSale = ledger.spendable(marioId).balance;
    expect(afterSale).toBeGreaterThan(1000 - cheap.price);
    expect((await mario.post('/udt/market/buy', { botId: cheap.botId })).status).toBe(200);
    expect(ledger.spendable(marioId).balance).toBe(afterSale - cheap.price);
    // The starter stays.
    const starter = (await mario.get('/udt')).body.roster.find(
      (r: { starter: boolean }) => r.starter,
    );
    expect((await mario.post(`/udt/roster/${starter.botId}/sell`)).status).toBe(409);
    // Before the market time of the next day nothing happens.
    clock.advance(DAY - 8 * 3_600_000); // Tuesday 02:00 UTC = 04:00 in Berlin (summer time)
    clock.advance(-60_000);
    expect(market.tick()).toBe(false);
    clock.advance(2 * 60_000);
    expect(market.tick()).toBe(true);
    const m2 = (await mario.get('/udt/market')).body;
    expect(m2.day).toBe('2026-10-20');
    expect((m2.offers as Offer[]).some((o) => o.botId === cheap.botId)).toBe(false);
  });

  it("shows library bots without their clan tag; in a roster they carry the manager's tag", async () => {
    const { admin, mario, market } = await setup();
    const clan = (await admin.post('/bot-clans', { name: 'Thunder Crash', tag: '[TC]' })).body;
    const lib = (await admin.get('/bots')).body.bots as { id: string }[];
    for (const b of lib)
      expect((await admin.req('PATCH', `/bots/${b.id}`, { clanId: clan.id })).status).toBe(200);
    const tagged = (await admin.get('/bots')).body.bots as { gameName: string }[];
    expect(tagged.every((b) => b.gameName.startsWith('[TC]'))).toBe(true);
    market.tick();
    const offers = (await mario.get('/udt/market')).body.offers as Offer[];
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) expect(o.name).not.toMatch(/\[TC\]/);
    const o = offers.find((x) => x.price <= 900)!;
    expect((await mario.post('/udt/market/buy', { botId: o.botId })).status).toBe(200);
    const r = (await mario.get('/udt')).body.roster.find(
      (x: { botId: string }) => x.botId === o.botId,
    );
    expect(r.gameName).toBe(`[NX]${o.name}`);
  });

  it('pays salaries on Mondays (strike when it cannot be paid)', async () => {
    const { clock, mario, market, ledger } = await setup();
    market.tick();
    const m = (await mario.get('/udt/market')).body;
    const best = [...(m.offers as Offer[])]
      .filter((o) => o.price <= 900)
      .sort((a, b) => b.price - a.price)[0]!;
    const marioId = (await mario.get('/me')).body.id as string;
    expect((await mario.post('/udt/market/buy', { botId: best.botId })).status).toBe(200);
    // On to the next Monday.
    for (let d = 0; d < 7; d++) {
      clock.advance(DAY);
      market.tick();
    }
    const entries = ledger.entries(marioId, 1);
    const salary = entries.find((e) => e.kind === 'udt_salary');
    const r = (await mario.get('/udt')).body.roster.find(
      (x: { botId: string }) => x.botId === best.botId,
    );
    if (salary) {
      expect(salary.amount).toBeLessThan(0);
      expect(r.striking).toBe(false);
    } else expect(r.striking).toBe(true);
  });

  it('owes salaries it cannot pay (missed Mondays too) until a market day or a sale pays them', async () => {
    const { clock, mario, market, ledger } = await setup();
    market.tick(); // Monday 19.10.
    const m = (await mario.get('/udt/market')).body;
    const best = [...(m.offers as Offer[])]
      .filter((o) => o.price <= 900)
      .sort((a, b) => b.price - a.price)[0]!;
    const marioId = (await mario.get('/me')).body.id as string;
    expect((await mario.post('/udt/market/buy', { botId: best.botId })).status).toBe(200);
    const drain = (ref: string) =>
      ledger.book({
        season: 1,
        userId: marioId,
        kind: 'udt_reward',
        amount: -ledger.spendable(marioId).spendable,
        ref,
      });
    const bot = async () =>
      (await mario.get('/udt')).body.roster.find((x: { botId: string }) => x.botId === best.botId);
    const salaries = () =>
      ledger
        .entries(marioId, 1)
        .filter((e) => e.kind === 'udt_salary')
        .reduce((n, e) => n + e.amount, 0);
    drain('drain1');
    // The server misses Monday 26.10.: the market day of Tuesday still charges the week.
    clock.advance(8 * DAY);
    market.tick();
    const owed = await bot();
    expect(owed.salaryDue).toBeGreaterThan(0);
    expect(owed.striking).toBe(true);
    // Neuro again: the next market day collects what is owed and the strike ends.
    ledger.book({ season: 1, userId: marioId, kind: 'udt_reward', amount: 5000, ref: 'gift' });
    clock.advance(DAY);
    market.tick();
    expect(salaries()).toBe(-owed.salaryDue);
    expect(await bot()).toMatchObject({ striking: false, salaryDue: 0 });
    // Owed again on Monday 2.11.; a sale pays it from the price.
    drain('drain2');
    for (let d = 0; d < 5; d++) {
      clock.advance(DAY);
      market.tick();
    }
    const again = await bot();
    expect(again).toMatchObject({ striking: true });
    expect(again.salaryDue).toBeGreaterThan(0);
    const before = salaries();
    expect((await mario.post(`/udt/roster/${best.botId}/sell`)).status).toBe(200);
    expect(salaries()).toBe(before - again.salaryDue);
  });

  it('sells back for at most the price paid; the index counts active managers only', async () => {
    const { clock, mario, tim, market, ledger } = await setup();
    market.tick();
    const m = (await mario.get('/udt/market')).body;
    const best = [...(m.offers as Offer[])].filter((o) => o.price <= 900)[0]!;
    const marioId = (await mario.get('/me')).body.id as string;
    const timId = (await tim.get('/me')).body.id as string;
    expect((await mario.post('/udt/market/buy', { botId: best.botId })).status).toBe(200);
    // The value rose far above the price (here set directly): the sale pays the price.
    const db = api!.app.get(DB) as Db;
    db.insert(udtValues)
      .values({ botId: best.botId, day: '2099-01-01', value: best.price * 10 })
      .run();
    expect((await mario.post(`/udt/roster/${best.botId}/sell`)).status).toBe(200);
    const sale = ledger.entries(marioId, 1).find((e) => e.kind === 'udt_sale')!;
    expect(sale.amount).toBe(best.price);
    // Eight days later only Mario acted (his purchase is older, a bet or a new action counts).
    clock.advance(8 * DAY);
    const active = (since: number) =>
      (
        market as unknown as { activeManagers(s: number, since: string): Set<string> }
      ).activeManagers(1, new Date(since).toISOString());
    expect(active(clock.now() - 7 * DAY).size).toBe(0);
    ledger.book({ season: 1, userId: marioId, kind: 'udt_rest', amount: -10, ref: 'rest-x' });
    expect([...active(clock.now() - 7 * DAY)]).toEqual([marioId]);
    expect(active(clock.now() - 7 * DAY).has(timId)).toBe(false);
  });

  it('refunds the open bids of the old market once', async () => {
    const { mario, market, ledger } = await setup();
    market.tick();
    const m = (await mario.get('/udt/market')).body;
    const marioId = (await mario.get('/me')).body.id as string;
    const db = api!.app.get(DB) as Db;
    ledger.book({ season: 1, userId: marioId, kind: 'udt_purchase', amount: -300, ref: 'bid:old' });
    db.insert(udtBids)
      .values({
        id: 'old',
        day: m.day,
        botId: (m.offers as Offer[])[0]!.botId,
        userId: marioId,
        amount: 300,
        createdAt: new Date().toISOString(),
      })
      .run();
    expect(ledger.spendable(marioId).balance).toBe(700);
    expect(market.refundOpenBids()).toBe(1);
    expect(market.refundOpenBids()).toBe(0);
    expect(ledger.spendable(marioId).balance).toBe(1000);
  });
});
