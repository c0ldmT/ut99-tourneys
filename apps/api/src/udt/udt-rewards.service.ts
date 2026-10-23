import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { ADAPTER_MH } from '@tourney/adapter-ut99';
import { udtManagerOf, type TournamentEvent, type TournamentProjection } from '@tourney/protocol';
import {
  DEFAULT_ECONOMY,
  managerEffects,
  matchReward,
  placeReward,
  rewardFactor,
  roundNeuro,
} from '@tourney/udt';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { DB, type Db } from '../db/database.js';
import { tournaments, udtRoster } from '../db/schema.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { AWARDS } from '../shop/catalog.js';
import { ShopService } from '../shop/shop.service.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import { TournamentsService, UdtEventRulesSchema } from '../tournaments/tournaments.service.js';
import { UdtEventsService } from './udt-events.service.js';
import { UdtService } from './udt.service.js';

/** Table points per place (1, 2, 3/4, played), times the format's factor. */
const POINTS = { 1: 10, 2: 6, 3: 4, played: 1 } as const;
const FORMAT_POINTS: Record<number, number> = { 1: 1, 2: 1.5, 3: 2, 5: 3 };
const XP_GAME = 10;
const XP_WIN = 15;

export interface TableRow {
  userId: string;
  name: string;
  tag: string;
  points: number;
  titles: number;
  events: number;
  /** An AI manager's team. */
  ai: boolean;
}

/**
 * Dream Team results: every decided match of a manager's lineup pays (game, win, MVP; wins
 * against library bots count half) and tires its bots (stamina) while they gain experience; a
 * finished tournament pays the places. Bookings are idempotent (ledger refs), so a resync or a
 * restart pays nothing twice.
 */
