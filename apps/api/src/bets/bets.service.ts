import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { TournamentProjection } from '@tourney/protocol';
import { UsersService } from '../auth/users.service.js';
import { badRequest, conflict, forbidden, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { betBailouts, bets, tournaments } from '../db/schema.js';
import { SeasonsService, type Season } from '../seasons/seasons.service.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import {
  betRecords,
  emptyWallet,
  matchBooks,
  pools,
  settleMatch,
  wallets,
  type Bailout,
  type Bet,
  type BetKind,
  type MatchBook,
  type SettledBet,
  type Wallet,
} from './betting.js';

/** Phases in which a tournament takes bets (its bracket exists, it is not over). */
const BETTING_PHASES = ['seeded', 'checkIn', 'running', 'paused'];

type BetRow = typeof bets.$inferSelect;

const toBet = (r: BetRow): Bet => ({
  id: r.id,
  season: r.season,
  tournamentId: r.tournamentId,
  matchId: r.matchId,
  kind: r.kind as BetKind,
  userId: r.userId,
  pick: r.pick,
  amount: r.amount,
  allIn: r.allIn,
  placedAt: r.placedAt,
});

/**
 * Betting with Neuro (€), the website's virtual currency: per season, in season tournaments
 * only, on the winner of a match. Wallets, settlement and records are derived from the stored
 * bets, rescues and event logs.
 */
@Injectable()
export class BetsService {
  private bookCache = new Map<
    string,
    { head: number; books: Map<string, MatchBook>; proj: TournamentProjection }
  >();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(EventLogService) private readonly log: EventLogService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  private now(): string {
    return new Date(this.clock.now()).toISOString();
  }

  /** Betting state of the matches of a tournament (cached by the log head). */
  private book(tournamentId: string) {
    const events = this.log.load(tournamentId);
    const head = events.at(-1)?.seq ?? 0;
    const hit = this.bookCache.get(tournamentId);
    if (hit?.head === head) return hit;
    const proj = this.log.projection(tournamentId);
    if (!proj) return undefined;
    const entry = { head, books: matchBooks(events, proj), proj };
    this.bookCache.set(tournamentId, entry);
    return entry;
  }

  private settle(list: readonly Bet[]): SettledBet[] {
    const byMatch = new Map<string, Bet[]>();
    for (const b of list) {
      const k = `${b.tournamentId}\u0000${b.matchId}`;
      const l = byMatch.get(k) ?? [];
      l.push(b);
      byMatch.set(k, l);
    }
    const out: SettledBet[] = [];
    for (const l of byMatch.values()) {
      const book = this.book(l[0]!.tournamentId)?.books.get(l[0]!.matchId);
      // Settle with all bets of the match (also other seasons' and users'): pools are shared.
      out.push(...settleMatch(book, l));
    }
    return out;
  }

  private seasonBets(season: number): Bet[] {
    return this.db.select().from(bets).where(eq(bets.season, season)).all().map(toBet);
  }

  private seasonBailouts(season: number, userId?: string): Bailout[] {
    return this.db
      .select()
      .from(betBailouts)
      .where(
        userId
          ? and(eq(betBailouts.season, season), eq(betBailouts.userId, userId))
          : eq(betBailouts.season, season),
      )
      .all()
      .map((r) => ({ userId: r.userId, amount: r.amount, at: r.at }));
  }

  /**
   * Settled bets of a season. Pools are per match: a match's bets are settled together, even
   * the bets of other users that the caller does not need.
   */
  private settledSeason(season: number): SettledBet[] {
    return this.settle(this.seasonBets(season));
  }

  private seasonOr(n: number | undefined): Season | undefined {
    if (n !== undefined) return this.seasons.list().find((s) => s.number === n);
    return this.seasons.current() ?? this.seasons.latestStarted();
  }

  /** A user's wallet in a season (a fresh one if the user has not bet yet). */
  wallet(userId: string, season: Season): Wallet {
    const ws = wallets(
      this.settledSeason(season.number).filter((b) => b.userId === userId),
      this.seasonBailouts(season.number, userId),
      season.betting.startBalance,
    );
    return ws.get(userId) ?? emptyWallet(userId, season.betting.startBalance);
  }

