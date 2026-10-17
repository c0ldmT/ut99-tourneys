import { entrantUserIds, type TournamentEvent, type TournamentProjection } from '@tourney/protocol';

/**
 * Betting (pure): which matches take bets, how a match settles, and the Neuro wallets and
 * records of a season, all derived from the event logs and the stored bets. Nothing is
 * "booked" when a match ends: corrections by the organizer (overrides) settle again on their
 * own, like the statistics.
 */

/** Kinds of bets. Only the match winner for now; the data model is ready for more. */
export const BET_KINDS = ['winner'] as const;
export type BetKind = (typeof BET_KINDS)[number];

/** The state of a match for betting. */
export type BookState =
  /** Not both entrants known yet. */
  | 'waiting'
  /** Bets can be placed, changed and withdrawn. */
  | 'open'
  /** The first game started: no more changes, pools are shown. */
  | 'closed'
  /** Decided by played games: winners share the losers' pool. */
  | 'settled'
  /** Every stake goes back (no game played, called off, tournament aborted). */
  | 'refunded';

export interface MatchBook {
  matchId: string;
  entrants: [string, string] | null;
  state: BookState;
  /** When the first game started (bets closed). */
  closedAt?: string;
  winnerId?: string;
  /** When the match was decided (or refunded). */
  settledAt?: string;
  /** Website users playing in the match (players, team members and subs): no bets. */
  participants: string[];
}

/** Betting state of every match of a tournament. */
export function matchBooks(
  events: readonly TournamentEvent[],
  proj: TournamentProjection,
): Map<string, MatchBook> {
  const startedAt = new Map<string, string>();
  const resultAt = new Map<string, string>();
  let abortedAt: string | undefined;
  for (const e of events) {
    if (e.type === 'match.started' && !startedAt.has(e.data.matchId))
      startedAt.set(e.data.matchId, e.at);
    else if (e.type === 'match.result') resultAt.set(e.data.result.matchId, e.at);
    else if (e.type === 'tournament.aborted') abortedAt = e.at;
  }
  const out = new Map<string, MatchBook>();
  for (const m of proj.bracket?.matches ?? []) {
    const [a, b] = m.entrants;
    const entrants: [string, string] | null = a && b ? [a, b] : null;
    const participants = entrants
      ? entrants.flatMap((id) => {
          const e = proj.entrants[id];
          return e ? entrantUserIds(e) : [];
        })
      : [];
    const book: MatchBook = { matchId: m.id, entrants, state: 'waiting', participants };
    const closedAt = startedAt.get(m.id);
    if (closedAt) book.closedAt = closedAt;
    const played = (proj.games[m.id]?.length ?? 0) > 0;
    if (m.status === 'completed' && m.winnerId) {
      const at = resultAt.get(m.id) ?? closedAt;
      if (at) book.settledAt = at;
      if (played) {
        book.state = 'settled';
        book.winnerId = m.winnerId;
      } else book.state = 'refunded'; // no-show, simulated bot match, decided by the organizer
    } else if (m.status === 'void') {
      book.state = 'refunded';
    } else if (proj.phase === 'aborted') {
      book.state = 'refunded';
      if (abortedAt) book.settledAt = abortedAt;
    } else if (closedAt) book.state = 'closed';
    else if (entrants) book.state = 'open';
    out.set(m.id, book);
  }
  return out;
}

export interface Bet {
  id: string;
  season: number;
  tournamentId: string;
  matchId: string;
  kind: BetKind;
  userId: string;
  /** Entrant id the user backs. */
  pick: string;
  amount: number;
  /** The whole free Neuro balance was staked. */
  allIn: boolean;
  placedAt: string;
}

export type BetStatus = 'open' | 'won' | 'lost' | 'refunded';

export interface SettledBet extends Bet {
  status: BetStatus;
  /** What comes back: stake plus share (won), stake (refunded), 0 (lost); 0 while open. */
  payout: number;
  /** When it was decided. */
  settledAt?: string;
}

/**
 * Settles the bets of one match: pari-mutuel, the winners share the losers' pool in
 * proportion to their stakes (rounded down). Bets on an entrant no longer in the match (the
 * organizer corrected an earlier match), bets of players of the match and matches where one
 * side has no bets are refunded.
 */
