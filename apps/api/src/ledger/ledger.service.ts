import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { BetsService } from '../bets/bets.service.js';
import { conflict } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { neuroLedger } from '../db/schema.js';
import { SeasonsService } from '../seasons/seasons.service.js';

/** What a booking is for. */
export type LedgerKind =
  | 'udt_reward'
  | 'udt_place'
  | 'udt_purchase'
  | 'udt_sale'
  | 'udt_salary'
  | 'udt_refund'
  | 'udt_breeder'
  | 'udt_pack'
  | 'udt_trade'
  | 'udt_trade_fee'
  | 'udt_ticket'
  | 'udt_pot';

export interface Booking {
  season: number;
  userId: string;
  kind: LedgerKind;
  /** Positive earns, negative spends. */
  amount: number;
  /** Unique: booking the same ref again does nothing (idempotent). */
  ref: string;
  meta?: Record<string, unknown>;
}

export interface LedgerEntry {
  id: string;
  season: number;
  kind: LedgerKind;
  amount: number;
  ref: string;
  at: string;
  meta: Record<string, unknown> | null;
}

/**
 * Neuro ledger: earnings and spendings besides bets and the shop. The bets wallet adds the
 * bookings in time order, so the balance, the leaderboard and the shop see them.
 */
@Injectable()
export class LedgerService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(BetsService) private readonly bets: BetsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
  ) {}

  /** Books an amount; false when the ref was booked before. */
  book(b: Booking): boolean {
    if (!Number.isInteger(b.amount) || b.amount === 0) return false;
    const exists = this.db.select().from(neuroLedger).where(eq(neuroLedger.ref, b.ref)).get();
    if (exists) return false;
    this.db
      .insert(neuroLedger)
      .values({
        id: `l${randomId(12)}`,
        season: b.season,
        userId: b.userId,
        kind: b.kind,
        amount: b.amount,
        ref: b.ref,
        at: new Date(this.clock.now()).toISOString(),
        metaJson: b.meta ? JSON.stringify(b.meta) : null,
      })
      .run();
    return true;
  }

  /** Takes Neuro above the rescue floor of the running season, or throws 409. */
  charge(b: Omit<Booking, 'season' | 'amount'> & { amount: number }): number {
    const s = this.spendable(b.userId);
    if (s.season === null) throw conflict('no season is running');
    const amount = Math.abs(b.amount);
    if (amount > s.spendable)
      throw conflict(`not enough Neuro: ${s.spendable} can be spent (rescue floor ${s.floor})`);
    this.book({ ...b, season: s.season, amount: -amount });
    return s.season;
  }

  /** What a user can spend now: the free Neuro above the floor of the running season. */
  spendable(userId: string) {
    const season = this.seasons.current();
    if (!season) return { season: null, balance: 0, free: 0, floor: 0, spendable: 0 };
    const w = this.bets.wallet(userId, season);
    const floor = season.betting.floor;
    return {
      season: season.number,
      balance: w.balance,
      free: w.free,
      floor,
      spendable: Math.max(0, w.free - floor),
    };
  }

  /** A user's bookings of a season, newest first. */
  entries(userId: string, season: number, limit = 100): LedgerEntry[] {
    return this.db
      .select()
      .from(neuroLedger)
      .where(and(eq(neuroLedger.userId, userId), eq(neuroLedger.season, season)))
      .orderBy(desc(neuroLedger.at))
      .limit(limit)
      .all()
      .map((r) => ({
        id: r.id,
        season: r.season,
        kind: r.kind as LedgerKind,
        amount: r.amount,
        ref: r.ref,
        at: r.at,
        meta: r.metaJson ? (JSON.parse(r.metaJson) as Record<string, unknown>) : null,
      }));
  }

  /** Whether a ref was booked. */
  has(ref: string): boolean {
    return Boolean(this.db.select().from(neuroLedger).where(eq(neuroLedger.ref, ref)).get());
  }

  /** Website reset: the bookings go with the seasons. */
  clearAll(): void {
    this.db.delete(neuroLedger).run();
  }
}
