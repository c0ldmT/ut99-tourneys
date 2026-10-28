import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { LOGGER, type ApiLogger } from './logger.js';

/**
 * A block of the event loop at least this long is a "long block" (ms): it is logged with what
 * ran, and two of them within `STRIKE_WINDOW_MS` mark the server busy (decision 229; on a
 * Raspberry Pi a single block of a few hundred ms is normal and not worth a warning).
 */
export const BUSY_BLOCK_MS = 1500;
/** Two long blocks within this time mark the server busy (ms). */
export const STRIKE_WINDOW_MS = 10_000;
/** How often the event loop is looked at (ms). */
const WINDOW_MS = 2000;
/** Requests and timer tasks at least this long are kept for the log of a long block (ms). */
const SLOW_WORK_MS = 200;
/** How many of them are kept. */
const RECENT_MAX = 12;
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

/** A request or timer task, for the log line of a long block. */
interface Work {
  what: string;
  start: number;
  end?: number;
}

export interface ActivityHandle {
  step(done: number): void;
  end(): void;
}

/**
 * What the server is working on (decisions 227, 229): jobs that run in steps (a league evening)
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
  /** When the last long blocks were seen (two strikes make "busy"). */
  private strikes: number[] = [];
  /** Requests and timer tasks running now, and the slow ones that ended lately. */
  private readonly running = new Set<Work>();
  private recent: Work[] = [];

  constructor(@Optional() @Inject(LOGGER) private readonly log?: ApiLogger) {}

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

  /**
   * Notes a piece of work (a request, a timer task) for the log of a long block; the returned
   * function ends it. Slow work stays listed for a while after its end.
   */
  track(what: string): () => void {
    const w: Work = { what, start: Date.now() };
    this.running.add(w);
    return () => {
      if (!this.running.delete(w)) return;
      w.end = Date.now();
      if (w.end - w.start < SLOW_WORK_MS) return;
      this.recent.push(w);
      if (this.recent.length > RECENT_MAX) this.recent.shift();
    };
  }

  /** Runs a timer task, noted for the log of a long block; a failure is logged, not thrown. */
  async task(label: string, fn: () => unknown): Promise<void> {
    const end = this.track(`task ${label}`);
    try {
      await fn();
    } catch (e) {
      this.log?.error(`task ${label}: ${(e as Error).message}`);
    } finally {
      end();
    }
  }

  /** Marks the server busy (also for tests). */
  markBusy(): void {
    this.busyUntil = Date.now() + BUSY_HOLD_MS;
    this.check(false);
  }

  /** A long block of `ms` was seen: logged, and the second within the window makes "busy". */
  blocked(ms: number, now = Date.now()): void {
    this.log?.warn(`event loop blocked ${Math.round(ms)} ms; ${this.culprits(now, ms)}`);
    this.strikes = [...this.strikes.filter((t) => now - t < STRIKE_WINDOW_MS), now];
    if (this.strikes.length >= 2) this.busyUntil = now + BUSY_HOLD_MS;
    this.check(false);
  }

  /** What ran around a block: work still running and slow work that ended in the window. */
  culprits(now: number, ms: number): string {
    const since = now - WINDOW_MS - ms;
    const fmt = (w: Work) => `${w.what} ${(w.end ?? now) - w.start} ms${w.end ? '' : ' (running)'}`;
    const list = [
      ...[...this.running].filter((w) => now - w.start >= SLOW_WORK_MS),
      ...this.recent.filter((w) => w.end! >= since),
    ].sort((a, b) => (b.end ?? now) - b.start - ((a.end ?? now) - a.start));
    return list.length ? `work: ${list.slice(0, 8).map(fmt).join(', ')}` : 'no slow work seen';
  }

  private check(read = true): void {
    if (read && this.histogram) {
      // The longest delay of the loop's timer in this window, in ms.
      const max = this.histogram.max / 1e6;
      this.histogram.reset();
      if (max >= BUSY_BLOCK_MS) return this.blocked(max);
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
