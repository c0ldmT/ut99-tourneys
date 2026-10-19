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
import { dayStartMs } from '../seasons/season-time.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { EventLogService } from '../tournaments/event-log.service.js';
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
  ) {}

  onModuleInit(): void {
    this.events.onAppend((id, stored, after) => this.onAppended(id, stored, after));
  }

  private onAppended(
    id: string,
    stored: readonly TournamentEvent[],
    after: TournamentProjection,
  ): void {
    try {
      const t = this.db.select().from(tournaments).where(eq(tournaments.id, id)).get();
      if (!t || t.kind !== 'udt') return;
      const season = this.seasons.current();
      if (!season) return;
      for (const e of stored) {
        if (e.type === 'match.result') this.matchDone(id, season.number, e.data.result, after);
        else if (e.type === 'tournament.finished') this.finished(id, season.number, after);
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
      for (const r of this.db
        .select()
        .from(udtRoster)
        .where(and(eq(udtRoster.season, season), inArray(udtRoster.botId, ids)))
        .all()) {
        const fx = managerEffects(onBots.get(r.botId) ?? []);
        const lost = Math.round(games * DEFAULT_ECONOMY.stamina.perGame * fx.fatigue);
        this.db
          .update(udtRoster)
          .set({
            stamina: Math.max(0, r.stamina - lost),
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
    const managers = standings.filter((s) => udtManagerOf(s.entrantId));
    const onlyBase = managers.length === 1;
    const onBots = this.udt.traitsOnBots(season);
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
        placeReward(place <= 4 ? place : 99, teamSize, index, onlyBase) * (midas ? 1.1 : 1),
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
  }

  /** Season table: points from the places of finished Dream Team tournaments of the season. */
  table(season: number): TableRow[] {
    const s = this.seasons.list().find((x) => x.number === season);
    if (!s) return [];
    const from = new Date(dayStartMs(s.startDate, this.seasons.timeZone)).toISOString();
    const teams = new Map(this.udt.teams(season).map((t) => [t.userId, t]));
    const rows = new Map<string, TableRow>();
    for (const t of this.db
      .select()
      .from(tournaments)
      .where(and(eq(tournaments.kind, 'udt'), eq(tournaments.phase, 'finished')))
      .all()) {
      if (t.createdAt < from) continue;
      const proj = this.events.projection(t.id);
      if (!proj) continue;
      const factor = FORMAT_POINTS[proj.settings.teamSize] ?? 1;
      for (const st of proj.bracket?.standings ?? []) {
        const userId = udtManagerOf(st.entrantId);
        const team = userId ? teams.get(userId) : undefined;
        if (!userId || !team) continue;
        const r = rows.get(userId) ?? {
          userId,
          name: team.name,
          tag: team.tag,
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
