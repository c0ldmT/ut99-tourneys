import fs from 'node:fs';
import path from 'node:path';
import {
  TournamentEventSchema,
  type NewTournamentEvent,
  type TournamentEvent,
} from '@tourney/protocol';
import type { Clock } from './clock.js';

export type AppendResult =
  | { accepted: true; events: TournamentEvent[] }
  /** Someone else appended first; `missing` are the events after baseSeq. */
  | { accepted: false; missing: TournamentEvent[]; reason: string };

/**
 * Where the tournament event log lives. Standalone: a local JSONL file. With a website: the
 * website is canonical and this becomes a sync client (same interface, optimistic concurrency).
 */
export interface EventStore {
  load(tournamentId: string): Promise<TournamentEvent[]>;
  append(
    tournamentId: string,
    baseSeq: number,
    events: readonly NewTournamentEvent[],
  ): Promise<AppendResult>;
}

/** Event log kept by the bridge itself, persisted as one JSONL file per tournament. */
export class LocalEventStore implements EventStore {
  private logs = new Map<string, TournamentEvent[]>();

  constructor(
    private readonly clock: Clock,
    /** Directory for <tournamentId>.jsonl files; undefined = memory only. */
    private readonly dir?: string,
  ) {
    if (dir) fs.mkdirSync(dir, { recursive: true });
  }

  private file(id: string): string | undefined {
    if (!this.dir) return undefined;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`invalid tournament id ${id}`);
    return path.join(this.dir, `${id}.jsonl`);
  }

  async load(tournamentId: string): Promise<TournamentEvent[]> {
    const cached = this.logs.get(tournamentId);
    if (cached) return [...cached];
    const file = this.file(tournamentId);
    let events: TournamentEvent[] = [];
    if (file && fs.existsSync(file)) {
      events = fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l, i) => {
          const parsed = TournamentEventSchema.safeParse(JSON.parse(l));
          if (!parsed.success) throw new Error(`${file}:${i + 1}: ${parsed.error.message}`);
          return parsed.data;
        });
    }
    this.logs.set(tournamentId, events);
    return [...events];
  }

  async append(
    tournamentId: string,
    baseSeq: number,
    events: readonly NewTournamentEvent[],
  ): Promise<AppendResult> {
    const log =
      this.logs.get(tournamentId) ?? (await this.load(tournamentId), this.logs.get(tournamentId)!);
    const head = log.length;
    if (baseSeq !== head) {
      return {
        accepted: false,
        missing: log.slice(baseSeq),
        reason: `head is ${head}, not ${baseSeq}`,
      };
    }
    const at = new Date(this.clock.now()).toISOString();
    const stored = events.map((e, i) =>
      TournamentEventSchema.parse({ ...e, seq: head + i + 1, at }),
    );
    log.push(...stored);
    const file = this.file(tournamentId);
    if (file) fs.appendFileSync(file, stored.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return { accepted: true, events: stored };
  }
}
