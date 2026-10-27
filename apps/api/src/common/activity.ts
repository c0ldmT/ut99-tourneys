import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

/** Longest block of the event loop within a window that counts as "busy" (ms). */
export const BUSY_BLOCK_MS = 400;
/** How often the event loop is looked at (ms). */
const WINDOW_MS = 2000;
/** "Busy" stays this long after the last long block (ms): the browsers see it for a moment. */
const BUSY_HOLD_MS = 8000;
/** Progress is sent at most this often per job (ms). */
const PROGRESS_EVERY_MS = 500;

/** Work the server does in the background, for the website's activity bar. */
export interface ActivityJob {
  /** What: the website names it (`activity.job.<key>`), e.g. `leagueEvening`. */
  key: string;
  done: number;
  total: number | null;
  since: string;
}

export interface ActivityState {
  jobs: ActivityJob[];
  /** The event loop was blocked for long just now (answers took long). */
  busy: boolean;
}

export interface ActivityHandle {
  step(done: number): void;
  end(): void;
}

/**
 * What the server is working on (decision 227): jobs that run in steps (a league evening)
 * report their progress, and a long block of the event loop marks the server busy. The
 * browsers get it over `/api/me/stream` (event `activity`). Work that runs in one piece cannot
 * report while it runs (nothing is sent before it ends): it shows as busy afterwards, and the
 * browsers notice slow answers themselves.
 */
@Injectable()
export class ServerActivity implements OnModuleInit, OnModuleDestroy {
  private readonly jobs = new Map<string, ActivityJob>();
  private readonly listeners = new Set<(s: ActivityState) => void>();
  private histogram?: IntervalHistogram;
  private timer?: NodeJS.Timeout;
  private busyUntil = 0;
  private busy = false;
  private nextId = 0;

  onModuleInit(): void {
    this.histogram = monitorEventLoopDelay({ resolution: 20 });
    this.histogram.enable();
    this.timer = setInterval(() => this.check(), WINDOW_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
    this.histogram?.disable();
  }

  state(): ActivityState {
    return { jobs: [...this.jobs.values()].map((j) => ({ ...j })), busy: this.busy };
  }

  subscribe(fn: (s: ActivityState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** A job starts; its handle reports progress and the end. */
  begin(key: string, total: number | null = null): ActivityHandle {
    const id = `${key}:${++this.nextId}`;
    this.jobs.set(id, { key, done: 0, total, since: new Date().toISOString() });
    this.emit();
    let sent = Date.now();
    return {
      step: (done) => {
        const j = this.jobs.get(id);
        if (!j) return;
        j.done = done;
        if (Date.now() - sent >= PROGRESS_EVERY_MS) {
          sent = Date.now();
          this.emit();
        }
      },
      end: () => {
        if (this.jobs.delete(id)) this.emit();
      },
    };
  }

  /** Runs `fn` as a job (async work that gives the event loop turns in between). */
  async run<T>(key: string, total: number | null, fn: (h: ActivityHandle) => Promise<T>) {
    const h = this.begin(key, total);
    try {
      return await fn(h);
    } finally {
      h.end();
    }
  }

  /** Marks the server busy (also for tests). */
  markBusy(): void {
    this.busyUntil = Date.now() + BUSY_HOLD_MS;
    this.check(false);
  }

  private check(read = true): void {
    if (read && this.histogram) {
      // The longest delay of the loop's timer in this window, in ms.
      const max = this.histogram.max / 1e6;
      this.histogram.reset();
      if (max >= BUSY_BLOCK_MS) this.busyUntil = Date.now() + BUSY_HOLD_MS;
    }
    const busy = Date.now() < this.busyUntil;
    if (busy !== this.busy) {
      this.busy = busy;
      this.emit();
    }
  }

  private emit(): void {
    const s = this.state();
    for (const fn of this.listeners)
      try {
        fn(s);
      } catch {
        // a broken stream must not affect the others
      }
  }
}
