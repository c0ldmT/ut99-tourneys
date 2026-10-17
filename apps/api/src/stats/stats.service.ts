import { Inject, Injectable } from '@nestjs/common';
import { TournamentSettingsSchema } from '@tourney/protocol';
import { eq, or } from 'drizzle-orm';
import { UsersService } from '../auth/users.service.js';
import { DB, type Db } from '../db/database.js';
import { tournaments } from '../db/schema.js';
import { SettingsService } from '../settings/settings.service.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import {
  mapRecords,
  playerDetail,
  playerTable,
  records,
  type MapRecord,
  type PlayerDetail,
  type PlayerRow,
  type RecordEntry,
} from './aggregate.js';
import { extractFacts, userKey, type StatMode, type TournamentFacts } from './facts.js';
import {
  computeRatings,
  strengthOf,
  type PlayerRating,
  type RatedGame,
  type Ratings,
} from './ratings.js';

export interface RatingRow extends PlayerRating {
  /** Place in the list of non-provisional ratings (undefined while provisional). */
  rank?: number;
}

/**
 * Statistics page and ratings: read models of the event logs of all tournaments that count
 * (`stats_enabled` for the statistics, `ranked` for the ratings). Facts per tournament are cached
 * by the head of its log, so an append only re-derives that tournament; the ratings are
 * recomputed when a ranked log or the rating settings change.
 */
@Injectable()
export class StatsService {
  private cache = new Map<string, { sig: string; facts: TournamentFacts }>();
  private ratingCache?: { sig: string; ratings: Ratings };

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EventLogService) private readonly log: EventLogService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /** Facts of every counted tournament that has a log, oldest first. */
  facts(): TournamentFacts[] {
    return this.load()
      .filter((x) => x.stats)
      .map((x) => x.facts);
  }

  /** Facts of the ranked tournaments, oldest first. */
  rankedFacts(): TournamentFacts[] {
    return this.load()
      .filter((x) => x.ranked)
      .map((x) => x.facts);
  }

  private load(): { facts: TournamentFacts; stats: boolean; ranked: boolean; head: number }[] {
    const rows = this.db
      .select({
        id: tournaments.id,
        name: tournaments.name,
        settingsJson: tournaments.settingsJson,
        botPoolJson: tournaments.botPoolJson,
        headSeq: tournaments.headSeq,
        createdAt: tournaments.createdAt,
        statsEnabled: tournaments.statsEnabled,
        ranked: tournaments.ranked,
      })
      .from(tournaments)
      .where(or(eq(tournaments.statsEnabled, true), eq(tournaments.ranked, true)))
      .all()
      .filter((r) => r.headSeq > 0)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const out: { facts: TournamentFacts; stats: boolean; ranked: boolean; head: number }[] = [];
    for (const r of rows) {
      const sig = `${r.headSeq}|${r.name}|${r.botPoolJson}`;
      const flags = { stats: r.statsEnabled, ranked: r.ranked, head: r.headSeq };
      const cached = this.cache.get(r.id);
      if (cached && cached.sig === sig) {
        out.push({ facts: cached.facts, ...flags });
        continue;
      }
      const parsed = TournamentSettingsSchema.safeParse(JSON.parse(r.settingsJson));
      if (!parsed.success) continue;
      let botPool: { name: string; skill: number }[] = [];
      try {
        botPool = JSON.parse(r.botPoolJson) as { name: string; skill: number }[];
      } catch {
        // no pool: bots without an entrant play as Adept
      }
      const facts = extractFacts(
        { id: r.id, name: r.name, settings: parsed.data, botPool },
        this.log.load(r.id),
      );
      this.cache.set(r.id, { sig, facts });
      out.push({ facts, ...flags });
    }
    return out;
  }

  /** Ratings of all ranked tournaments (cached until a ranked log or the settings change). */
  ratings(): Ratings {
    const ranked = this.load().filter((x) => x.ranked);
    const opts = this.settings.get().rating;
    const sig = `${JSON.stringify(opts)}|${ranked.map((x) => `${x.facts.tournamentId}:${x.head}`).join(',')}`;
    if (this.ratingCache?.sig === sig) return this.ratingCache.ratings;
    const ratings = computeRatings(
      ranked.map((x) => x.facts),
      { botGames: opts.botGames, levelPoints: opts.levelPoints },
    );
    this.ratingCache = { sig, ratings };
    return ratings;
  }

  /** Rating list of a mode: rated players (bots optional), best first, current names. */
  ratingList(mode: StatMode, bots: boolean): RatingRow[] {
    const names = this.names();
    const rows = [...this.ratings().players[mode].values()]
      .filter((r) => bots || !r.bot)
      .map((r) => ({ ...r, name: names.get(r.key) ?? r.name }))
      .sort((a, b) => b.rating - a.rating || b.games - a.games);
    let place = 0;
    return rows.map((r) => (r.provisional ? r : { ...r, rank: ++place }));
  }

  /** A player's rating per mode and the changes of the last games. */
  playerRatings(key: string): {
    modes: Partial<Record<StatMode, PlayerRating>>;
    recent: (RatedGame & { delta: number; after: number })[];
  } {
    const r = this.ratings();
    const modes: Partial<Record<StatMode, PlayerRating>> = {};
    for (const m of ['dm', 'tdm', 'mh'] as const) {
      const p = r.players[m].get(key);
      if (p) modes[m] = p;
    }
    const recent = r.games
      .flatMap((g) => {
        const c = g.changes.find((x) => x.key === key);
        return c ? [{ ...g, delta: c.delta, after: c.after }] : [];
      })
      .slice(-50);
    return { modes, recent };
  }

  /** Rated games of one tournament (rating changes per game). */
  tournamentRatings(tournamentId: string): RatedGame[] {
    return this.ratings().games.filter((g) => g.tournamentId === tournamentId);
  }

  /** Strength for seeding and balancing (shown rating, bots with their difficulty bonus). */
  strength(mode: StatMode, key: string, skill?: number): number {
    return strengthOf(this.ratings(), mode, key, skill, this.settings.get().rating.levelPoints);
  }

  /** Current display names of website users (they can rename themselves). */
  names(): Map<string, string> {
    return new Map(this.users.list().map((u) => [userKey(u.id), u.displayName]));
  }

  players(mode: StatMode | undefined, bots: boolean): PlayerRow[] {
    return playerTable(this.facts(), { ...(mode ? { mode } : {}), bots, names: this.names() });
  }

  player(key: string): PlayerDetail | undefined {
    return playerDetail(this.facts(), key, this.names());
  }

  records(mode: StatMode | undefined): { records: RecordEntry[]; maps: MapRecord[] } {
    return records(this.facts(), { ...(mode ? { mode } : {}), names: this.names() });
  }

  /** Monster Hunt map records (best time plus penalty per map), for the in-game HUD. */
  mapRecords(): MapRecord[] {
    return mapRecords(this.facts(), this.names());
  }
}