export function settleMatch(book: MatchBook | undefined, bets: readonly Bet[]): SettledBet[] {
  const open = (b: Bet): SettledBet => ({ ...b, status: 'open', payout: 0 });
  const refund = (b: Bet): SettledBet => ({
    ...b,
    status: 'refunded',
    payout: b.amount,
    ...(book?.settledAt ? { settledAt: book.settledAt } : {}),
  });
  if (!book || book.state === 'waiting' || book.state === 'open' || book.state === 'closed')
    return bets.map(open);
  if (book.state === 'refunded' || !book.winnerId || !book.entrants) return bets.map(refund);
  const valid = (b: Bet) =>
    book.entrants!.includes(b.pick) && !book.participants.includes(b.userId);
  const win = bets.filter((b) => valid(b) && b.pick === book.winnerId);
  const lose = bets.filter((b) => valid(b) && b.pick !== book.winnerId);
  const W = win.reduce((s, b) => s + b.amount, 0);
  const L = lose.reduce((s, b) => s + b.amount, 0);
  if (!W || !L) return bets.map(refund);
  const at = book.settledAt ? { settledAt: book.settledAt } : {};
  return bets.map((b): SettledBet => {
    if (!valid(b)) return refund(b);
    if (b.pick === book.winnerId)
      return { ...b, status: 'won', payout: b.amount + Math.floor((b.amount * L) / W), ...at };
    return { ...b, status: 'lost', payout: 0, ...at };
  });
}

/** Totals per entrant of a match (shown once the bets are closed). */
export function pools(bets: readonly Bet[]): Record<string, { amount: number; bettors: number }> {
  const out: Record<string, { amount: number; bettors: number }> = {};
  for (const b of bets) {
    const p = (out[b.pick] ??= { amount: 0, bettors: 0 });
    p.amount += b.amount;
    p.bettors++;
  }
  return out;
}

export interface Bailout {
  userId: string;
  amount: number;
  at: string;
}

/** A user's Neuro over a season. */
export interface Wallet {
  userId: string;
  /** Start + rescues + wins - losses (open stakes still included). */
  balance: number;
  /** Staked in matches not decided yet. */
  staked: number;
  /** What can be staked now: balance - staked. */
  free: number;
  peak: number;
  bets: number;
  won: number;
  lost: number;
  refunded: number;
  open: number;
  /** Sum of wins minus losses (rescues not included). */
  profit: number;
  bailouts: number;
  bailedOut: number;
  bestWin: number;
  worstLoss: number;
  /** Highest payout / stake of a won bet. */
  bestOdds: number;
  winStreak: number;
  loseStreak: number;
  /** Biggest stake of a won all-in bet. */
  allInWin: number;
}

export const emptyWallet = (userId: string, start: number): Wallet => ({
  userId,
  balance: start,
  staked: 0,
  free: start,
  peak: start,
  bets: 0,
  won: 0,
  lost: 0,
  refunded: 0,
  open: 0,
  profit: 0,
  bailouts: 0,
  bailedOut: 0,
  bestWin: 0,
  worstLoss: 0,
  bestOdds: 0,
  winStreak: 0,
  loseStreak: 0,
  allInWin: 0,
});

/**
 * Wallets of a season: every decided bet and rescue in time order (ties: rescues first), open
 * stakes on top. Users without bets or rescues have none (they start with `start`).
 */
