import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { BotsService } from '../src/bots/bots.service.js';
import { DB, type Db } from '../src/db/database.js';
import { eq } from 'drizzle-orm';
import { udtBlueprints, udtBots, udtRoster } from '../src/db/schema.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { Client, startApi, startSeason } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

async function setup() {
  ({ api } = await startApi());
  const admin = await Client.login(api, 'Boss', true);
  const mario = await Client.login(api, 'Mario');
  await admin.req('PUT', '/settings/udt', { enabled: true });
  await startSeason(admin);
  await mario.post('/udt/team', {
    name: 'Nexus',
    tag: '[NX]',
    starter: { name: 'Mira', skill: 3 },
  });
  const marioId = (await mario.get('/me')).body.id as string;
  api.app
    .get(LedgerService)
    .book({ season: 1, userId: marioId, kind: 'udt_reward', amount: 50_000, ref: 'gift' });
  return { admin, mario, marioId, db: api.app.get<Db>(DB), ledger: api.app.get(LedgerService) };
}

describe('Unreal Dream Team: academy', () => {
  it('scouts, signs a talent with a licence, develops it up to its potential', async () => {
    const { mario, marioId, db, ledger } = await setup();
    let v = (await mario.get('/udt/academy')).body;
    // The starter was the first (free) licence; the second costs 2000 × index 0.3.
    expect(v).toMatchObject({
      scoutPrice: 360,
      licence: { made: 1, nextPrice: 600 },
      report: null,
    });
    expect((await mario.post('/udt/academy/sign', { pick: 0, name: 'Kid' })).status).toBe(409);
    const before = ledger.spendable(marioId).balance;
    v = (await mario.post('/udt/academy/scout')).body;
    expect(v.report).toHaveLength(3);
    expect(ledger.spendable(marioId).balance).toBe(before - 360);
    const r = v.report[1];
    expect(r.potential[1] - r.potential[0]).toBe(1);
    const signed = await mario.post('/udt/academy/sign', { pick: 1, name: 'Kid' });
    expect(signed.status, JSON.stringify(signed.body)).toBe(200);
    expect(signed.body).toMatchObject({ report: null, licence: { made: 2, nextPrice: 1200 } });
    expect(ledger.spendable(marioId).balance).toBe(before - 360 - 600);
    const kid = signed.body.own.find((b: { name: string }) => b.name === 'Kid');
    expect(kid).toMatchObject({ skill: r.skill, own: { origin: 'academy', points: 0 } });
    // The roster shows the report's window (crossing two windows told the potential).
    expect(kid.own.potential).toEqual(r.potential);
    // The open yearbook does not tell it either before level 5.
    const book = JSON.stringify((await mario.get('/udt/yearbook')).body);
    expect(book).toContain('Kid');
    expect(book).not.toMatch(/"potential":\d/);
    // Own bots stay: not for sale.
    expect((await mario.post(`/udt/roster/${kid.botId}/sell`)).status).toBe(409);
    // One free renaming: the game name keeps the tag; a second one is refused.
    expect(kid.own.canRename).toBe(true);
    const renamed = await mario.post(`/udt/bots/${kid.botId}/rename`, { name: 'Kiddo' });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'Kiddo' });
    const again = await mario.post(`/udt/bots/${kid.botId}/rename`, { name: 'Kidd' });
    expect(again.status).toBe(409);
    expect(again.body.key).toBe('the bot was renamed already (once per bot)');
    const kiddo = (await mario.get('/udt')).body.roster.find(
      (b: { botId: string }) => b.botId === kid.botId,
    );
    expect(kiddo).toMatchObject({
      name: 'Kiddo',
      gameName: '[NX]Kiddo',
      own: { canRename: false },
    });
    // Not someone else's bot, not a taken name.
    const starter = (await mario.get('/udt')).body.roster.find(
      (b: { starter: boolean }) => b.starter,
    );
    expect((await mario.post(`/udt/bots/${starter.botId}/rename`, { name: 'Kiddo' })).status).toBe(
      409,
    );
    // Level 4 (120 XP): three points.
    db.update(udtRoster).set({ xp: 120 }).run();
    const dev = await mario.post(`/udt/roster/${kid.botId}/develop`, { stat: 'accuracy' });
    expect(dev.status, JSON.stringify(dev.body)).toBe(200);
    const k2 = dev.body.roster.find((b: { botId: string }) => b.botId === kid.botId);
    expect(k2.own).toMatchObject({ points: 2, spent: 1 });
    expect(k2.traits.accuracy).toBeCloseTo((kid.traits.accuracy ?? 0) + 0.1);
    expect((await mario.post(`/udt/roster/${kid.botId}/develop`, { stat: 'skill' })).status).toBe(
      409,
    ); // 3 points needed
  });

  it('a mentor of level 3 takes one apprentice per season', async () => {
    const { admin, mario, marioId, db } = await setup();
    const lib = (await admin.post('/bots', { name: 'Sensei', skill: 6, traits: { accuracy: 0.8 } }))
      .body.id as string;
    db.insert(udtRoster)
      .values({ season: 1, botId: lib, userId: marioId, price: 9000, acquiredAt: 'x', xp: 0 })
      .run();
    let v = (await mario.get('/udt/academy')).body;
    expect(v.mentors).toMatchObject([{ name: 'Sensei', ready: false }]);
    expect((await mario.post('/udt/academy/mentor', { mentorId: lib, name: 'Pupil' })).status).toBe(
      409,
    );
    db.update(udtRoster).set({ xp: 70 }).run(); // level 3
    const ok = await mario.post('/udt/academy/mentor', { mentorId: lib, name: 'Pupil' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const pupil = ok.body.own.find((b: { name: string }) => b.name === 'Pupil');
    expect(pupil).toMatchObject({ skill: 3, own: { origin: 'apprentice' } });
    expect(pupil.traits.accuracy).toBeGreaterThan(0.3);
    v = ok.body;
    expect(v.mentors[0]).toMatchObject({ used: true, ready: false });
    expect(
      (await mario.post('/udt/academy/mentor', { mentorId: lib, name: 'Pupil2' })).status,
    ).toBe(409);
  });

  it('graduates an own bot with 15 games and level 5 after an admin approved', async () => {
    const { admin, mario, db } = await setup();
    let g = (await mario.get('/udt/graduation')).body;
    expect(g).toMatchObject({ games: 15, level: 5, left: 2 });
    const mira = g.bots[0].botId as string;
    expect(g.bots[0]).toMatchObject({ name: 'Mira', status: 'own', ready: false });
    expect((await mario.post(`/udt/graduation/${mira}`)).status).toBe(409);
    db.update(udtRoster).set({ xp: 640, games: 20 }).run(); // level 10: with honours
    g = (await mario.post(`/udt/graduation/${mira}`)).body;
    expect(g.bots[0]).toMatchObject({ status: 'nominated', honours: true });
    expect(g.left).toBe(1);
    expect((await mario.get('/udt/nominations')).status).toBe(403);
    const n = (await admin.get('/udt/nominations')).body;
    expect(n).toMatchObject([
      { name: 'Mira', team: 'Nexus', breeder: 'Mario', level: 10, approvable: false },
    ]);
    // Approved only when the season is over.
    const early = await admin.post(`/udt/nominations/${mira}/approve`, { name: 'Mirabelle' });
    expect(early.status).toBe(409);
    expect((await admin.post('/seasons/1/end')).status).toBeLessThan(300);
    expect((await admin.get('/udt/nominations')).body[0].approvable).toBe(true);
    const ok = await admin.post(`/udt/nominations/${mira}/approve`, { name: 'Mirabelle' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual([]);
    // A library bot now: in the control center (inactive), in the yearbook with honours.
    const cc = (await admin.get('/bots')).body.bots as { name: string; active: boolean }[];
    expect(cc.find((b) => b.name === 'Mirabelle')).toMatchObject({ active: false });
    const y = (await mario.get('/udt/yearbook')).body;
    expect(y).toMatchObject({ season: 1, seasons: [1] });
    expect(y.bots[0]).toMatchObject({ name: 'Mirabelle', status: 'graduated', honours: true });
    expect((await mario.get('/udt/breeders')).body).toMatchObject([
      { name: 'Mario', graduates: 1, honours: 1 },
    ]);
  });

  it('breakthrough: once, for a fully developed bot from level 10', async () => {
    const { mario, db } = await setup();
    const starter = (await mario.get('/udt')).body.roster[0];
    const id = starter.botId as string;
    const bt = () => mario.post(`/udt/roster/${id}/breakthrough`);
    // Level 9, skill 3 below the potential 5, values 50: refused for the level first; a hidden
    // potential 7 at level 3 gets the same answer (it does not tell the potential).
    db.update(udtRoster).set({ xp: 585 }).where(eq(udtRoster.botId, id)).run();
    expect((await bt()).body.key).toBe('a breakthrough needs level {level}');
    db.update(udtRoster).set({ xp: 60 }).where(eq(udtRoster.botId, id)).run();
    db.update(udtBots).set({ potential: 7 }).where(eq(udtBots.botId, id)).run();
    expect((await bt()).body.key).toBe('a breakthrough needs level {level}');
    // Level 12 (11 points): skill at the potential, but the values (50) are below 60.
    db.update(udtRoster).set({ xp: 880 }).where(eq(udtRoster.botId, id)).run();
    db.update(udtBots).set({ potential: 3 }).where(eq(udtBots.botId, id)).run();
    expect((await bt()).body.key).toBe('a breakthrough needs every value at {value} or more');
    api!.app
      .get(BotsService)
      .update(id, { traits: { ...starter.traits, accuracy: 1, alertness: 1, strafing: 1 } });
    let r = (await mario.get('/udt')).body.roster[0];
    expect(r.own).toMatchObject({
      potential: [3, 3],
      points: 11,
      breakthrough: false,
      maxed: false,
    });
    // Not enough points (11 - 8 spent = 3 of 4).
    db.update(udtBots).set({ pointsSpent: 8 }).where(eq(udtBots.botId, id)).run();
    expect((await bt()).body.key).toBe('the breakthrough costs {cost} points');
    db.update(udtBots).set({ pointsSpent: 0 }).where(eq(udtBots.botId, id)).run();
    const ok = await bt();
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    r = ok.body.roster[0];
    // Skill and potential 4, values 100 -> 65, 4 points spent.
    expect(r).toMatchObject({
      skill: 4,
      own: { potential: [4, 4], points: 7, breakthrough: true },
    });
    expect(r.traits).toMatchObject({ accuracy: 0.3, alertness: 0.3, strafing: 0.3 });
    // Once per bot.
    expect((await bt()).body.key).toBe('a bot has one breakthrough');
  });

  it('builds an own bot from a blueprint: skill 3, points, potential, model, start trait', async () => {
    const { mario, marioId, db } = await setup();
    for (const [id, rarity] of [
      ['pC', 'common'],
      ['pE', 'epic'],
    ] as const)
      db.insert(udtBlueprints)
        .values({ id, season: 1, userId: marioId, rarity, createdAt: 'x' })
        .run();
    const v = (await mario.get('/udt/academy')).body;
    expect(v.blueprints.map((b: { rarity: string }) => b.rarity).sort()).toEqual([
      'common',
      'epic',
    ]);
    const avg = { accuracy: 0, alertness: 0, strafing: 0 };
    expect(
      (
        await mario.post('/udt/academy/build', {
          blueprintId: 'pC',
          name: 'Blank',
          skill: 4,
          traits: avg,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await mario.post('/udt/academy/build', {
          blueprintId: 'pC',
          name: 'Blank',
          skill: 3,
          traits: avg,
          botClass: 'BotPack.TFemale1Bot',
          look: {
            skin: 'FCommandoSkins.daco',
            personality: { lines: [{ kind: 'kill', text: 'Hi' }] },
          },
        })
      ).status,
    ).toBe(200); // the model is cosmetic: free for every blueprint
    // Epic: 1,625 points for skill 3 (always skill 3: no skill 4, no cheap skill 2).
    const top = { accuracy: 1, alertness: 1, strafing: 1 };
    for (const [skill, traits] of [
      [4, avg],
      [2, avg],
      [3, top],
    ] as const)
      expect(
        (
          await mario.post('/udt/academy/build', {
            blueprintId: 'pE',
            name: 'Signa',
            skill,
            traits,
          })
        ).status,
      ).toBe(400);
    const ok = await mario.post('/udt/academy/build', {
      blueprintId: 'pE',
      name: 'Signa',
      traits: { accuracy: 0.2, alertness: 0.2, strafing: 0.2 },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.built.startTrait).toBeTruthy();
    const b = ok.body.own.find((x: { name: string }) => x.name === 'Signa');
    expect(b).toMatchObject({ skill: 3, own: { origin: 'blueprint' } });
    // The potential comes from the epic range 4-6.
    const pot = db.select().from(udtBots).where(eq(udtBots.botId, b.botId)).get()!.potential;
    expect(pot).toBeGreaterThanOrEqual(4);
    expect(pot).toBeLessThanOrEqual(6);
    expect(b.udtTraits[0].code).toBe(ok.body.built.startTrait);
    expect(ok.body.blueprints).toHaveLength(0);
    const blank = ok.body.own.find((x: { name: string }) => x.name === 'Blank');
    expect(blank).toMatchObject({ botClass: 'BotPack.TFemale1Bot', skin: 'FCommandoSkins.daco' });
  });

  it('careers: every bot has one; admins retire bots into the hall of fame', async () => {
    const { admin, mario, db, marioId } = await setup();
    const old = (await admin.post('/bots', { name: 'Oldtimer', skill: 5 })).body.id as string;
    // Twelve seasons of Dream Team games: in decline, retirement suggested.
    for (let s = 1; s <= 12; s++)
      db.insert(udtRoster)
        .values({
          season: 100 + s,
          botId: old,
          userId: marioId,
          price: 0,
          acquiredAt: 'x',
          games: 6,
        })
        .run();
    const c = (await mario.get(`/udt/career/${old}`)).body;
    expect(c).toMatchObject({ age: 12, phase: 'decline', retire: true, games: 72 });
    let h = (await admin.get('/udt/hall')).body;
    expect(h.candidates.map((x: { name: string }) => x.name)).toContain('Oldtimer');
    expect((await mario.get('/udt/hall')).body.candidates).toEqual([]);
    expect((await mario.post(`/udt/career/${old}/retire`)).status).toBe(403);
    const r = await admin.post(`/udt/career/${old}/retire`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body[0]).toMatchObject({ name: 'Oldtimer', career: { age: 12 } });
    h = (await admin.get('/udt/hall')).body;
    expect(h.retired).toHaveLength(1);
    expect(h.candidates).toEqual([]);
    expect(
      (await admin.get('/bots')).body.bots.find((b: { name: string }) => b.name === 'Oldtimer'),
    ).toMatchObject({ active: false });
    // The roster shows the career of its bots.
    const v = (await mario.get('/udt')).body;
    expect(v.roster[0].career).toMatchObject({ phase: 'rookie' });
  });
});
