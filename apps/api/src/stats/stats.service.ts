import { Inject, Injectable } from '@nestjs/common';
import { TournamentSettingsSchema } from '@tourney/protocol';
import { eq } from 'drizzle-orm';
import { UsersService } from '../auth/users.service.js';
import { DB, type Db } from '../db/database.js';
import { tournaments } from '../db/schema.js';
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

/**
 * Statistics page: a read model of the event logs of all tournaments that count
 * (`stats_enabled`). Facts per tournament are cached by the head of its log, so an append only
 * re-derives that tournament.
 */
@Injectable()
export class StatsService {
  private cache = new Map<string, { head: number; enabledName: string; facts: TournamentFacts }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(EventLogService) private readonly log: EventLogService,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  /** Facts of every counted tournament that has a log, oldest first. */
  facts(): TournamentFacts[] {
    const rows = this.db
      .select({
        id: tournaments.id,
        name: tournaments.name,
        settingsJson: tournaments.settingsJson,
        headSeq: tournaments.headSeq,
        createdAt: tournaments.createdAt,
      })
      .from(tournaments)
      .where(eq(tournaments.statsEnabled, true))
      .all()
      .filter((r) => r.headSeq > 0)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const out: TournamentFacts[] = [];
    for (const r of rows) {
      const cached = this.cache.get(r.id);
      if (cached && cached.head === r.headSeq && cached.enabledName === r.name) {
        out.push(cached.facts);
        continue;
      }
      const parsed = TournamentSettingsSchema.safeParse(JSON.parse(r.settingsJson));
      if (!parsed.success) continue;
      const facts = extractFacts(
        { id: r.id, name: r.name, settings: parsed.data },
        this.log.load(r.id),
      );
      this.cache.set(r.id, { head: r.headSeq, enabledName: r.name, facts });
      out.push(facts);
    }
    return out;
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
