import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import type { RunningApi } from '../src/app.js';
import { AgentsService } from '../src/agents/agents.service.js';
import { DB, type Db } from '../src/db/database.js';
import { and, eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { neuroLedger, settings, udtChallenges, udtRoster, users } from '../src/db/schema.js';
import { SettingsService } from '../src/settings/settings.service.js';
import { LedgerService } from '../src/ledger/ledger.service.js';
import { TournamentsService } from '../src/tournaments/tournaments.service.js';
import { EventLogService } from '../src/tournaments/event-log.service.js';
import { StatsService } from '../src/stats/stats.service.js';
import { UdtChallengesService } from '../src/udt/udt-challenges.service.js';
import { UdtRewardsService } from '../src/udt/udt-rewards.service.js';
import { UdtAiService } from '../src/udt/udt-ai.service.js';
import { Client, startApi, startSeason, tournamentBody } from './helpers.js';
import type { DiscordOut, DiscordPost } from '../src/notify/discord-out.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const HOUR = 3_600_000;
/** Friday, 27.11.2026, 13:00 in Berlin: the window 19:00-22:00 is 18:00-21:00 UTC. */
const NOW = Date.parse('2026-11-27T12:00:00Z');
const at = (hhmmUtc: string, day = '2026-11-27') => `${day}T${hhmmUtc}:00.000Z`;

const profile = (port: number) => ({
  id: 'local',
  name: 'UT server',
  os: 'linux' as const,
  port,
  lobbyMap: 'DM-Deck16][',
  manage: true,
});

async function setup(servers = 2, env: Record<string, string> = {}, discordOut?: DiscordOut) {
  const clock = new FakeClock(NOW);
  ({ api } = await startApi(env, { clock, ...(discordOut ? { discordOut } : {}) }));
  const admin = await Client.login(api, 'Boss', true);
  const agents = api.app.get(AgentsService);
  for (let i = 1; i <= servers; i++) {
    await admin.post('/agents', { id: `s${i}`, name: `Server ${i}` });
    agents.saveHello(`s${i}`, { profiles: [profile(7777 + 10 * i)] });
  }
  const put = await admin.put('/settings/udt', { enabled: true, challenge: { enabled: true } });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
  await startSeason(admin);
  const mario = await Client.login(api, 'Mario');
  const tim = await Client.login(api, 'Tim');
  const ana = await Client.login(api, 'Ana');
  for (const [c, name, tag] of [
    [mario, 'Nexus', '[NX]'],
    [tim, 'Iron', '[IG]'],
    [ana, 'Comets', '[RC]'],
  ] as const)
    expect((await c.post('/udt/team', { name, tag, starter: { name: `${name}1` } })).status).toBe(
      201,
    );
  const id = async (c: Client) => (await c.get('/me')).body.id as string;
  const [marioId, timId, anaId] = [await id(mario), await id(tim), await id(ana)];
  const ledger = api.app.get(LedgerService);
  for (const u of [marioId, timId, anaId])
    ledger.book({ season: 1, userId: u, kind: 'udt_reward', amount: 10_000, ref: `gift:${u}` });
  const base = ledger.spendable(marioId).spendable;
  /** Neuro spent on challenges (everybody starts with the same). */
  const free = (u: string) => base - ledger.spendable(u).spendable;
  return {
    clock,
    admin,
    mario,
    tim,
    ana,
    marioId,
    timId,
    anaId,
    ledger,
    free,
    db: api.app.get<Db>(DB),
  };
}

const body = (over: Record<string, unknown> = {}) => ({
  mode: 'dm',
  teamSize: 5,
  bestOf: 1,
  stake: 500,
  at: at('18:30'),
  ...over,
});

const DISCORD = {
  DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/123456/abc-DEF_1',
  DISCORD_BOT_TOKEN: 't',
  NOTIFY_LANG: 'de',
};

/** Records the channel posts and direct messages. */
function recorder() {
  const posts: DiscordPost[] = [];
  const dms: { to: string; text: string }[] = [];
  const out: DiscordOut = {
    webhook: (_url, text) =>
      void posts.push(typeof text === 'string' ? { content: text, embeds: [] } : text),
    dm: (to, text) => void dms.push({ to, text }),
    idle: async () => {},
  };
  return { out, posts, dms };
}

describe('Dream Team challenges (decision 334)', () => {
  it('lists the start times of the window with their state', async () => {
    const { mario, timId } = await setup();
    const r = await mario.get(`/udt/challenges/slots?mode=dm&bestOf=1&opponent=${timId}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const day = r.body.days[0];
    expect(day.date).toBe('2026-11-27');
    expect(day.starts).toHaveLength(12);
    expect(day.starts[0]).toMatchObject({ time: '19:00', at: at('18:00'), state: 'free' });
    expect(day.starts.at(-1).time).toBe('21:45');
    // Monster Hunt: a race keeps the server 45 minutes, the last start is 21:15.
    const mh = await mario.get('/udt/challenges/slots?mode=mh');
    expect(mh.body.minutes).toBe(45);
    expect(mh.body.days[0].starts.at(-1).time).toBe('21:15');
  });

  it('holds the stake, reserves a server, takes the answer and gives stakes back', async () => {
    const { mario, tim, marioId, timId, free, clock } = await setup();
    const sent = await mario.post('/udt/challenges', body({ to: timId, message: 'Revanche?' }));
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(free(marioId)).toBe(500);
    const id = sent.body.id as string;
    expect(sent.body.outgoing[0]).toMatchObject({ id, stake: 500, pot: 1000, prize: 950 });
    // The challenged team sees it; it keeps the start (both teams busy then).
    const inbox = await tim.get('/udt/challenges');
    expect(inbox.body.incoming.map((c: { id: string }) => c.id)).toEqual([id]);
    expect((await tim.get('/udt/hub')).body.challengesIn).toBe(1);
    expect((await tim.get('/udt/hub')).body.challenges).toMatchObject({ incoming: 1 });
    expect((await tim.get('/udt/challenges/count')).body).toEqual({ incoming: 1 });
    const opps = await mario.get('/udt/challenges/opponents?mode=dm&teamSize=1');
    expect(opps.status, JSON.stringify(opps.body)).toBe(200);
    expect(opps.body.me).toMatchObject({ full: true });
    expect(opps.body.teams.find((x: { userId: string }) => x.userId === timId)).toMatchObject({
      full: true,
      pairLeft: 1,
    });
    const slots = await tim.get(`/udt/challenges/slots?opponent=${marioId}`);
    expect(slots.body.days[0].starts[2]).toMatchObject({ time: '19:30', state: 'mine' });
    // The server calendar keeps a cup out of the challenge's server.
    const tours = api!.app.get(TournamentsService);
    const probe = {
      id: 'x',
      agentId: 's1',
      kind: 'standard',
      udtJson: null,
      settings: tours.settings({
        settingsJson: JSON.stringify(tournamentBody({}, { size: 4, format: 'single' }).settings),
      } as never),
    };
    expect(tours.calendar.blocking(probe, Date.parse(at('18:25')))?.label).toBe('challenge');
    // Accept: Tim's stake is held too.
    const acc = await tim.post(`/udt/challenges/${id}/accept`);
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect(free(timId)).toBe(500);
    expect(acc.body.upcoming[0]).toMatchObject({ id, status: 'accepted' });
    // A second one from Mario to Tim: declined, Mario gets his stake back.
    const two = await mario.post(
      '/udt/challenges',
      body({ to: timId, at: at('20:00'), stake: 300 }),
    );
    expect(two.status, JSON.stringify(two.body)).toBe(201);
    expect(free(marioId)).toBe(800);
    expect((await tim.post(`/udt/challenges/${two.body.id}/decline`)).status).toBe(200);
    expect(free(marioId)).toBe(500);
    // A third one is withdrawn; a fourth expires at its deadline (lock 60 minutes before).
    const three = await mario.post(
      '/udt/challenges',
      body({ to: timId, at: at('19:00'), stake: 0 }),
    );
    expect(three.status, JSON.stringify(three.body)).toBe(201);
    expect((await mario.del(`/udt/challenges/${three.body.id}`)).status).toBe(200);
    const four = await mario.post(
      '/udt/challenges',
      body({ to: timId, at: at('19:30'), stake: 200 }),
    );
    expect(four.status, JSON.stringify(four.body)).toBe(201);
    expect(four.body.outgoing[0].expiresAt).toBe(at('18:30'));
    clock.advance(7 * HOUR);
    const later = await mario.get('/udt/challenges');
    expect(later.body.outgoing).toHaveLength(0);
    expect(later.body.recent.find((c: { id: string }) => c.id === four.body.id).status).toBe(
      'expired',
    );
    expect(free(marioId)).toBe(500);
  });

  it('keeps the limits: pair per week, stake cap and steps, the window, the season', async () => {
    const { mario, tim, timId, anaId } = await setup();
    const cap = (await mario.get('/udt/challenges')).body.rules.stakeCap as number;
    expect((await mario.post('/udt/challenges', body({ to: timId, stake: cap + 10 }))).status).toBe(
      409,
    );
    expect((await mario.post('/udt/challenges', body({ to: timId, stake: 55 }))).status).toBe(400);
    expect((await mario.post('/udt/challenges', body({ to: timId, stake: 50 }))).status).toBe(400);
    // Off the grid, outside the window, too late.
    expect((await mario.post('/udt/challenges', body({ to: timId, at: at('18:10') }))).status).toBe(
      409,
    );
    expect((await mario.post('/udt/challenges', body({ to: timId, at: at('21:00') }))).status).toBe(
      409,
    );
    const late = await mario.post('/udt/challenges', body({ to: timId, at: at('12:30') }));
    expect(late.status).toBe(409);
    // Two per pair and week (counter offers and declined ones do not count).
    expect((await mario.post('/udt/challenges', body({ to: timId, at: at('18:00') }))).status).toBe(
      201,
    );
    const second = await mario.post(
      '/udt/challenges',
      body({ to: timId, at: at('19:00', '2026-11-28') }),
    );
    expect(second.status).toBe(201);
    const third = await mario.post(
      '/udt/challenges',
      body({ to: timId, at: at('20:00', '2026-11-29') }),
    );
    expect(third.status).toBe(409);
    expect(third.body.key).toBe('at most {n} challenges between two managers per week');
    // A third waiting challenge is allowed (max 3), a fourth not.
    expect((await mario.post('/udt/challenges', body({ to: anaId, at: at('20:30') }))).status).toBe(
      201,
    );
    const ana2 = await mario.post(
      '/udt/challenges',
      body({ to: anaId, at: at('18:30', '2026-11-28') }),
    );
    expect(ana2.status).toBe(409);
    expect(ana2.body.key).toBe('at most {max} challenges can wait for an answer at once');
    // Monster Hunt needs five bots in both lineups.
    const mh = await tim.post('/udt/challenges', body({ to: anaId, mode: 'mh', at: at('18:15') }));
    expect(mh.status).toBe(409);
    expect(mh.body.key).toBe('Monster Hunt needs {n} bots in your lineup');
  });

  it('fills the servers: two challenges at once, a third start is full', async () => {
    const { mario, ana, timId, marioId } = await setup(3);
    await mario.post('/udt/challenges', body({ to: timId, at: at('18:00') }));
    const busy = await ana.post('/udt/challenges', body({ to: timId, at: at('18:00') }));
    expect(busy.body.key).toBe('the other team plays another challenge then');
    const dan = await Client.login(api!, 'Dan');
    await dan.post('/udt/team', { name: 'Dawn', tag: '[DW]', starter: { name: 'D1' } });
    expect(
      (
        await ana.post(
          '/udt/challenges',
          body({ to: (await dan.get('/me')).body.id, at: at('18:00') }),
        )
      ).status,
    ).toBe(201);
    // Two challenges at 19:00 (setting "servers" 2, though the pool has three).
    const eve = await Client.login(api!, 'Eve');
    await eve.post('/udt/team', { name: 'Eden', tag: '[ED]', starter: { name: 'E1' } });
    const s = await eve.get(`/udt/challenges/slots?opponent=${marioId}`);
    expect(s.body.days[0].starts[0]).toMatchObject({ time: '19:00', state: 'opponent' });
    const s2 = await eve.get('/udt/challenges/slots');
    expect(s2.body.days[0].starts[0]).toMatchObject({ time: '19:00', state: 'full' });
    expect(s2.body.days[0].starts[1]).toMatchObject({ time: '19:15', state: 'free' });
  });

  it('answers with a counter offer, an open challenge is taken by the first', async () => {
    const { mario, tim, ana, marioId, timId, free } = await setup();
    const sent = await mario.post('/udt/challenges', body({ to: timId, stake: 1000 }));
    const counter = await tim.post(`/udt/challenges/${sent.body.id}/counter`, body({ stake: 400 }));
    expect(counter.status, JSON.stringify(counter.body)).toBe(201);
    expect(free(marioId)).toBe(0); // his stake came back
    expect(free(timId)).toBe(400);
    const mine = await mario.get('/udt/challenges');
    expect(mine.body.incoming[0]).toMatchObject({ round: 2, stake: 400, counterOf: sent.body.id });
    expect(mine.body.recent[0]).toMatchObject({ id: sent.body.id, status: 'countered' });
    expect((await mario.post(`/udt/challenges/${counter.body.id}/accept`)).status).toBe(200);
    // Open challenge: every manager sees it, the first to accept plays.
    const open = await ana.post(
      '/udt/challenges',
      body({ to: null, open: 'all', at: at('20:00'), stake: 0 }),
    );
    expect(open.status, JSON.stringify(open.body)).toBe(201);
    expect((await tim.get('/udt/challenges')).body.open.map((c: { id: string }) => c.id)).toEqual([
      open.body.id,
    ]);
    expect((await tim.post(`/udt/challenges/${open.body.id}/accept`)).status).toBe(200);
    const taken = await mario.post(`/udt/challenges/${open.body.id}/accept`);
    expect(taken.status).toBe(409);
  });

  it('checks the window: it ends after it starts; with the league off anything goes', async () => {
    const { admin } = await setup();
    const league = { enabled: true, slotTime: '22:00', slotDays: [0, 1, 2, 3, 4, 5] };
    // 19:00-22:00 ends when the evening starts: fine (the league itself may not fit the season).
    const ok = await admin.put('/settings/udt', {
      challenge: { enabled: true, from: '19:00', to: '22:00' },
    });
    expect(ok.status).toBe(200);
    const clash = await admin.put('/settings/udt', {
      league: { ...league, enabled: false },
      challenge: { enabled: true, from: '20:00', to: '23:00' },
    });
    expect(clash.status).toBe(200); // the league is off
    const r = await admin.put('/settings/udt', {
      challenge: { enabled: true, from: '23:30', to: '23:00' },
    });
    expect(r.status).toBe(400);
    expect(r.body.key).toBe('the challenge window must end after it starts ({from} - {to})');
  });
});

describe('challenge window and league', () => {
  it('refuses a window into the league evening when the league is on', async () => {
    const { admin, db } = await setup();
    // The league on at 22:00 (stored directly: its own fit check needs a league season).
    const svc = api!.app.get(SettingsService);
    const udt = svc.get().udt;
    udt.league = { ...udt.league, enabled: true, slotTime: '22:00', slotDays: [0, 1, 2, 3, 4, 5] };
    db.update(settings)
      .set({ valueJson: JSON.stringify(udt) })
      .where(eq(settings.key, 'udt'))
      .run();
    svc.version++;
    expect(
      (
        await admin.put('/settings/udt', {
          challenge: { enabled: true, from: '19:00', to: '22:00' },
        })
      ).status,
    ).toBe(200);
    expect(svc.get().udt.league.enabled).toBe(true);
    const r = await admin.put('/settings/udt', {
      challenge: { enabled: true, from: '21:00', to: '23:00' },
    });
    expect(r.status).toBe(409);
    expect(r.body.key).toBe(
      'the challenge window {from} - {to} runs into the league evening at {time}',
    );
    // The admin tab draws the evening and the limits (decision 339).
    const v = await admin.get('/udt/challenges/admin');
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    expect(v.body).toMatchObject({
      league: { enabled: true, days: [0, 1, 2, 3, 4, 5], time: '22:00' },
      pool: 2,
      booked: 0,
    });
    expect(v.body.league.minutes).toBeGreaterThan(15);
    const mario = await Client.login(api!, 'Mario');
    const rules = (await mario.get('/udt/challenges')).body.rules;
    expect(v.body.stakeCap).toBe(rules.stakeCap);
    expect(v.body.recordBonus).toBe(rules.mh.recordBonus);
    expect((await mario.get('/udt/challenges/admin')).status).toBe(403);
  });
});

describe('challenge matches (decision 335)', () => {
  /** Setup with the test mode (simulated games) and library bots for the rosters. */
  async function played(env: Record<string, string> = {}, out?: DiscordOut) {
    const ctx = await setup(2, { TEST_MODE: 'true', ...env }, out);
    for (let i = 1; i <= 12; i++)
      await ctx.admin.post('/bots', { name: `Lib${i}`, skill: 1 + (i % 6) });
    const svc = api!.app.get(UdtChallengesService);
    const tours = api!.app.get(TournamentsService);
    const row = (id: string) =>
      ctx.db.select().from(udtChallenges).where(eq(udtChallenges.id, id)).get()!;
    const roster = (u: string) =>
      ctx.db
        .select()
        .from(udtRoster)
        .where(and(eq(udtRoster.season, 1), eq(udtRoster.userId, u)))
        .all();
    /** Gives a manager `n` more library bots in the lineup of a mode (from place 2, or 1). */
    const libs = ((await ctx.admin.get('/bots')).body.bots as { id: string }[]).map((b) => b.id);
    let next = 0;
    const give = (u: string, n: number, slot: 'dmSlot' | 'mhSlot', from = 2) => {
      for (let i = 0; i < n; i++)
        ctx.db
          .insert(udtRoster)
          .values({
            season: 1,
            botId: libs[next++]!,
            userId: u,
            price: 100,
            acquiredAt: 'x',
            [slot]: from + i,
          })
          .run();
    };
    /** Books and accepts a challenge, moves the clock to its lock and ticks. */
    const book = async (over: Record<string, unknown> = {}) => {
      const sent = await ctx.mario.post('/udt/challenges', body({ to: ctx.timId, ...over }));
      expect(sent.status, JSON.stringify(sent.body)).toBe(201);
      const acc = await ctx.tim.post(`/udt/challenges/${sent.body.id}/accept`);
      expect(acc.status, JSON.stringify(acc.body)).toBe(200);
      return sent.body.id as string;
    };
    const toLock = (id: string) => {
      ctx.clock.advance(Date.parse(row(id).scheduledAt) - 60 * 60_000 - ctx.clock.now());
      svc.tick();
      return row(id);
    };
    return { ...ctx, svc, tours, row, roster, give, book, toLock };
  }

  it('locks the lineups, opens the bets, pays the pot and tires the bots (no money, no XP)', async () => {
    const { admin, mario, ana, marioId, timId, free, svc, tours, row, roster, book, toLock, db } =
      await played();
    const id = await book({ teamSize: 1, stake: 500 });
    // Before the lock: nothing to play yet.
    svc.tick();
    expect(row(id).status).toBe('accepted');
    const c = toLock(id);
    expect(c.status).toBe('locked');
    const t = tours.get(c.tournamentId!)!;
    expect(t.phase).toBe('seeded');
    expect(t.agentId).toBe(c.agentId);
    expect(JSON.parse(t.udtJson!).challenge).toEqual({ id });
    expect(tours.settings(t)).toMatchObject({ format: 'fixtures', size: 2, teamSize: 1 });
    // Not among the cups (decision 337).
    const cups = (await mario.get('/udt/events')).body as { id: string }[];
    expect(cups.map((x) => x.id)).not.toContain(t.id);
    const proj = api!.app.get(EventLogService).projection(t.id)!;
    expect(proj.bracket?.definition.slots).toEqual([`udt-${marioId}`, `udt-${timId}`]);
    // Bets are open: the two managers cannot bet on their own match, Ana can.
    const match = proj.bracket!.matches[0]!.id;
    const own = await mario.req('PUT', `/bets/tournaments/${t.id}/${match}`, {
      pick: `udt-${marioId}`,
      amount: 50,
    });
    expect(own.status).toBe(403);
    const bet = await ana.req('PUT', `/bets/tournaments/${t.id}/${match}`, {
      pick: `udt-${timId}`,
      amount: 50,
    });
    expect(bet.status, JSON.stringify(bet.body)).toBe(200);
    const before = new Map(
      [...roster(marioId), ...roster(timId)].map((r) => [r.botId, r] as const),
    );
    // Played (the test mode decides it by strength).
    const sim = await admin.post(`/udt/test/simulate/${t.id}`);
    expect(sim.status, JSON.stringify(sim.body)).toBe(200);
    const done = row(id);
    expect(done.status).toBe('played');
    const winner = done.winnerUser!;
    const loser = winner === marioId ? timId : marioId;
    // The pot of 1000 less 5 %: the winner is 450 up, the loser 500 down.
    expect(free(winner)).toBe(-450);
    expect(free(loser)).toBe(500);
    // Stamina as in a cup, no experience, no games counted; no game money or place reward.
    for (const r of [...roster(marioId), ...roster(timId)]) {
      const b = before.get(r.botId)!;
      expect(r.stamina).toBeLessThan(b.stamina);
      expect(r.xp).toBe(b.xp);
      expect(r.games).toBe(b.games);
    }
    const paid = db
      .select()
      .from(neuroLedger)
      .all()
      .filter((l) => (l.metaJson ?? '').includes(t.id));
    expect(paid.filter((l) => l.kind !== 'bet').map((l) => l.kind)).toEqual([]);
    expect(api!.app.get(UdtRewardsService).table(1)).toEqual([]);
    // Settled once: another tick changes nothing.
    svc.tick();
    expect(free(winner)).toBe(-450);
    // The list shows it with its winner.
    const recent = (await mario.get('/udt/challenges')).body.recent;
    expect(recent[0]).toMatchObject({ id, status: 'played', winner, tournamentId: t.id });
    // Record, rivalry, evenings, calendar, archive, yearbook (decision 338).
    const rec = (await api!.app.get(UdtChallengesService).record({ id: winner } as never)) as {
      won: number;
      lost: number;
      net: number;
      rivals: { userId: string; won: number; net: number }[];
    };
    expect(rec).toMatchObject({ won: 1, lost: 0, net: 450 });
    expect(rec.rivals[0]).toMatchObject({ userId: loser, won: 1, net: 450 });
    const riv = await mario.get(`/udt/rivalry/${timId}`);
    expect(riv.body.challenges).toEqual({
      won: winner === marioId ? 1 : 0,
      lost: winner === marioId ? 0 : 1,
      net: winner === marioId ? 450 : -500,
    });
    expect(riv.body).toMatchObject({ league: { won: 0, lost: 0 }, rival: false });
    const eve = await mario.get('/udt/challenges/evenings');
    expect(eve.status, JSON.stringify(eve.body)).toBe(200);
    expect(eve.body.days[0]).toMatchObject({ main: id, items: [{ id, status: 'played' }] });
    const cal = await mario.get('/calendar?from=2026-11-26&to=2026-11-28');
    const items = cal.body.items as { kind: string; link: string; mine: boolean }[];
    expect(items.find((x) => x.kind === 'challengeEvening')).toMatchObject({ mine: true });
    expect(items.some((x) => x.link === `/t/${t.id}`)).toBe(false);
    const archive = await admin.get('/tournaments?scope=done&kind=udt');
    expect(archive.status).toBe(200);
    expect(JSON.stringify(archive.body)).not.toContain(t.id);
    const all = await admin.get('/tournaments?scope=done');
    expect(JSON.stringify(all.body)).toContain(t.id);
    const yb = await mario.get('/udt/yearbook');
    expect(yb.body.challengeRecords).toEqual([]);
  });

  it('a team that cannot field its lineup loses without a game; neither: called off', async () => {
    const { marioId, timId, free, give, book, toLock } = await played();
    // 3v3: Mario has three bots, Tim only his starter.
    give(marioId, 2, 'dmSlot');
    const id = await book({ teamSize: 3, stake: 300 });
    const c = toLock(id);
    expect(c).toMatchObject({ status: 'played', reason: 'forfeit', winnerUser: marioId });
    expect(c.tournamentId).toBeNull();
    expect(free(marioId)).toBe(-270); // 600 less 5 %, his 300 back with it
    expect(free(timId)).toBe(300);
    // 5v5: nobody has five bots.
    const two = await book({ teamSize: 5, stake: 200, at: at('20:00') });
    expect(toLock(two)).toMatchObject({ status: 'void', reason: 'lineups' });
    expect(free(marioId)).toBe(-270);
    expect(free(timId)).toBe(300);
  });

  it('calls a challenge off when its tournament cannot start in time, stakes back', async () => {
    const { marioId, timId, free, svc, tours, row, book, toLock, clock } = await played();
    const id = await book({ teamSize: 1, stake: 400 });
    const c = toLock(id);
    expect(free(marioId)).toBe(400);
    // The servers are offline: it waits while the game would still end in the window (by 22:00,
    // a quarter of an hour at least), then it is called off.
    clock.advance(Date.parse(at('20:45')) - clock.now());
    svc.tick();
    expect(row(id).status).toBe('locked');
    clock.advance(60_000);
    svc.tick();
    expect(tours.get(c.tournamentId!)!.phase).toBe('aborted');
    expect(row(id)).toMatchObject({ status: 'void', reason: 'aborted' });
    expect(free(marioId)).toBe(0);
    expect(free(timId)).toBe(0);
  });

  it('offers a rematch: the other way round, same stake, once', async () => {
    const { admin, mario, tim, marioId, timId, row, book, toLock } = await played();
    const id = await book({ teamSize: 1, stake: 200 });
    const c = toLock(id);
    expect((await mario.post(`/udt/challenges/${id}/rematch`, { at: at('20:30') })).status).toBe(
      409,
    );
    await admin.post(`/udt/test/simulate/${c.tournamentId}`);
    expect(row(id).status).toBe('played');
    const re = await tim.post(`/udt/challenges/${id}/rematch`, { at: at('20:30') });
    expect(re.status, JSON.stringify(re.body)).toBe(201);
    expect(row(re.body.id)).toMatchObject({
      fromUser: timId,
      toUser: marioId,
      stake: 200,
      teamSize: 1,
      rematchOf: id,
    });
    const again = await mario.post(`/udt/challenges/${id}/rematch`, { at: at('20:45') });
    expect(again.body.key).toBe('a rematch of this challenge is booked already');
  });

  it('keeps a team with a booked challenge out of a cup at that time (from the lock)', async () => {
    const { admin, mario, tim, ana, book } = await played();
    await book({ teamSize: 1, stake: 0 }); // 19:30 Berlin, locked from 18:30
    // A cup of four (three games, about 18 minutes) at 18:20 runs into the lock.
    const cup = (scheduledAt: string) =>
      admin.post(
        '/tournaments',
        tournamentBody(
          { name: `Cup ${scheduledAt}`, botPool: [], kind: 'udt', scheduledAt, agentId: 's2' },
          { size: 4, format: 'single', teamSize: 1 },
        ),
      );
    const late = await cup(at('17:20'));
    expect(late.status, JSON.stringify(late.body)).toBe(201);
    const r = await mario.post(`/udt/events/${late.body.id}/enter`);
    expect(r.status).toBe(409);
    expect(r.body.key).toBe('your team plays a challenge then');
    expect((await tim.post(`/udt/events/${late.body.id}/enter`)).status).toBe(409);
    expect((await ana.post(`/udt/events/${late.body.id}/enter`)).status).toBe(200);
    // One that ends before the lock is fine.
    const early = await cup(at('17:05'));
    expect((await mario.post(`/udt/events/${early.body.id}/enter`)).status).toBe(200);
  });

  it('checks the map against the pool', async () => {
    const { mario, timId, svc } = await played();
    const pool = svc.mapPool('dm');
    const bad = await mario.post('/udt/challenges', body({ to: timId, map: 'DM-Nowhere' }));
    expect(bad.status).toBe(409);
    expect(bad.body.key).toBe('the map {map} is not in the pool');
    const ok = await mario.post(
      '/udt/challenges',
      body({ to: timId, map: pool[1]!.toLowerCase(), teamSize: 1 }),
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.outgoing[0].map).toBe(pool[1]); // the pool's spelling
    expect(ok.body.rules.maps.dm).toEqual(pool);
  });

  it('tells Discord: new, answer, reminder, bets open, result, expiry (decision 339)', async () => {
    const { out, posts, dms } = recorder();
    const { admin, marioId, timId, mario, tim, svc, row, book, toLock, clock, db } = await played(
      DISCORD,
      out,
    );
    const ids = { [marioId]: '300000000000000001', [timId]: '300000000000000002' };
    for (const [u, d] of Object.entries(ids))
      db.update(users).set({ discordId: d }).where(eq(users.id, u)).run();
    const to = (u: string) => dms.filter((d) => d.to === ids[u]).map((d) => d.text);
    // A challenge and its answer: Tim hears of it, Mario of the answer, the channel of the match.
    const id = await book({ teamSize: 1, stake: 500 });
    expect(to(timId)).toEqual([expect.stringContaining('**Nexus** fordert dein Team heraus')]);
    expect(to(timId)[0]).toContain('1v1 Deathmatch · Bo1');
    expect(to(marioId)).toEqual([expect.stringContaining('**Iron** nimmt deine Challenge an')]);
    expect(to(marioId)[0]).toContain('500 N');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.embeds![0]).toMatchObject({ title: '⚔️ Nexus fordert Iron heraus' });
    expect(JSON.stringify(posts[0])).toContain('Topf 1.000 N · Sieger 950 N');
    // A second one Tim declines; a third one waits and expires.
    const two = await mario.post('/udt/challenges', body({ to: timId, at: at('20:00'), stake: 0 }));
    expect((await tim.post(`/udt/challenges/${two.body.id}/decline`)).status).toBe(200);
    expect(to(marioId).at(-1)).toContain('**Iron** lehnt deine Challenge ab');
    const three = await mario.post(
      '/udt/challenges',
      body({ to: timId, teamSize: 1, at: at('20:30'), stake: 0 }),
    );
    expect(three.status, JSON.stringify(three.body)).toBe(201);
    expect(to(timId).at(-1)).toContain('Freundschaftsspiel');
    // Half an hour before the lock both managers are reminded, once.
    const lock = Date.parse(row(id).scheduledAt) - 60 * 60_000;
    clock.advance(lock - 31 * 60_000 - clock.now());
    svc.tick();
    expect(to(timId).filter((t) => t.startsWith('⏰'))).toEqual([]);
    clock.advance(2 * 60_000);
    svc.tick();
    svc.tick();
    expect(to(marioId).filter((t) => t.startsWith('⏰'))).toEqual([
      expect.stringContaining('gegen **Iron**'),
    ]);
    expect(to(timId).filter((t) => t.startsWith('⏰'))).toEqual([
      expect.stringContaining('gegen **Nexus**'),
    ]);
    // The lock opens the bets in the channel (until the start).
    const c = toLock(id);
    expect(c.status).toBe('locked');
    expect(posts.at(-1)!.embeds![0]).toMatchObject({ title: '🎲 Wetten offen: Nexus vs Iron' });
    expect(posts.at(-1)!.embeds![0]!.description).toContain('Wetten bis zum Start');
    const before = posts.length;
    await admin.post(`/udt/test/simulate/${c.tournamentId}`);
    const done = row(id);
    expect(done.status).toBe('played');
    // Only the challenge's own result (no generic check-in, match or champion post).
    const after = posts.slice(before).map((p) => p.embeds![0]!);
    const result = after.find((e) => /schlägt|kampflos/.test(e.title ?? ''));
    expect(result, JSON.stringify(after)).toBeDefined();
    const [w, l] = done.winnerUser === marioId ? ['Nexus', 'Iron'] : ['Iron', 'Nexus'];
    expect(result!.title).toContain(`${w} schlägt ${l}`);
    expect(JSON.stringify(result)).toContain('950 N');
    expect(after.filter((e) => !/Wetten|schlägt|kampflos/.test(e.title ?? ''))).toEqual([]);
    // The third one expires at its deadline: Mario's stake (none) is back, he hears it.
    clock.advance(Date.parse(row(three.body.id).expiresAt) + 1000 - clock.now());
    svc.tick();
    expect(row(three.body.id).status).toBe('expired');
    expect(to(marioId).at(-1)).toContain('an **Iron** ist ohne Antwort abgelaufen');
  });

  it('without a game: the forfeit in the channel, a called-off one by message (decision 339)', async () => {
    const { out, posts, dms } = recorder();
    const { marioId, db, book, toLock, give } = await played(DISCORD, out);
    db.update(users).set({ discordId: '300000000000000001' }).where(eq(users.id, marioId)).run();
    // 3v3: Tim cannot field three, Mario wins without a game.
    give(marioId, 2, 'dmSlot');
    const id = await book({ teamSize: 3, stake: 300 });
    expect(toLock(id).status).toBe('played');
    expect(posts.at(-1)!.embeds![0]).toMatchObject({
      title: '⏭️ Nexus gewinnt kampflos gegen Iron',
    });
    // 5v5: neither can, called off; Mario hears why.
    const two = await book({ teamSize: 5, stake: 200, at: at('20:00') });
    expect(toLock(two).status).toBe('void');
    expect(dms.at(-1)!.text).toBe(
      '🚫 Die Challenge gegen **Iron** fällt aus (keine gültige Aufstellung). Die Einsätze sind zurück.',
    );
  });

  it('Monster Hunt: five bots each, no fee, the record bonus for beating the season record', async () => {
    const { out, posts } = recorder();
    const { admin, mario, marioId, timId, free, svc, tours, row, give, book, toLock, db } =
      await played(DISCORD, out);
    for (const u of [marioId, timId]) {
      db.update(udtRoster).set({ mhSlot: null }).where(eq(udtRoster.userId, u)).run();
      give(u, 5, 'mhSlot', 1);
    }
    vi.spyOn(svc, 'mapPool').mockImplementation((m) =>
      m === 'mh' ? ['MH-Lonely'] : ['DM-Deck16]['],
    );
    const id = await book({ mode: 'mh', map: 'MH-Lonely', hardness: 'hard', stake: 500 });
    const c = toLock(id);
    expect(c.status).toBe('locked');
    const t = tours.get(c.tournamentId!)!;
    expect(tours.settings(t)).toMatchObject({
      teamSize: 5,
      game: {
        adapter: 'ut99-mh',
        rules: { monsterSkill: 6, lives: 3, penaltySec: 8, mapPool: ['MH-Lonely'] },
      },
    });
    // The statistics: the challenge's best run beat the season record of MH-Lonely on skill 6.
    const stats = api!.app.get(StatsService);
    vi.spyOn(stats, 'mapRecords').mockReturnValue([
      { map: 'MH-Lonely', monsterSkill: 6, finalMs: 600_000 } as never,
    ]);
    vi.spyOn(stats, 'udtFacts').mockReturnValue([
      {
        tournamentId: t.id,
        runs: [
          {
            entrantId: `udt-${timId}`,
            map: 'MH-Lonely',
            monsterSkill: 6,
            finalMs: 580_000,
            finished: true,
            forfeit: false,
          },
        ],
      } as never,
    ]);
    await admin.post(`/udt/test/simulate/${t.id}`);
    const done = row(id);
    expect(done.status).toBe('played');
    // The bonus: 300 at the index (Tim's run); no fee, the winner takes the whole pot.
    const bonus = (await mario.get('/udt/challenges')).body.rules.mh.recordBonus as number;
    const rows = db
      .select()
      .from(neuroLedger)
      .all()
      .filter((l) => l.kind === 'udt_challenge_record');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: timId, amount: bonus });
    const winner = done.winnerUser!;
    expect(free(winner)).toBe(winner === timId ? -500 - bonus : -500);
    expect(free(marioId) + free(timId)).toBe(-bonus);
    // Discord: the showcase when accepted, the new record after the race (decision 339).
    const titles = posts.map((p) => p.embeds?.[0]?.title ?? '');
    expect(titles[0]).toBe('👹 Monster-Hunt-Showcase: Nexus gegen Iron');
    expect(JSON.stringify(posts[0])).toContain('Hart');
    expect(titles).toContain('🏆 Neuer Rekord auf MH-Lonely: 9:40.0');
    expect(JSON.stringify(posts)).toContain('vorher 10:00.0');
    // The yearbook names the record (decision 338).
    const yb = await mario.get('/udt/yearbook');
    expect(yb.body.challengeRecords).toEqual([
      expect.objectContaining({ map: 'MH-Lonely', finalMs: 580_000 }),
    ]);
  });
});

describe('AI managers in challenges (decision 336)', () => {
  /** Two AI managers with a team (tactician, gambler), the test mode on. */
  async function withAi(ai = true) {
    const ctx = await setup(2, { TEST_MODE: 'true' });
    const put = await ctx.admin.put('/settings/udt', {
      enabled: true,
      aiEnabled: true,
      aiCount: 2,
      challenge: { enabled: true, ai },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const aiSvc = api!.app.get(UdtAiService);
    aiSvc.ensure(1);
    const [tactician, gambler] = aiSvc.managers().map((m) => m.user.id);
    const svc = api!.app.get(UdtChallengesService);
    const row = (id: string) =>
      ctx.db.select().from(udtChallenges).where(eq(udtChallenges.id, id)).get()!;
    const act = async () => {
      const r = await ctx.admin.post('/udt/test/challenges/act');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body as { answered: number; offered: number };
    };
    return { ...ctx, aiSvc, svc, row, act, tactician: tactician!, gambler: gambler! };
  }

  it('an AI manager accepts with a good chance, declines with a bad one, after a while', async () => {
    const { mario, svc, row, aiSvc, tactician, gambler, clock } = await withAi();
    const chance = vi.spyOn(svc, 'chance').mockReturnValue(0.55);
    const one = await mario.post('/udt/challenges', body({ to: gambler, teamSize: 1, stake: 0 }));
    expect(one.status, JSON.stringify(one.body)).toBe(201);
    // Not at once: 15 to 120 minutes later.
    aiSvc.answerChallenges(clock.now());
    expect(row(one.body.id).status).toBe('pending');
    clock.advance(121 * 60_000);
    svc.tick();
    expect(row(one.body.id).status).toBe('accepted');
    // The tactician needs 0.50: with 0.45 it says no (no stake: no counter offer).
    chance.mockReturnValue(0.45);
    const two = await mario.post(
      '/udt/challenges',
      body({ to: tactician, teamSize: 1, stake: 0, at: at('20:00') }),
    );
    expect(two.status, JSON.stringify(two.body)).toBe(201);
    clock.advance(121 * 60_000);
    svc.tick();
    expect(row(two.body.id).status).toBe('declined');
  });

  it('a stake above its share of the free Neuro is a no; tacticians may offer half', async () => {
    const { mario, svc, row, act, tactician, gambler, ledger } = await withAi();
    vi.spyOn(svc, 'chance').mockReturnValue(0.9);
    // The gambler spends at most 60 % of its free Neuro.
    const free = ledger.spendable(gambler).spendable;
    const stake = Math.min(1000, Math.floor((free * 0.6) / 10) * 10 + 100);
    expect(stake).toBeGreaterThanOrEqual(100);
    const big = await mario.post('/udt/challenges', body({ to: gambler, teamSize: 1, stake }));
    expect(big.status, JSON.stringify(big.body)).toBe(201);
    // The tactician (40 %) with a stake it cannot take: declined or half as a counter offer.
    const tFree = ledger.spendable(tactician).spendable;
    const tStake = Math.min(1000, Math.floor((tFree * 0.4) / 10) * 10 + 200);
    const t = await mario.post(
      '/udt/challenges',
      body({ to: tactician, teamSize: 1, stake: tStake, at: at('20:00') }),
    );
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect((await act()).answered).toBe(2);
    expect(row(big.body.id).status).toBe('declined');
    const answered = row(t.body.id);
    expect(['declined', 'countered']).toContain(answered.status);
    if (answered.status === 'countered') {
      const offer = (await mario.get('/udt/challenges')).body.incoming[0];
      expect(offer).toMatchObject({ counterOf: t.body.id, stake: Math.floor(tStake / 20) * 10 });
    }
  });

  it('an AI manager takes an open challenge it likes; AI managers challenge humans', async () => {
    const { mario, svc, row, act, marioId } = await withAi();
    vi.spyOn(svc, 'chance').mockReturnValue(0.5);
    const open = await mario.post(
      '/udt/challenges',
      body({ to: null, open: 'all', teamSize: 1, stake: 0 }),
    );
    expect(open.status, JSON.stringify(open.body)).toBe(201);
    const r = await act();
    expect(r.answered).toBe(1);
    expect(row(open.body.id).status).toBe('accepted');
    // Both offered one (0.5 lies in their band 0.45-0.60): to Tim, Ana or Mario.
    expect(r.offered).toBe(2);
    const sent = api!.app
      .get<Db>(DB)
      .select()
      .from(udtChallenges)
      .all()
      .filter((c) => c.status === 'pending');
    expect(sent).toHaveLength(2);
    const pool = svc.mapPool('dm');
    for (const c of sent) {
      expect(c).toMatchObject({ mode: 'dm', bestOf: 1, teamSize: 1 });
      expect(pool).toContain(c.map);
      expect(c.stake % 10).toBe(0);
      // Sent by the AI managers (Mario's open one is taken).
      expect(c.fromUser).not.toBe(marioId);
    }
    // A chance outside the band: no challenge.
    vi.spyOn(svc, 'chance').mockReturnValue(0.7);
    expect((await act()).offered).toBe(0);
  });

  it('does nothing with the switch "AI managers in challenges" off', async () => {
    const { mario, row, act, gambler } = await withAi(false);
    const r = await mario.post('/udt/challenges', body({ to: gambler, teamSize: 1, stake: 0 }));
    expect(r.status).toBe(409);
    expect(r.body.key).toBe('the AI managers are switched off');
    const open = await mario.post(
      '/udt/challenges',
      body({ to: null, open: 'all', teamSize: 1, stake: 0 }),
    );
    expect(await act()).toEqual({ answered: 0, offered: 0 });
    expect(row(open.body.id).status).toBe('pending');
  });
});
