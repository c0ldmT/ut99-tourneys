import { Inject, Injectable } from '@nestjs/common';
import { TournamentSettingsSchema } from '@tourney/protocol';
import { UsersService } from '../auth/users.service.js';
import { BotsService } from '../bots/bots.service.js';
import { DB, type Db } from '../db/database.js';
import { tournaments } from '../db/schema.js';
import { seasonAt } from '../seasons/season-time.js';
import { SeasonsService, type Season } from '../seasons/seasons.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import {
  headToHead,
  mapRecords,
  playerDetail,
  playerTable,
  records,
  type MapRecord,
  type PlayerDetail,
  type PlayerRow,
  type RecordEntry,
} from './aggregate.js';
import { botKey, extractFacts, userKey, type StatMode, type TournamentFacts } from './facts.js';
import {
  computeRatings,
  levelBonusMu,
  shownRating,
  type PlayerRating,
  type RatedGame,
  type Ratings,
} from './ratings.js';

export interface RatingRow extends PlayerRating {
  /** Place in the list of non-provisional ratings (undefined while provisional). */
  rank?: number;
}

/** Lifetime (every tournament) or one season (its season tournaments). */
export type StatScope = 'lifetime' | number;

interface Loaded {
  facts: TournamentFacts;
  seasonal: boolean;
  head: number;
  /** Season of a season tournament: the one in which its first game was played. */
  season?: number;
}

/**
 * Statistics and ratings: read models of the event logs.
 *
 * - Lifetime statistics count every tournament; they have no records.
 * - A season counts the season tournaments whose first game was played in it: season
 *   statistics, records and ratings (ratings exist per season only). An ended season is the
 *   archive; it keeps the rating settings it ran with.
 *
 * Facts per tournament are cached by the head of its log, ratings per season until a log of the
 * season, the seasons or the settings change.
 */
