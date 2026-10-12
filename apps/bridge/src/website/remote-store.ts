import fs from 'node:fs';
import path from 'node:path';
import {
  TournamentEventSchema,
  type NewTournamentEvent,
  type TournamentEvent,
} from '@tourney/protocol';
import type { AppendResult, EventStore } from '../event-store.js';
import type { Logger } from '../log.js';
import type { WebsiteLink } from './link.js';

type SyncPayload = { tournamentId: string; fromSeq: number; events: TournamentEvent[] };

/**
 * Event store backed by the website (canonical log). Keeps a local mirror per tournament in
 * JSONL files, so the bridge knows where it left off after a restart. Appends wait while the
 * website is unreachable; the game on the server keeps running meanwhile.
 */
export class RemoteEventStore implements EventStore {
  private logs = new Map<string, TournamentEvent[]>();

  constructor(
    private readonly link: WebsiteLink,
    private readonly log: Logger,
    private readonly dir?: string,
    private readonly ackTimeoutMs = 30_000,
  ) {
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.jsonl')) continue;
        try {
          const events = fs
            .readFileSync(path.join(dir, f), 'utf8')
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => TournamentEventSchema.parse(JSON.parse(l)));
          this.logs.set(f.slice(0, -6), events);
        } catch (e) {
          log.warn(`ignoring mirror ${f}: ${(e as Error).message}`);
        }
      }
    }
  }

  /** Last known seq per tournament (sent in agent.hello). */
  knownSeq(): Record<string, number> {
    return Object.fromEntries([...this.logs].map(([id, l]) => [id, l.length]));
  }

  has(tournamentId: string): boolean {
    return (this.logs.get(tournamentId)?.length ?? 0) > 0;
  }

  /**
   * Applies a tournament.sync. Returns true if the log changed (events the director did not
   * write itself, e.g. an admin action while the bridge was offline).
   */
  applySync(sync: SyncPayload): boolean {
    const current = this.logs.get(sync.tournamentId) ?? [];
    if (sync.fromSeq > current.length) {
      this.log.warn(
        `sync for ${sync.tournamentId} starts at ${sync.fromSeq}, mirror has ${current.length}; ignored`,
      );
      return false;
    }
    const next = [...current.slice(0, sync.fromSeq), ...sync.events];
    const changed =
      next.length !== current.length ||
      next.some((e, i) => JSON.stringify(e) !== JSON.stringify(current[i]));
    if (!changed) return false;
    this.set(sync.tournamentId, next);
    return true;
  }

  async load(tournamentId: string): Promise<TournamentEvent[]> {
    return [...(this.logs.get(tournamentId) ?? [])];
  }

  async append(
    tournamentId: string,
    baseSeq: number,
    events: readonly NewTournamentEvent[],
  ): Promise<AppendResult> {
    for (let attempt = 1; ; attempt++) {
      if (!this.link.connected) {
        this.log.warn('website unreachable: waiting to store the result');
        await this.link.waitConnected();
      }
      let reply;
      try {
        reply = await this.link.request(
          'events.append',
          { tournamentId, baseSeq, events: events as unknown as Record<string, unknown>[] },
          this.ackTimeoutMs,
        );
      } catch (e) {
        this.log.warn(`storing events failed (${(e as Error).message}), retry ${attempt}`);
        await new Promise((r) => setTimeout(r, Math.min(10_000, 500 * attempt)));
        continue;
      }
      if (reply.type !== 'events.ack') throw new Error(`unexpected answer ${reply.type}`);
      const ack = reply.payload;
      const base = (this.logs.get(tournamentId) ?? []).slice(0, baseSeq);
      if (ack.accepted) {
        this.set(tournamentId, [...base, ...ack.events]);
        return { accepted: true, events: ack.events };
      }
      if (!ack.events.length && ack.reason?.startsWith('invalid')) {
        // Not a race but a bug: retrying would loop forever.
        throw new Error(`website rejected events: ${ack.reason}`);
      }
      this.set(tournamentId, [...base, ...ack.events]);
      return { accepted: false, missing: ack.events, reason: ack.reason ?? 'rejected' };
    }
  }

  private set(tournamentId: string, events: TournamentEvent[]) {
    if (events.length) this.logs.set(tournamentId, events);
    else this.logs.delete(tournamentId);
    if (!this.dir) return;
    if (!/^[A-Za-z0-9_-]+$/.test(tournamentId))
      throw new Error(`invalid tournament id ${tournamentId}`);
    const file = path.join(this.dir, `${tournamentId}.jsonl`);
    if (!events.length) {
      fs.rmSync(file, { force: true });
      return;
    }
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    fs.renameSync(tmp, file);
  }
}
