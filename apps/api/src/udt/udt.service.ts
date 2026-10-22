import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { BotTraitsSchema } from '@tourney/protocol';
import {
  baseValue,
  botRarity,
  DEFAULT_ECONOMY,
  economyIndex,
  effectiveValues,
  levelOf,
  developPoints,
  DEVELOP_VALUES,
  marketValue,
  valueAtTop,
  potentialWindow,
  SCRAP,
  starterPotential,
  traitDef,
  traitSlots,
  traitValueFactor,
  valueScore,
  type TraitCode,
  type TraitOnBot,
} from '@tourney/udt';
import { z } from 'zod';
import { BotsService, PersonalitySchema, type LibraryBot } from '../bots/bots.service.js';
import { badRequest, conflict, forbidden, notFound } from '../common/http.js';
import { CLOCK, CONFIG, type ApiClock, type ApiConfig } from '../config.js';
import { DB, type Db } from '../db/database.js';
import {
  bots,
  udtAi,
  udtBids,
  udtBlueprints,
  udtBots,
  udtDays,
  udtEntries,
  udtHall,
  udtOffers,
  udtPity,
  udtRoster,
  udtScouts,
  udtTeams,
  udtTrades,
  udtTraits,
  udtValues,
  users,
} from '../db/schema.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { today } from '../seasons/season-time.js';
import { SeasonsService, type Season } from '../seasons/seasons.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { User } from '../auth/users.service.js';

/** The longest name in the game (UT cuts there): tag + bot name. */
const GAME_NAME_CHARS = 24;
const ASCII = /^[\x20-\x7e]+$/;

const LookRef = z.string().trim().max(48);
/** Chat chance and lines (no defaults: what is left out stays as it is). */
const BotLines = z.object({
  talk: z.number().int().min(0).max(100).optional(),
  lines: PersonalitySchema.shape.lines.unwrap().optional(),
});
/** What a manager sets on an own bot: skin, face, voice and chat lines (not the values). */
export const BotLookBody = z.object({
  /** The model (bot class): cosmetic, free for own bots. */
  botClass: LookRef.optional(),
  skin: LookRef.optional(),
  face: LookRef.optional(),
  voice: LookRef.optional(),
  personality: BotLines.optional(),
});
export type BotLook = z.infer<typeof BotLookBody>;

/** The look and the lines for BotsService.create/update (empty strings: the default). */
export function lookFields(look: BotLook | undefined) {
  if (!look) return {};
  return {
    ...(look.botClass !== undefined ? { botClass: look.botClass } : {}),
    ...(look.skin !== undefined ? { skin: look.skin } : {}),
    ...(look.face !== undefined ? { face: look.face } : {}),
    ...(look.personality ? { personality: look.personality } : {}),
  };
}

export const TeamBody = z.object({
  name: z.string().trim().min(2).max(32).regex(ASCII, 'ASCII letters, digits and signs only'),
  /** In front of the bots' names as it is (brackets only if the manager types them). */
  tag: z.string().trim().min(1).max(8).regex(ASCII, 'ASCII letters, digits and signs only'),
  starter: z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(17)
      .regex(ASCII, 'ASCII letters, digits and signs only (UT99 names)'),
    // Whole steps only: the game rounds the skill, the price would take the fraction (cheap values).
    skill: z.number().int().min(0).max(7),
    botClass: z.string().trim().max(48).optional(),
    skin: z.string().trim().max(48).optional(),
    face: z.string().trim().max(48).optional(),
    traits: BotTraitsSchema.optional(),
    personality: BotLines.optional(),
  }),
});
export type TeamInput = z.infer<typeof TeamBody>;

const Slots = (n: number) => z.array(z.string().max(40).nullable()).max(n);
export const LineupBody = z.object({
  dm: Slots(5).optional(),
  mh: Slots(5).optional(),
  bench: Slots(2).optional(),
});
export type LineupInput = z.infer<typeof LineupBody>;

