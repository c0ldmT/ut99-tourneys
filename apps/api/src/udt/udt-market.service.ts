import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  baseValue,
  botRarity,
  bracketOf,
  buyPrice,
  demandFactor,
  economyIndex,
  formFactor,
  madeSalaryShare,
  managerEffects,
  PHASE_EFFECT,
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
import { conflict, notFound } from '../common/http.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import {
  bets,
  neuroLedger,
  udtBids,
  udtDays,
  udtOffers,
  udtRoster,
  udtValues,
} from '../db/schema.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { nextDay, zonedMs } from '../seasons/season-time.js';
import { SeasonsService, type Season } from '../seasons/seasons.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { botKey } from '../stats/facts.js';
import { StatsService } from '../stats/stats.service.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import { UdtCareerService } from './udt-career.service.js';
import { playingBots } from './udt-playing.js';
import { UdtService, withTraits } from './udt.service.js';
import { ServerActivity } from '../common/activity.js';

/** At most this many bots per manager (5 + 2 on the bench). */
export const ROSTER_MAX = 7;

export const BuyBody = z.object({
  botId: z.string().min(1).max(40),
});
export type BuyInput = z.infer<typeof BuyBody>;

/**
 * The Dream Team transfer market. Once a day (setting `udt.marketTime`, SEASON_TZ) the market
 * day lets the AI managers buy what is left of the day's offers, pays salaries on Mondays (a bot
 * whose salary cannot be paid goes on strike), lets the bots rest, computes the economy index
 * and every bot's market value, and puts new bots on offer at a fixed price (market value plus
 * the bracket's surcharge). Managers buy an offer at once: first come, first served.
 */
const DAY_MS = 86_400_000;

/** Ledger kinds a manager books by acting (spending): purchases, packs, academy, trades, rest, tickets. */
const MANAGER_ACTIONS = [
  'udt_purchase',
  'udt_pack',
  'udt_scout',
  'udt_licence',
  'udt_trade',
  'udt_trade_fee',
  'udt_rest',
  'udt_ticket',
];

