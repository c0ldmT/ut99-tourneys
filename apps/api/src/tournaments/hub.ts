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
/** The match a live message belongs to (live telemetry, feed entries and states carry it). */
const matchOf = (msg: HubMessage): string | undefined =>
  msg.type === 'live' || msg.type === 'feed' || msg.type === 'state'
    ? (msg.data as { matchId?: string } | undefined)?.matchId
    : undefined;

/** Per tournament, per match: the newest entry is moved last (the "latest" match). */
type PerMatch<T> = Map<string, Map<string, T>>;

function put<T>(m: PerMatch<T>, tournamentId: string, matchId: string, value: T): void {
  let inner = m.get(tournamentId);
  if (!inner) m.set(tournamentId, (inner = new Map()));
  inner.delete(matchId);
  inner.set(matchId, value);
}

function pick<T>(m: PerMatch<T>, tournamentId: string, matchId?: string): T | undefined {
  const inner = m.get(tournamentId);
  if (!inner) return undefined;
  if (matchId !== undefined) return inner.get(matchId);
  return [...inner.values()].at(-1);
}

/**
 * In-process fan-out of tournament updates to the browsers' event streams. Live state, items and
 * bot thoughts of a game with a human player can be published with a delay (kills stay live), so
 * a player cannot read the opponent's health or a bot's plans on a second screen. Live data is
 * kept per match: with parallel matches (decision 291) several games of a tournament run at once.
 */
@Injectable()
export class LiveHub implements OnModuleDestroy {
  private listeners = new Map<string, Set<Listener>>();
  /** Latest live telemetry per tournament and match (not persisted). */
  private live: PerMatch<unknown> = new Map();
  /** Latest live state per tournament and match (as published, i.e. after the delay). */
  private state: PerMatch<LiveState> = new Map();
  /** Feed of the game in progress per tournament and match (the last FEED_SIZE entries per run). */
  private feed: PerMatch<{ game: string; list: KillFeedEntry[] }> = new Map();
  /** Delayed messages waiting per tournament (with their match). */
  private pending = new Map<string, Map<NodeJS.Timeout, string | undefined>>();

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
    let waiting = this.pending.get(tournamentId);
    if (!waiting) this.pending.set(tournamentId, (waiting = new Map()));
    const timer = setTimeout(() => {
      waiting.delete(timer);
      this.deliver(tournamentId, msg);
    }, delayMs);
    timer.unref?.();
    waiting.set(timer, matchOf(msg));
  }

  private deliver(tournamentId: string, msg: HubMessage): void {
    const matchId = matchOf(msg);
    if (matchId !== undefined) {
      if (msg.type === 'live') put(this.live, tournamentId, matchId, msg.data);
      if (msg.type === 'state') put(this.state, tournamentId, matchId, msg.data);
      if (msg.type === 'feed') this.keep(tournamentId, msg.data);
    }
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
   * game in progress of each match. A live entry of another game starts over; a delayed one of an
   * earlier game goes to the streams only.
   */
  private keep(tournamentId: string, e: KillFeedEntry): void {
    const key = `${e.game}`;
    let kept = pick(this.feed, tournamentId, e.matchId);
    if (!heldBack(e) && kept?.game !== key) {
      kept = { game: key, list: [] };
    }
    if (!kept || kept.game !== key) return;
    const list = kept.list;
    const side = (x: KillFeedEntry) => (byTheWay(x) ? 1 : 0);
    const group = (x: KillFeedEntry) => `${x.run ?? 0}/${side(x)}`;
    const g = group(e);
    const same = list.filter((x) => group(x) === g);
    const drop = new Set(same.slice(0, Math.max(0, same.length + 1 - FEED_SIZE)));
    put(this.feed, tournamentId, e.matchId, {
      game: key,
      list: [...list.filter((x) => !drop.has(x)), e],
    });
  }

  /** Telemetry of a match, or of the match that sent the latest. */
  latestLive(tournamentId: string, matchId?: string): unknown {
    return pick(this.live, tournamentId, matchId);
  }

  /** Telemetry of every match being played (parallel matches), oldest update first. */
  allLive(tournamentId: string): unknown[] {
    return [...(this.live.get(tournamentId)?.values() ?? [])];
  }

  latestState(tournamentId: string, matchId?: string): LiveState | undefined {
    return pick(this.state, tournamentId, matchId);
  }

  /** The live data of a match (it was decided), or of the whole tournament. */
  clearLive(tournamentId: string, matchId?: string): void {
    for (const m of [this.live, this.state, this.feed] as PerMatch<unknown>[]) {
      if (matchId === undefined) m.delete(tournamentId);
      else m.get(tournamentId)?.delete(matchId);
    }
    const waiting = this.pending.get(tournamentId);
    for (const [t, mid] of [...(waiting?.entries() ?? [])]) {
      if (matchId !== undefined && mid !== matchId) continue;
      clearTimeout(t);
      waiting?.delete(t);
    }
    if (matchId === undefined || !waiting?.size) this.pending.delete(tournamentId);
  }

  /** Feed of the game in progress of a match (or the latest match), oldest first. */
  latestFeed(tournamentId: string, matchId?: string): KillFeedEntry[] {
    return pick(this.feed, tournamentId, matchId)?.list ?? [];
  }

  subscriberCount(tournamentId: string): number {
    return this.listeners.get(tournamentId)?.size ?? 0;
  }

  onModuleDestroy(): void {
    for (const id of [...this.pending.keys()]) this.clearLive(id);
  }
}