@Injectable()
export class UdtRewardsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(EventLogService) private readonly events: EventLogService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(LedgerService) private readonly ledger: LedgerService,
    @Inject(UdtService) private readonly udt: UdtService,
    @Inject(UdtEventsService) private readonly udtEvents: UdtEventsService,
    @Inject(ShopService) private readonly shop: ShopService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
  ) {}

  onModuleInit(): void {
    this.events.onAppend((id, stored, after) => this.onAppended(id, stored, after));
    this.udtEvents.tableOf = (season) => this.table(season);
    // The season's Dream Team champion gets a frame and a title (shop awards).
    this.shop.registerAwardProvider((season) => {
      const userId = this.champion(season);
      return userId
        ? [
            { userId, item: AWARDS.dreamTeam(season) },
            { userId, item: AWARDS.dreamTeamTitle(season) },
          ]
        : [];
    });
  }

  private onAppended(
    id: string,
    stored: readonly TournamentEvent[],
    after: TournamentProjection,
  ): void {
    try {
      const t = this.db.select().from(tournaments).where(eq(tournaments.id, id)).get();
      if (!t || t.kind !== 'udt') return;
      // Everything books into the tournament's season, also when it ends after that season (or
      // the next one runs already): its rosters, index and table.
      const season = this.tournaments.udtSeason(t) ?? this.seasons.current()?.number;
      for (const e of stored) {
        if (e.type === 'tournament.aborted') this.udtEvents.refundTickets(id);
        else if (season === undefined) continue;
        else if (e.type === 'match.result') this.matchDone(id, season, e.data.result, after);
        else if (e.type === 'tournament.finished') this.finished(id, season, after);
      }
    } catch (err) {
      this.log.error(`udt rewards ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** The side whose player scored most in the match (frags, Monster Hunt: monster points). */
  private mvpSide(tournamentId: string, matchId: string, mh: boolean): string | undefined {
    const score = new Map<string, number>();
    for (const e of this.events.load(tournamentId))
      if (e.type === 'match.playerStats' && e.data.matchId === matchId)
        for (const p of e.data.players) {
          if (!p.entrantId) continue;
          const key = `${p.entrantId}|${p.name}`;
          const v = mh ? p.monsterPoints : p.kills - p.suicides - p.teamKills;
          score.set(key, (score.get(key) ?? 0) + v);
        }
    let best: [string, number] | undefined;
    for (const [k, v] of score) if (!best || v > best[1]) best = [k, v];
    return best?.[0].split('|')[0];
  }

  private matchDone(
    tournamentId: string,
    season: number,
    result: { matchId: string; entrants: [string, string]; winnerId: string; games?: unknown[] },
    proj: TournamentProjection,
  ): void {
    const teamSize = proj.settings.teamSize;
    const mh = proj.settings.game.adapter === ADAPTER_MH;
    const index = this.udt.index(season);
    const games = Math.max(1, result.games?.length ?? 1);
    const mvp = this.mvpSide(tournamentId, result.matchId, mh) ?? result.winnerId;
    for (const [me, other] of [
      [result.entrants[0], result.entrants[1]],
      [result.entrants[1], result.entrants[0]],
    ] as const) {
      const userId = udtManagerOf(me);
      if (!userId) continue;
      const won = result.winnerId === me;
      const e = proj.entrants[me];
      const botIds =
        e?.kind === 'bot' ? [e.bot.id] : e?.kind === 'team' ? e.bots.map((b) => b.id) : [];
      const ids = botIds.filter((x): x is string => !!x);
      // Manager traits: crowd favourites in the lineup, Midas anywhere in the roster.
      const onBots = this.udt.traitsOnBots(season);
      const rosterIds = this.db
        .select({ botId: udtRoster.botId })
        .from(udtRoster)
        .where(and(eq(udtRoster.season, season), eq(udtRoster.userId, userId)))
        .all()
        .map((r) => r.botId);
      const factor = rewardFactor(
        ids.map((id) => onBots.get(id) ?? []),
        teamSize,
        rosterIds.map((id) => onBots.get(id) ?? []),
      );
      const amount = roundNeuro(
        matchReward({ won, mvp: mvp === me, teamSize, vsBaseBots: !udtManagerOf(other) }, index) *
          factor,
      );
      const first = this.ledger.book({
        season,
        userId,
        kind: 'udt_reward',
        amount,
        ref: `udt-match:${tournamentId}:${result.matchId}:${userId}`,
        meta: { tournamentId, matchId: result.matchId, won, mvp: mvp === me },
      });
      if (!first) continue; // booked before: stamina and experience too
      if (!ids.length) continue;
      // Only while the bot is still this manager's (never another roster's row of the same bot).
      for (const r of this.db
        .select()
        .from(udtRoster)
        .where(
          and(
            eq(udtRoster.season, season),
            eq(udtRoster.userId, userId),
            inArray(udtRoster.botId, ids),
          ),
        )
        .all()) {
        const fx = managerEffects(onBots.get(r.botId) ?? []);
        const lost = Math.round(games * DEFAULT_ECONOMY.stamina.perGame * fx.fatigue);
        this.db
          .update(udtRoster)
          .set({
            stamina: Math.max(0, r.stamina - lost),
            games: r.games + games,
            xp: r.xp + Math.round((games * XP_GAME + (won ? XP_WIN : 0)) * fx.xp),
          })
          .where(and(eq(udtRoster.season, season), eq(udtRoster.botId, r.botId)))
          .run();
      }
    }
  }

  private finished(tournamentId: string, season: number, proj: TournamentProjection): void {
    const teamSize = proj.settings.teamSize;
    const index = this.udt.index(season);
    const standings = proj.bracket?.standings ?? [];
    const all = standings.filter((s) => udtManagerOf(s.entrantId));
    const onlyBase = all.length === 1;
    // Place rewards and the high stakes pot go to human managers only (not to AI managers).
    const ai = this.udt.aiIds();
    const managers = all.filter((s) => !ai.has(udtManagerOf(s.entrantId)!));
    const onBots = this.udt.traitsOnBots(season);
    // High stakes (tickets were paid): bigger place rewards, the pot on top.
    const highStakes = this.udtEvents.tickets(tournamentId).some((e) => e.ticket > 0);
    for (const s of managers) {
      const userId = udtManagerOf(s.entrantId)!;
      const place = s.placement ?? 99;
      // Midas anywhere in the roster: +10 %.
      const midas = this.db
        .select({ botId: udtRoster.botId })
        .from(udtRoster)
        .where(and(eq(udtRoster.season, season), eq(udtRoster.userId, userId)))
        .all()
        .some((r) => managerEffects(onBots.get(r.botId) ?? []).team > 1);
      const amount = roundNeuro(
        placeReward(place <= 4 ? place : 99, teamSize, index, onlyBase, undefined, highStakes) *
          (midas ? 1.1 : 1),
      );
      this.ledger.book({
        season,
        userId,
        kind: 'udt_place',
        amount,
        ref: `udt-place:${tournamentId}:${userId}`,
        meta: { tournamentId, place },
      });
    }
    this.payPot(tournamentId, season, managers);
  }

  /**
   * High stakes: the best human team gets 60 % of the tickets plus one ticket as a bonus (at
   * most a tenth of the tickets), the second best 20 %; the rest leaves the economy.
   */
  private payPot(
    tournamentId: string,
    season: number,
    managers: { entrantId: string; placement?: number | null }[],
  ): void {
    const paid = this.udtEvents.tickets(tournamentId).filter((e) => e.ticket > 0);
    if (!paid.length) return;
    const pot = paid.reduce((n, e) => n + e.ticket, 0);
    // The winner's bonus (one ticket) comes out of the pot: at most a tenth of it, so at least
    // 10 % always leaves the economy (a bonus on top made money with up to five teams, M2).
    const bonus = Math.min(Math.max(...paid.map((e) => e.ticket)), roundNeuro(pot * 0.1));
    const ranked = [...managers]
      .map((m) => ({ userId: udtManagerOf(m.entrantId)!, place: m.placement ?? 99 }))
      .filter((m) => paid.some((e) => e.userId === m.userId))
      .sort((a, b) => a.place - b.place);
    const shares = [roundNeuro(pot * 0.6) + bonus, roundNeuro(pot * 0.2)];
    ranked.slice(0, 2).forEach((m, i) =>
      this.ledger.book({
        season,
        userId: m.userId,
        kind: 'udt_pot',
        amount: shares[i]!,
        ref: `udt-pot:${tournamentId}:${m.userId}`,
        meta: { tournamentId, place: i + 1, pot },
      }),
    );
  }

  /**
   * The Dream Team champion of a season: the winner of its finale, else the top of the table
   * (human managers only; AI managers get no awards).
   */
  champion(season: number): string | null {
    const s = this.seasons.list().find((x) => x.number === season);
    if (!s) return null;
    const ai = this.udt.aiIds();
    const finales = this.db
      .select()
      .from(tournaments)
      .where(and(eq(tournaments.kind, 'udt'), eq(tournaments.phase, 'finished')))
      .all()
      .filter((t) => this.tournaments.udtSeason(t) === season)
      .filter((t) => {
        try {
          return UdtEventRulesSchema.parse(t.udtJson ? JSON.parse(t.udtJson) : {}).finale;
        } catch {
          return false;
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // The last finale decides (decision 124): an AI winner there leaves it to the table.
    const last = finales[0];
    if (last) {
      const champ = this.events.projection(last.id)?.championId;
      const userId = champ ? udtManagerOf(champ) : undefined;
      if (userId && !ai.has(userId)) return userId;
    }
    const top = this.table(season).find((r) => !r.ai && r.points > 0);
    return top?.userId ?? null;
  }

  /** Season table: points from the places of finished Dream Team tournaments of the season. */
  table(season: number): TableRow[] {
    const s = this.seasons.list().find((x) => x.number === season);
    if (!s) return [];
    const teams = new Map(this.udt.teams(season).map((t) => [t.userId, t]));
    const ai = this.udt.aiIds();
    const aiOn = this.udt.aiOn();
    const rows = new Map<string, TableRow>();
    for (const t of this.db
      .select()
      .from(tournaments)
      .where(and(eq(tournaments.kind, 'udt'), eq(tournaments.phase, 'finished')))
      .all()) {
      // Only the season's own tournaments (not the next season's, decision 110).
      if (this.tournaments.udtSeason(t) !== season) continue;
      const proj = this.events.projection(t.id);
      if (!proj) continue;
      const factor = FORMAT_POINTS[proj.settings.teamSize] ?? 1;
      for (const st of proj.bracket?.standings ?? []) {
        const userId = udtManagerOf(st.entrantId);
        const team = userId ? teams.get(userId) : undefined;
        if (!userId || !team) continue;
        if (ai.has(userId) && !aiOn) continue;
        const r = rows.get(userId) ?? {
          userId,
          name: team.name,
          tag: team.tag,
          ai: ai.has(userId),
          points: 0,
          titles: 0,
          events: 0,
        };
        const p = st.placement ?? 99;
        const base = p === 1 ? POINTS[1] : p === 2 ? POINTS[2] : p <= 4 ? POINTS[3] : POINTS.played;
        r.points += Math.round(base * factor);
        r.events++;
        if (p === 1) r.titles++;
        rows.set(userId, r);
      }
    }
    return [...rows.values()].sort(
      (a, b) => b.points - a.points || b.titles - a.titles || a.name.localeCompare(b.name),
    );
  }
}