@Injectable()
export class UdtMarketService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(ServerActivity) private readonly activity: ServerActivity,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(BetsService) private readonly bets: BetsService,
    @Inject(StatsService) private readonly stats: StatsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(UdtService) private readonly udt: UdtService,
    @Inject(UdtCareerService) private readonly career: UdtCareerService,
    @Inject(EventLogService) private readonly events: EventLogService,
  ) {}

  onModuleInit(): void {
    try {
      this.refundOpenBids();
    } catch (e) {
      this.log.error(`udt old bids: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.timer = setInterval(
      () => void this.activity.task('market', () => this.tick(true)),
      60_000,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs the market day when it is due (also the first one of a season right away). */
  /**
   * Called on every tick (each minute; the test mode's clock moves call it every hour);
   * `fromTimer`: the minute timer (not a clock move).
   */
  onTick(fn: (fromTimer: boolean) => void): void {
    this.tickHooks.push(fn);
  }
  private readonly tickHooks: ((fromTimer: boolean) => void)[] = [];

  tick(fromTimer = false): boolean {
    for (const fn of this.tickHooks)
      try {
        fn(fromTimer);
      } catch (e) {
        this.log.error(`udt tick: ${e instanceof Error ? e.message : String(e)}`);
      }
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

  /** Managers with a bet, a Dream Team action of their own or a new team since `since`. */
  private activeManagers(season: number, since: string): Set<string> {
    const out = new Set<string>();
    for (const b of this.db
      .select({ userId: bets.userId })
      .from(bets)
      .where(and(eq(bets.season, season), gte(bets.placedAt, since)))
      .all())
      if (b.userId) out.add(b.userId);
    for (const l of this.db
      .select({ userId: neuroLedger.userId })
      .from(neuroLedger)
      .where(
        and(
          eq(neuroLedger.season, season),
          gte(neuroLedger.at, since),
          inArray(neuroLedger.kind, MANAGER_ACTIONS),
          lt(neuroLedger.amount, 0),
        ),
      )
      .all())
      out.add(l.userId);
    for (const t of this.udt.teams(season)) if (t.createdAt >= since) out.add(t.userId);
    return out;
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

  private readonly dayHooks: ((season: Season, day: string) => void)[] = [];
  private readonly closingHooks: ((season: Season, day: string) => void)[] = [];
  /** Called after every market day (the AI managers act then). */
  afterDay(fn: (season: Season, day: string) => void): void {
    this.dayHooks.push(fn);
  }
  /**
   * Called at the start of a market day while the old offers are still on sale (`day`: the day
   * of those offers): the AI managers buy what the humans left, so they never get there first.
   */
  atClosing(fn: (season: Season, day: string) => void): void {
    this.closingHooks.push(fn);
  }

  /** The market day (exposed for the test mode: "market day now"). */
  runDay(season: Season, day: string): void {
    const last = this.lastDay(season.number);
    const s = season.number;
    // 1. Closing time of the last offers: the AI managers buy; then the demand per bracket.
    if (last)
      for (const fn of this.closingHooks)
        try {
          fn(season, last.day);
        } catch (e) {
          this.log.error(`udt market closing: ${e instanceof Error ? e.message : String(e)}`);
        }
    const sales = this.salesByBracket(s, last?.day);
    const library = this.bots.list();
    const byId = new Map(library.map((b) => [b.id, b]));
    // 2. Rest, 3. salaries (Mondays).
    const rest = last ? daysBetween(last.day, day) : 0;
    const roster = this.db.select().from(udtRoster).where(eq(udtRoster.season, s)).all();
    const onBots = this.udt.traitsOnBots(s);
    if (rest > 0)
      for (const r of roster)
        this.db
          .update(udtRoster)
          .set({
            stamina: staminaRecovered(
              r.stamina,
              rest * managerEffects(onBots.get(r.botId) ?? []).recovery,
            ),
          })
          .where(and(eq(udtRoster.season, s), eq(udtRoster.botId, r.botId)))
          .run();
    // 4. Index from the managers' book net worth (balance + what their bots cost).
    // AI managers do not move the index.
    const ai = this.udt.aiIds();
    const all = this.udt.teams(s).filter((t) => !ai.has(t.userId));
    // Only active managers (a bet or a Dream Team action in the last 7 days, or a new team):
    // left teams would hold the median down (review 23.10., M3). Nobody active: all count.
    const active = this.activeManagers(s, new Date(this.clock.now() - 7 * DAY_MS).toISOString());
    const teams = all.some((t) => active.has(t.userId))
      ? all.filter((t) => active.has(t.userId))
      : all;
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
    const demands = new Map<string, number>();
    const careers = this.career.careers();
    for (const b of library) {
      if (b.udtOwner && !owned.has(b.id)) continue;
      const p = players.get(botKey(b.id));
      const phase = careers.get(b.id)?.phase;
      const demand = demandFactor(sales.get(bracketOf(b.skill)) ?? 0, unsoldDays.get(b.id) ?? 0);
      const v = marketValue(
        baseValue(b.skill, valueScore(b.traits)) * (phase ? PHASE_EFFECT[phase].value : 1),
        formFactor({ games: p?.games ?? 0, wins: p?.gamesWon ?? 0 }),
        demand,
        index,
      );
      values.set(b.id, v);
      demands.set(b.id, demand);
      this.db
        .insert(udtValues)
        .values({ botId: b.id, day, value: v })
        .onConflictDoUpdate({ target: [udtValues.botId, udtValues.day], set: { value: v } })
        .run();
    }
    // Salaries: a week's for every Monday since the last market day (a missed Monday still
    // counts), and what is owed is collected on every market day until it is paid.
    // At most one week at a time: weeks without any market day (the Dream Team switched off)
    // were weeks without games, sales or trades.
    const weeks = last ? Math.min(1, mondaysAfter(last.day, day)) : 0;
    this.paySalaries(s, day, weeks, roster, values, byId, onBots);
    // 6. New offers: free bots of the library (active, not made by a manager, not owned).
    const free = library.filter((b) => b.active && !b.udtOwner && !owned.has(b.id));
    const n = Math.min(this.settings.get().udt.offersPerDay, free.length);
    const yesterday = new Set(last ? this.offerIds(last.day) : []);
    // Not the same bots two days running when there are enough others.
    const fresh = shuffle(free.filter((b) => !yesterday.has(b.id)));
    const again = shuffle(free.filter((b) => yesterday.has(b.id)));
    // The price stays for the whole market day (`minPrice` holds it).
    for (const b of [...fresh, ...again].slice(0, n))
      this.db
        .insert(udtOffers)
        .values({
          day,
          botId: b.id,
          minPrice: buyPrice(values.get(b.id) ?? 10, b.skill),
          demand: demands.get(b.id) ?? 1,
        })
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
    for (const fn of this.dayHooks)
      try {
        fn(season, day);
      } catch (e) {
        this.log.error(`udt after market day: ${e instanceof Error ? e.message : String(e)}`);
      }
  }

  /** Bots bought on the market on a market day, per bracket (the demand of the next day). */
  private salesByBracket(season: number, day: string | undefined): Map<string, number> {
    const out = new Map<string, number>();
    const ids = day ? this.offerIds(day) : [];
    if (!ids.length) return out;
    const lib = new Map(this.bots.list().map((b) => [b.id, b]));
    const bought = this.db
      .select({ botId: udtRoster.botId })
      .from(udtRoster)
      .where(and(eq(udtRoster.season, season), inArray(udtRoster.botId, ids)))
      .all();
    for (const r of bought) {
      const b = lib.get(r.botId);
      if (!b) continue;
      const k = bracketOf(b.skill);
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    return out;
  }

  /**
   * Bids from before the instant market (decision 152) that were never settled: their Neuro
   * goes back once.
   */
  refundOpenBids(): number {
    const open = this.db.select().from(udtBids).where(eq(udtBids.status, 'open')).all();
    if (!open.length) return 0;
    const seasonOf = new Map(
      this.db
        .select()
        .from(udtDays)
        .all()
        .map((d) => [d.day, d.season]),
    );
    let n = 0;
    for (const b of open) {
      // The day of the offer gives the season; without it the bid stays open (and is logged).
      const season = seasonOf.get(b.day);
      if (season === undefined) {
        this.log.error(`udt market: old bid ${b.id} has no market day ${b.day}, not refunded`);
        continue;
      }
      this.db.transaction(() => {
        this.ledger.book({
          season,
          userId: b.userId,
          kind: 'udt_refund',
          amount: b.amount,
          ref: `bid-refund:${b.id}`,
          meta: { botId: b.botId },
        });
        this.db.update(udtBids).set({ status: 'lost' }).where(eq(udtBids.id, b.id)).run();
      });
      n++;
    }
    this.log.info(`udt market: ${n} open bids of the old market refunded`);
    return n;
  }

  private paySalaries(
    season: number,
    day: string,
    weeks: number,
    roster: (typeof udtRoster.$inferSelect)[],
    values: Map<string, number>,
    byId: Map<string, LibraryBot>,
    onBots: ReturnType<UdtService['traitsOnBots']>,
  ) {
    const own = this.udt.ownBots(season);
    for (const r of roster) {
      // Bots the managers made play for free (starter, talents, apprentices) or for a share of
      // the salary (blueprint bots, owner 25.10.).
      // Keepers play for free (league plan L-E7).
      const o = own.get(r.botId);
      const share = r.starter || (o?.keptFrom ?? null) !== null ? 0 : madeSalaryShare(o?.origin);
      if (!share) continue;
      const b = byId.get(r.botId);
      const traits = onBots.get(r.botId) ?? [];
      const value = values.get(r.botId);
      const salary =
        Math.round(
          (weeklySalary(
            value !== undefined && b ? withTraits(value, b, traits) : r.price,
            b?.skill ?? 4,
          ) *
            managerEffects(traits).salary *
            share) /
            10,
        ) * 10;
      // A strike from before the owed salaries (migration 33) still owes that week.
      const due = r.salaryDue + salary * weeks + (r.striking && !r.salaryDue ? salary : 0);
      if (!due && !r.striking) continue;
      const can = this.ledger.spendable(r.userId).spendable >= due;
      if (can && due > 0)
        this.ledger.book({
          season,
          userId: r.userId,
          kind: 'udt_salary',
          amount: -due,
          ref: `salary:${season}:${day}:${r.botId}`,
          meta: { botId: r.botId, weeks, owed: r.salaryDue },
        });
      // Not payable: the bot strikes and the salary stays owed (no week goes free).
      this.db
        .update(udtRoster)
        .set({ striking: !can, salaryDue: can ? 0 : due })
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

  /** When the next market day opens (ms). */
  nextAt(): number {
    const today = this.udt.today();
    return zonedMs(
      this.dayDone(today) ? nextDay(today) : today,
      this.settings.get().udt.marketTime,
      this.seasons.timeZone,
    );
  }

  /** The market page: today's offers with price, value and history; who bought what. */
  view(user: User) {
    this.udt.assertOn();
    const season = this.udt.season();
    const last = this.lastDay(season.number);
    const tz = this.seasons.timeZone;
    const marketTime = this.settings.get().udt.marketTime;
    const today = this.udt.today();
    const nextAt = zonedMs(this.dayDone(today) ? nextDay(today) : today, marketTime, tz);
    const size = this.udt.team(user.id, season.number)
      ? this.udt.roster(user.id, season.number).length
      : 0;
    if (!last)
      return {
        day: null,
        index: this.udt.index(season.number),
        nextAt,
        offers: [],
        rosterSize: size,
        rosterMax: ROSTER_MAX,
      };
    const lib = new Map(this.bots.list().map((b) => [b.id, b]));
    const owners = this.udt.owners(season.number);
    const tags = new Map(this.udt.teams(season.number).map((t) => [t.userId, t.tag]));
    const offers = this.db.select().from(udtOffers).where(eq(udtOffers.day, last.day)).all();
    const homegrown = this.career.homegrown();
    const careers = this.career.careers();
    const history = this.history(
      offers.map((o) => o.botId),
      14,
    );
    return {
      day: last.day,
      index: last.economyIndex,
      nextAt,
      rosterSize: size,
      rosterMax: ROSTER_MAX,
      offers: offers.flatMap((o) => {
        const b = lib.get(o.botId);
        if (!b) return [];
        const h = history.get(b.id) ?? [];
        const owner = owners.get(b.id);
        return [
          {
            botId: b.id,
            // Library bots appear without their clan tag: in the Dream Team the manager's tag counts.
            name: b.name,
            skill: b.skill,
            rarity: botRarity(b.skill),
            botClass: b.botClass,
            skin: b.skin,
            face: b.face,
            traits: b.traits,
            price: o.minPrice,
            /** The demand in the value: >1 in demand (bracket sold well), <1 unsold for days. */
            demand: o.demand,
            value: h.at(-1)?.value ?? o.minPrice,
            history: h,
            sold: owner !== undefined,
            /** The tag of the team that bought it (sold). */
            buyer: owner !== undefined ? (tags.get(owner) ?? null) : null,
            mine: owner === user.id,
            homegrown: homegrown.get(b.id) ?? null,
            career: careers.get(b.id) ?? null,
          },
        ];
      }),
    };
  }

  /**
   * Market values of the last `days` market days per bot, with the economy index of each day
   * (value / index: the bot's own development without the economy).
   */
  history(botIds: readonly string[], days: number) {
    const out = new Map<string, { day: string; value: number; index: number }[]>();
    if (!botIds.length) return out;
    const recent = this.db.select().from(udtDays).orderBy(desc(udtDays.day)).limit(days).all();
    const indexOf = new Map(recent.map((d) => [d.day, d.economyIndex]));
    const from = recent.at(-1)?.day ?? '0000-00-00';
    for (const v of this.db
      .select()
      .from(udtValues)
      .where(and(inArray(udtValues.botId, [...botIds]), gte(udtValues.day, from)))
      .orderBy(asc(udtValues.day))
      .all())
      out.set(v.botId, [
        ...(out.get(v.botId) ?? []),
        { day: v.day, value: v.value, index: indexOf.get(v.day) ?? 1 },
      ]);
    return out;
  }

  /** Buys an offer of the day at its price, at once (first come, first served). */
  buy(user: User, body: BuyInput) {
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
    if (!this.bots.list().some((b) => b.id === body.botId)) throw notFound('offer');
    if (this.udt.roster(user.id, season.number).length >= ROSTER_MAX)
      throw conflict('at most {max} bots: your roster is full', { max: ROSTER_MAX });
    // Unique per purchase: a bot sold back can be bought again the same day.
    const ref = `buy:${season.number}:${last.day}:${body.botId}:${randomId(6)}`;
    // Throws when the Neuro do not reach (nothing changes then).
    this.ledger.charge({
      userId: user.id,
      kind: 'udt_purchase',
      amount: offer.minPrice,
      ref,
      meta: { botId: body.botId, day: last.day },
    });
    this.db
      .insert(udtRoster)
      .values({
        season: season.number,
        botId: body.botId,
        userId: user.id,
        price: offer.minPrice,
        acquiredAt: new Date(this.clock.now()).toISOString(),
      })
      .run();
    this.career.saleBonus(season.number, body.botId, offer.minPrice, ref);
    return this.view(user);
  }

  /** Sells a bot back to the market for 85 % of its value (not the starter, not while it plays). */
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
    if (this.udt.isOwnBot(season.number, botId))
      throw conflict('a bot made by a team cannot be sold to the market, only traded');
    const bot = this.bots.list().find((b) => b.id === botId);
    // Its lineup is fixed in a seeded or running tournament: it plays that one out first.
    if (playingBots(this.db, this.events, user.id).has(botId))
      throw conflict('{name} plays in a running Dream Team tournament', {
        name: bot?.name ?? botId,
      });
    // 85 % of today's value, at most what the bot cost (a rising index made buying and selling
    // back a sure gain, M7; with traits the value counted them and the scrap came on top).
    const price = Math.min(sellPrice(bot ? this.udt.value(bot, season.number) : r.price), r.price);
    this.db
      .delete(udtRoster)
      .where(and(eq(udtRoster.season, season.number), eq(udtRoster.botId, botId)))
      .run();
    // Its traits do not go to the market: they turn into scrap.
    this.udt.scrapBotTraits(season.number, user.id, botId);
    const ref = `sale:${season.number}:${botId}:${randomId(6)}`;
    this.ledger.book({
      season: season.number,
      userId: user.id,
      kind: 'udt_sale',
      amount: price,
      ref,
      meta: { botId },
    });
    // Salary still owed comes out of the sale (at most the price).
    const owed = Math.min(r.salaryDue, price);
    if (owed > 0)
      this.ledger.book({
        season: season.number,
        userId: user.id,
        kind: 'udt_salary',
        amount: -owed,
        ref: `${ref}:salary`,
        meta: { botId, owed: r.salaryDue },
      });
    return this.udt.view(user);
  }
}

/** Mondays after `from` up to and including `to` (days as YYYY-MM-DD). */
export function mondaysAfter(from: string, to: string): number {
  const days = daysBetween(from, to);
  let n = 0;
  for (let i = 1; i <= days; i++) {
    const [y, m, d] = from.split('-').map(Number) as [number, number, number];
    if (new Date(Date.UTC(y, m - 1, d + i)).getUTCDay() === 1) n++;
  }
  return n;
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
