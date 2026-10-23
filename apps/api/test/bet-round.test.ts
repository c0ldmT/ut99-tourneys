import { describe, expect, it } from 'vitest';
import { BetRound } from '../src/bets/bets.service.js';
import type { Bailout, Bet, SettledBet } from '../src/bets/betting.js';

let n = 0;
const bet = (userId: string, tournamentId: string, matchId: string, amount = 10): Bet => ({
  id: `b${++n}`,
  season: 1,
  tournamentId,
  matchId,
  kind: 'winner',
  userId,
  pick: 'e1',
  amount,
  allIn: false,
  placedAt: `2026-10-01T00:00:${String(n).padStart(2, '0')}.000Z`,
});

/** A settlement that shows the pool it saw: payout = number of bets in the match. */
const settle = (list: readonly Bet[]): SettledBet[] =>
  list.map((b) => ({ ...b, status: 'won' as const, payout: list.length }));

/** What `wallet` reads: the season's list in row order, settled per match, filtered. */
function expected(rows: readonly Bet[], bettor: string): SettledBet[] {
  const byMatch = new Map<string, Bet[]>();
  for (const b of rows) {
    const k = `${b.tournamentId}/${b.matchId}`;
    byMatch.set(k, [...(byMatch.get(k) ?? []), b]);
  }
  return [...byMatch.values()].flatMap((l) => settle(l).filter((b) => b.userId === bettor));
}

describe('a round of bot bets', () => {
  it('reads every bettor like wallet does, with the bets and rescues of the round', () => {
    // Rows out of match order: the order of a bettor's matches is the row of their first bet.
    const rows = [
      bet('bot:a', 'old', 'W1-2'),
      bet('bot:b', 'old', 'W1-1'),
      bet('bot:a', 'cur', 'W1-1'),
      bet('u1', 'old', 'W1-2'),
      bet('bot:a', 'old', 'W1-1'),
      bet('bot:b', 'cur', 'W1-2'),
    ];
    const bailouts: Bailout[] = [
      { userId: 'bot:a', amount: 5, at: '2026-10-01T00:01:00.000Z' },
      { userId: 'u1', amount: 7, at: '2026-10-01T00:02:00.000Z' },
    ];
    const ledger: Bailout[] = [{ userId: 'u1', amount: -3, at: '2026-10-01', kind: 'udt_buy' }];
    const round = new BetRound(
      'cur',
      {
        bets: rows.map((b, i) => ({ ...b, rid: 10 + i * 3 })),
        bailouts,
        spends: [],
        ledger,
        rulesFrom: '2026-09-01',
      },
      settle,
    );
    for (const who of ['bot:a', 'bot:b', 'u1', 'bot:nobody'])
      expect(round.parts(who).settled).toEqual(expected(rows, who));
    expect(round.parts('bot:a').bailouts).toEqual([bailouts[0]]);
    expect(round.parts('u1').ledger).toEqual(ledger);
    expect(round.parts('bot:nobody')).toEqual({
      settled: [],
      bailouts: [],
      spends: [],
      ledger: [],
      rulesFrom: '2026-09-01',
    });

    // The round bets on the current tournament: an existing match and a new one.
    const added = [
      bet('bot:b', 'cur', 'W1-1'),
      bet('bot:c', 'cur', 'W2-1'),
      bet('bot:a', 'cur', 'W2-1'),
    ];
    for (const b of added) round.addBet(b);
    round.addBailout({ userId: 'bot:c', amount: 4, at: '2026-10-01T00:03:00.000Z' });
    const all = [...rows, ...added];
    for (const who of ['bot:a', 'bot:b', 'bot:c', 'u1'])
      expect(round.parts(who).settled).toEqual(expected(all, who));
    expect(round.parts('bot:c').bailouts).toEqual([
      { userId: 'bot:c', amount: 4, at: '2026-10-01T00:03:00.000Z' },
    ]);
  });
});
