import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { KillFeedEntry, LiveState } from '@tourney/protocol';

export type HubMessage =
  | { type: 'change'; headSeq: number; phase: string }
  | { type: 'live'; data: unknown }
  | { type: 'feed'; data: KillFeedEntry }
  | { type: 'state'; data: LiveState }
  | { type: 'agent'; online: boolean };

type Listener = (msg: HubMessage) => void;

/** Feed entries kept per game and run for browsers that open the match page during a game. */
export const FEED_SIZE = 40;

/**
 * Feed entries that help a player when shown live (a human plays): items, bot thoughts and
 * trait episodes (mod 0.17.0).
 */
export function heldBack(entry: KillFeedEntry): boolean {
  return entry.humans === true && byTheWay(entry);
}

/** Items, thoughts and trait episodes: kept apart from kills and chat lines, dropped first. */
const byTheWay = (x: KillFeedEntry) =>
  x.kind === 'item' || x.kind === 'thought' || x.kind === 'trait';

/**
 * In-process fan-out of tournament updates to the browsers' event streams. Live state, items and
 * bot thoughts of a game with a human player can be published with a delay (kills stay live), so
 * a player cannot read the opponent's health or a bot's plans on a second screen.
 */
@Injectable()
export class LiveHub implements OnModuleDestroy {
  private listeners = new Map<string, Set<Listener>>();
  /** Latest live telemetry per tournament (not persisted). */
  private live = new Map<string, unknown>();
  /** Latest live state per tournament (as published, i.e. after the delay). */
  private state = new Map<string, LiveState>();
  /** Feed of the game in progress per tournament (the last FEED_SIZE entries per run). */
  private feed = new Map<string, KillFeedEntry[]>();
  /** The game (match/game) the kept feed belongs to, per tournament. */
  private feedGame = new Map<string, string>();
  /** Delayed messages waiting per tournament. */
  private pending = new Map<string, Set<NodeJS.Timeout>>();

  subscribe(tournamentId: string, fn: Listener): () => void {
    let set = this.listeners.get(tournamentId);
    if (!set) this.listeners.set(tournamentId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size) this.listeners.delete(tournamentId);
    };
  }

  /** Publishes now, or after `delayMs` (dropped when the live data is cleared meanwhile). */
  publish(tournamentId: string, msg: HubMessage, delayMs = 0): void {
    if (delayMs <= 0) return this.deliver(tournamentId, msg);
    let set = this.pending.get(tournamentId);
    if (!set) this.pending.set(tournamentId, (set = new Set()));
    const timer = setTimeout(() => {
      set.delete(timer);
      this.deliver(tournamentId, msg);
    }, delayMs);
    timer.unref?.();
    set.add(timer);
  }

  private deliver(tournamentId: string, msg: HubMessage): void {
    if (msg.type === 'live') this.live.set(tournamentId, msg.data);
    if (msg.type === 'state') this.state.set(tournamentId, msg.data);
    if (msg.type === 'feed') this.keep(tournamentId, msg.data);
    for (const fn of this.listeners.get(tournamentId) ?? []) {
      try {
        fn(msg);
      } catch {
        // a broken stream must not affect the others
      }
    }
  }

  /**
   * Keeps the last FEED_SIZE kills and chat lines and FEED_SIZE items and thoughts per run of the
   * game in progress. A live entry of another game starts over; a delayed one of an earlier game
   * goes to the streams only.
   */
  private keep(tournamentId: string, e: KillFeedEntry): void {
    const key = `${e.matchId}/${e.game}`;
    if (!heldBack(e) && this.feedGame.get(tournamentId) !== key) {
      this.feedGame.set(tournamentId, key);
      this.feed.set(tournamentId, []);
    }
    if (this.feedGame.get(tournamentId) !== key) return;
    const list = this.feed.get(tournamentId) ?? [];
    const side = (x: KillFeedEntry) => (byTheWay(x) ? 1 : 0);
    const group = (x: KillFeedEntry) => `${x.run ?? 0}/${side(x)}`;
    const g = group(e);
    const same = list.filter((x) => group(x) === g);
    const drop = new Set(same.slice(0, Math.max(0, same.length + 1 - FEED_SIZE)));
    this.feed.set(tournamentId, [...list.filter((x) => !drop.has(x)), e]);
  }

  latestLive(tournamentId: string): unknown {
    return this.live.get(tournamentId);
  }

  latestState(tournamentId: string): LiveState | undefined {
    return this.state.get(tournamentId);
  }

  clearLive(tournamentId: string): void {
    this.live.delete(tournamentId);
    this.state.delete(tournamentId);
    this.feed.delete(tournamentId);
    this.feedGame.delete(tournamentId);
    for (const t of this.pending.get(tournamentId) ?? []) clearTimeout(t);
    this.pending.delete(tournamentId);
  }

  /** Feed of the game in progress (both runs of a Monster Hunt game), oldest first. */
  latestFeed(tournamentId: string): KillFeedEntry[] {
    return this.feed.get(tournamentId) ?? [];
  }

  subscriberCount(tournamentId: string): number {
    return this.listeners.get(tournamentId)?.size ?? 0;
  }

  onModuleDestroy(): void {
    for (const id of [...this.pending.keys()]) this.clearLive(id);
  }
}
