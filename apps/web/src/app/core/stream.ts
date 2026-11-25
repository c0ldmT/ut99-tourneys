import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Loading } from './loading';
import type { KillFeedEntry, LiveInfo, LiveStateView } from './types';

/**
 * Server-sent events of one tournament: `change` means "fetch the detail again", `live` carries
 * match telemetry, `agent` tells whether the bridge is online. Reconnects on its own.
 */
@Injectable()
export class TournamentStream {
  readonly live = signal<LiveInfo | null>(null);
  /** Telemetry per match: several are played at once with parallel matches (decision 291). */
  readonly lives = signal<Record<string, LiveInfo>>({});
  /** Live state per match (see `state`). */
  readonly states = signal<Record<string, LiveStateView>>({});
  /** Feed entries arriving while the stream is open (see `feed` on the match page). */
  readonly kill = signal<KillFeedEntry | null>(null);
  /** Called for every feed entry (several can arrive between two renderings). */
  onFeed?: (e: KillFeedEntry) => void;
  /** Live state of the players (mod 0.16.0), delayed by the website while a human plays. */
  readonly state = signal<LiveStateView | null>(null);
  readonly connected = signal(false);
  private source?: EventSource;
  private onChange: () => void = () => {};
  private readonly loading = inject(Loading);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
  }

  open(id: string, onChange: () => void): void {
    this.close();
    this.lives.set({});
    this.states.set({});
    this.onChange = onChange;
    const es = new EventSource(`/api/tournaments/${encodeURIComponent(id)}/stream`, {
      withCredentials: true,
    });
    this.source = es;
    es.onopen = () => this.connected.set(true);
    es.onerror = () => this.connected.set(false);
    // Live updates load in the background (no loading display).
    es.addEventListener('change', () => this.loading.background(this.onChange));
    es.addEventListener('agent', () => this.loading.background(this.onChange));
    es.addEventListener('feed', (ev) => {
      try {
        const e = JSON.parse((ev as MessageEvent<string>).data) as KillFeedEntry;
        this.kill.set(e);
        this.onFeed?.(e);
      } catch {
        // ignore a malformed kill
      }
    });
    es.addEventListener('state', (ev) => {
      try {
        const s = JSON.parse((ev as MessageEvent<string>).data) as LiveStateView;
        this.state.set(s);
        this.states.update((m) => ({ ...m, [s.matchId]: s }));
      } catch {
        // ignore a malformed state
      }
    });
    es.addEventListener('live', (ev) => {
      try {
        const l = JSON.parse((ev as MessageEvent<string>).data) as LiveInfo;
        this.live.set(l);
        this.lives.update((m) => ({ ...m, [l.matchId]: l }));
      } catch {
        // ignore malformed telemetry
      }
    });
  }

  close(): void {
    this.source?.close();
    this.source = undefined;
    this.connected.set(false);
  }
}
