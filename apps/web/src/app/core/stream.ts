import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { LiveInfo } from './types';

/**
 * Server-sent events of one tournament: `change` means "fetch the detail again", `live` carries
 * match telemetry, `agent` tells whether the bridge is online. Reconnects on its own.
 */
@Injectable()
export class TournamentStream {
  readonly live = signal<LiveInfo | null>(null);
  readonly connected = signal(false);
  private source?: EventSource;
  private onChange: () => void = () => {};

  constructor() {
    inject(DestroyRef).onDestroy(() => this.close());
  }

  open(id: string, onChange: () => void): void {
    this.close();
    this.onChange = onChange;
    const es = new EventSource(`/api/tournaments/${encodeURIComponent(id)}/stream`, {
      withCredentials: true,
    });
    this.source = es;
    es.onopen = () => this.connected.set(true);
    es.onerror = () => this.connected.set(false);
    es.addEventListener('change', () => this.onChange());
    es.addEventListener('agent', () => this.onChange());
    es.addEventListener('live', (ev) => {
      try {
        this.live.set(JSON.parse((ev as MessageEvent<string>).data) as LiveInfo);
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