export interface RosterBot {
  botId: string;
  name: string;
  /** Name in Dream Team games: [TAG] + bot name, cut to 24 characters. */
  gameName: string;
  skill: number;
  rarity: ReturnType<typeof botRarity>;
  botClass: string | null;
  skin: string | null;
  face: string | null;
  traits: LibraryBot['traits'];
  price: number;
  value: number;
  starter: boolean;
  dmSlot: number | null;
  mhSlot: number | null;
  bench: number | null;
  stamina: number;
  xp: number;
  level: number;
  /** Trait slots at the bot's level. */
  slots: number;
  /** Trait cards on the bot (oldest first). */
  udtTraits: (TraitOnBot & { id: string; rarity: string })[];
  /** Skill and play-style values with the traits (what the game gets). */
  effective: { skill: number; traits: LibraryBot['traits']; overflow: boolean };
  striking: boolean;
  /** Dream Team games this season. */
  games: number;
  /** A bot the manager made: origin, potential (exact from level 5, else a range), points. */
  own: {
    origin: string;
    potential: [number, number];
    points: number;
    spent: number;
    /** The one free renaming is still open. */
    canRename: boolean;
    /** The one breakthrough happened. */
    breakthrough: boolean;
    /** Fully developed for good (from level 5): points have nothing left to buy. */
    maxed: boolean;
  } | null;
}

export interface UdtTeam {
  userId: string;
  name: string;
  tag: string;
  createdAt: string;
  /** Enters open Dream Team tournaments automatically when possible. */
  autoEnter: boolean;
}

/** Neuro per stamina point bought (rest with Neuro, not indexed). */
export const REST_PRICE = DEFAULT_ECONOMY.restPrice;

/**
 * Unreal Dream Team (add-on, settings "udt.enabled"): managers' teams and rosters of a season.
 * The market lives in UdtMarketService, events and rewards come later.
 */
