import { Injectable } from '@nestjs/common';

export type HubMessage =
  | { type: 'change'; headSeq: number; phase: string }
  | { type: 'live'; data: unknown }
  | { type: 'feed'; data: { matchId: string; game: number } }
  | { type: 'agent'; online: boolean };

type Listener = (msg: HubMessage) => void;

/** Kills kept for browsers that open the match page during a game. */
export const FEED_SIZE = 40;

/** In-process fan-out of tournament updates to the browsers' event streams. */
@Injectable()
export class LiveHub {
  private listeners = new Map<string, Set<Listener>>();
  /** Latest live telemetry per tournament (not persisted). */
  private live = new Map<string, unknown>();
  /** Kill feed of the game in progress per tournament (the last FEED_SIZE kills). */
  private feed = new Map<string, { matchId: string; game: number }[]>();

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
    if (msg.type === 'feed') {
      const prev = this.feed.get(tournamentId) ?? [];
      const same = prev.filter((e) => e.matchId === msg.data.matchId && e.game === msg.data.game);
      this.feed.set(tournamentId, [...same, msg.data].slice(-FEED_SIZE));
    }
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
    this.feed.delete(tournamentId);
  }

  /** Kill feed of the game in progress, oldest first. */
  latestFeed(tournamentId: string): unknown[] {
    return this.feed.get(tournamentId) ?? [];
  }

  subscriberCount(tournamentId: string): number {
    return this.listeners.get(tournamentId)?.size ?? 0;
  }
}
