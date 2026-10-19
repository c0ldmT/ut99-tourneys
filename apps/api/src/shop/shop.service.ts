import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { UsersService, type User } from '../auth/users.service.js';
import { BetsService } from '../bets/bets.service.js';
import { badRequest, conflict, forbidden, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { shopPurchases, users } from '../db/schema.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { seasonStatus } from '../seasons/season-time.js';
import { SettingsService } from '../settings/settings.service.js';
import { StatsService } from '../stats/stats.service.js';
import {
  AWARDS,
  CATALOG,
  itemById,
  lookView,
  SLOTS,
  type Look,
  type LookView,
  type ShopItem,
  type Slot,
} from './catalog.js';

/** A dedication: what the website bots say when they frag the buyer or are fragged by them. */
export const DedicationSchema = z.object({
  /** A bot fragged you ({victim} = you, {killer} = the bot). */
  kill: z.string().trim().max(120).default(''),
  /** You fragged a bot. */
  death: z.string().trim().max(120).default(''),
});
export type Dedication = z.infer<typeof DedicationSchema>;

export const BuyBody = z.object({
  item: z.string().min(1).max(64),
  dedication: DedicationSchema.optional(),
});
export const EquipBody = z.object({
  slot: z.enum(SLOTS),
  item: z.string().max(64).nullable(),
});

type Purchase = typeof shopPurchases.$inferSelect;

/**
 * The Neuro shop: cosmetics paid with the Neuro of the running season, kept for good. A purchase
 * may not take the balance below the rescue floor (no free shopping with rescues).
 */
@Injectable()
export class ShopService {
  private awardCache?: { at: number; map: Map<string, ShopItem[]> };

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(BetsService) private readonly bets: BetsService,
    @Inject(StatsService) private readonly stats: StatsService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  /** The items for sale with the admin's prices; hidden ones left out unless `all`. */
  catalog(all = false): (ShopItem & { hidden: boolean; basePrice: number })[] {
    const s = this.settings.get().shop;
    return CATALOG.map((i) => ({
      ...i,
      basePrice: i.price,
      price: s.prices[i.id] ?? i.price,
      hidden: s.hidden.includes(i.id),
    })).filter((i) => all || !i.hidden);
  }

  private purchases(userId: string): Purchase[] {
    return this.db
      .select()
      .from(shopPurchases)
      .where(eq(shopPurchases.userId, userId))
      .orderBy(desc(shopPurchases.at))
      .all();
  }

  /**
   * Season awards (ended seasons): the champion frame for the most tournament titles, the
   * "Top Bettor" title for the most Neuro at the end. Cached for a minute.
   */
  awards(): Map<string, ShopItem[]> {
    const now = this.clock.now();
    if (this.awardCache && now - this.awardCache.at < 60_000) return this.awardCache.map;
    const map = new Map<string, ShopItem[]>();
    const add = (userId: string, item: ShopItem) =>
      map.set(userId, [...(map.get(userId) ?? []), item]);
    for (const s of this.seasons
      .list()
      .filter((x) => seasonStatus(x, now, this.seasons.timeZone) === 'ended')) {
      const board = this.bets.leaderboard(s.number).rows.filter((r) => !r.bot);
      if (board[0] && board[0].balance > 0) add(board[0].id, AWARDS.topBettor(s.number));
      const rows = this.stats
        .players(s.number, undefined, false)
        .filter((r) => r.key.startsWith('u:'));
      const best = Math.max(0, ...rows.map((r) => r.titles));
      if (best > 0)
        for (const r of rows.filter((x) => x.titles === best))
          add(r.key.slice(2), AWARDS.champion(s.number));
    }
    this.awardCache = { at: now, map };
    return map;
  }

  /** Items a user owns: bought (not refunded) and awarded. */
  owned(userId: string): Set<string> {
    const ids = new Set(
      this.purchases(userId)
        .filter((p) => p.status !== 'rejected')
        .map((p) => p.itemId),
    );
    for (const a of this.awards().get(userId) ?? []) ids.add(a.id);
    return ids;
  }

  look(u: User): Look {
    try {
      return u.lookJson ? (JSON.parse(u.lookJson) as Look) : {};
    } catch {
      return {};
    }
  }

  /** What can be spent: the free Neuro above the rescue floor. */
  private spendable(userId: string) {
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

  private dedicationOf(userId: string) {
    const p = this.purchases(userId).find((x) => x.itemId === 'dedication');
    if (!p) return null;
    const d = DedicationSchema.parse(p.dataJson ? JSON.parse(p.dataJson) : {});
    return { status: p.status as 'pending' | 'approved' | 'rejected', ...d };
  }

  /** The shop page: items, what the user owns and wears, the Neuro to spend. */
  view(user: User) {
    const owned = this.owned(user.id);
    return {
      enabled: this.settings.get().shop.enabled,
      wallet: this.spendable(user.id),
      items: this.catalog().map((i) => ({ ...i, owned: owned.has(i.id) })),
      awards: this.awards().get(user.id) ?? [],
      look: this.look(user),
      dedication: this.dedicationOf(user.id),
    };
  }

  buy(user: User, body: z.infer<typeof BuyBody>) {
    if (!this.settings.get().shop.enabled) throw forbidden('the shop is closed');
    const item = this.catalog().find((i) => i.id === body.item);
    if (!item) throw notFound(`item ${body.item}`);
    const w = this.spendable(user.id);
    if (w.season === null) throw conflict('no season is running');
    const ded = item.slot === 'dedication';
    if (ded) {
      if (this.dedicationOf(user.id) && this.dedicationOf(user.id)!.status !== 'rejected')
        throw conflict('you have a dedication already: change its lines instead');
      const d = DedicationSchema.parse(body.dedication ?? {});
      if (!d.kill && !d.death) throw badRequest('write at least one line');
    } else if (this.owned(user.id).has(item.id)) throw conflict('you own it already');
    if (item.price > w.spendable)
      throw conflict(`not enough Neuro: ${w.spendable} can be spent (rescue floor ${w.floor})`);
    if (ded)
      // A refunded dedication makes room for the new one.
      this.db
        .delete(shopPurchases)
        .where(and(eq(shopPurchases.userId, user.id), eq(shopPurchases.itemId, 'dedication')))
        .run();
    this.db
      .insert(shopPurchases)
      .values({
        id: `p${randomId(12)}`,
        userId: user.id,
        itemId: item.id,
        season: w.season,
        price: item.price,
        at: new Date(this.clock.now()).toISOString(),
        status: ded ? 'pending' : 'ok',
        dataJson: ded ? JSON.stringify(DedicationSchema.parse(body.dedication ?? {})) : null,
      })
      .run();
    // Wear it right away.
    if (item.slot !== 'dedication')
      this.setLook(user, { ...this.look(user), [item.slot]: item.id });
    return this.view(this.users.require(user.id));
  }

  equip(user: User, body: z.infer<typeof EquipBody>) {
    const look = { ...this.look(user) };
    if (body.item === null) delete look[body.slot];
    else {
      const item = itemById(body.item);
      if (!item || item.slot !== body.slot) throw badRequest('this item does not go there');
      if (!this.owned(user.id).has(item.id)) throw forbidden('you do not own it');
      look[body.slot] = item.id;
    }
    this.setLook(user, look);
    return this.view(this.users.require(user.id));
  }

  private setLook(user: User, look: Look) {
    this.db
      .update(users)
      .set({ lookJson: JSON.stringify(look) })
      .where(eq(users.id, user.id))
      .run();
  }

  /** New lines for an owned dedication: back to the admin for approval. */
  changeDedication(user: User, d: Dedication) {
    const cur = this.dedicationOf(user.id);
    if (!cur || cur.status === 'rejected') throw conflict('buy a dedication first');
    if (!d.kill && !d.death) throw badRequest('write at least one line');
    this.db
      .update(shopPurchases)
      .set({ dataJson: JSON.stringify(d), status: 'pending' })
      .where(and(eq(shopPurchases.userId, user.id), eq(shopPurchases.itemId, 'dedication')))
      .run();
    return this.view(this.users.require(user.id));
  }

  /** Every user's look (the website draws names with it); only users who wear something. */
  looks(): { userId: string; name: string; look: LookView }[] {
    const owned = (id: string) => this.owned(id);
    return this.users
      .list()
      .filter((u) => u.lookJson)
      .map((u) => {
        const has = owned(u.id);
        // Only what the user (still) owns: a refunded or no longer awarded item drops out.
        const look = Object.fromEntries(
          Object.entries(this.look(u)).filter(([, id]) => id && has.has(id)),
        ) as Look;
        return { userId: u.id, name: u.displayName, look: lookView(look) };
      })
      .filter((x) => Object.keys(x.look).length);
  }

  // --- admin ----------------------------------------------------------------------------------

  /** Purchases (newest first) with buyer names; dedications to approve on top. */
  log() {
    const names = new Map(this.users.list().map((u) => [u.id, u.displayName]));
    const rows = this.db.select().from(shopPurchases).orderBy(desc(shopPurchases.at)).all();
    return rows.map((p) => ({
      id: p.id,
      userId: p.userId,
      name: names.get(p.userId) ?? p.userId,
      item: p.itemId,
      itemName: itemById(p.itemId)?.name ?? p.itemId,
      season: p.season,
      price: p.price,
      at: p.at,
      status: p.status,
      ...(p.dataJson ? { dedication: DedicationSchema.parse(JSON.parse(p.dataJson)) } : {}),
    }));
  }

  /** Approves or rejects a dedication (rejected: the Neuro come back). */
  review(id: string, approve: boolean) {
    const p = this.db.select().from(shopPurchases).where(eq(shopPurchases.id, id)).get();
    if (!p || p.itemId !== 'dedication') throw notFound(`dedication ${id}`);
    this.db
      .update(shopPurchases)
      .set({ status: approve ? 'approved' : 'rejected' })
      .where(eq(shopPurchases.id, id))
      .run();
    return this.log();
  }

  /** Approved dedications for the game server; `names`: in-game names by user id. */
  dedications(names: ReadonlyMap<string, string>): { name: string; kill: string; death: string }[] {
    if (!names.size) return [];
    return this.db
      .select()
      .from(shopPurchases)
      .where(and(eq(shopPurchases.itemId, 'dedication'), eq(shopPurchases.status, 'approved')))
      .all()
      .filter((p) => names.has(p.userId))
      .map((p) => ({
        name: names.get(p.userId)!,
        ...DedicationSchema.parse(p.dataJson ? JSON.parse(p.dataJson) : {}),
      }));
  }

  /** The tournament winner's look for the champion post (fanfare owners only). */
  fanfareLook(userId: string): LookView | null {
    const u = this.users.byId(userId);
    if (!u) return null;
    const look = this.look(u);
    if (!look.fanfare || !this.owned(u.id).has(look.fanfare)) return null;
    const has = this.owned(u.id);
    return lookView(
      Object.fromEntries(Object.entries(look).filter(([, id]) => id && has.has(id))) as Look,
    );
  }
}

export type { Slot };
