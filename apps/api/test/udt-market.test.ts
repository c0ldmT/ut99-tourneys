import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import type { RunningApi } from '../src/app.js';
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
  const starter = (name: string) => ({ name, skill: 2 });
  await mario.post('/udt/team', { name: 'Nexus', tag: '[NX]', starter: starter('Mira') });
  await tim.post('/udt/team', { name: 'Iron', tag: '[IG]', starter: starter('Tox') });
  const market = api.app.get(UdtMarketService);
  const ledger = api.app.get(LedgerService);
  return { clock, admin, mario, tim, market, ledger };
}

describe('Unreal Dream Team: transfer market', () => {
  it('opens on the first tick, settles hidden bids on the next market day, refunds the loser', async () => {
    const { clock, mario, tim, market, ledger } = await setup();
    expect(market.tick()).toBe(true); // first market day of the season: right away
    expect(market.tick()).toBe(false);
    const m = (await mario.get('/udt/market')).body;
    expect(m.day).toBe('2026-10-19');
    expect(m.index).toBe(0.3);
    expect(m.offers).toHaveLength(6);
    const cheap = [...m.offers].sort(
      (a: { minPrice: number }, b: { minPrice: number }) => a.minPrice - b.minPrice,
    )[0];
    expect(cheap.minPrice).toBeGreaterThan(0);
    expect((await mario.post('/udt/market/bid', { botId: cheap.botId, amount: 5 })).status).toBe(
      400,
    );
    const low = cheap.minPrice;
    expect((await mario.post('/udt/market/bid', { botId: cheap.botId, amount: low })).status).toBe(
      200,
    );
    expect(
      (await tim.post('/udt/market/bid', { botId: cheap.botId, amount: low + 50 })).status,
    ).toBe(200);
    const marioId = (await mario.get('/me')).body.id as string;
    const timId = (await tim.get('/me')).body.id as string;
    // Paid while open.
    expect(ledger.spendable(marioId).balance).toBe(1000 - low);
    // A higher bid replaces the own one.
    expect(
      (await mario.post('/udt/market/bid', { botId: cheap.botId, amount: low + 60 })).status,
    ).toBe(200);
    expect(ledger.spendable(marioId).balance).toBe(1000 - low - 60);
    // Before the market time of the next day nothing happens.
    clock.advance(DAY - 8 * 3_600_000); // Tuesday 02:00 UTC = 04:00 in Berlin (summer time)
    clock.advance(-60_000);
    expect(market.tick()).toBe(false);
    clock.advance(2 * 60_000);
    expect(market.tick()).toBe(true);
    const roster = (await mario.get('/udt')).body.roster as { botId: string; price: number }[];
    expect(roster.find((r) => r.botId === cheap.botId)?.price).toBe(low + 60);
    expect(ledger.spendable(timId).balance).toBe(1000); // refunded
    const m2 = (await mario.get('/udt/market')).body;
    expect(m2.day).toBe('2026-10-20');
    expect(m2.offers.some((o: { botId: string }) => o.botId === cheap.botId)).toBe(false);
    // Selling pays 85 % of the value; the starter stays.
    const starter = (await mario.get('/udt')).body.roster.find(
      (r: { starter: boolean }) => r.starter,
    );
    expect((await mario.post(`/udt/roster/${starter.botId}/sell`)).status).toBe(409);
    const sold = await mario.post(`/udt/roster/${cheap.botId}/sell`);
    expect(sold.status).toBe(200);
    expect(ledger.spendable(marioId).balance).toBeGreaterThan(1000 - low - 60);
  });

  it('withdraws bids and pays salaries on Mondays (strike when it cannot be paid)', async () => {
    const { clock, mario, market, ledger } = await setup();
    market.tick();
    const m = (await mario.get('/udt/market')).body;
    const best = [...m.offers]
      .filter((o: { minPrice: number }) => o.minPrice <= 900)
      .sort((a: { minPrice: number }, b: { minPrice: number }) => b.minPrice - a.minPrice)[0];
    const marioId = (await mario.get('/me')).body.id as string;
    expect(
      (await mario.post('/udt/market/bid', { botId: best.botId, amount: best.minPrice })).status,
    ).toBe(200);
    expect(
      (
        await mario.post('/udt/market/bid', {
          botId: m.offers.find((o: { minPrice: number }) => o.minPrice > 900)?.botId ?? best.botId,
          amount: 100_000,
        })
      ).status,
    ).toBe(409);
    const wd = await mario.req('DELETE', `/udt/market/bid/${best.botId}`);
    expect(wd.status, JSON.stringify(wd.body)).toBe(200);
    expect(ledger.spendable(marioId).balance).toBe(1000);
    await mario.post('/udt/market/bid', { botId: best.botId, amount: best.minPrice });
    // Tuesday's market day: Mario owns it. Then on to the next Monday.
    clock.advance(DAY);
    market.tick();
    for (let d = 0; d < 6; d++) {
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
});
