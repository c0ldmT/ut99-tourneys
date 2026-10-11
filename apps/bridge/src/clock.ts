/** Time source and timers, injectable so tests can run a whole tournament in milliseconds. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export type TimerHandle = { readonly id: number };

class RealClock implements Clock {
  private nextId = 1;
  private timers = new Map<number, NodeJS.Timeout>();

  now(): number {
    return Date.now();
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        fn();
      }, ms),
    );
    return { id };
  }

  clearTimeout(handle: TimerHandle): void {
    const t = this.timers.get(handle.id);
    if (t) clearTimeout(t);
    this.timers.delete(handle.id);
  }
}

export const realClock: Clock = new RealClock();

/** Manually advanced clock for tests. Timers fire in due order during advance(). */
export class FakeClock implements Clock {
  private time: number;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  constructor(start = Date.UTC(2026, 9, 11, 12, 0, 0)) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + Math.max(0, ms), fn });
    return { id };
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers.delete(handle.id);
  }

  /** Advances time, firing every timer that becomes due (including timers scheduled meanwhile). */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let nextId = -1;
      let nextAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.at <= target && (t.at < nextAt || (t.at === nextAt && id < nextId))) {
          nextAt = t.at;
          nextId = id;
        }
      }
      if (nextId < 0) break;
      const timer = this.timers.get(nextId) as { at: number; fn: () => void };
      this.timers.delete(nextId);
      this.time = Math.max(this.time, timer.at);
      timer.fn();
    }
    this.time = target;
  }

  get pendingTimers(): number {
    return this.timers.size;
  }
}
