import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import { asc, eq } from 'drizzle-orm';
import type { RunningApi } from '../src/app.js';
import { DB, type Db } from '../src/db/database.js';
import { udtBotDays, udtTeamDays } from '../src/db/schema.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { UdtMarketService } from '../src/udt/udt-market.service.js';
import { UdtSnapshotService } from '../src/udt/udt-snapshots.service.js';
import { UdtService } from '../src/udt/udt.service.js';
import { Client, startApi, startSeason } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const DAY = 86_400_000;

describe('Dream Team snapshots per market day (decision 244)', () => {
  it('writes every team and roster bot after the market day, one row per day and bot', async () => {
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
    await mario.post('/udt/team', {
      name: 'Nexus',
      tag: '[NX]',
      starter: { name: 'Mira', skill: 3 },
    });
    await tim.post('/udt/team', { name: 'Iron', tag: '[IG]', starter: { name: 'Tox', skill: 3 } });
    const market = api.app.get(UdtMarketService);
    const ledger = api.app.get(LedgerService);
    const db = api.app.get<Db>(DB);
    const marioId = (await mario.get('/me')).body.id as string;

    expect(market.tick()).toBe(true);
    const day1 = db.select().from(udtTeamDays).orderBy(asc(udtTeamDays.userId)).all();
    expect(day1).toHaveLength(2);
    for (const t of day1)
      expect(t).toMatchObject({
        day: '2026-10-19',
        season: 1,
        ai: false,
        cash: 1000,
        staked: 0,
        book: 0,
        rosterValue: 0,
        salaryWeek: 0,
        roster: 1,
        striking: 0,
        top5Skill: 3,
        blueprints: 0,
      });
    const starters = db.select().from(udtBotDays).all();
    expect(starters).toHaveLength(2);
    for (const b of starters)
      expect(b).toMatchObject({
        day: '2026-10-19',
        origin: 'starter',
        skill: 3,
        level: 1,
        xp: 0,
        salary: 0,
        value: 0,
        traitCodes: '',
        striking: false,
      });
    expect(starters[0]!.potential).toBeGreaterThanOrEqual(3);
    expect(['hot', 'normal', 'cold']).toContain(starters[0]!.form);

    // Mario buys a bot: the next market day has it with its price, value and salary.
    const offers = (await mario.get('/udt/market')).body.offers as {
      botId: string;
      price: number;
    }[];
    const cheap = [...offers].sort((a, b) => a.price - b.price)[0]!;
    expect((await mario.post('/udt/market/buy', { botId: cheap.botId })).status).toBe(200);
    clock.advance(DAY);
    expect(market.tick()).toBe(true);
    const day2 = db.select().from(udtTeamDays).where(eq(udtTeamDays.day, '2026-10-20')).all();
    expect(day2).toHaveLength(2);
    const m = day2.find((t) => t.userId === marioId)!;
    expect(m).toMatchObject({ roster: 2, book: cheap.price });
    expect(m.cash).toBe(ledger.spendable(marioId).balance);
    expect(m.rosterValue).toBeGreaterThan(0);
    expect(m.salaryWeek).toBeGreaterThan(0);
    const bought = db.select().from(udtBotDays).where(eq(udtBotDays.botId, cheap.botId)).all();
    expect(bought).toHaveLength(1);
    expect(bought[0]).toMatchObject({
      day: '2026-10-20',
      userId: marioId,
      origin: 'bought',
      potential: null,
      price: cheap.price,
      salary: m.salaryWeek,
    });
    expect(bought[0]!.value).toBeGreaterThan(0);
    // Day 1 stays as it was: one row per bot and day.
    expect(db.select().from(udtBotDays).all()).toHaveLength(5);

    // The same day again (the test mode's "market day now") replaces its rows.
    const again = api.app
      .get(UdtSnapshotService)
      .take(api.app.get(UdtService).season(), '2026-10-20', {
        active: new Set(),
        salary: new Map(),
      });
    expect(again).toEqual({ teams: 2, bots: 3 });
    expect(db.select().from(udtBotDays).all()).toHaveLength(5);
    // A website reset takes the snapshots with it.
    expect((await admin.post('/settings/reset', { confirm: 'RESET' })).status).toBeLessThan(300);
    expect(db.select().from(udtTeamDays).all()).toHaveLength(0);
    expect(db.select().from(udtBotDays).all()).toHaveLength(0);
  });
});
