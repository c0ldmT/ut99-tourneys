import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm';
import {
  baseValue,
  botRarity,
  demandFactor,
  economyIndex,
  formFactor,
  marketValue,
  sellPrice,
  staminaRecovered,
  valueScore,
  weeklySalary,
} from '@tourney/udt';
import { z } from 'zod';
import type { User } from '../auth/users.service.js';
import { BetsService } from '../bets/bets.service.js';
import { BotsService, type LibraryBot } from '../bots/bots.service.js';
import { randomId } from '../common/ids.js';
import { badRequest, conflict, notFound } from '../common/http.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { udtBids, udtDays, udtOffers, udtRoster, udtValues } from '../db/schema.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { nextDay, zonedMs } from '../seasons/season-time.js';
import { SeasonsService, type Season } from '../seasons/seasons.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { StatsService } from '../stats/stats.service.js';
import { UdtService } from './udt.service.js';

/** At most this many bots per manager (5 + 2 on the bench). */
export const ROSTER_MAX = 7;

export const BidBody = z.object({
  botId: z.string().min(1).max(40),
  amount: z.number().int().min(10).max(100_000_000),
});
export type BidInput = z.infer<typeof BidBody>;

/**
 * The Dream Team transfer market. Once a day (setting `udt.marketTime`, SEASON_TZ) the market
 * day settles the hidden bids of the day before (highest wins, the others get their Neuro back),
 * pays salaries on Mondays (a bot whose salary cannot be paid goes on strike), lets the bots
 * rest, computes the economy index and every bot's market value, and puts new bots on offer.
 * A bid is paid when it is made and refunded when it loses.
 */
