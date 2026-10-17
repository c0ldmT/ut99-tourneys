import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { betRecords, settleMatch, wallets, type Bet, type MatchBook } from '../src/bets/betting.js';
import { EventLogService } from '../src/tournaments/event-log.service.js';
import { Client, startApi, startSeason, tournamentBody } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const bet = (userId: string, pick: string, amount: number, extra: Partial<Bet> = {}): Bet => ({
  id: `${userId}-${pick}`,
  season: 1,
  tournamentId: 't',
  matchId: 'M',
  kind: 'winner',
  userId,
  pick,
  amount,
  allIn: false,
  placedAt: '2026-10-17T20:00:00.000Z',
  ...extra,
});
const book = (over: Partial<MatchBook> = {}): MatchBook => ({
  matchId: 'M',
  entrants: ['a', 'b'],
  state: 'settled',
  winnerId: 'a',
  settledAt: '2026-10-17T21:00:00.000Z',
  participants: ['pa', 'pb'],
  ...over,
});

describe('betting (pure)', () => {
  it('pays pari-mutuel, rounded down; refunds when one side is empty or no game was played', () => {
    const bets = [bet('u1', 'a', 600), bet('u2', 'a', 300), bet('u3', 'b', 250)];
    const s = settleMatch(book(), bets);
    // Winners share 250 by 600:300.
    expect(s.map((b) => [b.userId, b.status, b.payout])).toEqual([
      ['u1', 'won', 766],
      ['u2', 'won', 383],
      ['u3', 'lost', 0],
    ]);
    expect(settleMatch(book(), [bet('u1', 'a', 100)])[0]).toMatchObject({
      status: 'refunded',
      payout: 100,
    });
    expect(
      settleMatch(book({ state: 'refunded' }), bets).every((b) => b.status === 'refunded'),
    ).toBe(true);
    expect(settleMatch(book({ state: 'closed' }), bets)[0]!.status).toBe('open');
    // A pick no longer in the match (organizer correction) and players of the match: refunded.
    const odd = settleMatch(book(), [...bets, bet('u4', 'x', 50), bet('pa', 'b', 50)]);
    expect(odd.slice(3).map((b) => b.status)).toEqual(['refunded', 'refunded']);
    expect(odd[0]!.payout).toBe(766);
  });

  it('keeps wallets in time order with rescues, streaks and records', () => {
    const at = (h: number) => `2026-10-17T${String(h).padStart(2, '0')}:00:00.000Z`;
    const s = [
      { ...bet('u1', 'a', 500), status: 'won' as const, payout: 1500, settledAt: at(10) },
      {
        ...bet('u1', 'a', 1500),
        status: 'lost' as const,
        payout: 0,
        settledAt: at(11),
        allIn: true,
      },
      { ...bet('u2', 'b', 100), status: 'lost' as const, payout: 0, settledAt: at(10) },
      { ...bet('u2', 'b', 100), status: 'open' as const, payout: 0 },
    ];
    const ws = wallets(s, [{ userId: 'u1', amount: 100, at: at(12) }], 1000);
    // u1: 1000 +1000 = 2000 (peak), -1500 = 500, rescue +100 = 600.
    expect(ws.get('u1')).toMatchObject({
      balance: 600,
      peak: 2000,
      bestWin: 1000,
      worstLoss: 1500,
      bestOdds: 3,
      bailouts: 1,
      profit: -500,
    });
    expect(ws.get('u2')).toMatchObject({ balance: 900, staked: 100, free: 800, open: 1 });
    const r = Object.fromEntries(betRecords(ws, s, 1000).map((x) => [x.key, x]));
    expect(r['peak']).toMatchObject({ userId: 'u1', value: 2000 });
    expect(r['bestOdds']).toMatchObject({ userId: 'u1', value: 3 });
    expect(r['biggestPool']).toMatchObject({ value: 2100 });
    expect(r['allInWin']).toBeUndefined(); // the all-in was lost
  });
});

