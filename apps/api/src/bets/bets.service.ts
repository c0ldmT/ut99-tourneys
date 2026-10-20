import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { createRng } from '@tourney/bracket';
import type { Entrant, TournamentProjection } from '@tourney/protocol';
import { UsersService } from '../auth/users.service.js';
import { BotsService, type LibraryBot } from '../bots/bots.service.js';
import { badRequest, conflict, forbidden, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { betBailouts, bets, neuroLedger, shopPurchases, tournaments } from '../db/schema.js';
import { SeasonsService, type Season } from '../seasons/seasons.service.js';
import { headToHead } from '../stats/aggregate.js';
import { botKey, userKey } from '../stats/facts.js';
import { StatsService } from '../stats/stats.service.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import {
  betOdds as odds,
  betRecords,
  botBettor,
  emptyWallet,
  isBotBettor,
  matchBetSummary,
  matchBooks,
  pools,
  settleMatch,
  tournamentBetSummary,
  wallets,
  type Bailout,
  type Bet,
  type BetKind,
  type MatchBetSummary,
  type MatchBook,
  type SettledBet,
  type TournamentBetSummary,
  type Wallet,
} from './betting.js';
import {
  bettingType,
  botBet,
  drawBettors,
  type BetSide,
  type BettingBot,
  type BotFeelings,
} from './bot-betting.js';

/** Phases in which a tournament takes bets (its bracket exists, it is not over). */
const BETTING_PHASES = ['seeded', 'checkIn', 'running', 'paused'];

type BetRow = typeof bets.$inferSelect;

