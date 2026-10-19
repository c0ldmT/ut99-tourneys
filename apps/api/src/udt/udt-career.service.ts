import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { udtManagerOf } from '@tourney/protocol';
import { levelOf, roundNeuro } from '@tourney/udt';
import { z } from 'zod';
import type { User } from '../auth/users.service.js';
import { UsersService } from '../auth/users.service.js';
import { BotsService } from '../bots/bots.service.js';
import { conflict, notFound } from '../common/http.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { bots, neuroLedger, udtBots, udtRoster, udtTeams } from '../db/schema.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import { UdtService } from './udt.service.js';

/** Graduation: this many Dream Team games in the season and this level. */
export const GRADUATE_GAMES = 15;
export const GRADUATE_LEVEL = 5;
export const HONOURS_LEVEL = 10;
/** At most this many graduations (nominations) per manager and season. */
export const GRADUATES_PER_SEASON = 2;
/** Breeder bonus: share of a graduate's market price, reward for a title (× index). */
const BREEDER_SALE = 0.05;
const BREEDER_TITLE = 150;

export const ApproveBody = z.object({
  /** Admins may give the graduate another name (and look) in the library. */
  name: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[\x20-\x7e]+$/)
    .optional(),
});

/**
 * Dream Team careers: own bots that played enough (15 games, level 5) can be nominated by their
 * manager (at most two per season); an admin approves the graduation (optionally renaming the
 * bot): it becomes a normal library bot (inactive until activated) with its breeder, "with
 * honours" from level 10. All other own bots of past seasons go into the yearbook. Breeders get
 * a small bonus when a graduate is bought on the market or wins a Dream Team tournament.
 */