describe('betting with Neuro', () => {
  it('opens, hides, closes, settles; no bets on own matches; rescues at the floor', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    const anna = await Client.login(api, 'Anna');
    const carl = await Client.login(api, 'Carl');
    await admin.post('/agents', { id: 'pi', name: 'Raspberry' });
    await startSeason(admin);
    const t = await admin.post(
      '/tournaments',
      tournamentBody({ name: 'Bet Cup' }, { size: 4, format: 'single' }),
    );
    const id = t.body.id as string;
    // Out of a betting phase (draft): closed.
    expect((await carl.get(`/bets/tournaments/${id}`)).body).toMatchObject({
      open: false,
      reason: 'phase',
    });
    await mario.post(`/tournaments/${id}/registration`);
    await anna.post(`/tournaments/${id}/registration`);
    const seeded = await admin.post(`/tournaments/${id}/seed`, {
      mode: 'auto',
      humanOrder: 'seeded',
      botPlacement: 'byes',
      rngSeed: 's',
    });
    expect(seeded.status, JSON.stringify(seeded.body)).toBe(200);
    const view = (await carl.get(`/bets/tournaments/${id}`)).body;
    expect(view.open).toBe(true);
    expect(view.wallet).toMatchObject({ balance: 1000, free: 1000, floor: 100 });
    const marioId = (await mario.get('/me')).body.id;
    const proj = seeded.body.projection;
    const marioEntrant = Object.values(proj.entrants).find((e: any) => e.userId === marioId) as any;
    const matches = view.matches as { matchId: string; entrants: [string, string] }[];
    const own = matches.find((m) => m.entrants.includes(marioEntrant.id))!;
    const other = matches.find((m) => m !== own)!;
    expect(other).toBeDefined();
    // Players never bet on their own match.
    expect(
      (
        await mario.req('PUT', `/bets/tournaments/${id}/${own.matchId}`, {
          pick: own.entrants[1],
          amount: 10,
        })
      ).status,
    ).toBe(403);
    expect(
      (await mario.get(`/bets/tournaments/${id}`)).body.matches.find(
        (m: any) => m.matchId === own.matchId,
      ).playing,
    ).toBe(true);

    const [a, b] = own.entrants;
    const put = (c: Client, pick: string, amount: number, m = own.matchId) =>
      c.req('PUT', `/bets/tournaments/${id}/${m}`, { pick, amount });
    expect((await put(admin, a, 600)).status).toBe(200);
    expect((await put(carl, a, 100)).status).toBe(200);
    // Free changes: other side, other amount; withdraw and place again.
    expect((await put(carl, b, 300)).status).toBe(200);
    expect((await carl.req('DELETE', `/bets/tournaments/${id}/${own.matchId}`)).status).toBe(200);
    expect((await put(carl, b, 1001)).status).toBe(400);
    const placed = (await put(carl, b, 300)).body as any;
    expect(placed.wallet).toMatchObject({ balance: 1000, staked: 300, free: 700 });
    // Pools stay hidden while bets are open.
    expect(placed.matches.find((m: any) => m.matchId === own.matchId).pools).toBeNull();

    // The match is called and starts: bets close, pools show.
    const log = api!.app.get(EventLogService);
    const append = (events: Record<string, unknown>[]) => {
      const head = log.load(id).length;
      const r = log.append(
        id,
        head,
        events.map((e) => ({ actor: { kind: 'bridge' }, ...e })),
      );
      if (!r.accepted) throw new Error(r.reason);
    };
    append([
      { type: 'checkin.opened', data: { serverProfileId: 'local' } },
      { type: 'tournament.started', data: {} },
      { type: 'match.called', data: { matchId: own.matchId, entrants: own.entrants } },
      { type: 'match.started', data: { matchId: own.matchId, game: 1 } },
    ]);
    expect((await put(carl, b, 200)).status).toBe(409);
    const closed = (await carl.get(`/bets/tournaments/${id}`)).body.matches.find(
      (m: any) => m.matchId === own.matchId,
    );
    expect(closed.state).toBe('closed');
    expect(closed.pools).toEqual({
      [a]: { amount: 600, bettors: 1 },
      [b]: { amount: 300, bettors: 1 },
    });
    append([
      {
        type: 'match.gameFinished',
        data: {
          matchId: own.matchId,
          game: 1,
          map: 'DM-Deck16][',
          scores: { [a]: 20, [b]: 5 },
          winnerId: a,
          endReason: 'fragLimit',
        },
      },
      {
        type: 'match.result',
        data: {
          result: { matchId: own.matchId, entrants: own.entrants, winnerId: a, outcome: 'played' },
        },
      },
    ]);
    const adminWallet = (await admin.get(`/bets/tournaments/${id}`)).body.wallet;
    expect(adminWallet).toMatchObject({ balance: 1300, free: 1300 }); // 600 + 600*300/600
    expect((await carl.get(`/bets/tournaments/${id}`)).body.wallet.balance).toBe(700);

    // The other match is decided without a game (no-show): stakes come back.
    const [c, d] = other.entrants;
    expect(
      ((await put(carl, c, 700, other.matchId)).body as any).matches.find(
        (m: any) => m.matchId === other.matchId,
      ).mine,
    ).toMatchObject({ amount: 700 });
    expect((await put(admin, d, 100, other.matchId)).status).toBe(200);
    append([
      {
        type: 'match.result',
        data: {
          result: {
            matchId: other.matchId,
            entrants: other.entrants,
            winnerId: c,
            outcome: 'forfeit',
          },
        },
      },
    ]);
    const carlView = (await carl.get(`/bets/tournaments/${id}`)).body;
    expect(carlView.matches.find((m: any) => m.matchId === other.matchId).mine).toMatchObject({
      status: 'refunded',
      payout: 700,
    });
    expect(carlView.wallet.balance).toBe(700);

    // Statistics: ranking, records, the player's page.
    const board = (await anna.get('/bets/leaderboard')).body;
    expect(board.rows.map((r: any) => [r.name, r.balance])).toEqual([
      ['Boss', 1300],
      ['Carl', 700],
    ]);
    const rec = (await anna.get('/bets/records')).body.records;
    expect(rec.find((r: any) => r.key === 'bestWin')).toMatchObject({ name: 'Boss', value: 300 });
    expect(rec.find((r: any) => r.key === 'biggestPool')).toMatchObject({ value: 900 });
    const carlId = (await carl.get('/me')).body.id;
    const page = (await anna.get(`/bets/users/${carlId}`)).body;
    expect(page.wallet).toMatchObject({ balance: 700, lost: 1, refunded: 1 });
    expect(page.recent).toHaveLength(2);

    // Settings: a new floor reaches the running season; a wallet below it is rescued.
    expect((await admin.req('PUT', '/settings/betting', { floor: 800 })).status).toBe(200);
    expect((await admin.req('PUT', '/settings/betting', { floor: 5000 })).status).toBe(400);
    const final = (await carl.get(`/bets/tournaments/${id}`)).body.matches.find(
      (m: any) => m.state === 'open',
    );
    const rescued = (await put(carl, final.entrants[0], 800, final.matchId)).body as any;
    expect(rescued.wallet).toMatchObject({ balance: 800, staked: 800, free: 0 });
    expect((await anna.get(`/bets/users/${carlId}`)).body.wallet).toMatchObject({
      bailouts: 1,
      bailedOut: 100,
    });
  });
});