const toBet = (r: BetRow): Bet => ({
  id: r.id,
  season: r.season,
  tournamentId: r.tournamentId,
  matchId: r.matchId,
  kind: r.kind as BetKind,
  userId: r.userId ?? botBettor(r.botId ?? ''),
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

  /** Matches the bots have looked at (tournament/match), so they decide once. */
  private botsDecided = new Set<string>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(EventLogService) private readonly log: EventLogService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(StatsService) private readonly stats: StatsService,
  ) {
    // A match opens for bets when its entrants are known: the bots bet right away.
    this.log.onAppend((tournamentId) => this.botsBet(tournamentId));
  }

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

  private seasonBailouts(season: number, bettor?: string): Bailout[] {
    const who = bettor
      ? isBotBettor(bettor)
        ? eq(betBailouts.botId, bettor.slice(4))
        : eq(betBailouts.userId, bettor)
      : undefined;
    return this.db
      .select()
      .from(betBailouts)
      .where(who ? and(eq(betBailouts.season, season), who) : eq(betBailouts.season, season))
      .all()
      .map((r) => ({ userId: r.userId ?? botBettor(r.botId ?? ''), amount: r.amount, at: r.at }));
  }

  /** Shop purchases of a season (refunded dedications do not count). */
  private seasonSpends(season: number, userId?: string): Bailout[] {
    return this.db
      .select()
      .from(shopPurchases)
      .where(
        userId
          ? and(eq(shopPurchases.season, season), eq(shopPurchases.userId, userId))
          : eq(shopPurchases.season, season),
      )
      .all()
      .filter((p) => p.status !== 'rejected')
      .map((p) => ({ userId: p.userId, amount: p.price, at: p.at }));
  }

  /** Ledger bookings of a season (Dream Team and later sources), signed. */
  private seasonLedger(season: number, userId?: string): Bailout[] {
    return this.db
      .select()
      .from(neuroLedger)
      .where(
        userId
          ? and(eq(neuroLedger.season, season), eq(neuroLedger.userId, userId))
          : eq(neuroLedger.season, season),
      )
      .all()
      .map((r) => ({ userId: r.userId, amount: r.amount, at: r.at }));
  }

  /** Tops a wallet below the season's floor up to it; returns the (new) wallet. */
  private rescue(bettor: string, season: Season): Wallet {
    const w = this.wallet(bettor, season);
    if (w.balance >= season.betting.floor) return w;
    this.db
      .insert(betBailouts)
      .values({
        id: `r${randomId(12)}`,
        season: season.number,
        ...(isBotBettor(bettor) ? { botId: bettor.slice(4) } : { userId: bettor }),
        amount: season.betting.floor - w.balance,
        at: this.now(),
      })
      .run();
    return this.wallet(bettor, season);
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

  /** A bettor's wallet in a season (a fresh one before the first bet). */
  wallet(userId: string, season: Season): Wallet {
    const ws = wallets(
      this.settledSeason(season.number).filter((b) => b.userId === userId),
      this.seasonBailouts(season.number, userId),
      season.betting.startBalance,
      season.betting.floor,
      this.seasonSpends(season.number, userId),
      this.seasonLedger(season.number, userId),
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
    const library = this.bots.list();
    const names = this.names();
    // Side names for the texts (a Dream Team entrant is "udt-<user>": its team name).
    const entrants = this.log.projection(tournamentId)?.entrants ?? {};
    const sideName = (id: string) => entrants[id]?.displayName ?? id;
    const matches = [...(b?.books.values() ?? [])]
      .filter((m) => m.entrants)
      .map((m) => {
        const mine = settled.find((x) => x.matchId === m.matchId && x.userId === userId);
        const ofMatch = all.filter((x) => x.matchId === m.matchId);
        const botBets = settled.filter((x) => x.matchId === m.matchId && isBotBettor(x.userId));
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
          /** Hidden while open: what one Neuro on a side brings back (pari-mutuel). */
          odds: m.state === 'open' ? null : odds(m, ofMatch),
          bettors: ofMatch.length,
          /** After the window: every bet, players' and bots', biggest first. */
          bets:
            m.state === 'open'
              ? []
              : settled
                  .filter((x) => x.matchId === m.matchId)
                  .sort((x, y) => y.amount - x.amount)
                  .map((x) => ({
                    bot: isBotBettor(x.userId),
                    id: isBotBettor(x.userId) ? x.userId.slice(4) : x.userId,
                    name: names.get(x.userId) ?? x.userId,
                    pick: x.pick,
                    pickName: sideName(x.pick),
                    amount: x.amount,
                    status: x.status,
                    payout: x.payout,
                  })),
          /** While open: the side of the strongest bot that bet (not the amount). */
          expert: m.state === 'open' ? this.expert(botBets, library, sideName) : null,
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

  private expert(
    botBets: readonly SettledBet[],
    library: readonly LibraryBot[],
    sideName: (id: string) => string,
  ) {
    let best: { bot: LibraryBot; pick: string } | undefined;
    for (const x of botBets) {
      const bot = library.find((b) => b.id === x.userId.slice(4));
      if (!bot) continue;
      const better =
        !best ||
        bot.skill > best.bot.skill ||
        (bot.skill === best.bot.skill &&
          (bot.traits.accuracy ?? 0) > (best.bot.traits.accuracy ?? 0));
      if (better) best = { bot, pick: x.pick };
    }
    return best
      ? {
          botId: best.bot.id,
          name: best.bot.gameName,
          pick: best.pick,
          pickName: sideName(best.pick),
        }
      : null;
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
    const w = this.rescue(userId, season);
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

  // --- the bots bet ---------------------------------------------------------------------------

  /** Lets the control center's bots bet on every match of the tournament that just opened. */
  private botsBet(tournamentId: string): void {
    try {
      const t = this.db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).get();
      if (!t || this.closedReason(t)) return;
      const season = this.seasons.current()!;
      if (!season.betting.botsBet || season.betting.botsPerMatch <= 0) return;
      const b = this.book(tournamentId);
      if (!b) return;
      const open = [...b.books.values()].filter(
        (m) => m.state === 'open' && !this.botsDecided.has(`${tournamentId}/${m.matchId}`),
      );
      if (!open.length) return;
      const library = this.bots.list().filter((x) => x.active);
      const revenge = this.revengeTargets(library, season.number);
      for (const m of open) {
        this.botsDecided.add(`${tournamentId}/${m.matchId}`);
        this.matchBotBets(t.id, m, b.proj, library, revenge, season);
      }
    } catch {
      // Bots betting must never break the event log.
    }
  }

  private matchBotBets(
    tournamentId: string,
    m: MatchBook,
    proj: TournamentProjection,
    library: readonly LibraryBot[],
    revenge: ReadonlyMap<string, string>,
    season: Season,
  ): void {
    const existing = new Set(
      this.db
        .select({ botId: bets.botId })
        .from(bets)
        .where(and(eq(bets.tournamentId, tournamentId), eq(bets.matchId, m.matchId)))
        .all()
        .flatMap((r) => (r.botId ? [r.botId] : [])),
    );
    const seed = `${season.number}|${tournamentId}|${m.matchId}`;
    const candidates = library
      .filter((x) => !m.participants.includes(botBettor(x.id)) && !existing.has(x.id))
      .map((x) => ({ ...toBettingBot(x), lib: x }));
    const n = Math.max(0, season.betting.botsPerMatch - existing.size);
    const sides = m.entrants!.map((id) => betSide(id, proj, library)) as [BetSide, BetSide];
    for (const bot of drawBettors(candidates, n, createRng(seed))) {
      const feelings: BotFeelings = {
        rivals: new Map(
          bot.lib.personality.rivals.map((r) => [
            r.kind === 'user' ? r.id : botBettor(r.id),
            r.level === 'nemesis' ? (2 as const) : (1 as const),
          ]),
        ),
        ...(revenge.get(bot.id) ? { revenge: revenge.get(bot.id)! } : {}),
      };
      const w = this.rescue(botBettor(bot.id), season);
      const d = botBet(bot, sides, feelings, w.free, createRng(`${seed}|${bot.id}`));
      if (!d) continue;
      this.db
        .insert(bets)
        .values({
          id: `w${randomId(12)}`,
          season: season.number,
          tournamentId,
          matchId: m.matchId,
          kind: 'winner',
          botId: bot.id,
          pick: d.pick,
          amount: d.amount,
          allIn: d.allIn,
          placedAt: this.now(),
        })
        .run();
    }
  }

  /**
   * Revenge: per bot the player who beat it most often this season (two games at least). The
   * mod reports no kills per victim, so "most beaten by" stands for "most fragged by".
   */
  private revengeTargets(library: readonly LibraryBot[], season: number): Map<string, string> {
    const out = new Map<string, string>();
    const facts = this.stats.facts(season);
    if (!facts.length) return out;
    const userKeys = this.users.list().map((u) => userKey(u.id));
    for (const bot of library) {
      const h2h = headToHead(facts, botKey(bot.id), userKeys);
      let best: { key: string; lost: number } | undefined;
      for (const [k, r] of Object.entries(h2h)) {
        const lost = r.games - r.wins;
        if (lost >= 2 && (!best || lost > best.lost)) best = { key: k, lost };
      }
      if (best) out.set(bot.id, best.key.slice(2));
    }
    return out;
  }

  /**
   * News for the game: per bot its latest decided bet of the running season, if it was
   * decided after the bot's last game (the bot talks about it at the start of its next game).
   */
  botBetNews(
    botIds: readonly string[],
  ): Map<string, { won: boolean; amount: number; pick: string }> {
    const out = new Map<string, { won: boolean; amount: number; pick: string }>();
    const season = this.seasons.current();
    if (!season || !botIds.length) return out;
    const settled = this.settledSeason(season.number);
    const lastGame = new Map<string, string>();
    for (const f of this.stats.facts('lifetime'))
      for (const p of f.players) if ((lastGame.get(p.key) ?? '') < p.at) lastGame.set(p.key, p.at);
    for (const id of botIds) {
      const last = settled
        .filter((x) => x.userId === botBettor(id) && (x.status === 'won' || x.status === 'lost'))
        .sort((a, b) => (b.settledAt ?? '').localeCompare(a.settledAt ?? ''))[0];
      if (!last?.settledAt || last.settledAt <= (lastGame.get(botKey(id)) ?? '')) continue;
      const pick = this.book(last.tournamentId)?.proj.entrants[last.pick]?.displayName ?? last.pick;
      out.set(id, {
        won: last.status === 'won',
        amount: last.status === 'won' ? last.payout - last.amount : last.amount,
        pick,
      });
    }
    return out;
  }

  // --- Discord channel ------------------------------------------------------------------------

  /** Bets go to the Discord channel: a season tournament, a season, the switch on. */
  private discordOn(t: typeof tournaments.$inferSelect | undefined): boolean {
    const season = this.seasons.current();
    return !!t?.seasonal && !!season && season.betting.discord;
  }

  private tournamentBets(tournamentId: string, matchId?: string): Bet[] {
    return this.db
      .select()
      .from(bets)
      .where(
        matchId
          ? and(eq(bets.tournamentId, tournamentId), eq(bets.matchId, matchId))
          : eq(bets.tournamentId, tournamentId),
      )
      .all()
      .map(toBet);
  }

  /** Display name of a bettor (users and bots under their current name). */
  bettorNames(): (bettor: string) => string {
    const names = this.names();
    return (k) => names.get(k) ?? k;
  }

  /** The match was called and takes bets for a while: how long (null: nothing to post). */
  discordOpen(tournamentId: string, matchId: string): { windowSec: number } | null {
    const t = this.db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).get();
    if (!t || !this.discordOn(t) || this.closedReason(t)) return null;
    const windowSec = this.seasons.current()!.betting.windowSec;
    const m = this.book(tournamentId)?.books.get(matchId);
    if (!windowSec || m?.state !== 'open') return null;
    return { windowSec };
  }

  /**
   * Pools and odds of a match whose bets just closed (its first game started at `at`), or its
   * payout once decided. Null when nobody bet or the channel gets no bets.
   */
  discordMatch(tournamentId: string, matchId: string, closedAt?: string): MatchBetSummary | null {
    const t = this.db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).get();
    if (!this.discordOn(t)) return null;
    const m = this.book(tournamentId)?.books.get(matchId);
    if (!m?.entrants) return null;
    if (closedAt !== undefined && (m.state !== 'closed' || m.closedAt !== closedAt)) return null;
    const list = this.tournamentBets(tournamentId, matchId);
    if (!list.length) return null;
    return matchBetSummary(m, this.settle(list));
  }

  /** Winners and losers of a finished tournament's bets (null: no decided bets). */
  discordTournament(tournamentId: string): TournamentBetSummary | null {
    const t = this.db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).get();
    if (!this.discordOn(t)) return null;
    return tournamentBetSummary(this.settle(this.tournamentBets(tournamentId)));
  }

  // --- statistics -----------------------------------------------------------------------------

  /** Display names of all bettors: users and bots. */
  private names(): Map<string, string> {
    const m = new Map(this.users.list().map((u) => [u.id, u.displayName]));
    for (const b of this.bots.list()) m.set(botBettor(b.id), b.gameName);
    return m;
  }

  /** Ranking of a season: everybody who bet or was rescued, richest first; bots marked. */
  /** Website users that are Dream Team AI managers (discord id "ai:..."): not in the rankings. */
  private aiUsers(): Set<string> {
    return new Set(
      this.users
        .list()
        .filter((u) => u.discordId.startsWith('ai:'))
        .map((u) => u.id),
    );
  }

  leaderboard(seasonNo?: number) {
    const season = this.seasonOr(seasonNo);
    if (!season) return { season: null, rows: [], versus: { humans: 0, bots: 0 } };
    const settled = this.settledSeason(season.number);
    const ws = wallets(
      settled,
      this.seasonBailouts(season.number),
      season.betting.startBalance,
      season.betting.floor,
      this.seasonSpends(season.number),
      this.seasonLedger(season.number),
    );
    const names = this.names();
    const ai = this.aiUsers();
    const rows = [...ws.values()]
      .filter((w) => !ai.has(w.userId))
      .map((w) => ({
        ...w,
        bot: isBotBettor(w.userId),
        /** User id, or the bot's id. */
        id: isBotBettor(w.userId) ? w.userId.slice(4) : w.userId,
        name: names.get(w.userId) ?? w.userId,
      }))
      .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
    // Man against machine: pools are shared, so what one side wins the other loses.
    const versus = { humans: 0, bots: 0 };
    for (const r of rows) versus[r.bot ? 'bots' : 'humans'] += r.profit;
    return { season: season.number, startBalance: season.betting.startBalance, rows, versus };
  }

  /** Betting records of a season: players' and, separately, the bots'. */
  records(seasonNo?: number) {
    const season = this.seasonOr(seasonNo);
    if (!season) return { season: null, records: [], botRecords: [] };
    const settled = this.settledSeason(season.number);
    const ws = wallets(
      settled,
      this.seasonBailouts(season.number),
      season.betting.startBalance,
      season.betting.floor,
      this.seasonSpends(season.number),
      this.seasonLedger(season.number),
    );
    const names = this.names();
    const tnames = this.tournamentNames();
    const ai = this.aiUsers();
    const part = (bot: boolean) =>
      new Map([...ws].filter(([k]) => isBotBettor(k) === bot && !ai.has(k)));
    const view = (r: ReturnType<typeof betRecords>[number]) => ({
      ...r,
      ...(r.userId
        ? {
            name: names.get(r.userId) ?? r.userId,
            ...(isBotBettor(r.userId) ? { botId: r.userId.slice(4) } : {}),
          }
        : {}),
      ...(r.tournamentId ? { tournamentName: tnames.get(r.tournamentId) ?? r.tournamentId } : {}),
    });
    const human = settled.filter((b) => !isBotBettor(b.userId));
    const bot = settled.filter((b) => isBotBettor(b.userId));
    return {
      season: season.number,
      records: betRecords(part(false), human, season.betting.startBalance).map(view),
      botRecords: betRecords(part(true), bot, season.betting.startBalance)
        .filter((r) => r.key !== 'biggestPool')
        .map(view),
    };
  }

  private tournamentNames(): Map<string, string> {
    return new Map(
      this.db
        .select({ id: tournaments.id, name: tournaments.name })
        .from(tournaments)
        .all()
        .map((t) => [t.id, t.name]),
    );
  }

  /** A player's Neuro in a season (shown on the player page to everybody). */
  userView(userId: string, seasonNo?: number) {
    const name = this.users.list().find((u) => u.id === userId)?.displayName ?? null;
    return { name, ...this.bettorView(userId, seasonNo) };
  }

  /** A bot's Neuro in a season and its betting type (bot profile). */
  botView(botId: string, seasonNo?: number) {
    const bot = this.bots.get(botId);
    if (!bot) throw notFound(`bot ${botId}`);
    return {
      name: bot.gameName,
      type: bettingType(toBettingBot(bot)),
      ...this.bettorView(botBettor(bot.id), seasonNo),
    };
  }

  private bettorView(bettor: string, seasonNo?: number) {
    const season = this.seasonOr(seasonNo);
    if (!season) return { season: null, wallet: null, recent: [] };
    const settled = this.settledSeason(season.number);
    const ws = wallets(
      settled,
      this.seasonBailouts(season.number),
      season.betting.startBalance,
      season.betting.floor,
      this.seasonSpends(season.number),
      this.seasonLedger(season.number),
    );
    const w = ws.get(bettor) ?? emptyWallet(bettor, season.betting.startBalance);
    const tnames = this.tournamentNames();
    const pickName = (b: SettledBet) =>
      this.book(b.tournamentId)?.proj.entrants[b.pick]?.displayName ?? b.pick;
    const recent = settled
      .filter((b) => b.userId === bettor)
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
    return { season: season.number, wallet: w, recent };
  }
}

/** The betting view of a library bot. */
function toBettingBot(b: LibraryBot): BettingBot {
  return {
    id: b.id,
    skill: b.skill,
    accuracy: b.traits.accuracy ?? 0,
    alertness: b.traits.alertness ?? 0,
    combatStyle: b.traits.combatStyle ?? 0,
    camping: b.traits.camping ?? 0,
    jumpy: !!b.traits.jumpy,
    clanId: b.clanId,
  };
}

/** What a bot knows about one side: rating, clans of its bots, who plays. */
function betSide(
  entrantId: string,
  proj: TournamentProjection,
  library: readonly LibraryBot[],
): BetSide {
  const e: Entrant | undefined = proj.entrants[entrantId];
  const players: string[] = [];
  const botIds: string[] = [];
  if (e?.kind === 'human') players.push(e.userId);
  if (e?.kind === 'bot' && e.bot.id) botIds.push(e.bot.id);
  if (e?.kind === 'team') {
    players.push(...e.members.map((m) => m.userId));
    for (const b of e.bots) if (b.id) botIds.push(b.id);
  }
  const clans = botIds.flatMap((id) => {
    const c = library.find((b) => b.id === id)?.clanId;
    return c ? [c] : [];
  });
  const rating = proj.seedRatings?.[entrantId];
  return {
    entrantId,
    ...(rating !== undefined ? { rating } : {}),
    clans,
    players: [...players, ...botIds.map(botBettor)],
  };
}