  // --- tournament page ------------------------------------------------------------------------

  /** Why a tournament takes no bets right now (null: it does). */
  private closedReason(t: typeof tournaments.$inferSelect): string | null {
    if (!t.seasonal) return 'notSeasonal';
    if (!this.seasons.current()) return 'noSeason';
    if (!BETTING_PHASES.includes(t.phase)) return 'phase';
    return null;
  }

  private tournament(id: string) {
    const t = this.db.select().from(tournaments).where(eq(tournaments.id, id)).get();
    if (!t) throw notFound(`tournament ${id}`);
    return t;
  }

  /** Bets panel of a tournament: the matches with entrants, the user's bets and wallet. */
  tournamentView(tournamentId: string, userId: string) {
    const t = this.tournament(tournamentId);
    const season = this.seasons.current();
    const reason = this.closedReason(t);
    const b = this.book(tournamentId);
    const all = this.db
      .select()
      .from(bets)
      .where(eq(bets.tournamentId, tournamentId))
      .all()
      .map(toBet);
    const settled = this.settle(all);
    const matches = [...(b?.books.values() ?? [])]
      .filter((m) => m.entrants)
      .map((m) => {
        const mine = settled.find((x) => x.matchId === m.matchId && x.userId === userId);
        const ofMatch = all.filter((x) => x.matchId === m.matchId);
        return {
          matchId: m.matchId,
          entrants: m.entrants!,
          state: m.state,
          ...(m.closedAt ? { closedAt: m.closedAt } : {}),
          ...(m.winnerId ? { winnerId: m.winnerId } : {}),
          /** Players of the match cannot bet on it. */
          playing: m.participants.includes(userId),
          mine: mine
            ? { pick: mine.pick, amount: mine.amount, status: mine.status, payout: mine.payout }
            : null,
          /** Hidden while bets are open (everybody bets on their own judgement). */
          pools: m.state === 'open' ? null : pools(ofMatch),
          bettors: ofMatch.length,
        };
      });
    return {
      open: reason === null,
      reason,
      season: season?.number ?? null,
      wallet: season ? this.walletView(this.wallet(userId, season), season) : null,
      matches,
    };
  }

  private walletView(w: Wallet, season: Season) {
    return {
      balance: w.balance,
      staked: w.staked,
      free: w.free,
      floor: season.betting.floor,
      startBalance: season.betting.startBalance,
    };
  }

  /**
   * Places or changes a bet (side and amount) while the match takes bets. A wallet below the
   * season's floor is first topped up to it (a rescue).
   */
  place(
    tournamentId: string,
    matchId: string,
    userId: string,
    body: { pick: string; amount: number; kind?: BetKind },
  ) {
    const kind = body.kind ?? 'winner';
    const t = this.tournament(tournamentId);
    const reason = this.closedReason(t);
    if (reason) throw conflict(`no bets in this tournament now (${reason})`);
    const season = this.seasons.current()!;
    const m = this.book(tournamentId)?.books.get(matchId);
    if (!m) throw notFound(`match ${matchId}`);
    if (m.state !== 'open') throw conflict('bets on this match are closed');
    if (m.participants.includes(userId)) throw forbidden('you play in this match');
    if (!m.entrants!.includes(body.pick)) throw badRequest('pick one of the two entrants');
    const existing = this.db
      .select()
      .from(bets)
      .where(
        and(
          eq(bets.tournamentId, tournamentId),
          eq(bets.matchId, matchId),
          eq(bets.kind, kind),
          eq(bets.userId, userId),
        ),
      )
      .get();
    let w = this.wallet(userId, season);
    if (w.balance < season.betting.floor) {
      this.db
        .insert(betBailouts)
        .values({
          id: `r${randomId(12)}`,
          season: season.number,
          userId,
          amount: season.betting.floor - w.balance,
          at: this.now(),
        })
        .run();
      w = this.wallet(userId, season);
    }
    // The old stake of this bet is free again when it changes.
    const free = w.free + (existing && existing.season === season.number ? existing.amount : 0);
    if (body.amount > free) throw badRequest(`only ${free} Neuro free`);
    const row = {
      season: season.number,
      pick: body.pick,
      amount: body.amount,
      allIn: body.amount === free,
      placedAt: this.now(),
    };
    if (existing) this.db.update(bets).set(row).where(eq(bets.id, existing.id)).run();
    else
      this.db
        .insert(bets)
        .values({ id: `w${randomId(12)}`, tournamentId, matchId, kind, userId, ...row })
        .run();
    return this.tournamentView(tournamentId, userId);
  }

