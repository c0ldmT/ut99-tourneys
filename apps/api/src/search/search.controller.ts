import { Controller, Get, Inject, Query } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { CurrentUser } from '../auth/guard.js';
import { UsersService, type User } from '../auth/users.service.js';
import { BotsService } from '../bots/bots.service.js';
import { ZodPipe } from '../common/http.js';
import { DB, type Db } from '../db/database.js';
import { tournaments } from '../db/schema.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { StatsService } from '../stats/stats.service.js';
import { UdtService } from '../udt/udt.service.js';

/** Hits per group. */
export const SEARCH_MAX = 5;

const SearchQuery = z.object({ q: z.string().trim().min(1).max(40) });
type SearchQuery = z.infer<typeof SearchQuery>;

/** Ranks a name: starts with the query 0, a word starts with it 1, contains it 2, else null. */
function rank(name: string, q: string): number | null {
  const n = name.toLowerCase();
  if (n.startsWith(q)) return 0;
  if (n.split(/[\s\-_.[\]]+/).some((w) => w.startsWith(q))) return 1;
  return n.includes(q) ? 2 : null;
}

/** The best hits of a list: by rank, then by name. */
function best<T>(items: T[], text: (t: T) => string[], q: string): T[] {
  return items
    .map((t) => {
      const ranks = text(t)
        .map((s) => rank(s, q))
        .filter((r): r is number => r !== null);
      return { t, r: ranks.length ? Math.min(...ranks) : null, name: text(t)[0] ?? '' };
    })
    .filter((x): x is { t: T; r: number; name: string } => x.r !== null)
    .sort((a, b) => a.r - b.r || a.name.localeCompare(b.name))
    .slice(0, SEARCH_MAX)
    .map((x) => x.t);
}

/**
 * The quick search (decision 313, Ctrl+K): bots, Dream Team teams of the running season, players
 * and tournaments by name, at most five each. Players are those with statistics; admins also
 * find every other user (their row leads to the user list). League games are left out (their
 * evening and the league pages show them); drafts only for admins.
 */
@Controller('search')
export class SearchController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(BotsService) private readonly bots: BotsService,
    @Inject(UdtService) private readonly udt: UdtService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(StatsService) private readonly stats: StatsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
  ) {}

  @Get()
  search(@CurrentUser() user: User, @Query(new ZodPipe(SearchQuery)) query: SearchQuery) {
    const q = query.q.toLowerCase();
    const udt = this.udt.enabled();
    const season = this.seasons.current()?.number ?? null;
    const teams = udt && season !== null ? this.udt.teams(season) : [];
    const teamOf = new Map(teams.map((t) => [t.userId, t]));
    const owners = udt && season !== null ? this.udt.owners(season) : new Map<string, string>();
    const ai = this.udt.aiIds();

    const botHits = best(this.bots.list(), (b) => [b.name, b.gameName], q).map((b) => {
      const owner = owners.get(b.id);
      return {
        id: b.id,
        name: b.name,
        skill: b.skill,
        team: owner ? (teamOf.get(owner)?.name ?? null) : null,
      };
    });

    const teamHits = best(
      teams.filter((t) => !ai.has(t.userId) || this.udt.aiOn()),
      (t) => [t.name, t.tag],
      q,
    ).map((t) => ({
      userId: t.userId,
      name: t.name,
      tag: t.tag,
      manager: this.users.byId(t.userId)?.displayName ?? null,
    }));

    const played = new Map(
      this.stats
        .players('lifetime', undefined, false)
        .filter((p) => p.userId)
        .map((p) => [p.userId!, p]),
    );
    const people = this.users.list().filter((u) => !ai.has(u.id));
    const playerHits = best(
      people.filter((u) => user.isAdmin || played.has(u.id)),
      (u) => [u.displayName],
      q,
    ).map((u) => {
      const p = played.get(u.id);
      return {
        userId: u.id,
        name: u.displayName,
        key: p?.key ?? null,
        tournaments: p?.tournaments ?? 0,
      };
    });

    const rows = this.db
      .select({
        id: tournaments.id,
        name: tournaments.name,
        phase: tournaments.phase,
        scheduledAt: tournaments.scheduledAt,
        createdAt: tournaments.createdAt,
        udtJson: tournaments.udtJson,
      })
      .from(tournaments)
      .orderBy(desc(tournaments.createdAt))
      .all()
      .filter((t) => !t.udtJson?.includes('"league":{') && (user.isAdmin || t.phase !== 'draft'));
    const tournamentHits = best(rows, (t) => [t.name], q).map((t) => ({
      id: t.id,
      name: t.name,
      phase: t.phase,
      at: t.scheduledAt ?? t.createdAt,
    }));

    return {
      udt,
      bots: botHits,
      teams: teamHits,
      players: playerHits,
      tournaments: tournamentHits,
    };
  }
}
