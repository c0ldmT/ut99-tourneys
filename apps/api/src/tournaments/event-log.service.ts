import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import {
  projectTournament,
  TournamentEventSchema,
  type NewTournamentEvent,
  type TournamentEvent,
  type TournamentProjection,
} from '@tourney/protocol';
import { z } from 'zod';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { events, tournaments } from '../db/schema.js';
import { LiveHub } from './hub.js';
import { NeuroHub } from '../ledger/neuro-hub.js';

/** Events after which bets are settled or refunded. */
const SETTLES = new Set(['match.result', 'tournament.finished', 'tournament.aborted']);

/** Called after every accepted append (notifications). `before` folds the log as it was. */
export type AppendListener = (
  tournamentId: string,
  stored: readonly TournamentEvent[],
  projection: TournamentProjection,
  before: () => TournamentProjection | undefined,
) => void;

export type AppendResult =
  | { accepted: true; events: TournamentEvent[]; projection: TournamentProjection }
  | { accepted: false; missing: TournamentEvent[]; reason: string };

/**
 * The canonical tournament event log. Appends use optimistic concurrency: a batch is accepted
 * only if it was based on the current head, and only if the resulting log still folds into a
 * valid projection.
 */
@Injectable()
export class EventLogService {
  private cache = new Map<string, TournamentEvent[]>();
  private listeners: AppendListener[] = [];
  private clearListeners: ((tournamentId: string) => void)[] = [];

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(LiveHub) private readonly hub: LiveHub,
    @Inject(NeuroHub) private readonly neuro: NeuroHub,
  ) {}

  load(tournamentId: string): TournamentEvent[] {
    const cached = this.cache.get(tournamentId);
    if (cached) return cached;
    const rows = this.db
      .select({ json: events.json })
      .from(events)
      .where(eq(events.tournamentId, tournamentId))
      .orderBy(asc(events.seq))
      .all();
    const log = rows.map((r) => TournamentEventSchema.parse(JSON.parse(r.json)));
    this.cache.set(tournamentId, log);
    return log;
  }

  onAppend(listener: AppendListener): void {
    this.listeners.push(listener);
  }

  /** Called after a log was cleared (back to draft: the bets go). */
  onClear(listener: (tournamentId: string) => void): void {
    this.clearListeners.push(listener);
  }

  projection(tournamentId: string): TournamentProjection | undefined {
    const log = this.load(tournamentId);
    return log.length ? projectTournament(log) : undefined;
  }

  append(
    tournamentId: string,
    baseSeq: number,
    batch: readonly (NewTournamentEvent | Record<string, unknown>)[],
  ): AppendResult {
    const log = this.load(tournamentId);
    const head = log.length;
    if (baseSeq !== head) {
      return {
        accepted: false,
        missing: log.slice(baseSeq),
        reason: `head is ${head}, not ${baseSeq}`,
      };
    }
    const at = new Date(this.clock.now()).toISOString();
    let stored: TournamentEvent[];
    let projection: TournamentProjection;
    try {
      stored = batch.map((e, i) => TournamentEventSchema.parse({ ...e, seq: head + i + 1, at }));
      projection = projectTournament([...log, ...stored]);
    } catch (e) {
      const reason = e instanceof z.ZodError ? z.prettifyError(e) : (e as Error).message;
      return { accepted: false, missing: [], reason: `invalid events: ${reason}` };
    }
    this.db.transaction((tx) => {
      for (const e of stored) {
        tx.insert(events)
          .values({ tournamentId, seq: e.seq, type: e.type, at: e.at, json: JSON.stringify(e) })
          .run();
      }
      tx.update(tournaments)
        .set({ phase: projection.phase, headSeq: projection.headSeq })
        .where(eq(tournaments.id, tournamentId))
        .run();
    });
    this.cache.set(tournamentId, [...log, ...stored]);
    this.hub.publish(tournamentId, {
      type: 'change',
      headSeq: projection.headSeq,
      phase: projection.phase,
    });
    // Results settle bets: everybody's Neuro may have changed.
    if (stored.some((e) => SETTLES.has(e.type))) this.neuro.changedAll();
    const before = () => (log.length ? projectTournament(log) : undefined);
    for (const l of this.listeners) {
      try {
        l(tournamentId, stored, projection, before);
      } catch {
        // A listener (notifications) must never break the log.
      }
    }
    return { accepted: true, events: stored, projection };
  }

  /** Back to draft: only allowed by the caller before check-in. */
  clear(tournamentId: string): void {
    this.db.transaction((tx) => {
      tx.delete(events).where(eq(events.tournamentId, tournamentId)).run();
      tx.update(tournaments)
        .set({ phase: 'draft', headSeq: 0 })
        .where(eq(tournaments.id, tournamentId))
        .run();
    });
    this.cache.delete(tournamentId);
    for (const l of this.clearListeners) {
      try {
        l(tournamentId);
      } catch {
        // A listener must never break the log.
      }
    }
    this.hub.publish(tournamentId, { type: 'change', headSeq: 0, phase: 'draft' });
    this.neuro.changedAll();
  }

  forget(tournamentId: string): void {
    this.cache.delete(tournamentId);
  }
}
