import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  Pipe,
  signal,
  untracked,
  type PipeTransform,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { ServerActivity } from './activity';
import { Api } from './api';
import { Auth } from './auth';
import { I18n } from './i18n';

/**
 * Neuro, the website's virtual currency (symbol €). Amounts are whole Neuro, written with the
 * language's digit grouping and the symbol after the number: "1.250 €" / "1,250 €".
 */
export function formatNeuro(n: number, lang: string, symbol = true): string {
  const locale = lang === 'de' ? 'de-DE' : 'en-GB';
  const s = Math.round(n).toLocaleString(locale);
  return symbol ? `${s}\u00a0€` : s;
}

/** {{ amount | neuro }} ({{ amount | neuro: false }} without €, next to the coin); re-evaluated
 * when the language changes. */
@Pipe({ name: 'neuro', pure: false })
export class NeuroPipe implements PipeTransform {
  private readonly i18n = inject(I18n);
  transform(n: number | null | undefined, symbol = true): string {
    return n === null || n === undefined ? '' : formatNeuro(n, this.i18n.lang(), symbol);
  }
}

/** The own wallet as the server computes it (`GET /api/me/neuro`). */
export interface NeuroWallet {
  /** The running season (out of season the last one); null: none yet. */
  season: number | null;
  running: boolean;
  balance: number;
  /** In open bets. */
  staked: number;
  /** What can be staked: balance - staked. */
  free: number;
  /** The rescue floor of the season. */
  floor: number;
  /** What a rescue tops up to now: the floor minus Neuro in Dream Team bots (in debt: 0). */
  rescueTo?: number;
  /** What can be spent (shop, Dream Team): free above the floor, 0 out of season. */
  spendable: number;
}

/**
 * The own Neuro, one state for every display (navbar, bets, shop, Dream Team). Never computed in
 * the browser: it is the server's snapshot, fetched again when the server reports a change
 * (event stream `/api/me/stream`: bookings, bets, results), after every own action, on
 * reconnecting, on page changes and when the tab comes back. Only the newest answer counts.
 */
@Injectable({ providedIn: 'root' })
export class NeuroStore {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly activity = inject(ServerActivity);
  private readonly state = signal<NeuroWallet | null>(null);
  readonly wallet = this.state.asReadonly();
  readonly balance = computed(() => {
    const w = this.state();
    return w && w.season !== null ? w.balance : null;
  });
  /** What can be spent; null while unknown (not loaded yet): the server checks anyway. */
  readonly spendable = computed(() => this.state()?.spendable ?? null);
  private source?: EventSource;
  private userId: string | null = null;
  private seq = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private retry?: ReturnType<typeof setTimeout>;
  private backoff = 2000;

  constructor() {
    effect(() => {
      const id = this.auth.me()?.id ?? null;
      untracked(() => {
        if (id === this.userId) return;
        // Another user (or none): a new stream and no numbers of the old one.
        this.disconnect();
        this.userId = id;
        if (id) this.connect();
      });
    });
    // Own actions (any successful change through the Api).
    effect(() => {
      if (this.api.changes() > 0) untracked(() => this.refresh());
    });
    const sub = inject(Router).events.subscribe((e) => {
      if (e instanceof NavigationEnd) this.refresh();
    });
    // Hidden tabs keep no stream open (browsers allow few connections per server over HTTP/1.1);
    // back in view they reconnect and fetch.
    const visible = () => {
      if (!this.userId) return;
      if (document.visibilityState === 'visible') this.connect();
      else this.close();
    };
    document.addEventListener('visibilitychange', visible);
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      document.removeEventListener('visibilitychange', visible);
      this.disconnect();
    });
  }

  /** Fetches the wallet soon (several triggers at once make one request). */
  refresh(): void {
    if (!this.auth.me()) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.load(), 150);
  }

  private async load() {
    const n = ++this.seq;
    try {
      const w = await this.api.myNeuro();
      // An older answer arriving late must not overwrite a newer one.
      if (n === this.seq) this.state.set(w);
    } catch {
      // keep the last state (the next trigger tries again)
    }
  }

  private connect() {
    this.refresh();
    if (this.source || typeof EventSource === 'undefined') return;
    if (document.visibilityState === 'hidden') return;
    const es = new EventSource('/api/me/stream', { withCredentials: true });
    this.source = es;
    // On (re)connecting: changes may have been missed meanwhile.
    es.onopen = () => {
      this.backoff = 2000;
      this.refresh();
    };
    es.onerror = () => {
      // The browser retries by itself unless the server answered with an error (a restart,
      // an ended session): then try again later.
      if (es.readyState !== EventSource.CLOSED) return;
      if (this.source === es) this.source = undefined;
      // A restart: what the server worked on is over (it says again once connected).
      this.activity.reset();
      clearTimeout(this.retry);
      this.retry = setTimeout(() => {
        if (this.userId) this.connect();
      }, this.backoff);
      this.backoff = Math.min(this.backoff * 2, 60_000);
    };
    es.addEventListener('neuro', () => this.refresh());
    // What the server works on (activity bar, decision 227): the state at the start, then changes.
    es.addEventListener('activity', (e) => {
      try {
        this.activity.server.set(JSON.parse((e as MessageEvent<string>).data));
      } catch {
        // a broken line: keep the last state
      }
    });
  }

  private close() {
    this.activity.reset();
    clearTimeout(this.retry);
    this.source?.close();
    this.source = undefined;
  }

  private disconnect() {
    this.close();
    clearTimeout(this.timer);
    this.seq++;
    this.state.set(null);
  }
}
