import { afterEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { xpForLevel } from '@tourney/udt';
import type { RunningApi } from '../src/app.js';
import { DB, type Db } from '../src/db/database.js';
import { bots, udtAi, udtBlueprints, udtBots, udtRoster } from '../src/db/schema.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { UdtAiService } from '../src/udt/udt-ai.service.js';
import { UdtService } from '../src/udt/udt.service.js';
import { Client, startApi, startSeason } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

/** An API with one AI manager (a tactician) and its team; returns what the tests need. */
async function oneAi(libSkills: number[] = []) {
  ({ api } = await startApi({ TEST_MODE: 'true' }));
  const admin = await Client.login(api, 'Boss', true);
  await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
  for (const [i, skill] of libSkills.entries())
    await admin.post('/bots', { name: `Lib${i}`, skill });
  await admin.req('PUT', '/settings/udt', { enabled: true });
  const season = await startSeason(admin);
  await admin.req('PUT', '/settings/udt', { aiEnabled: true, aiCount: 1 });
  await admin.post('/udt/ai/ensure');
  const db = api.app.get<Db>(DB);
  const userId = db.select().from(udtAi).get()!.userId;
  const udt = api.app.get(UdtService);
  const ai = api.app.get(UdtAiService);
  const starter = udt.roster(userId, season).find((r) => r.starter)!;
  return { admin, db, userId, udt, ai, season, starter };
}

describe('Dream Team AI managers (decision 249)', () => {
  it('save development points for the next skill step until the bot reaches its potential', async () => {
    const { db, userId, udt, ai, season, starter } = await oneAi();
    const own = () => db.select().from(udtBots).where(eq(udtBots.botId, starter.botId)).get()!;
    db.update(udtBots).set({ potential: 6 }).where(eq(udtBots.botId, starter.botId)).run();
    const values = { ...starter.traits };
    const setLevel = (level: number) =>
      db
        .update(udtRoster)
        .set({ xp: xpForLevel(level) })
        .where(and(eq(udtRoster.season, season), eq(udtRoster.botId, starter.botId)))
        .run();
    const act = () => ai.daily({ number: season } as never, udt.today());
    // Level 3: two points - not enough for a skill step, they wait (before: two values +5).
    setLevel(3);
    act();
    let bot = udt.roster(userId, season).find((r) => r.botId === starter.botId)!;
    expect(bot.skill).toBe(3);
    expect(own().pointsSpent).toBe(0);
    expect(bot.traits.accuracy).toBe(values.accuracy);
    // Level 4: three points - skill 4.
    setLevel(4);
    act();
    bot = udt.roster(userId, season).find((r) => r.botId === starter.botId)!;
    expect(bot.skill).toBe(4);
    expect(own().pointsSpent).toBe(3);
    // Level 11: ten points - skill 6 (the potential), the last point into the lowest value.
    setLevel(11);
    act();
    bot = udt.roster(userId, season).find((r) => r.botId === starter.botId)!;
    expect(bot.skill).toBe(6);
    expect(own().pointsSpent).toBe(10);
    const sum = (v: typeof values) => (v.accuracy ?? 0) + (v.alertness ?? 0) + (v.strafing ?? 0);
    expect(sum(bot.traits)).toBeCloseTo(sum(values) + 0.1, 5);
  });

  it('buy prestige points from their share and place them by personality (decision 263)', async () => {
    const { db, userId, udt, ai, season, starter } = await oneAi();
    api!.app
      .get(LedgerService)
      .book({ season, userId, kind: 'udt_reward', amount: 100_000, ref: 'ai-gift' });
    // The starter at its potential (mature): four points of room, none yet.
    db.update(udtBots).set({ potential: 3 }).where(eq(udtBots.botId, starter.botId)).run();
    db.update(udtRoster)
      .set({ xp: xpForLevel(6) })
      .where(and(eq(udtRoster.season, season), eq(udtRoster.botId, starter.botId)))
      .run();
    const pres = () => udt.roster(userId, season).find((r) => r.starter)!.own!.prestige!;
    expect(pres()).toMatchObject({ stage: 'mature', points: 0 });
    ai.daily({ number: season } as never, udt.today());
    // Two a day at most, placed at once (a tactician aims first).
    expect(pres()).toMatchObject({ points: 2, spent: 2, free: 0, alloc: { aim: 2 } });
    ai.daily({ number: season } as never, udt.today());
    expect(pres()).toMatchObject({ points: 4, spent: 4, alloc: { aim: 3, react: 1 } });
  });

  it('a full roster swaps its weakest bought bot for a clearly stronger offer, never a bot it made', async () => {
    // The market offers come from the library: weak ones for the roster, strong ones to buy.
    const { admin, db, userId, udt, ai, season } = await oneAi([1, 1, 1, 1, 1, 1, 6, 6, 6, 6]);
    await admin.post('/udt/test/market-day');
    // Six weak library bots in the roster (bought), the starter makes seven.
    const weak = db
      .select()
      .from(bots)
      .all()
      .filter((b) => b.skill === 1 && !b.udtOwner)
      .slice(0, 6);
    for (const b of weak)
      db.insert(udtRoster)
        .values({ season, botId: b.id, userId, price: 100, acquiredAt: new Date().toISOString() })
        .run();
    expect(udt.roster(userId, season)).toHaveLength(7);
    const offers = (await admin.get('/udt/market')).body.offers as { skill: number }[];
    expect(offers.some((o) => o.skill === 6)).toBe(true);
    // Plenty of Neuro (a sponsor).
    api!.app.get(LedgerService).book({
      season,
      userId,
      kind: 'udt_sponsor',
      amount: 500_000,
      ref: `test-money:${userId}`,
    });
    const bought = ai.closing({ number: season } as never, udt.today());
    expect(bought).toBe(2);
    const roster = udt.roster(userId, season);
    expect(roster).toHaveLength(7);
    expect(roster.filter((r) => r.skill === 6)).toHaveLength(2);
    expect(roster.filter((r) => r.skill === 1)).toHaveLength(4);
    expect(roster.some((r) => r.starter)).toBe(true);
  });

  it('build their blueprints when a licence fits (a full roster makes room from a weak bought bot)', async () => {
    const { db, userId, udt, ai, season } = await oneAi([1]);
    db.insert(udtBlueprints)
      .values({
        id: 'bp1',
        season,
        userId,
        rarity: 'rare',
        createdAt: new Date().toISOString(),
      })
      .run();
    api!.app.get(LedgerService).book({
      season,
      userId,
      kind: 'udt_sponsor',
      amount: 100_000,
      ref: `test-money:${userId}`,
    });
    ai.daily({ number: season } as never, udt.today());
    const made = udt.roster(userId, season).filter((r) => r.own?.origin === 'blueprint');
    expect(made).toHaveLength(1);
    expect(made[0]!.skill).toBe(3);
    // Accuracy first, the other values average.
    expect(made[0]!.traits.accuracy).toBeGreaterThan(0);
    expect(made[0]!.traits.alertness).toBe(0);
    // One blueprint used (the best: packs bought from its savings may have brought a better one).
    expect(
      db
        .select()
        .from(udtBlueprints)
        .all()
        .filter((b) => b.usedAt),
    ).toHaveLength(1);
  });
});