@Injectable()
export class StatsService {
  private cache = new Map<string, { sig: string; facts: TournamentFacts }>();
  private ratingCache = new Map<number, { sig: string; ratings: Ratings }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EventLogService) private readonly log: EventLogService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(BotsService) private readonly bots: BotsService,
  ) {}

  /** Forgets the cached facts and ratings (after the tournaments were cleared). */
  clearCache(): void {
    this.cache.clear();
    this.ratingCache.clear();
  }

  /** Facts of the tournaments in a scope, oldest first. */
  facts(scope: StatScope = 'lifetime'): TournamentFacts[] {
    return this.scoped(scope).map((x) => x.facts);
  }

  private scoped(scope: StatScope): Loaded[] {
    const all = this.load();
    return scope === 'lifetime' ? all : all.filter((x) => x.season === scope);
  }

  private load(): Loaded[] {
    const rows = this.db
      .select({
        id: tournaments.id,
        name: tournaments.name,
        settingsJson: tournaments.settingsJson,
        botPoolJson: tournaments.botPoolJson,
        headSeq: tournaments.headSeq,
        createdAt: tournaments.createdAt,
        seasonal: tournaments.seasonal,
      })
      .from(tournaments)
      .all()
      .filter((r) => r.headSeq > 0)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const seasons = this.seasons.list();
    const out: Loaded[] = [];
    for (const r of rows) {
      const sig = `${r.headSeq}|${r.name}|${r.botPoolJson}`;
      let facts = this.cache.get(r.id)?.sig === sig ? this.cache.get(r.id)!.facts : undefined;
      if (!facts) {
        const parsed = TournamentSettingsSchema.safeParse(JSON.parse(r.settingsJson));
        if (!parsed.success) continue;
        let botPool: { name: string; skill: number }[] = [];
        try {
          botPool = JSON.parse(r.botPoolJson) as { name: string; skill: number }[];
        } catch {
          // no pool: bots without an entrant play as Adept
        }
        facts = extractFacts(
          { id: r.id, name: r.name, settings: parsed.data, botPool },
          this.log.load(r.id),
        );
        this.cache.set(r.id, { sig, facts });
      }
      const first = firstGameAt(facts);
      const season = r.seasonal && first !== undefined ? this.seasonOf(seasons, first) : undefined;
      out.push({
        facts,
        seasonal: r.seasonal,
        head: r.headSeq,
        ...(season !== undefined ? { season } : {}),
      });
    }
    return out;
  }

  private seasonOf(seasons: readonly Season[], instant: number): number | undefined {
    return seasonAt(seasons, instant, this.seasons.timeZone)?.number;
  }

  /** Season of a tournament (undefined: no season tournament, not played yet, or no season). */
  seasonOfTournament(tournamentId: string): number | undefined {
    return this.load().find((x) => x.facts.tournamentId === tournamentId)?.season;
  }

  /** Ratings of a season (cached until a log of the season, the seasons or the settings change). */
  ratings(season: number): Ratings {
    const s = this.seasons.list().find((x) => x.number === season);
    const ts = this.scoped(season);
    if (!s) return computeRatings([]);
    const sig = `${JSON.stringify(s.rating)}|${ts.map((x) => `${x.facts.tournamentId}:${x.head}`).join(',')}`;
    const cached = this.ratingCache.get(season);
    if (cached?.sig === sig) return cached.ratings;
    const ratings = computeRatings(
      ts.map((x) => x.facts),
      { botGames: s.rating.botGames, levelPoints: s.rating.levelPoints },
    );
    this.ratingCache.set(season, { sig, ratings });
    return ratings;
  }

  /** Rating list of a mode in a season: best first, current names. */
  ratingList(season: number, mode: StatMode, bots: boolean): RatingRow[] {
    const names = this.names();
    const rows = [...this.ratings(season).players[mode].values()]
      .filter((r) => bots || !r.bot)
      .map((r) => ({ ...r, name: names.get(r.key) ?? r.name }))
      .sort((a, b) => b.rating - a.rating || b.games - a.games);
    let place = 0;
    return rows.map((r) => (r.provisional ? r : { ...r, rank: ++place }));
  }

  /** A player's rating per mode in a season and the changes of the last games. */
  playerRatings(
    key: string,
    season: number,
  ): {
    modes: Partial<Record<StatMode, PlayerRating>>;
    recent: (RatedGame & { delta: number; after: number; tournamentName: string })[];
  } {
    const r = this.ratings(season);
    const modes: Partial<Record<StatMode, PlayerRating>> = {};
    for (const m of ['dm', 'tdm', 'mh'] as const) {
      const p = r.players[m].get(key);
      if (p) modes[m] = p;
    }
    const names = new Map(this.facts(season).map((f) => [f.tournamentId, f.name]));
    const recent = r.games
      .flatMap((g) => {
        const c = g.changes.find((x) => x.key === key);
        return c
          ? [
              {
                ...g,
                delta: c.delta,
                after: c.after,
                tournamentName: names.get(g.tournamentId) ?? g.tournamentId,
              },
            ]
          : [];
      })
      .slice(-50);
    return { modes, recent };
  }

  /** Rated games of one tournament (its season's rating changes). */
  tournamentRatings(tournamentId: string): RatedGame[] {
    const season = this.seasonOfTournament(tournamentId);
    if (season === undefined) return [];
    return this.ratings(season).games.filter((g) => g.tournamentId === tournamentId);
  }

  /**
   * Strength for seeding and balancing: the shown rating in the running season; a player
   * without games in it keeps the rating of the last season they played. Bots get the bonus of
   * the difficulty they will play with.
   */
  strength(mode: StatMode, key: string, skill?: number): number {
    const current = this.seasons.current() ?? this.seasons.latestStarted();
    const levelPoints = (current?.rating ?? this.settings.get().rating).levelPoints;
    const started = this.seasons
      .list()
      .filter((s) => !current || s.number <= current.number)
      .reverse();
    let mu: number | undefined;
    for (const s of started) {
      const r = this.ratings(s.number).players[mode].get(key);
      if (r) {
        mu = r.mu;
        break;
      }
    }
    return shownRating((mu ?? 25) + levelBonusMu(skill, levelPoints));
  }

  /**
   * Head to head (lifetime): games in which `key` and each of `others` played on opposite sides,
   * and how many of them `key` won.
   */
  headToHead(
    key: string,
    others: readonly string[],
  ): Record<string, { games: number; wins: number }> {
    return headToHead(this.facts('lifetime'), key, others);
  }

  /**
   * Current names: website users (they can rename themselves) and the bots of the control
   * center (`b:<id>`, renamed or moved to another clan there).
   */
  names(): Map<string, string> {
    const m = new Map(this.users.list().map((u) => [userKey(u.id), u.displayName]));
    for (const [id, name] of this.bots.gameNames()) m.set(botKey(id), name);
    return m;
  }

  players(scope: StatScope, mode: StatMode | undefined, bots: boolean): PlayerRow[] {
    return playerTable(this.facts(scope), {
      ...(mode ? { mode } : {}),
      bots,
      names: this.names(),
    });
  }

  /** A player's statistics; lifetime without records (records belong to seasons). */
  player(key: string, scope: StatScope): PlayerDetail | undefined {
    const d = playerDetail(this.facts(scope), key, this.names());
    return d && scope === 'lifetime' ? { ...d, records: [], mapRecords: [] } : d;
  }

  /** Records of a season (lifetime has none). */
  records(
    season: number,
    mode: StatMode | undefined,
  ): { records: RecordEntry[]; maps: MapRecord[] } {
    return records(this.facts(season), { ...(mode ? { mode } : {}), names: this.names() });
  }

  /** Monster Hunt map records of a season (per map and monster skill), for the in-game HUD. */
  mapRecords(season: number): MapRecord[] {
    return mapRecords(this.facts(season), this.names());
  }
}

/** Time of the first game of a tournament (epoch ms). */
function firstGameAt(f: TournamentFacts): number | undefined {
  let first: number | undefined;
  for (const g of f.games) {
    const t = Date.parse(g.at);
    if (first === undefined || t < first) first = t;
  }
  for (const r of f.runs) {
    const t = Date.parse(r.at);
    if (first === undefined || t < first) first = t;
  }
  return first;
}
