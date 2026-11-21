import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import type { RunningApi } from '../src/app.js';
import { buyPrice, weeklySalary } from '@tourney/udt';
import { desc, eq } from 'drizzle-orm';
import { DB, type Db } from '../src/db/database.js';
import {
  bots,
  udtBids,
  udtBots,
  udtDays,
  udtRoster,
  udtTraits,
  udtValues,
} from '../src/db/schema.js';
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

  it('a bought bot settles in after 10 games: 2 prestige points, more team value (decision 269)', async () => {
    const { mario, market, ledger } = await setup();
    market.tick();
    const marioId = (await mario.get('/me')).body.id as string;
    ledger.book({ season: 1, userId: marioId, kind: 'udt_reward', amount: 50_000, ref: 'gift' });
    const o = ((await mario.get('/udt/market')).body.offers as Offer[])[0]!;
    expect((await mario.post('/udt/market/buy', { botId: o.botId })).status).toBe(200);
    const row = async () =>
      ((await mario.get('/udt')).body.roster as { botId: string; [k: string]: unknown }[]).find(
        (r) => r.botId === o.botId,
      )!;
    expect((await row()).settle).toEqual({ games: 0, need: 10, prestige: null });
    expect((await mario.post(`/udt/roster/${o.botId}/prestige`, { stat: 'aim' })).body.key).toBe(
      'a bought bot gets prestige points after {n} Dream Team games for your team',
    );
    const db = api!.app.get<Db>(DB);
    db.update(udtRoster).set({ settleGames: 10 }).where(eq(udtRoster.botId, o.botId)).run();
    const before = (await row()).capValue as number;
    expect((await row()).prestige).toMatchObject({ stage: 'settled', cap: 2, points: 2, free: 2 });
    for (let i = 0; i < 2; i++)
      expect((await mario.post(`/udt/roster/${o.botId}/prestige`, { stat: 'aim' })).status).toBe(
        200,
      );
    expect((await mario.post(`/udt/roster/${o.botId}/prestige`, { stat: 'fire' })).body.key).toBe(
      'no free prestige point',
    );
    const set = await row();
    expect(set.prestige).toMatchObject({ spent: 2, free: 0, alloc: { aim: 2 } });
    expect((set.prestige as { prices: { point: null } }).prices.point).toBeNull();
    // Each point set adds 4 % to what the bot counts against a team value cap.
    expect(set.capValue).toBe(Math.round(before * 1.08));
    // Bought points, the ascension and stars stay with own bots.
    expect((await mario.post(`/udt/roster/${o.botId}/prestige/buy`)).status).toBe(404);
    // Resetting costs as for own bots.
    expect((await mario.post(`/udt/roster/${o.botId}/prestige/reset`)).status).toBe(200);
    expect((await row()).prestige).toMatchObject({ spent: 0, free: 2 });
  });

  it('loans an offer for 7 market days without salary, then it goes back (decision 270)', async () => {
    const { clock, mario, tim, market, ledger } = await setup();
    market.tick();
    const marioId = (await mario.get('/me')).body.id as string;
    ledger.book({ season: 1, userId: marioId, kind: 'udt_reward', amount: 50_000, ref: 'gift' });
    const m = (await mario.get('/udt/market')).body;
    const [o, o2] = [...(m.offers as (Offer & { loanFee: number })[])].sort(
      (a, b) => b.skill - a.skill,
    );
    expect(o!.loanFee).toBe(Math.round((o!.value * 0.15) / 10) * 10);
    const before = ledger.spendable(marioId).spendable;
    const lent = await mario.post('/udt/market/loan', { botId: o!.botId });
    expect(lent.status, JSON.stringify(lent.body)).toBe(200);
    expect(lent.body.loan).toMatchObject({ botId: o!.botId, until: '2026-10-26' });
    expect(lent.body.offers.find((x: Offer) => x.botId === o!.botId)).toMatchObject({
      sold: true,
      mine: true,
      onLoan: true,
    });
    expect(ledger.spendable(marioId).spendable).toBe(before - o!.loanFee);
    // One loan at a time; others cannot buy it; it cannot be sold.
    expect((await mario.post('/udt/market/loan', { botId: o2!.botId })).body.key).toBe(
      'one loan at a time',
    );
    expect((await tim.post('/udt/market/buy', { botId: o!.botId })).body.key).toBe(
      'the bot is sold',
    );
    expect((await mario.post(`/udt/roster/${o!.botId}/sell`)).body.key).toBe(
      'a loaned bot goes back by itself',
    );
    const row = (
      (await mario.get('/udt')).body.roster as { botId: string; loan: unknown; settle: unknown }[]
    ).find((r) => r.botId === o!.botId)!;
    expect(row.loan).toEqual({ until: '2026-10-26', fee: o!.loanFee });
    expect(row.settle).toBeNull();
    // A trait on it goes back to the inventory when the loan ends.
    const db = api!.app.get<Db>(DB);
    db.insert(udtTraits)
      .values({
        id: 'tL',
        season: 1,
        userId: marioId,
        code: 'bouncer',
        botId: o!.botId,
        source: 'pack',
        createdAt: 'x',
        assignedAt: 'x',
      })
      .run();
    // Monday 26.10. (no salary for it on the Monday): back to the market.
    for (let d = 0; d < 7; d++) {
      clock.advance(DAY);
      market.tick();
    }
    const salaries = ledger
      .entries(marioId, 1, 100)
      .filter((e) => e.kind === 'udt_salary' && (e.meta as { botId?: string })?.botId === o!.botId);
    expect(salaries).toEqual([]);
    const after = (await mario.get('/udt')).body.roster as { botId: string }[];
    expect(after.some((r) => r.botId === o!.botId)).toBe(false);
    expect(db.select().from(udtTraits).where(eq(udtTraits.id, 'tL')).get()!.botId).toBeNull();
    expect((await mario.get('/udt/market')).body.loan).toBeNull();
  });

  it('buys its loaned bot for the price less the fee paid (decision 270)', async () => {
    const { mario, market, ledger } = await setup();
    market.tick();
    const marioId = (await mario.get('/me')).body.id as string;
    ledger.book({ season: 1, userId: marioId, kind: 'udt_reward', amount: 50_000, ref: 'gift' });
    const o = ((await mario.get('/udt/market')).body.offers as (Offer & { loanFee: number })[])[0]!;
    await mario.post('/udt/market/loan', { botId: o.botId });
    const before = ledger.spendable(marioId).spendable;
    expect((await mario.post('/udt/market/buy', { botId: o.botId })).status).toBe(200);
    expect(ledger.spendable(marioId).spendable).toBe(before - (o.price - o.loanFee));
    const row = (
      (await mario.get('/udt')).body.roster as { botId: string; loan: unknown; price: number }[]
    ).find((r) => r.botId === o.botId)!;
    expect(row).toMatchObject({ loan: null, price: o.price });
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

  it('blueprint bots draw 75 % of the salary; starter and talents none', async () => {
    const { clock, admin, mario, market, ledger } = await setup();
    const marioId = (await mario.get('/me')).body.id as string;
    const db = api!.app.get<Db>(DB);
    const made = async (name: string, origin: string) => {
      const id = (await admin.post('/bots', { name, skill: 5 })).body.id as string;
      db.update(bots).set({ udtOwner: marioId, udtOrigin: origin }).where(eq(bots.id, id)).run();
      db.insert(udtRoster)
        .values({ season: 1, botId: id, userId: marioId, price: 0, acquiredAt: 'x' })
        .run();
      db.insert(udtBots)
        .values({
          botId: id,
          season: 1,
          userId: marioId,
          madeBy: marioId,
          origin,
          potential: 6,
          createdAt: 'x',
        })
        .run();
      return id;
    };
    const bp = await made('Blue', 'blueprint');
    const talent = await made('Tal', 'academy');
    ledger.book({ season: 1, userId: marioId, kind: 'udt_reward', amount: 50_000, ref: 'gift' });
    market.tick(); // Monday 19.10.: the first market day charges nothing yet
    for (let d = 0; d < 7; d++) {
      clock.advance(DAY);
      market.tick();
    }
    const paid = (botId: string) =>
      ledger
        .entries(marioId, 1)
        .filter((e) => e.kind === 'udt_salary' && (e.meta as { botId?: string })?.botId === botId)
        .reduce((n, e) => n + e.amount, 0);
    const value = db
      .select()
      .from(udtValues)
      .where(eq(udtValues.botId, bp))
      .orderBy(desc(udtValues.day))
      .get()!;
    const index = db.select().from(udtDays).where(eq(udtDays.day, value.day)).get()!.economyIndex;
    expect(paid(bp)).toBe(-Math.round((weeklySalary(value.value, 5, index) * 0.75) / 10) * 10);
    expect(paid(bp)).toBeLessThan(0);
    expect(paid(talent)).toBe(0);
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