export function wallets(
  settled: readonly SettledBet[],
  bailouts: readonly Bailout[],
  start: number,
): Map<string, Wallet> {
  type Step =
    | { at: string; order: 0; userId: string; bailout: number }
    | { at: string; order: 1; userId: string; bet: SettledBet };
  const steps: Step[] = [
    ...bailouts.map((b) => ({ at: b.at, order: 0 as const, userId: b.userId, bailout: b.amount })),
    ...settled
      .filter((b) => b.status !== 'open')
      .map((b) => ({ at: b.settledAt ?? b.placedAt, order: 1 as const, userId: b.userId, bet: b })),
  ].sort((x, y) => x.at.localeCompare(y.at) || x.order - y.order);
  const out = new Map<string, Wallet>();
  const of = (id: string) => {
    let w = out.get(id);
    if (!w) out.set(id, (w = emptyWallet(id, start)));
    return w;
  };
  const streak = new Map<string, number>(); // >0 wins in a row, <0 losses in a row
  for (const s of steps) {
    const w = of(s.userId);
    if ('bailout' in s) {
      w.balance += s.bailout;
      w.bailouts++;
      w.bailedOut += s.bailout;
    } else {
      const b = s.bet;
      w.bets++;
      if (b.status === 'refunded') {
        w.refunded++;
        continue;
      }
      const net = b.payout - b.amount;
      w.balance += net;
      w.profit += net;
      const st = streak.get(s.userId) ?? 0;
      if (b.status === 'won') {
        w.won++;
        w.bestWin = Math.max(w.bestWin, net);
        w.bestOdds = Math.max(w.bestOdds, b.payout / b.amount);
        if (b.allIn) w.allInWin = Math.max(w.allInWin, b.amount);
        const n = st > 0 ? st + 1 : 1;
        streak.set(s.userId, n);
        w.winStreak = Math.max(w.winStreak, n);
      } else {
        w.lost++;
        w.worstLoss = Math.max(w.worstLoss, b.amount);
        const n = st < 0 ? st - 1 : -1;
        streak.set(s.userId, n);
        w.loseStreak = Math.max(w.loseStreak, -n);
      }
    }
    w.peak = Math.max(w.peak, w.balance);
  }
  for (const b of settled)
    if (b.status === 'open') {
      const w = of(b.userId);
      w.bets++;
      w.open++;
      w.staked += b.amount;
    }
  for (const w of out.values()) w.free = w.balance - w.staked;
  return out;
}

/** Minimum decided bets for the hit-rate record. */
export const HIT_RATE_MIN_BETS = 10;

export interface BetRecord {
  key: string;
  userId?: string;
  value: number;
  /** Biggest pool: the match. */
  tournamentId?: string;
  matchId?: string;
}

/** Records of a season from the wallets (and the pools of the decided matches). */
export function betRecords(
  ws: ReadonlyMap<string, Wallet>,
  settled: readonly SettledBet[],
  start: number,
): BetRecord[] {
  const list = [...ws.values()];
  const best = (key: string, value: (w: Wallet) => number, min = 1): BetRecord | null => {
    let top: Wallet | undefined;
    for (const w of list) if (value(w) >= min && (!top || value(w) > value(top))) top = w;
    return top ? { key, userId: top.userId, value: value(top) } : null;
  };
  const decided = (w: Wallet) => w.won + w.lost;
  const out: (BetRecord | null)[] = [
    best('peak', (w) => w.peak, start + 1),
    best('bestWin', (w) => w.bestWin),
    best('worstLoss', (w) => w.worstLoss),
    best('bestOdds', (w) => Math.round(w.bestOdds * 100) / 100, 1.01),
    best('winStreak', (w) => w.winStreak, 2),
    best('loseStreak', (w) => w.loseStreak, 2),
    best('mostBets', (w) => w.bets),
    best(
      'hitRate',
      (w) => (decided(w) >= HIT_RATE_MIN_BETS ? Math.round((w.won / decided(w)) * 1000) / 10 : 0),
      0.1,
    ),
    best('profit', (w) => w.profit),
    best('bailouts', (w) => w.bailouts),
    best('allInWin', (w) => w.allInWin),
  ];
  // Biggest pool of a decided match.
  const byMatch = new Map<string, { t: string; m: string; amount: number }>();
  for (const b of settled)
    if (b.status === 'won' || b.status === 'lost') {
      const k = `${b.tournamentId}/${b.matchId}`;
      const x = byMatch.get(k) ?? { t: b.tournamentId, m: b.matchId, amount: 0 };
      x.amount += b.amount;
      byMatch.set(k, x);
    }
  let pool: { t: string; m: string; amount: number } | undefined;
  for (const x of byMatch.values()) if (!pool || x.amount > pool.amount) pool = x;
  if (pool)
    out.push({ key: 'biggestPool', value: pool.amount, tournamentId: pool.t, matchId: pool.m });
  return out.filter((r): r is BetRecord => r !== null);
}
