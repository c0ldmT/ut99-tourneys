import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  cannotAssign,
  craftCost,
  DEFAULT_ECONOMY,
  isTraitCode,
  levelOf,
  packPrice,
  BLUEPRINT_CHANCE,
  BLUEPRINTS_MAX,
  rollBox,
  rollTen,
  SCRAP,
  TRAITS,
  traitDef,
  traitOfRarity,
  type PackBox,
  type Pity,
  type Rarity,
  type TraitCode,
} from '@tourney/udt';
import { z } from 'zod';
import type { User } from '../auth/users.service.js';
import { BotsService } from '../bots/bots.service.js';
import { badRequest, conflict, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { udtBlueprints, udtPity, udtRoster, udtTeams, udtTraits } from '../db/schema.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { UdtService } from './udt.service.js';

const BOXES: readonly PackBox[] = ['standard', 'premium', 'elite'];

export const OpenBody = z.object({
  box: z.enum(['standard', 'premium', 'elite']),
  ten: z.boolean().optional(),
});
export type OpenInput = z.infer<typeof OpenBody>;

export const AssignBody = z.object({
  botId: z.string().min(1).max(40),
  /** Gun nut: the favourite weapon (a weapon class of the game). */
  weapon: z.string().min(1).max(64).optional(),
});
export type AssignInput = z.infer<typeof AssignBody>;

export const CraftBody = z.object({ code: z.string().min(1).max(40) });

export interface PullCard {
  id: string | null;
  /** A trait, or "blueprint" (build an own bot from it in the academy). */
  code: TraitCode | 'blueprint';
  rarity: Rarity;
  /** Already in the inventory: turned into scrap. */
  duplicate: boolean;
  scrap: number;
}

/** Random 0..1 for the draws (not seeded: packs are not replayed). */
const rng = () => randomInt(0, 2 ** 32) / 2 ** 32;

/**
 * Dream Team packs and traits: boxes with open drop rates and pity per season, trait cards in
 * the inventory (one of each; duplicates become scrap), putting traits on roster bots within the
 * slots of their level, removing (scrap) and crafting.
 */
@Injectable()
export class UdtPacksService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(UdtService) private readonly udt: UdtService,
    @Inject(BotsService) private readonly bots: BotsService,
  ) {}

  private now(): string {
    return new Date(this.clock.now()).toISOString();
  }

  private pity(season: number, userId: string, box: PackBox) {
    return (
      this.db
        .select()
        .from(udtPity)
        .where(and(eq(udtPity.season, season), eq(udtPity.userId, userId), eq(udtPity.box, box)))
        .get() ?? { sinceEpic: 0, sinceLegendary: 0, opened: 0 }
    );
  }

  private scrapOf(season: number, userId: string): number {
    return (
      this.db
        .select()
        .from(udtTeams)
        .where(and(eq(udtTeams.season, season), eq(udtTeams.userId, userId)))
        .get()?.scrap ?? 0
    );
  }

  private inventory(season: number, userId: string) {
    return this.db
      .select()
      .from(udtTraits)
      .where(
        and(eq(udtTraits.season, season), eq(udtTraits.userId, userId), isNull(udtTraits.botId)),
      )
      .all();
  }

  /** Unused blueprints of the manager this season. */
  blueprints(season: number, userId: string) {
    return this.db
      .select()
      .from(udtBlueprints)
      .where(
        and(
          eq(udtBlueprints.season, season),
          eq(udtBlueprints.userId, userId),
          isNull(udtBlueprints.usedAt),
        ),
      )
      .all();
  }

  /** The packs page: boxes (prices at the index, rates, pity), scrap, inventory, crafting. */
  view(user: User) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    const index = this.udt.index(season);
    const team = this.udt.team(user.id, season);
    const boxes = BOXES.map((box) => {
      const p = DEFAULT_ECONOMY.packs[box];
      const pity = this.pity(season, user.id, box);
      return {
        box,
        price: packPrice(box, index),
        tenPrice: packPrice(box, index, true),
        rates: p.rates,
        /** Boxes until an epic / a legendary is certain (this one counts). */
        epicIn: Math.max(1, p.pityEpic - pity.sinceEpic),
        legendaryIn: Math.max(1, p.pityLegendary - pity.sinceLegendary),
        opened: pity.opened,
      };
    });
    const inv = this.inventory(season, user.id);
    return {
      index,
      hasTeam: !!team,
      scrap: this.scrapOf(season, user.id),
      spendable: this.ledger.spendable(user.id).spendable,
      boxes,
      inventory: inv.map((t) => ({
        id: t.id,
        code: t.code,
        rarity: traitDef(t.code)?.rarity ?? 'common',
        category: traitDef(t.code)?.category ?? 'values',
        needsWeapon: !!traitDef(t.code)?.needsWeapon,
      })),
      blueprints: this.blueprints(season, user.id).map((b) => ({ id: b.id, rarity: b.rarity })),
      /** For the gun nut: the weapons of the game. */
      weapons: this.bots.assets().weapons,
      catalog: TRAITS.map((t) => ({
        ...t,
        scrap: SCRAP[t.rarity],
        craft: craftCost(t.code),
        owned: inv.some((x) => x.code === t.code),
      })),
    };
  }

  /** Opens one box or a 10-pull: pays, draws, keeps new traits, turns duplicates into scrap. */
  open(user: User, body: OpenInput) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    if (!this.udt.team(user.id, season)) throw conflict('found your team first');
    const price = packPrice(body.box, this.udt.index(season), !!body.ten);
    const id = `p${randomId(12)}`;
    this.ledger.charge({
      userId: user.id,
      kind: 'udt_pack',
      amount: price,
      ref: `pack:${id}`,
      meta: { box: body.box, ten: !!body.ten },
    });
    const old = this.pity(season, user.id, body.box);
    const start: Pity = { sinceEpic: old.sinceEpic, sinceLegendary: old.sinceLegendary };
    const drawn = body.ten
      ? rollTen(body.box, start, rng)
      : (() => {
          const r = rollBox(body.box, start, rng);
          return { rarities: [r.rarity], pity: r.pity };
        })();
    this.db
      .insert(udtPity)
      .values({
        season,
        userId: user.id,
        box: body.box,
        sinceEpic: drawn.pity.sinceEpic,
        sinceLegendary: drawn.pity.sinceLegendary,
        opened: old.opened + drawn.rarities.length,
      })
      .onConflictDoUpdate({
        target: [udtPity.season, udtPity.userId, udtPity.box],
        set: {
          sinceEpic: drawn.pity.sinceEpic,
          sinceLegendary: drawn.pity.sinceLegendary,
          opened: old.opened + drawn.rarities.length,
        },
      })
      .run();
    const held = new Set(this.inventory(season, user.id).map((t) => t.code));
    const cards: PullCard[] = [];
    let scrap = 0;
    let blueprints = this.blueprints(season, user.id).length;
    for (const rarity of drawn.rarities) {
      // Now and then a blueprint of the rarity instead of a trait.
      if (rng() < BLUEPRINT_CHANCE) {
        if (blueprints >= BLUEPRINTS_MAX) {
          scrap += SCRAP[rarity];
          cards.push({
            id: null,
            code: 'blueprint',
            rarity,
            duplicate: true,
            scrap: SCRAP[rarity],
          });
          continue;
        }
        const bpId = `p${randomId(12)}`;
        this.db
          .insert(udtBlueprints)
          .values({ id: bpId, season, userId: user.id, rarity, createdAt: this.now() })
          .run();
        blueprints++;
        cards.push({ id: bpId, code: 'blueprint', rarity, duplicate: false, scrap: 0 });
        continue;
      }
      const t = traitOfRarity(rarity, rng);
      if (held.has(t.code)) {
        scrap += SCRAP[t.rarity];
        cards.push({
          id: null,
          code: t.code,
          rarity: t.rarity,
          duplicate: true,
          scrap: SCRAP[t.rarity],
        });
        continue;
      }
      held.add(t.code);
      const cardId = `t${randomId(12)}`;
      this.db
        .insert(udtTraits)
        .values({
          id: cardId,
          season,
          userId: user.id,
          code: t.code,
          source: 'pack',
          createdAt: this.now(),
        })
        .run();
      cards.push({ id: cardId, code: t.code, rarity: t.rarity, duplicate: false, scrap: 0 });
    }
    if (scrap) this.udt.addScrap(season, user.id, scrap);
    return { box: body.box, ten: !!body.ten, price, cards, view: this.view(user) };
  }

  private card(season: number, userId: string, id: string) {
    const t = this.db
      .select()
      .from(udtTraits)
      .where(and(eq(udtTraits.id, id), eq(udtTraits.season, season), eq(udtTraits.userId, userId)))
      .get();
    if (!t) throw notFound('trait card');
    return t;
  }

  /** Puts a trait card from the inventory on a roster bot (within its slots). */
  assign(user: User, cardId: string, body: AssignInput) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    const card = this.card(season, user.id, cardId);
    if (card.botId) throw conflict('the trait is on a bot already');
    const r = this.db
      .select()
      .from(udtRoster)
      .where(
        and(
          eq(udtRoster.season, season),
          eq(udtRoster.botId, body.botId),
          eq(udtRoster.userId, user.id),
        ),
      )
      .get();
    if (!r) throw notFound('bot in your roster');
    const def = traitDef(card.code);
    if (!def || !isTraitCode(card.code)) throw badRequest('unknown trait');
    if (def.needsWeapon && !this.bots.assets().weapons.some((w) => w.name === body.weapon))
      throw badRequest('choose the favourite weapon');
    const on = this.udt.botTraits(season, body.botId).map((t) => t.code);
    const why = cannotAssign(def.code, on, levelOf(r.xp));
    if (why === 'slots') throw conflict('no free trait slot (more from level 5 and 10)');
    if (why === 'same') throw conflict('the bot has this trait');
    if (why === 'legendary') throw conflict('at most one legendary trait per bot');
    if (why === 'body') throw conflict('at most one body trait per bot');
    this.db
      .update(udtTraits)
      .set({
        botId: body.botId,
        weapon: def.needsWeapon ? body.weapon : null,
        assignedAt: this.now(),
      })
      .where(eq(udtTraits.id, cardId))
      .run();
    return this.udt.view(user);
  }

  /** Takes a trait off a bot: it is destroyed and gives its scrap. */
  remove(user: User, cardId: string) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    const card = this.card(season, user.id, cardId);
    if (!card.botId) throw conflict('the trait is not on a bot');
    this.destroy(season, user.id, card.id, card.code);
    return this.udt.view(user);
  }

  /** Turns an inventory card into scrap. */
  scrap(user: User, cardId: string) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    const card = this.card(season, user.id, cardId);
    if (card.botId) throw conflict('take the trait off the bot first');
    this.destroy(season, user.id, card.id, card.code);
    return this.view(user);
  }

  private destroy(season: number, userId: string, id: string, code: string) {
    this.db.delete(udtTraits).where(eq(udtTraits.id, id)).run();
    this.udt.addScrap(season, userId, SCRAP[traitDef(code)?.rarity ?? 'common']);
  }

  /** Crafts a trait with scrap (four times its scrap value), one of each in the inventory. */
  craft(user: User, code: string) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    if (!this.udt.team(user.id, season)) throw conflict('found your team first');
    if (!isTraitCode(code)) throw badRequest('unknown trait');
    if (this.inventory(season, user.id).some((t) => t.code === code))
      throw conflict('you have this trait in your inventory');
    const cost = craftCost(code);
    if (!this.udt.addScrap(season, user.id, -cost)) throw conflict(`crafting costs ${cost} scrap`);
    this.db
      .insert(udtTraits)
      .values({
        id: `t${randomId(12)}`,
        season,
        userId: user.id,
        code,
        source: 'craft',
        createdAt: this.now(),
      })
      .run();
    return this.view(user);
  }
}
