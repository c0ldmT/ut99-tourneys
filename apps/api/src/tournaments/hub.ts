import { Injectable } from '@nestjs/common';

export type HubMessage =
  | { type: 'change'; headSeq: number; phase: string }
  | { type: 'live'; data: unknown }
  | { type: 'agent'; online: boolean };

type Listener = (msg: HubMessage) => void;

/** In-process fan-out of tournament updates to the browsers' event streams. */
@Injectable()
export class LiveHub {
  private listeners = new Map<string, Set<Listener>>();
  /** Latest live telemetry per tournament (not persisted). */
  private live = new Map<string, unknown>();

  subscribe(tournamentId: string, fn: Listener): () => void {
    let set = this.listeners.get(tournamentId);
    if (!set) this.listeners.set(tournamentId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size) this.listeners.delete(tournamentId);
    };
  }

  publish(tournamentId: string, msg: HubMessage): void {
    if (msg.type === 'live') this.live.set(tournamentId, msg.data);
    for (const fn of this.listeners.get(tournamentId) ?? []) {
      try {
        fn(msg);
      } catch {
        // a broken stream must not affect the others
      }
    }
  }

  latestLive(tournamentId: string): unknown {
    return this.live.get(tournamentId);
  }

  clearLive(tournamentId: string): void {
    this.live.delete(tournamentId);
  }

  subscriberCount(tournamentId: string): number {
    return this.listeners.get(tournamentId)?.size ?? 0;
  }
}
