import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { BotTraitsSchema } from '@tourney/protocol';
import { baseValue, botRarity, economyIndex, marketValue, valueScore } from '@tourney/udt';
import { z } from 'zod';
import { BotsService, type LibraryBot } from '../bots/bots.service.js';
import { badRequest, conflict, forbidden, notFound } from '../common/http.js';
import { CLOCK, CONFIG, type ApiClock, type ApiConfig } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { bots, udtDays, udtRoster, udtTeams, udtValues } from '../db/schema.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { today } from '../seasons/season-time.js';
import { SeasonsService, type Season } from '../seasons/seasons.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { User } from '../auth/users.service.js';

/** The longest name in the game (UT cuts there): "[TAG]" + bot name. */
const GAME_NAME_CHARS = 24;
const ASCII = /^[\x20-\x7e]+$/;

export const TeamBody = z.object({
  name: z.string().trim().min(2).max(32).regex(ASCII, 'ASCII letters, digits and signs only'),
  tag: z
    .string()
    .trim()
    .min(2)
    .max(5)
    .regex(/^[A-Za-z0-9]+$/, 'letters and digits only'),
  starter: z.object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(17)
      .regex(ASCII, 'ASCII letters, digits and signs only (UT99 names)'),
    skill: z.number().min(0).max(7),
    botClass: z.string().trim().max(48).optional(),
    skin: z.string().trim().max(48).optional(),
    face: z.string().trim().max(48).optional(),
    traits: BotTraitsSchema.optional(),
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
  striking: boolean;
}

export interface UdtTeam {
  userId: string;
  name: string;
  tag: string;
  createdAt: string;
}

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

  enabled(): boolean {
    return this.settings.get().udt.enabled;
  }

  /** Throws 403 while the Dream Team is switched off. */
  assertOn(): void {
    if (!this.enabled()) throw forbidden('the Dream Team is switched off');
  }

  /** The running season, or 409. */
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

  /** Market value of a bot: the latest market day's value, else computed at the index. */
  value(bot: Pick<LibraryBot, 'id' | 'skill' | 'traits'>, season: number): number {
    const v = this.db
      .select()
      .from(udtValues)
      .where(eq(udtValues.botId, bot.id))
      .orderBy(desc(udtValues.day))
      .get();
    if (v) return v.value;
    return marketValue(baseValue(bot.skill, valueScore(bot.traits)), 1, 1, this.index(season));
  }

  team(userId: string, season: number): UdtTeam | null {
    const t = this.db
      .select()
      .from(udtTeams)
      .where(and(eq(udtTeams.season, season), eq(udtTeams.userId, userId)))
      .get();
    return t ? { userId: t.userId, name: t.name, tag: t.tag, createdAt: t.createdAt } : null;
  }

  teams(season: number): UdtTeam[] {
    return this.db
      .select()
      .from(udtTeams)
      .where(eq(udtTeams.season, season))
      .all()
      .map((t) => ({ userId: t.userId, name: t.name, tag: t.tag, createdAt: t.createdAt }));
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
    return this.db
      .select()
      .from(udtRoster)
      .where(and(eq(udtRoster.season, season), eq(udtRoster.userId, userId)))
      .all()
      .flatMap((r) => {
        const b = lib.get(r.botId);
        if (!b) return [];
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
            value: r.starter ? 0 : this.value(b, season),
            starter: r.starter,
            dmSlot: r.dmSlot,
            mhSlot: r.mhSlot,
            bench: r.bench,
            stamina: r.stamina,
            xp: r.xp,
            striking: r.striking,
          },
        ];
      })
      .sort((a, b) => (a.dmSlot ?? 9) - (b.dmSlot ?? 9) || b.skill - a.skill);
  }

  /** The Dream Team page of a manager. */
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
      throw conflict(`the team name ${body.name} is taken`);
    if (others.some((t) => t.tag.toLowerCase() === tagKey))
      throw conflict(`the tag ${body.tag} is taken`);
    if (gameName(body.tag, body.starter.name).length < `[${body.tag}]${body.starter.name}`.length)
      throw badRequest(
        `tag and bot name are too long for the game: [${body.tag}]${body.starter.name} (at most ${GAME_NAME_CHARS})`,
      );
    const budget = this.settings.get().udt.starterBudget;
    const cost = Math.round(baseValue(body.starter.skill, valueScore(body.starter.traits)));
    if (cost > budget)
      throw badRequest(`the starter bot costs ${cost} of ${budget} points: lower skill or values`);
    const bot = this.bots.create({
      name: body.starter.name,
      skill: body.starter.skill,
      ...(body.starter.botClass ? { botClass: body.starter.botClass } : {}),
      ...(body.starter.skin ? { skin: body.starter.skin } : {}),
      ...(body.starter.face ? { face: body.starter.face } : {}),
      ...(body.starter.traits ? { traits: body.starter.traits } : {}),
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
    return this.team(user.id, season.number)!;
  }

  /** Lineups for deathmatch and Monster Hunt (slots 1..5) and the bench order (1..2). */
  setLineup(user: User, body: LineupInput): RosterBot[] {
    this.assertOn();
    const season = this.season();
    if (!this.team(user.id, season.number)) throw notFound('team');
    const owned = new Set(this.roster(user.id, season.number).map((r) => r.botId));
    const check = (list: (string | null)[] | undefined, what: string) => {
      if (!list) return;
      const ids = list.filter((x): x is string => x !== null);
      if (new Set(ids).size !== ids.length) throw badRequest(`a bot twice in the ${what}`);
      for (const id of ids) if (!owned.has(id)) throw badRequest(`bot ${id} is not yours`);
    };
    check(body.dm, 'deathmatch lineup');
    check(body.mh, 'Monster Hunt lineup');
    check(body.bench, 'bench');
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
  return `${tag ? `[${tag}]` : ''}${name}`.slice(0, GAME_NAME_CHARS);
}

function slotOf(list: (string | null)[], id: string): number | null {
  const i = list.indexOf(id);
  return i < 0 ? null : i + 1;
}