@Injectable()
export class UdtCareerService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(EventLogService) private readonly events: EventLogService,
    @Inject(UdtService) private readonly udt: UdtService,
  ) {}

  onModuleInit(): void {
    // A graduate's team wins a Dream Team tournament: the breeder gets a bonus.
    this.events.onAppend((id, stored, after) => {
      if (!stored.some((e) => e.type === 'tournament.finished')) return;
      try {
        const champ = after.championId ? after.entrants[after.championId] : undefined;
        if (!champ || !udtManagerOf(champ.id)) return;
        const ids = (
          champ.kind === 'bot'
            ? [champ.bot.id]
            : champ.kind === 'team'
              ? champ.bots.map((b) => b.id)
              : []
        ).filter((x): x is string => !!x);
        this.titleBonus(id, ids);
      } catch (e) {
        this.log.error(`udt breeder bonus ${id}: ${(e as Error).message}`);
      }
    });
  }

  private graduate(botId: string) {
    return this.db
      .select()
      .from(udtBots)
      .where(and(eq(udtBots.botId, botId), eq(udtBots.status, 'graduated')))
      .get();
  }

  private titleBonus(tournamentId: string, botIds: string[]) {
    const s = this.udt.season();
    for (const id of botIds) {
      const g = this.graduate(id);
      if (!g) continue;
      this.ledger.book({
        season: s.number,
        userId: g.userId,
        kind: 'udt_breeder',
        amount: roundNeuro(BREEDER_TITLE * this.udt.index(s.number)),
        ref: `breeder-title:${tournamentId}:${id}`,
        meta: { botId: id, tournamentId },
      });
    }
  }

  /** Called by the market when a bid wins: a graduate pays its breeder a share. */
  saleBonus(season: number, botId: string, price: number, bidId: string): void {
    const g = this.graduate(botId);
    if (!g || price <= 0) return;
    this.ledger.book({
      season,
      userId: g.userId,
      kind: 'udt_breeder',
      amount: roundNeuro(price * BREEDER_SALE),
      ref: `breeder-sale:${bidId}`,
      meta: { botId },
    });
  }

  /** The manager's own bots of the season with what the graduation still needs. */
  graduation(user: User) {
    this.udt.assertOn();
    const season = this.udt.season().number;
    const own = this.udt.ownBots(season, user.id);
    const rows = new Map(
      this.db
        .select()
        .from(udtRoster)
        .where(and(eq(udtRoster.season, season), eq(udtRoster.userId, user.id)))
        .all()
        .map((r) => [r.botId, r]),
    );
    const lib = new Map(this.bots.list().map((b) => [b.id, b]));
    const taken = [...own.values()].filter(
      (b) => b.status === 'nominated' || b.status === 'graduated',
    ).length;
    return {
      games: GRADUATE_GAMES,
      level: GRADUATE_LEVEL,
      honours: HONOURS_LEVEL,
      perSeason: GRADUATES_PER_SEASON,
      left: Math.max(0, GRADUATES_PER_SEASON - taken),
      bots: [...own.values()].map((b) => {
        const r = rows.get(b.botId);
        const level = levelOf(r?.xp ?? 0);
        return {
          botId: b.botId,
          name: lib.get(b.botId)?.name ?? '?',
          origin: b.origin,
          status: b.status,
          games: r?.games ?? 0,
          level,
          ready: (r?.games ?? 0) >= GRADUATE_GAMES && level >= GRADUATE_LEVEL,
          honours: level >= HONOURS_LEVEL,
        };
      }),
    };
  }

  /** The manager nominates an own bot for the graduation. */
  nominate(user: User, botId: string) {
    const g = this.graduation(user);
    const b = g.bots.find((x) => x.botId === botId);
    if (!b) throw notFound('own bot of this season');
    if (b.status !== 'own') throw conflict(`the bot is ${b.status}`);
    if (!b.ready)
      throw conflict(
        `a graduation needs ${GRADUATE_GAMES} Dream Team games and level ${GRADUATE_LEVEL}`,
      );
    if (g.left <= 0) throw conflict(`at most ${GRADUATES_PER_SEASON} graduations per season`);
    this.db
      .update(udtBots)
      .set({ status: 'nominated', nominatedAt: new Date(this.clock.now()).toISOString() })
      .where(eq(udtBots.botId, botId))
      .run();
    return this.graduation(user);
  }

  /** The manager takes the nomination back (before an admin decided). */
  withdraw(user: User, botId: string) {
    const season = this.udt.season().number;
    const b = this.udt.ownBots(season, user.id).get(botId);
    if (!b || b.status !== 'nominated') throw conflict('not nominated');
    this.db
      .update(udtBots)
      .set({ status: 'own', nominatedAt: null })
      .where(eq(udtBots.botId, botId))
      .run();
    return this.graduation(user);
  }

  /** Nominations waiting for an admin (all seasons). */
  nominations() {
    const rows = this.db.select().from(udtBots).where(eq(udtBots.status, 'nominated')).all();
    return rows.map((b) => this.entry(b));
  }

  /** An admin approves: the bot becomes a library bot (inactive) with its breeder. */
  approve(id: string, body: z.infer<typeof ApproveBody>) {
    const b = this.db.select().from(udtBots).where(eq(udtBots.botId, id)).get();
    if (!b || b.status !== 'nominated') throw conflict('not nominated');
    const r = this.db
      .select()
      .from(udtRoster)
      .where(and(eq(udtRoster.season, b.season), eq(udtRoster.botId, id)))
      .get();
    if (body.name) this.bots.update(id, { name: body.name });
    this.db.update(bots).set({ udtOwner: null, active: false }).where(eq(bots.id, id)).run();
    this.db
      .update(udtBots)
      .set({
        status: 'graduated',
        graduatedAt: new Date(this.clock.now()).toISOString(),
        honours: levelOf(r?.xp ?? 0) >= HONOURS_LEVEL,
      })
      .where(eq(udtBots.botId, id))
      .run();
    this.log.info(`udt graduation ${id} approved`);
    return this.nominations();
  }

  reject(id: string) {
    const b = this.db.select().from(udtBots).where(eq(udtBots.botId, id)).get();
    if (!b || b.status !== 'nominated') throw conflict('not nominated');
    this.db.update(udtBots).set({ status: 'rejected' }).where(eq(udtBots.botId, id)).run();
    return this.nominations();
  }

  private entry(b: typeof udtBots.$inferSelect) {
    const lib = this.bots.list().find((x) => x.id === b.botId);
    const r = this.db
      .select()
      .from(udtRoster)
      .where(and(eq(udtRoster.season, b.season), eq(udtRoster.botId, b.botId)))
      .get();
    const team = this.db
      .select()
      .from(udtTeams)
      .where(and(eq(udtTeams.season, b.season), eq(udtTeams.userId, b.userId)))
      .get();
    return {
      botId: b.botId,
      season: b.season,
      name: lib?.name ?? '?',
      skill: lib?.skill ?? 0,
      traits: lib?.traits ?? {},
      origin: b.origin,
      status: b.status,
      honours: b.honours,
      potential: b.potential,
      games: r?.games ?? 0,
      xp: r?.xp ?? 0,
      level: levelOf(r?.xp ?? 0),
      breeder: this.users.byId(b.userId)?.displayName ?? '?',
      team: team?.name ?? '?',
      tag: team?.tag ?? '',
      active: lib?.active ?? false,
    };
  }

  /**
   * The yearbook of a season: every bot the managers made (graduated ones with their badge),
   * the seasons that have one. Before the season ends it shows the running season's class.
   */
  yearbook(season?: number) {
    this.udt.assertOn();
    const seasons = [
      ...new Set(
        this.db
          .select({ s: udtBots.season })
          .from(udtBots)
          .all()
          .map((x) => x.s),
      ),
    ].sort((a, b) => b - a);
    const s = season ?? seasons[0] ?? this.udt.season().number;
    const rows = this.db.select().from(udtBots).where(eq(udtBots.season, s)).all();
    return {
      season: s,
      seasons,
      bots: rows
        .map((b) => this.entry(b))
        .sort(
          (a, b) =>
            Number(b.status === 'graduated') - Number(a.status === 'graduated') || b.xp - a.xp,
        ),
    };
  }

  /** Best breeders: graduates, honours and breeder bonuses of all seasons. */
  breeders() {
    this.udt.assertOn();
    const grads = this.db.select().from(udtBots).where(eq(udtBots.status, 'graduated')).all();
    const users = [...new Set(grads.map((g) => g.userId))];
    const bonus = new Map<string, number>();
    if (users.length)
      for (const l of this.db
        .select()
        .from(neuroLedger)
        .where(and(eq(neuroLedger.kind, 'udt_breeder'), inArray(neuroLedger.userId, users)))
        .all())
        bonus.set(l.userId, (bonus.get(l.userId) ?? 0) + l.amount);
    return users
      .map((u) => ({
        userId: u,
        name: this.users.byId(u)?.displayName ?? '?',
        graduates: grads.filter((g) => g.userId === u).length,
        honours: grads.filter((g) => g.userId === u && g.honours).length,
        bonus: bonus.get(u) ?? 0,
      }))
      .sort((a, b) => b.graduates - a.graduates || b.honours - a.honours || b.bonus - a.bonus);
  }

  /** Graduates by bot id (the market shows the "homegrown" badge with the breeder). */
  homegrown(): Map<string, { breeder: string; honours: boolean }> {
    return new Map(
      this.db
        .select()
        .from(udtBots)
        .where(eq(udtBots.status, 'graduated'))
        .all()
        .map((g) => [
          g.botId,
          { breeder: this.users.byId(g.userId)?.displayName ?? '?', honours: g.honours },
        ]),
    );
  }
}