@Injectable()
export class UdtService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
  ) {}

  /**
   * Website reset: every Dream Team season is gone. Teams, rosters, market, packs, trades,
   * academy, yearbook and hall of fame go; so do the bots the managers made and still own and
   * the AI managers (they come back with new teams while they are switched on). Graduated bots
   * are library bots and stay. The ledger is emptied by the reset itself.
   */
  wipeAll(): { teams: number; bots: number; ai: number } {
    return this.db.transaction((tx) => {
      const teams = tx.select({ u: udtTeams.userId }).from(udtTeams).all().length;
      const own = tx
        .select({ id: bots.id })
        .from(bots)
        .where(isNotNull(bots.udtOwner))
        .all()
        .map((b) => b.id);
      const ai = tx
        .select({ id: udtAi.userId })
        .from(udtAi)
        .all()
        .map((a) => a.id);
      for (const t of [
        udtRoster,
        udtDays,
        udtValues,
        udtOffers,
        udtBids,
        udtEntries,
        udtTraits,
        udtPity,
        udtTrades,
        udtBots,
        udtScouts,
        udtBlueprints,
        udtHall,
        udtAi,
        udtTeams,
      ])
        tx.delete(t).run();
      if (own.length) tx.delete(bots).where(inArray(bots.id, own)).run();
      tx.update(bots).set({ udtOrigin: null }).run();
      if (ai.length) tx.delete(users).where(inArray(users.id, ai)).run();
      return { teams, bots: own.length, ai: ai.length };
    });
  }

  enabled(): boolean {
    return this.settings.get().udt.enabled;
  }

  /** Throws 403 while the Dream Team is switched off. */
  assertOn(): void {
    if (!this.enabled()) throw forbidden('the Dream Team is switched off');
  }

  /** The running season, or 409. */
  /** The running season's number, null out of season. */
  seasonNumber(): number | null {
    return this.seasons.current()?.number ?? null;
  }

  season(): Season {
    const s = this.seasons.current();
    if (!s) throw conflict('no season is running');
    return s;
  }

  /** Today's date in the season time zone. */
  today(): string {
    return today(this.clock.now(), this.config.seasonTimeZone);
  }

  /** Economy index of the latest market day of the season (0.3 before the first). */
  index(season: number): number {
    const d = this.db
      .select()
      .from(udtDays)
      .where(eq(udtDays.season, season))
      .orderBy(desc(udtDays.day))
      .get();
    return d?.economyIndex ?? economyIndex([], undefined);
  }

  /**
   * Market value of a bot: the latest market day's value (else computed at the index), raised by
   * the traits on it.
   */
  value(
    bot: Pick<LibraryBot, 'id' | 'skill' | 'traits'>,
    season: number,
    traits: readonly TraitOnBot[] = this.botTraits(season, bot.id),
  ): number {
    const v = this.db
      .select()
      .from(udtValues)
      .where(eq(udtValues.botId, bot.id))
      .orderBy(desc(udtValues.day))
      .get();
    const plain =
      v?.value ??
      marketValue(baseValue(bot.skill, valueScore(bot.traits)), 1, 1, this.index(season));
    return withTraits(plain, bot, traits);
  }

  /** Traits on the bots of a season: bot id -> trait cards, oldest first. */
  traitsOnBots(season: number): Map<string, (TraitOnBot & { id: string })[]> {
    const out = new Map<string, (TraitOnBot & { id: string })[]>();
    for (const t of this.db
      .select()
      .from(udtTraits)
      .where(and(eq(udtTraits.season, season), isNotNull(udtTraits.botId)))
      .orderBy(asc(udtTraits.assignedAt), asc(udtTraits.id))
      .all())
      out.set(t.botId!, [
        ...(out.get(t.botId!) ?? []),
        { id: t.id, code: t.code as TraitCode, weapon: t.weapon },
      ]);
    return out;
  }

  botTraits(season: number, botId: string): (TraitOnBot & { id: string })[] {
    return this.traitsOnBots(season).get(botId) ?? [];
  }

  /** The bots a manager made this season (starter, talents, apprentices). */
  ownBots(season: number, userId?: string): Map<string, typeof udtBots.$inferSelect> {
    return new Map(
      this.db
        .select()
        .from(udtBots)
        .where(
          userId
            ? and(eq(udtBots.season, season), eq(udtBots.userId, userId))
            : eq(udtBots.season, season),
        )
        .all()
        .map((b) => [b.botId, b]),
    );
  }

  /** User ids of the AI managers (whether they act or not). */
  aiIds(): Set<string> {
    return new Set(
      this.db
        .select({ id: udtAi.userId })
        .from(udtAi)
        .all()
        .map((a) => a.id),
    );
  }

  /** AI managers act (setting). */
  aiOn(): boolean {
    return this.settings.get().udt.aiEnabled;
  }

  /** A bot the manager made stays with the team: not sold, not traded, no salary. */
  isOwnBot(season: number, botId: string): boolean {
    return !!this.db
      .select({ id: udtBots.botId })
      .from(udtBots)
      .where(and(eq(udtBots.season, season), eq(udtBots.botId, botId)))
      .get();
  }

  /** Adds (or with a negative amount spends) scrap; false when there is not enough. */
  addScrap(season: number, userId: string, amount: number): boolean {
    const t = this.db
      .select()
      .from(udtTeams)
      .where(and(eq(udtTeams.season, season), eq(udtTeams.userId, userId)))
      .get();
    if (!t || t.scrap + amount < 0) return false;
    this.db
      .update(udtTeams)
      .set({ scrap: t.scrap + amount })
      .where(and(eq(udtTeams.season, season), eq(udtTeams.userId, userId)))
      .run();
    return true;
  }

  /** Destroys the traits on a bot (it leaves the roster): their scrap goes to the manager. */
  scrapBotTraits(season: number, userId: string, botId: string): number {
    const cards = this.db
      .select()
      .from(udtTraits)
      .where(and(eq(udtTraits.season, season), eq(udtTraits.botId, botId)))
      .all();
    if (!cards.length) return 0;
    const scrap = cards.reduce((n, c) => n + SCRAP[traitDef(c.code)?.rarity ?? 'common'], 0);
    this.db
      .delete(udtTraits)
      .where(and(eq(udtTraits.season, season), eq(udtTraits.botId, botId)))
      .run();
    this.addScrap(season, userId, scrap);
    return scrap;
  }

  team(userId: string, season: number): UdtTeam | null {
    const t = this.db
      .select()
      .from(udtTeams)
      .where(and(eq(udtTeams.season, season), eq(udtTeams.userId, userId)))
      .get();
    return t
      ? {
          userId: t.userId,
          name: t.name,
          tag: t.tag,
          createdAt: t.createdAt,
          autoEnter: t.autoEnter,
        }
      : null;
  }

  /** The managers (humans) whose switch "enter automatically" is on this season. */
  autoEntrants(season: number): string[] {
    const ai = this.aiIds();
    return this.db
      .select({ u: udtTeams.userId })
      .from(udtTeams)
      .where(and(eq(udtTeams.season, season), eq(udtTeams.autoEnter, true)))
      .all()
      .map((r) => r.u)
      .filter((u) => !ai.has(u));
  }

  setAutoEnter(user: User, on: boolean): UdtTeam {
    this.assertOn();
    const season = this.season().number;
    if (!this.team(user.id, season)) throw conflict('found your team first');
    this.db
      .update(udtTeams)
      .set({ autoEnter: on })
      .where(and(eq(udtTeams.season, season), eq(udtTeams.userId, user.id)))
      .run();
    return this.team(user.id, season)!;
  }

  /** Buys stamina for a bot of the roster: REST_PRICE Neuro per point, up to 100. */
  rest(user: User, botId: string, points: number) {
    this.assertOn();
    const season = this.season().number;
    const r = this.db
      .select()
      .from(udtRoster)
      .where(
        and(
          eq(udtRoster.season, season),
          eq(udtRoster.botId, botId),
          eq(udtRoster.userId, user.id),
        ),
      )
      .get();
    if (!r) throw notFound('bot in your roster');
    const n = Math.min(Math.round(points), 100 - r.stamina);
    if (n <= 0) throw conflict('the bot is fully rested');
    this.ledger.charge({
      userId: user.id,
      kind: 'udt_rest',
      amount: n * REST_PRICE,
      ref: `rest:${season}:${botId}:${this.clock.now()}`,
      meta: { botId, points: n },
    });
    this.db
      .update(udtRoster)
      .set({ stamina: r.stamina + n })
      .where(and(eq(udtRoster.season, season), eq(udtRoster.botId, botId)))
      .run();
    return this.view(user);
  }

  teams(season: number): UdtTeam[] {
    return this.db
      .select()
      .from(udtTeams)
      .where(eq(udtTeams.season, season))
      .all()
      .map((t) => ({
        userId: t.userId,
        name: t.name,
        tag: t.tag,
        createdAt: t.createdAt,
        autoEnter: t.autoEnter,
      }));
  }

  /** Bots owned this season: bot id -> manager. */
  owners(season: number): Map<string, string> {
    return new Map(
      this.db
        .select({ botId: udtRoster.botId, userId: udtRoster.userId })
        .from(udtRoster)
        .where(eq(udtRoster.season, season))
        .all()
        .map((r) => [r.botId, r.userId]),
    );
  }

  roster(userId: string, season: number): RosterBot[] {
    const team = this.team(userId, season);
    const lib = new Map(this.bots.list().map((b) => [b.id, b]));
    const onBots = this.traitsOnBots(season);
    const own = this.ownBots(season, userId);
    return this.db
      .select()
      .from(udtRoster)
      .where(and(eq(udtRoster.season, season), eq(udtRoster.userId, userId)))
      .all()
      .flatMap((r) => {
        const b = lib.get(r.botId);
        if (!b) return [];
        const level = levelOf(r.xp);
        const slots = traitSlots(level);
        const cards = (onBots.get(b.id) ?? []).slice(0, slots);
        const eff = effectiveValues(b.skill, b.traits ?? {}, cards);
        return [
          {
            botId: b.id,
            name: b.name,
            gameName: gameName(team?.tag ?? '', b.name),
            skill: b.skill,
            rarity: botRarity(b.skill),
            botClass: b.botClass,
            skin: b.skin,
            face: b.face,
            traits: b.traits,
            price: r.price,
            value: r.starter ? 0 : this.value(b, season, cards),
            starter: r.starter,
            dmSlot: r.dmSlot,
            mhSlot: r.mhSlot,
            bench: r.bench,
            stamina: r.stamina,
            xp: r.xp,
            level,
            slots,
            udtTraits: cards.map((c) => ({ ...c, rarity: traitDef(c.code)?.rarity ?? 'common' })),
            effective: { skill: eff.skill, traits: eff.values, overflow: eff.overflow },
            striking: r.striking,
            games: r.games,
            own: ownView(own.get(b.id), level, b.skill, b.traits ?? {}),
          },
        ];
      })
      .sort((a, b) => (a.dmSlot ?? 9) - (b.dmSlot ?? 9) || b.skill - a.skill);
  }

  /** The Dream Team page of a manager. */
  /** The models, skins, faces and voices a manager can choose (stock and the synced servers). */
  looks() {
    this.assertOn();
    const a = this.bots.assets();
    return {
      botClasses: a.botClasses,
      skins: a.skins,
      faces: a.faces,
      voices: a.voices,
      packages: a.packages,
      /** Per model its skins, faces and voices (UT's setup rules, decision 172). */
      models: a.models,
    };
  }

  /** The manager changes model, skin, face, voice and chat lines of an own bot (never its values). */
  editBot(user: User, botId: string, body: BotLook): LibraryBot {
    this.assertOn();
    const b = this.bots.get(botId);
    if (!b || b.udtOwner !== user.id)
      throw forbidden('only your own bots (starter, academy, blueprint) can be changed');
    // What changes must fit the model; an older look that does not fit stays until it is changed.
    this.bots.assertLook(
      {
        botClass: body.botClass ?? b.botClass,
        skin: body.skin ?? b.skin,
        face: body.face ?? b.face,
        voice: body.voice ?? b.traits.voice,
      },
      { botClass: b.botClass, skin: b.skin, face: b.face, voice: b.traits.voice },
    );
    const traits = body.voice !== undefined ? { traits: { ...b.traits, voice: body.voice } } : {};
    return this.bots.update(b.id, { ...lookFields(body), ...traits });
  }

  /**
   * Renames an own bot of the season once, free (the look and lines can change any time, the
   * name only this once). Its game name keeps the team's tag in front.
   */
  rename(user: User, botId: string, name: string): LibraryBot {
    this.assertOn();
    const season = this.season().number;
    const own = this.db
      .select()
      .from(udtBots)
      .where(and(eq(udtBots.botId, botId), eq(udtBots.season, season)))
      .get();
    const b = this.bots.get(botId);
    if (!own || !b || own.userId !== user.id || b.udtOwner !== user.id)
      throw forbidden('only your own bots (starter, academy, blueprint) can be changed');
    if (own.renamed) throw conflict('the bot was renamed already (once per bot)');
    if (own.status !== 'own') throw conflict('the bot is {status}', { status: own.status });
    if (b.name === name) throw badRequest('that is its name already');
    if (this.bots.list().some((x) => x.id !== botId && x.name.toLowerCase() === name.toLowerCase()))
      throw conflict('a bot is called {name} already', { name });
    const tag = this.team(user.id, season)?.tag ?? '';
    if (gameName(tag, name).length < `${tag}${name}`.length)
      throw badRequest('{tag}{name} is too long for the game', { tag, name });
    const updated = this.bots.update(botId, { name });
    this.db.update(udtBots).set({ renamed: true }).where(eq(udtBots.botId, botId)).run();
    return updated;
  }

  view(user: User) {
    const enabled = this.enabled();
    const season = this.seasons.current();
    if (!enabled || !season)
      return { enabled, season: season?.number ?? null, team: null, roster: [], index: 0.3 };
    const team = this.team(user.id, season.number);
    return {
      enabled,
      season: season.number,
      today: this.today(),
      index: this.index(season.number),
      team,
      roster: team ? this.roster(user.id, season.number) : [],
      wallet: this.ledger.spendable(user.id),
      starterBudget: this.settings.get().udt.starterBudget,
      starterExtra: this.settings.get().udt.starterExtra,
    };
  }

  /** The manager's bookings of the running season. */
  ledgerOf(userId: string) {
    return this.ledger.entries(userId, this.season().number, 50);
  }

  /** Founds the manager's team of the season with its starter bot (made by the manager). */
  createTeam(user: User, body: TeamInput): UdtTeam {
    this.assertOn();
    const season = this.season();
    if (this.team(user.id, season.number)) throw conflict('you have a team this season');
    const nameKey = body.name.toLowerCase();
    const tagKey = body.tag.toLowerCase();
    const others = this.teams(season.number);
    if (others.some((t) => t.name.toLowerCase() === nameKey))
      throw conflict('the team name {name} is taken', { name: body.name });
    if (others.some((t) => t.tag.toLowerCase() === tagKey))
      throw conflict('the tag {tag} is taken', { tag: body.tag });
    if (gameName(body.tag, body.starter.name).length < `${body.tag}${body.starter.name}`.length)
      throw badRequest(
        'tag and bot name are too long for the game: {tag}{name} (at most {chars})',
        { tag: body.tag, name: body.starter.name, chars: GAME_NAME_CHARS },
      );
    const cfg = this.settings.get().udt;
    const budget = cfg.starterBudget + cfg.starterExtra;
    const cost = Math.round(baseValue(body.starter.skill, valueScore(body.starter.traits)));
    if (cost > budget)
      throw badRequest('the starter bot costs {cost} of {budget} points: lower skill or values', {
        cost,
        budget,
      });
    this.bots.assertLook({
      botClass: body.starter.botClass,
      skin: body.starter.skin,
      face: body.starter.face,
      voice: body.starter.traits?.voice,
    });
    const bot = this.bots.create({
      name: body.starter.name,
      skill: body.starter.skill,
      ...(body.starter.botClass ? { botClass: body.starter.botClass } : {}),
      ...(body.starter.skin ? { skin: body.starter.skin } : {}),
      ...(body.starter.face ? { face: body.starter.face } : {}),
      ...(body.starter.traits ? { traits: body.starter.traits } : {}),
      ...(body.starter.personality ? { personality: body.starter.personality } : {}),
      active: false,
    });
    this.db
      .update(bots)
      .set({ udtOwner: user.id, udtOrigin: 'starter' })
      .where(eq(bots.id, bot.id))
      .run();
    const now = new Date(this.clock.now()).toISOString();
    this.db
      .insert(udtTeams)
      .values({
        season: season.number,
        userId: user.id,
        name: body.name,
        nameKey,
        tag: body.tag,
        tagKey,
        createdAt: now,
      })
      .run();
    this.db
      .insert(udtRoster)
      .values({
        season: season.number,
        botId: bot.id,
        userId: user.id,
        price: 0,
        acquiredAt: now,
        starter: true,
        dmSlot: 1,
        mhSlot: 1,
      })
      .run();
    this.db
      .insert(udtBots)
      .values({
        botId: bot.id,
        season: season.number,
        userId: user.id,
        origin: 'starter',
        potential: starterPotential(body.starter.skill),
        createdAt: now,
      })
      .run();
    return this.team(user.id, season.number)!;
  }

  /** Lineups for deathmatch and Monster Hunt (slots 1..5) and the bench order (1..2). */
  setLineup(user: User, body: LineupInput): RosterBot[] {
    this.assertOn();
    const season = this.season();
    if (!this.team(user.id, season.number)) throw notFound('team');
    const owned = new Set(this.roster(user.id, season.number).map((r) => r.botId));
    const check = (list: (string | null)[] | undefined, twice: Error) => {
      if (!list) return;
      const ids = list.filter((x): x is string => x !== null);
      if (new Set(ids).size !== ids.length) throw twice;
      for (const id of ids) if (!owned.has(id)) throw badRequest('bot {id} is not yours', { id });
    };
    check(body.dm, badRequest('a bot twice in the deathmatch lineup'));
    check(body.mh, badRequest('a bot twice in the Monster Hunt lineup'));
    check(body.bench, badRequest('a bot twice on the bench'));
    const where = (botId: string) =>
      and(eq(udtRoster.season, season.number), eq(udtRoster.botId, botId));
    this.db.transaction((tx) => {
      for (const id of owned) {
        const set: Partial<typeof udtRoster.$inferInsert> = {};
        if (body.dm) set.dmSlot = slotOf(body.dm, id);
        if (body.mh) set.mhSlot = slotOf(body.mh, id);
        if (body.bench) set.bench = slotOf(body.bench, id);
        if (Object.keys(set).length) tx.update(udtRoster).set(set).where(where(id)).run();
      }
    });
    return this.roster(user.id, season.number);
  }
}

