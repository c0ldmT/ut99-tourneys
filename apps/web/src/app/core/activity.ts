import { computed, Injectable, signal } from '@angular/core';

/**
 * A call someone waits for taking longer than this (ms) makes the server count as busy
 * (decision 229: a Raspberry Pi often needs a second or two, that is not "busy" yet).
 */
export const SLOW_CALL_MS = 4000;
/** Once shown, "busy" stays at least this long (ms), so the bar does not flicker. */
const SLOW_HOLD_MS = 3000;

/** Work the server does in the background (`/api/me/stream`, event `activity`). */
export interface ServerJob {
  key: string;
  done: number;
  total: number | null;
  since: string;
}

export interface ServerActivityState {
  jobs: ServerJob[];
  busy: boolean;
}

const NONE: ServerActivityState = { jobs: [], busy: false };

/**
 * What the server is working on, for the activity bar under the header (decisions 227, 229):
 * the jobs the server reports (with progress), its "busy" mark (the event loop was blocked) and
 * slow answers seen here (a blocked server cannot report while it is blocked).
 */
@Injectable({ providedIn: 'root' })
export class ServerActivity {
  /** From the server's stream (NeuroStore listens; empty without a stream). */
  readonly server = signal<ServerActivityState>(NONE);
  /** A call of this browser takes long right now (or did a moment ago). */
  readonly slow = signal(false);
  readonly job = computed(() => this.server().jobs[0] ?? null);
  readonly busy = computed(() => this.server().busy || this.slow());
  readonly shown = computed(() => !!this.job() || this.busy());

  private readonly calls = new Map<number, number>();
  private seq = 0;
  private timer?: ReturnType<typeof setInterval>;
  private slowUntil = 0;

  /** The clock (tests set their own). */
  now: () => number = Date.now;

  /** A call starts (Api calls in the foreground); the returned function ends it. */
  call(): () => void {
    const id = ++this.seq;
    this.calls.set(id, this.now());
    this.timer ??= setInterval(() => this.check(), 500);
    return () => {
      this.calls.delete(id);
      this.check();
    };
  }

  /** The stream ended or another user logged in: nothing known about the server. */
  reset(): void {
    this.server.set(NONE);
  }

  /** Looks at the calls running (also used by tests). */
  check(): void {
    const now = this.now();
    if ([...this.calls.values()].some((t) => now - t >= SLOW_CALL_MS))
      this.slowUntil = now + SLOW_HOLD_MS;
    this.slow.set(now < this.slowUntil);
    if (!this.calls.size && !this.slow()) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
