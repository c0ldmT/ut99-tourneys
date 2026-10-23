import { and, eq, inArray } from 'drizzle-orm';
import { udtEntrantId, type TournamentProjection } from '@tourney/protocol';
import type { Db } from '../db/database.js';
import { tournaments } from '../db/schema.js';
import type { EventLogService } from '../tournaments/event-log.service.js';

/** Phases in which a Dream Team tournament's lineups are fixed (seeded up to finished). */
export const LINEUP_LOCKED_PHASES = ['seeded', 'checkIn', 'running', 'paused'];

/**
 * Bots of a manager that play in a seeded or running Dream Team tournament (also paused ones and
 * the finale, which has no sign-ups): they can be neither traded nor sold until it ends.
 */
export function playingBots(
  db: Db,
  events: EventLogService,
  userId: string,
  except?: string,
): Set<string> {
  return botsOf(lockedProjections(db, events, except), userId);
}

/**
 * The projections of the Dream Team tournaments with fixed lineups (but `except`): read once for
 * many managers with `botsOf` (the seeding).
 */
export function lockedProjections(
  db: Db,
  events: EventLogService,
  except?: string,
): TournamentProjection[] {
  const rows = db
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(and(eq(tournaments.kind, 'udt'), inArray(tournaments.phase, LINEUP_LOCKED_PHASES)))
    .all();
  return rows.flatMap(({ id }) => {
    if (id === except) return [];
    const p = events.projection(id);
    return p ? [p] : [];
  });
}

/** A manager's bots in these tournaments (see `playingBots`). */
export function botsOf(projections: readonly TournamentProjection[], userId: string): Set<string> {
  const out = new Set<string>();
  for (const p of projections) {
    const e = p.entrants[udtEntrantId(userId)];
    if (e?.kind === 'bot' && e.bot.id) out.add(e.bot.id);
    if (e?.kind === 'team') for (const b of e.bots) if (b.id) out.add(b.id);
  }
  return out;
}