@Injectable()
export class UdtMarketService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(BetsService) private readonly bets: BetsService,
    @Inject(StatsService) private readonly stats: StatsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(UdtService) private readonly udt: UdtService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.tick(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs the market day when it is due (also the first one of a season right away). */
  tick(): boolean {
    try {
      if (!this.udt.enabled()) return false;
      const season = this.seasons.current();
      if (!season) return false;
      const day = this.udt.today();
      if (this.dayDone(day)) return false;
      const first = !this.lastDay(season.number);
      const at = zonedMs(day, this.settings.get().udt.marketTime, this.seasons.timeZone);
      if (!first && this.clock.now() < at) return false;
      this.runDay(season, day);
      return true;
    } catch (e) {
      this.log.error(`udt market day failed: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  private dayDone(day: string): boolean {
    return Boolean(this.db.select().from(udtDays).where(eq(udtDays.day, day)).get());
  }

  private lastDay(season: number) {
    return this.db
      .select()
      .from(udtDays)
      .where(eq(udtDays.season, season))
      .orderBy(desc(udtDays.day))
      .get();
  }

  /** The market day (exposed for the test mode: "market day now"). */
  runDay(season: Season, day: string): void {
    const last = this.lastDay(season.number);
    const s = season.number;
    const library = this.bots.list();
    const byId = new Map(library.map((b) => [b.id, b]));
    // 1. Bids of the last offers.
    const bidCounts = this.settleBids(s, last?.day, byId);
    // 2. Rest, 3. salaries (Mondays).
    const rest = last ? daysBetween(last.day, day) : 0;
    const roster = this.db.select().from(udtRoster).where(eq(udtRoster.season, s)).all();
    if (rest > 0)
      for (const r of roster)
        this.db
          .update(udtRoster)
          .set({ stamina: staminaRecovered(r.stamina, rest) })
          .where(and(eq(udtRoster.season, s), eq(udtRoster.botId, r.botId)))
          .run();
    // 4. Index from the managers' book net worth (balance + what their bots cost).
    const teams = this.udt.teams(s);
    const nets = teams.map((t) => {
      const w = this.bets.wallet(t.userId, season);
      const book = roster.filter((r) => r.userId === t.userId).reduce((n, r) => n + r.price, 0);
      return w.balance + book;
    });
    const index = economyIndex(nets, last?.economyIndex);
    // 5. Market values of every bot that can be owned (library bots and owned ones).
    const players = new Map(this.stats.players(s, undefined, true).map((p) => [p.key, p]));
    const unsoldDays = this.unsoldDays(last?.day);
    const owned = new Map(roster.map((r) => [r.botId, r]));
    const values = new Map<string, number>();
    for (const b of library) {
      if (b.udtOwner && !owned.has(b.id)) continue;
      const p = players.get(`b:${b.id}`);
      const v = marketValue(
        baseValue(b.skill, valueScore(b.traits)),
        formFactor({ games: p?.games ?? 0, wins: p?.gamesWon ?? 0 }),
        demandFactor(bidCounts.get(b.id) ?? 0, unsoldDays.get(b.id) ?? 0),
        index,
      );
      values.set(b.id, v);
      this.db
        .insert(udtValues)
        .values({ botId: b.id, day, value: v })
        .onConflictDoUpdate({ target: [udtValues.botId, udtValues.day], set: { value: v } })
        .run();
    }
    if (weekday(day) === 1 && last) this.paySalaries(s, day, roster, values, byId);
    // 6. New offers: free bots of the library (active, not made by a manager, not owned).
    const free = library.filter((b) => b.active && !b.udtOwner && !owned.has(b.id));
    const n = Math.min(this.settings.get().udt.offersPerDay, free.length);
    const yesterday = new Set(last ? this.offerIds(last.day) : []);
    // Not the same bots two days running when there are enough others.
    const fresh = shuffle(free.filter((b) => !yesterday.has(b.id)));
    const again = shuffle(free.filter((b) => yesterday.has(b.id)));
    for (const b of [...fresh, ...again].slice(0, n))
      this.db
        .insert(udtOffers)
        .values({ day, botId: b.id, minPrice: values.get(b.id) ?? 10 })
        .onConflictDoNothing()
        .run();
    this.db
      .insert(udtDays)
      .values({
        day,
        season: s,
        economyIndex: index,
        doneAt: new Date(this.clock.now()).toISOString(),
      })
      .run();
    this.log.info(`udt market day ${day}: index ${index}, ${n} offers`);
  }

  /** Highest bid wins (earlier one on a tie); the others are refunded. Returns bids per bot. */
  private settleBids(season: number, day: string | undefined, byId: Map<string, LibraryBot>) {
    const counts = new Map<string, number>();
    if (!day) return counts;
    const open = this.db
      .select()
      .from(udtBids)
      .where(and(eq(udtBids.day, day), eq(udtBids.status, 'open')))
      .orderBy(desc(udtBids.amount), asc(udtBids.createdAt))
      .all();
    const owners = this.udt.owners(season);
    const won = new Set<string>();
    const size = new Map<string, number>();
    for (const r of this.db.select().from(udtRoster).where(eq(udtRoster.season, season)).all())
      size.set(r.userId, (size.get(r.userId) ?? 0) + 1);
    for (const b of open) {
      counts.set(b.botId, (counts.get(b.botId) ?? 0) + 1);
      const ok =
        !won.has(b.botId) &&
        !owners.has(b.botId) &&
        byId.has(b.botId) &&
        (size.get(b.userId) ?? 0) < ROSTER_MAX;
      if (ok) {
        won.add(b.botId);
        size.set(b.userId, (size.get(b.userId) ?? 0) + 1);
        this.db.update(udtBids).set({ status: 'won' }).where(eq(udtBids.id, b.id)).run();
        this.db
          .insert(udtRoster)
          .values({
            season,
            botId: b.botId,
            userId: b.userId,
            price: b.amount,
            acquiredAt: new Date(this.clock.now()).toISOString(),
          })
          .run();
      } else {
        this.db.update(udtBids).set({ status: 'lost' }).where(eq(udtBids.id, b.id)).run();
        this.ledger.book({
          season,
          userId: b.userId,
          kind: 'udt_refund',
          amount: b.amount,
          ref: `bid-refund:${b.id}`,
          meta: { botId: b.botId },
        });
      }
    }
    return counts;
  }

  private paySalaries(
    season: number,
    day: string,
    roster: (typeof udtRoster.$inferSelect)[],
    values: Map<string, number>,
    byId: Map<string, LibraryBot>,
  ) {
    for (const r of roster) {
      if (r.starter) continue;
      const b = byId.get(r.botId);
      const salary = weeklySalary(values.get(r.botId) ?? r.price, b?.skill ?? 4);
      const can = this.ledger.spendable(r.userId).spendable >= salary;
      if (can && salary > 0)
        this.ledger.book({
          season,
          userId: r.userId,
          kind: 'udt_salary',
          amount: -salary,
          ref: `salary:${season}:${day}:${r.botId}`,
          meta: { botId: r.botId },
        });
      this.db
        .update(udtRoster)
        .set({ striking: !can && salary > 0 })
        .where(and(eq(udtRoster.season, season), eq(udtRoster.botId, r.botId)))
        .run();
    }
  }

  private offerIds(day: string): string[] {
    return this.db
      .select()
      .from(udtOffers)
      .where(eq(udtOffers.day, day))
      .all()
      .map((o) => o.botId);
  }

  /** How many market days in a row each bot of the last offers stayed unsold. */
  private unsoldDays(lastDay: string | undefined): Map<string, number> {
    const out = new Map<string, number>();
    if (!lastDay) return out;
    const days = this.db
      .select()
      .from(udtDays)
      .orderBy(desc(udtDays.day))
      .limit(4)
      .all()
      .map((d) => d.day);
    for (const id of this.offerIds(lastDay)) {
      let n = 0;
      for (const d of days) {
        if (!this.offerIds(d).includes(id)) break;
        n++;
      }
      out.set(id, n);
    }
    return out;
  }

  /** The market page: today's offers with values and history, the manager's bids. */
  view(user: User) {
    this.udt.assertOn();
    const season = this.udt.season();
    const last = this.lastDay(season.number);
    const tz = this.seasons.timeZone;
    const marketTime = this.settings.get().udt.marketTime;
    const today = this.udt.today();
    const nextAt = zonedMs(this.dayDone(today) ? nextDay(today) : today, marketTime, tz);
    if (!last)
      return { day: null, index: this.udt.index(season.number), nextAt, offers: [], bids: [] };
    const lib = new Map(this.bots.list().map((b) => [b.id, b]));
    const owners = this.udt.owners(season.number);
    const offers = this.db.select().from(udtOffers).where(eq(udtOffers.day, last.day)).all();
    const history = this.history(
      offers.map((o) => o.botId),
      14,
    );
    const myBids = this.db
      .select()
      .from(udtBids)
      .where(and(eq(udtBids.day, last.day), eq(udtBids.userId, user.id)))
      .all();
    return {
      day: last.day,
      index: last.economyIndex,
      nextAt,
      offers: offers.flatMap((o) => {
        const b = lib.get(o.botId);
        if (!b) return [];
        const h = history.get(b.id) ?? [];
        return [
          {
            botId: b.id,
            name: b.gameName,
            skill: b.skill,
            rarity: botRarity(b.skill),
            botClass: b.botClass,
            skin: b.skin,
            face: b.face,
            traits: b.traits,
            minPrice: o.minPrice,
            value: h.at(-1)?.value ?? o.minPrice,
            history: h,
            sold: owners.has(b.id),
            myBid: myBids.find((x) => x.botId === b.id)?.amount ?? null,
          },
        ];
      }),
      bids: myBids.map((b) => ({ botId: b.botId, amount: b.amount, status: b.status })),
    };
  }

  /** Market values of the last `days` market days per bot. */
  history(botIds: readonly string[], days: number) {
    const out = new Map<string, { day: string; value: number }[]>();
    if (!botIds.length) return out;
    const recent = this.db.select().from(udtDays).orderBy(desc(udtDays.day)).limit(days).all();
    const from = recent.at(-1)?.day ?? '0000-00-00';
    for (const v of this.db
      .select()
      .from(udtValues)
      .where(and(inArray(udtValues.botId, [...botIds]), gte(udtValues.day, from)))
      .orderBy(asc(udtValues.day))
      .all())
      out.set(v.botId, [...(out.get(v.botId) ?? []), { day: v.day, value: v.value }]);
    return out;
  }

  /** A hidden bid (or a new amount): paid now, refunded if it loses. */
  bid(user: User, body: BidInput) {
    this.udt.assertOn();
    const season = this.udt.season();
    if (!this.udt.team(user.id, season.number)) throw conflict('found your team first');
    const last = this.lastDay(season.number);
    const offer = last
      ? this.db
          .select()
          .from(udtOffers)
          .where(and(eq(udtOffers.day, last.day), eq(udtOffers.botId, body.botId)))
          .get()
      : undefined;
    if (!last || !offer) throw notFound('offer');
    if (this.udt.owners(season.number).has(body.botId)) throw conflict('the bot is sold');
    if (body.amount < offer.minPrice) throw badRequest(`the lowest bid is ${offer.minPrice} Neuro`);
    const mine = this.db
      .select()
      .from(udtBids)
      .where(
        and(eq(udtBids.day, last.day), eq(udtBids.userId, user.id), eq(udtBids.status, 'open')),
      )
      .all();
    const old = mine.find((b) => b.botId === body.botId);
    const size = this.udt.roster(user.id, season.number).length;
    if (!old && size + mine.length >= ROSTER_MAX)
      throw conflict(`at most ${ROSTER_MAX} bots: your roster and open bids are full`);
    if (old) this.withdrawBid(old, season.number);
    const id = `u${randomId(12)}`;
    try {
      this.ledger.charge({
        userId: user.id,
        kind: 'udt_purchase',
        amount: body.amount,
        ref: `bid:${id}`,
        meta: { botId: body.botId, day: last.day },
      });
    } catch (e) {
      // Not enough Neuro: the old bid stays as it was.
      if (old) this.rebid(old, season.number);
      throw e;
    }
    this.db
      .insert(udtBids)
      .values({
        id,
        day: last.day,
        botId: body.botId,
        userId: user.id,
        amount: body.amount,
        createdAt: new Date(this.clock.now()).toISOString(),
      })
      .run();
    return this.view(user);
  }

  /** Takes back an open bid (Neuro back). */
  withdraw(user: User, botId: string) {
    this.udt.assertOn();
    const season = this.udt.season();
    const last = this.lastDay(season.number);
    const old = last
      ? this.db
          .select()
          .from(udtBids)
          .where(
            and(
              eq(udtBids.day, last.day),
              eq(udtBids.userId, user.id),
              eq(udtBids.botId, botId),
              eq(udtBids.status, 'open'),
            ),
          )
          .get()
      : undefined;
    if (!old) throw notFound('bid');
    this.withdrawBid(old, season.number);
    return this.view(user);
  }

  private withdrawBid(b: typeof udtBids.$inferSelect, season: number) {
    this.db.delete(udtBids).where(eq(udtBids.id, b.id)).run();
    this.ledger.book({
      season,
      userId: b.userId,
      kind: 'udt_refund',
      amount: b.amount,
      ref: `bid-refund:${b.id}`,
      meta: { botId: b.botId },
    });
  }

  /** Restores a withdrawn bid (its Neuro is taken again under a new ref). */
  private rebid(b: typeof udtBids.$inferSelect, season: number) {
    this.ledger.book({
      season,
      userId: b.userId,
      kind: 'udt_purchase',
      amount: -b.amount,
      ref: `bid-again:${b.id}`,
      meta: { botId: b.botId },
    });
    this.db.insert(udtBids).values(b).run();
  }

  /** Sells a bot back to the market for 85 % of its value (not the starter bot). */
  sell(user: User, botId: string) {
    this.udt.assertOn();
    const season = this.udt.season();
    const r = this.db
      .select()
      .from(udtRoster)
      .where(
        and(
          eq(udtRoster.season, season.number),
          eq(udtRoster.botId, botId),
          eq(udtRoster.userId, user.id),
        ),
      )
      .get();
    if (!r) throw notFound('bot in your roster');
    if (r.starter) throw conflict('the starter bot stays with your team');
    const bot = this.bots.list().find((b) => b.id === botId);
    const price = sellPrice(bot ? this.udt.value(bot, season.number) : r.price);
    this.db
      .delete(udtRoster)
      .where(and(eq(udtRoster.season, season.number), eq(udtRoster.botId, botId)))
      .run();
    this.ledger.book({
      season: season.number,
      userId: user.id,
      kind: 'udt_sale',
      amount: price,
      ref: `sale:${season.number}:${botId}:${randomId(6)}`,
      meta: { botId },
    });
    return this.udt.view(user);
  }
}

function weekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 Sunday, 1 Monday
}

function daysBetween(a: string, b: string): number {
  const t = (s: string) => Date.parse(`${s}T00:00:00Z`);
  return Math.round((t(b) - t(a)) / 86_400_000);
}

function shuffle<T>(l: readonly T[]): T[] {
  const a = [...l];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
