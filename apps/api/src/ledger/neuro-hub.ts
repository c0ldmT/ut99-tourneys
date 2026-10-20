import { Injectable } from '@nestjs/common';

type Listener = () => void;

/** Broadcasts to everyone at most this often (match results settle many bets at once). */
const ALL_EVERY_MS = 1000;

/**
 * Tells the browsers that a user's Neuro changed (`/api/me/stream`, event `neuro`): ledger
 * bookings, bets, the shop, rescues for one user; match results, finished or aborted
 * tournaments and seasons for everybody (they settle bets). The browser then fetches its
 * wallet (`/api/me/neuro`), so every display shows the same server state.
 */
@Injectable()
export class NeuroHub {
  private readonly listeners = new Map<string, Set<Listener>>();
  private allTimer?: NodeJS.Timeout;

  subscribe(userId: string, fn: Listener): () => void {
    let set = this.listeners.get(userId);
    if (!set) this.listeners.set(userId, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (!set.size) this.listeners.delete(userId);
    };
  }

  /** The Neuro of one user changed. */
  changed(userId: string): void {
    for (const fn of this.listeners.get(userId) ?? []) this.call(fn);
  }

  /** The Neuro of anybody may have changed (bets settled); sent once per second at most. */
  changedAll(): void {
    if (this.allTimer) return;
    this.allTimer = setTimeout(() => {
      this.allTimer = undefined;
      for (const set of this.listeners.values()) for (const fn of set) this.call(fn);
    }, ALL_EVERY_MS);
    this.allTimer.unref();
  }

  listenerCount(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }

  private call(fn: Listener) {
    try {
      fn();
    } catch {
      // a broken stream must not affect the others
    }
  }
}