/** "[TAG]Name", cut to what UT shows. */
export function gameName(tag: string, name: string): string {
  return `${tag}${name}`.slice(0, GAME_NAME_CHARS);
}

function slotOf(list: (string | null)[], id: string): number | null {
  const i = list.indexOf(id);
  return i < 0 ? null : i + 1;
}

/** A plain market value raised by the bot's traits. */
export function withTraits(
  plain: number,
  bot: Pick<LibraryBot, 'skill' | 'traits'>,
  traits: readonly TraitOnBot[],
): number {
  if (!traits.length) return plain;
  return Math.round((plain * traitValueFactor(bot.skill, bot.traits ?? {}, traits)) / 10) * 10;
}

/** What the roster shows of an own bot: the potential is a range until level 5. */
function ownView(
  b: typeof udtBots.$inferSelect | undefined,
  level: number,
  skill: number,
  values: LibraryBot['traits'],
) {
  if (!b) return null;
  const p = b.potential;
  const full = DEVELOP_VALUES.every((k) => valueAtTop(values[k]));
  return {
    origin: b.origin,
    potential: (level >= 5 ? [p, p] : potentialWindow(p, skill, b.botId)) as [number, number],
    points: developPoints(level, b.pointsSpent),
    spent: b.pointsSpent,
    canRename: !b.renamed && b.status === 'own',
    breakthrough: b.breakthrough,
    maxed: level >= 5 && full && Math.round(skill) >= p && (b.breakthrough || p >= 7),
  };
}