  /** Withdraws a bet while the match takes bets. */
  withdraw(tournamentId: string, matchId: string, userId: string, kind: BetKind = 'winner') {
    const m = this.book(tournamentId)?.books.get(matchId);
    if (!m) throw notFound(`match ${matchId}`);
    if (m.state !== 'open') throw conflict('bets on this match are closed');
    this.db
      .delete(bets)
      .where(
        and(
          eq(bets.tournamentId, tournamentId),
          eq(bets.matchId, matchId),
          eq(bets.kind, kind),
          eq(bets.userId, userId),
        ),
      )
      .run();
    return this.tournamentView(tournamentId, userId);
  }

  // --- statistics -----------------------------------------------------------------------------

  /** Ranking of a season: everybody who bet or was rescued, richest first. */
  leaderboard(seasonNo?: number) {
    const season = this.seasonOr(seasonNo);
    if (!season) return { season: null, rows: [] };
    const settled = this.settledSeason(season.number);
    const ws = wallets(settled, this.seasonBailouts(season.number), season.betting.startBalance);
    const names = new Map(this.users.list().map((u) => [u.id, u.displayName]));
    const rows = [...ws.values()]
      .map((w) => ({ ...w, name: names.get(w.userId) ?? w.userId }))
      .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
    return { season: season.number, startBalance: season.betting.startBalance, rows };
  }

  /** Betting records of a season. */
  records(seasonNo?: number) {
    const season = this.seasonOr(seasonNo);
    if (!season) return { season: null, records: [] };
    const settled = this.settledSeason(season.number);
    const ws = wallets(settled, this.seasonBailouts(season.number), season.betting.startBalance);
    const names = new Map(this.users.list().map((u) => [u.id, u.displayName]));
    const tnames = new Map(
      this.db
        .select({ id: tournaments.id, name: tournaments.name })
        .from(tournaments)
        .all()
        .map((t) => [t.id, t.name]),
    );
    return {
      season: season.number,
      records: betRecords(ws, settled, season.betting.startBalance).map((r) => ({
        ...r,
        ...(r.userId ? { name: names.get(r.userId) ?? r.userId } : {}),
        ...(r.tournamentId ? { tournamentName: tnames.get(r.tournamentId) ?? r.tournamentId } : {}),
      })),
    };
  }

  /** A player's Neuro in a season (shown on the player page to everybody). */
  userView(userId: string, seasonNo?: number) {
    const season = this.seasonOr(seasonNo);
    const name = this.users.list().find((u) => u.id === userId)?.displayName ?? null;
    if (!season) return { season: null, name, wallet: null, recent: [] };
    const settled = this.settledSeason(season.number);
    const ws = wallets(settled, this.seasonBailouts(season.number), season.betting.startBalance);
    const w = ws.get(userId) ?? emptyWallet(userId, season.betting.startBalance);
    const tnames = new Map(
      this.db
        .select({ id: tournaments.id, name: tournaments.name })
        .from(tournaments)
        .all()
        .map((t) => [t.id, t.name]),
    );
    const pickName = (b: SettledBet) =>
      this.book(b.tournamentId)?.proj.entrants[b.pick]?.displayName ?? b.pick;
    const recent = settled
      .filter((b) => b.userId === userId)
      .sort((a, b) => (b.settledAt ?? b.placedAt).localeCompare(a.settledAt ?? a.placedAt))
      .slice(0, 20)
      .map((b) => ({
        tournamentId: b.tournamentId,
        tournamentName: tnames.get(b.tournamentId) ?? b.tournamentId,
        matchId: b.matchId,
        pick: pickName(b),
        amount: b.amount,
        status: b.status,
        payout: b.payout,
        at: b.settledAt ?? b.placedAt,
      }));
    return { season: season.number, name, wallet: w, recent };
  }
}
