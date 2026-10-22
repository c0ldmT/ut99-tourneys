import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { roundNeuro } from '@tourney/udt';
import { z } from 'zod';
import type { User } from '../auth/users.service.js';
import { UsersService } from '../auth/users.service.js';
import { BotsService } from '../bots/bots.service.js';
import { badRequest, conflict, forbidden, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { udtRoster, udtTrades, udtTraits } from '../db/schema.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import { ROSTER_MAX } from './udt-market.service.js';
import { playingBots } from './udt-playing.js';
import { UdtService, type RosterBot } from './udt.service.js';

const DAY = 86_400_000;

export const TradeBody = z
  .object({
    to: z.string().min(1).max(40),
    give: z.array(z.string().min(1).max(40)).max(ROSTER_MAX).default([]),
    take: z.array(z.string().min(1).max(40)).max(ROSTER_MAX).default([]),
    giveNeuro: z.number().int().min(0).max(100_000_000).default(0),
    takeNeuro: z.number().int().min(0).max(100_000_000).default(0),
    message: z.string().trim().max(200).optional(),
  })
  .refine((b) => b.give.length + b.take.length > 0, 'a trade needs at least one bot')
  .refine((b) => !(b.giveNeuro > 0 && b.takeNeuro > 0), 'Neuro goes one way only');
export type TradeInput = z.infer<typeof TradeBody>;

type TradeRow = typeof udtTrades.$inferSelect;
type Status = 'open' | 'accepted' | 'declined' | 'withdrawn' | 'expired' | 'void';

/**
 * Dream Team trades between managers (phase 3): bots with their traits and Neuro both ways.
 * Brakes against moving Neuro to a friend: both sides worth at least `tradeBalancePct` of each
 * other, a fee on what each side receives, a lock after a bot was bought or traded, a limit of
 * trades per pair and week. The proposer's Neuro and fee are held until the offer is decided.
 */
@Injectable()
export class UdtTradesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(EventLogService) private readonly events: EventLogService,
    @Inject(UdtService) private readonly udt: UdtService,
  ) {}

  private cfg() {
    return this.settings.get().udt;
  }

  private assertOn() {
    this.udt.assertOn();
    if (!this.cfg().tradeEnabled) throw forbidden('trading is switched off');
  }

  private nowIso() {
    return new Date(this.clock.now()).toISOString();
  }

  /** Bots playing in a seeded or running Dream Team tournament of their manager. */
  private playing(userId: string): Set<string> {
    return playingBots(this.db, this.events, userId);
  }

  /** Why a roster bot cannot be traded now (null: it can). */
  private blocked(r: RosterBot, acquiredAt: string, playing: Set<string>): string | null {
    if (r.starter || r.own) return 'starter';
    if (playing.has(r.botId)) return 'playing';
    const lock = this.cfg().tradeLockDays * DAY;
    if (lock && Date.parse(acquiredAt) + lock > this.clock.now()) return 'locked';
    return null;
  }

  private acquired(season: number, userId: string): Map<string, string> {
    return new Map(
      this.db
        .select({ botId: udtRoster.botId, at: udtRoster.acquiredAt })
        .from(udtRoster)
        .where(and(eq(udtRoster.season, season), eq(udtRoster.userId, userId)))
        .all()
        .map((r) => [r.botId, r.at]),
    );
  }

  /** A manager's roster as others see it for a trade: values, traits, level, why not tradable. */
  rosterFor(userId: string) {
    const season = this.udt.season().number;
    const at = this.acquired(season, userId);
    const playing = this.playing(userId);
    const lock = this.cfg().tradeLockDays * DAY;
    return this.udt.roster(userId, season).map((r) => {
      const a = at.get(r.botId) ?? this.nowIso();
      return {
        botId: r.botId,
        name: r.name,
        gameName: r.gameName,
        skill: r.skill,
        rarity: r.rarity,
        traits: r.traits,
        effective: r.effective,
        udtTraits: r.udtTraits,
        level: r.level,
        slots: r.slots,
        stamina: r.stamina,
        value: r.value,
        starter: r.starter,
        blocked: this.blocked(r, a, playing),
        unlocksAt: lock ? new Date(Date.parse(a) + lock).toISOString() : null,
      };
    });
  }

  /** Other managers of the season with their rosters (the trade partner list). */
  partners(user: User) {
    this.assertOn();
    const season = this.udt.season().number;
    const ai = this.udt.aiIds();
    const aiOn = this.udt.aiOn();
    return this.udt
      .teams(season)
      .filter((t) => t.userId !== user.id && (aiOn || !ai.has(t.userId)))
      .map((t) => ({
        userId: t.userId,
        name: t.name,
        tag: t.tag,
        manager: this.users.byId(t.userId)?.displayName ?? '?',
        ai: ai.has(t.userId),
        roster: this.rosterFor(t.userId),
      }));
  }

  /** Fee for receiving `value` (bots + Neuro). */
  private fee(value: number): number {
    return roundNeuro((value * this.cfg().tradeFeePct) / 100);
  }

  /** Checks the bots of one side and returns their market values. */
  private side(userId: string, botIds: string[], season: number): number {
    if (new Set(botIds).size !== botIds.length) throw badRequest('a bot twice in the trade');
    const roster = new Map(this.udt.roster(userId, season).map((r) => [r.botId, r]));
    const at = this.acquired(season, userId);
    const playing = this.playing(userId);
    let value = 0;
    for (const id of botIds) {
      const r = roster.get(id);
      if (!r) throw conflict('bot {id} is not in that roster (any more)', { id });
      const why = this.blocked(r, at.get(id) ?? this.nowIso(), playing);
      if (why === 'starter')
        throw conflict('{name} was made by its team (starter, talent, apprentice): it stays', {
          name: r.name,
        });
      if (why === 'playing')
        throw conflict('{name} plays in a running Dream Team tournament', { name: r.name });
      if (why === 'locked')
        throw conflict('{name} was bought or traded less than {tradeLockDays} days ago', {
          name: r.name,
          tradeLockDays: this.cfg().tradeLockDays,
        });
      value += r.value;
    }
    return value;
  }

  private sizes(season: number, a: string, b: string) {
    const n = (u: string) =>
      this.db
        .select({ id: udtRoster.botId })
        .from(udtRoster)
        .where(and(eq(udtRoster.season, season), eq(udtRoster.userId, u)))
        .all().length;
    return [n(a), n(b)] as const;
  }

  /** Accepted trades of the pair in the last 7 days. */
  private pairCount(season: number, a: string, b: string): number {
    const since = new Date(this.clock.now() - 7 * DAY).toISOString();
    return this.db
      .select()
      .from(udtTrades)
      .where(
        and(
          eq(udtTrades.season, season),
          eq(udtTrades.status, 'accepted'),
          or(
            and(eq(udtTrades.fromUser, a), eq(udtTrades.toUser, b)),
            and(eq(udtTrades.fromUser, b), eq(udtTrades.toUser, a)),
          ),
        ),
      )
      .all()
      .filter((t) => (t.decidedAt ?? '') >= since).length;
  }

  /** All checks of a trade with today's values; returns values and fees. */
  private check(
    season: number,
    from: string,
    to: string,
    give: string[],
    take: string[],
    giveNeuro: number,
    takeNeuro: number,
  ) {
    const cfg = this.cfg();
    const giveBots = this.side(from, give, season);
    const takeBots = this.side(to, take, season);
    const giveValue = giveBots + giveNeuro;
    const takeValue = takeBots + takeNeuro;
    const hi = Math.max(giveValue, takeValue);
    const lo = Math.min(giveValue, takeValue);
    if (hi > 0 && lo * 100 < hi * cfg.tradeBalancePct)
      throw conflict(
        'unbalanced: one side is worth {giveValue}, the other {takeValue} Neuro (the smaller must be at least {tradeBalancePct} %)',
        { giveValue, takeValue, tradeBalancePct: cfg.tradeBalancePct },
      );
    const [fromSize, toSize] = this.sizes(season, from, to);
    if (
      fromSize - give.length + take.length > ROSTER_MAX ||
      toSize - take.length + give.length > ROSTER_MAX
    )
      throw conflict('at most {max} bots per roster', { max: ROSTER_MAX });
    // Every manager keeps at least one bot (the starter cannot go, but the rule is explicit).
    if (fromSize - give.length + take.length < 1 || toSize - take.length + give.length < 1)
      throw conflict('every manager keeps at least one bot');
    if (cfg.tradePairPerWeek && this.pairCount(season, from, to) >= cfg.tradePairPerWeek)
      throw conflict('at most {tradePairPerWeek} trades between two managers per week', {
        tradePairPerWeek: cfg.tradePairPerWeek,
      });
    return {
      giveValue,
      takeValue,
      // Each side pays the fee on what it receives.
      feeFrom: this.fee(takeValue),
      feeTo: this.fee(giveValue),
    };
  }

  /** Fee and balance of a planned trade (the form shows them before sending). */
  preview(user: User, body: TradeInput) {
    this.assertOn();
    const season = this.udt.season().number;
    const c = this.check(
      season,
      user.id,
      body.to,
      body.give,
      body.take,
      body.giveNeuro,
      body.takeNeuro,
    );
    return { ...c, balancePct: this.cfg().tradeBalancePct, feePct: this.cfg().tradeFeePct };
  }

  /** Makes an offer: the proposer's Neuro and fee are held until it is decided. */
  propose(user: User, body: TradeInput) {
    this.assertOn();
    const season = this.udt.season().number;
    if (body.to === user.id) throw badRequest('a trade needs two managers');
    if (!this.udt.team(user.id, season)) throw conflict('found your team first');
    if (!this.udt.team(body.to, season)) throw notFound('team of that manager');
    if (!this.udt.aiOn() && this.udt.aiIds().has(body.to))
      throw conflict('the AI managers are switched off');
    this.sweep(season);
    const c = this.check(
      season,
      user.id,
      body.to,
      body.give,
      body.take,
      body.giveNeuro,
      body.takeNeuro,
    );
    const id = `x${randomId(12)}`;
    if (body.giveNeuro > 0)
      this.ledger.charge({
        userId: user.id,
        kind: 'udt_trade',
        amount: body.giveNeuro,
        ref: `trade-hold:${id}`,
        meta: { tradeId: id },
      });
    if (c.feeFrom > 0)
      try {
        this.ledger.charge({
          userId: user.id,
          kind: 'udt_trade_fee',
          amount: c.feeFrom,
          ref: `trade-fee-hold:${id}`,
          meta: { tradeId: id },
        });
      } catch (e) {
        this.refund(season, id, user.id, body.giveNeuro, 0);
        throw e;
      }
    const now = this.clock.now();
    this.db
      .insert(udtTrades)
      .values({
        id,
        season,
        fromUser: user.id,
        toUser: body.to,
        giveJson: JSON.stringify(body.give),
        takeJson: JSON.stringify(body.take),
        giveNeuro: body.giveNeuro,
        takeNeuro: body.takeNeuro,
        giveValue: c.giveValue,
        takeValue: c.takeValue,
        feeFrom: c.feeFrom,
        feeTo: c.feeTo,
        message: body.message || null,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + this.cfg().tradeExpiryHours * 3_600_000).toISOString(),
      })
      .run();
    return this.list(user);
  }

  /** Gives the held Neuro and fee back. */
  private refund(season: number, id: string, userId: string, neuro: number, fee: number) {
    if (neuro > 0)
      this.ledger.book({
        season,
        userId,
        kind: 'udt_trade',
        amount: neuro,
        ref: `trade-back:${id}`,
        meta: { tradeId: id },
      });
    if (fee > 0)
      this.ledger.book({
        season,
        userId,
        kind: 'udt_trade_fee',
        amount: fee,
        ref: `trade-fee-back:${id}`,
        meta: { tradeId: id },
      });
  }

  private close(t: TradeRow, status: Exclude<Status, 'open' | 'accepted'>, reason?: string) {
    this.db
      .update(udtTrades)
      .set({ status, reason: reason ?? null, decidedAt: this.nowIso() })
      .where(and(eq(udtTrades.id, t.id), eq(udtTrades.status, 'open')))
      .run();
    this.refund(t.season, t.id, t.fromUser, t.giveNeuro, t.feeFrom);
  }

  /** Expires old offers and voids offers whose bots left a roster. */
  sweep(season: number): void {
    const open = this.db
      .select()
      .from(udtTrades)
      .where(and(eq(udtTrades.season, season), eq(udtTrades.status, 'open')))
      .all();
    if (!open.length) return;
    const owners = this.udt.owners(season);
    const now = this.nowIso();
    for (const t of open) {
      if (t.expiresAt <= now) {
        this.close(t, 'expired');
        continue;
      }
      const give = JSON.parse(t.giveJson) as string[];
      const take = JSON.parse(t.takeJson) as string[];
      if (
        give.some((b) => owners.get(b) !== t.fromUser) ||
        take.some((b) => owners.get(b) !== t.toUser)
      )
        this.close(t, 'void', 'a bot left its roster');
    }
  }

  private get(id: string, season: number): TradeRow {
    const t = this.db
      .select()
      .from(udtTrades)
      .where(and(eq(udtTrades.id, id), eq(udtTrades.season, season)))
      .get();
    if (!t) throw notFound('trade');
    return t;
  }

  /** The partner accepts: checks again with today's values, swaps bots and Neuro, pays fees. */
  accept(user: User, id: string) {
    this.assertOn();
    const season = this.udt.season().number;
    this.sweep(season);
    const t = this.get(id, season);
    if (t.toUser !== user.id) throw forbidden('only the partner can accept');
    if (t.status !== 'open') throw conflict('the offer is {status}', { status: t.status });
    const give = JSON.parse(t.giveJson) as string[];
    const take = JSON.parse(t.takeJson) as string[];
    // Values may have changed since the offer (market days): the balance must still hold. The
    // fees stay as offered.
    this.check(season, t.fromUser, t.toUser, give, take, t.giveNeuro, t.takeNeuro);
    // Payment, fee, bots and the status in one transaction: when the fee cannot be paid nothing is
    // booked, so a later accept pays again. (Before, the pay ref stayed booked and made the next
    // accept free – hence the new ref name: old databases may hold `trade-pay:<id>`.)
    this.db.transaction(() => {
      if (t.takeNeuro > 0)
        this.ledger.charge({
          userId: user.id,
          kind: 'udt_trade',
          amount: t.takeNeuro,
          ref: `trade-paid:${id}`,
          meta: { tradeId: id },
        });
      if (t.feeTo > 0)
        this.ledger.charge({
          userId: user.id,
          kind: 'udt_trade_fee',
          amount: t.feeTo,
          ref: `trade-fee:${id}`,
          meta: { tradeId: id },
        });
      const now = this.nowIso();
      const move = (botIds: string[], to: string) => {
        if (!botIds.length) return;
        this.db
          .update(udtRoster)
          .set({ userId: to, dmSlot: null, mhSlot: null, bench: null, acquiredAt: now })
          .where(and(eq(udtRoster.season, season), inArray(udtRoster.botId, botIds)))
          .run();
        // The traits go with the bot.
        this.db
          .update(udtTraits)
          .set({ userId: to })
          .where(and(eq(udtTraits.season, season), inArray(udtTraits.botId, botIds)))
          .run();
      };
      move(give, t.toUser);
      move(take, t.fromUser);
      if (t.giveNeuro > 0)
        this.ledger.book({
          season,
          userId: t.toUser,
          kind: 'udt_trade',
          amount: t.giveNeuro,
          ref: `trade-in:${id}:${t.toUser}`,
          meta: { tradeId: id },
        });
      if (t.takeNeuro > 0)
        this.ledger.book({
          season,
          userId: t.fromUser,
          kind: 'udt_trade',
          amount: t.takeNeuro,
          ref: `trade-in:${id}:${t.fromUser}`,
          meta: { tradeId: id },
        });
      this.db
        .update(udtTrades)
        .set({ status: 'accepted', decidedAt: now })
        .where(eq(udtTrades.id, id))
        .run();
    });
    this.log.info(`udt trade ${id} accepted (${give.length} for ${take.length} bots)`);
    // Other offers with these bots cannot happen any more.
    this.sweep(season);
    return this.list(user);
  }

  decline(user: User, id: string) {
    this.assertOn();
    const season = this.udt.season().number;
    const t = this.get(id, season);
    if (t.toUser !== user.id) throw forbidden('only the partner can decline');
    if (t.status !== 'open') throw conflict('the offer is {status}', { status: t.status });
    this.close(t, 'declined');
    return this.list(user);
  }

  withdraw(user: User, id: string) {
    this.assertOn();
    const season = this.udt.season().number;
    const t = this.get(id, season);
    if (t.fromUser !== user.id) throw forbidden('only the proposer can withdraw');
    if (t.status !== 'open') throw conflict('the offer is {status}', { status: t.status });
    this.close(t, 'withdrawn');
    return this.list(user);
  }

  /** Open offers with the bots' details and the last decided ones of the manager. */
  list(user: User) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    this.sweep(season);
    const rows = this.db
      .select()
      .from(udtTrades)
      .where(
        and(
          eq(udtTrades.season, season),
          or(eq(udtTrades.fromUser, user.id), eq(udtTrades.toUser, user.id)),
        ),
      )
      .orderBy(desc(udtTrades.createdAt))
      .limit(60)
      .all();
    const lib = new Map(this.bots.list().map((b) => [b.id, b]));
    const teams = new Map(this.udt.teams(season).map((t) => [t.userId, t]));
    const bot = (id: string) => {
      const b = lib.get(id);
      return { botId: id, name: b?.name ?? '?', skill: b?.skill ?? 0 };
    };
    const who = (u: string) => ({
      userId: u,
      team: teams.get(u)?.name ?? '?',
      tag: teams.get(u)?.tag ?? '',
      manager: this.users.byId(u)?.displayName ?? '?',
    });
    const out = rows.map((t) => ({
      id: t.id,
      incoming: t.toUser === user.id,
      from: who(t.fromUser),
      to: who(t.toUser),
      give: (JSON.parse(t.giveJson) as string[]).map(bot),
      take: (JSON.parse(t.takeJson) as string[]).map(bot),
      giveNeuro: t.giveNeuro,
      takeNeuro: t.takeNeuro,
      giveValue: t.giveValue,
      takeValue: t.takeValue,
      feeFrom: t.feeFrom,
      feeTo: t.feeTo,
      message: t.message,
      status: t.status as Status,
      reason: t.reason,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      decidedAt: t.decidedAt,
    }));
    const c = this.cfg();
    return {
      enabled: c.tradeEnabled,
      rules: {
        feePct: c.tradeFeePct,
        balancePct: c.tradeBalancePct,
        lockDays: c.tradeLockDays,
        expiryHours: c.tradeExpiryHours,
        pairPerWeek: c.tradePairPerWeek,
      },
      /** The manager's own roster with what can be traded. */
      mine: this.udt.team(user.id, season) ? this.rosterFor(user.id) : [],
      open: out.filter((t) => t.status === 'open'),
      done: out.filter((t) => t.status !== 'open').slice(0, 20),
    };
  }

  /** Open offers waiting for the manager (the menu badge). */
  incoming(userId: string): number {
    const season = this.udt.season().number;
    const now = this.nowIso();
    return this.db
      .select()
      .from(udtTrades)
      .where(
        and(
          eq(udtTrades.season, season),
          eq(udtTrades.toUser, userId),
          eq(udtTrades.status, 'open'),
        ),
      )
      .all()
      .filter((t) => t.expiresAt > now).length;
  }
}
