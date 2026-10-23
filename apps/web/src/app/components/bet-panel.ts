import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { formatNeuro, NeuroPipe, NeuroStore } from '../core/neuro';
import { Coin } from '../core/brand';
import type { BetMatchView, Entrant, TournamentBets, TournamentDetail } from '../core/types';

interface Draft {
  pick: string;
  amount: number;
}

/**
 * Betting with Neuro on the tournament page (side column): the open matches one at a time
 * (switch between them), the stake form and the expert tip; below, the next matches of the
 * bracket. Matches whose bets are closed and running go to the page (`running`).
 */
@Component({
  selector: 'app-bet-panel',
  imports: [TPipe, FormsModule, NeuroPipe, RouterLink, Coin],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
      @if (v.open || mineAny()) {
        <div class="card bets">
          <div class="spread top">
            <h2>{{ 'bets.title' | t }}</h2>
            @if (wallet(); as w) {
              <b class="neuro bal" [title]="'bets.balance' | t"
                ><na-coin [size]="18" /> {{ w.balance | neuro: false }}</b
              >
            }
          </div>
          @if (wallet()?.staked) {
            <p class="muted small">
              {{ 'bets.staked' | t }} {{ wallet()!.staked | neuro }} · {{ 'bets.free' | t }}
              {{ wallet()!.free | neuro }}
            </p>
          }
          @if (!v.open) {
            <p class="muted small">{{ 'bets.closed.' + (v.reason ?? 'phase') | t }}</p>
          } @else if (!openMatches().length) {
            <p class="muted small">{{ 'bets.noneOpen' | t }}</p>
          } @else if (selected(); as m) {
            <div class="switch">
              <button
                type="button"
                class="nav"
                [attr.aria-label]="'bets.prev' | t"
                [disabled]="openMatches().length < 2"
                (click)="step(-1)"
              >
                ‹
              </button>
              <div class="which">
                <a class="mono" [routerLink]="['/t', tournament().id, 'm', m.matchId]">{{
                  m.matchId
                }}</a>
                <span class="muted small">{{
                  'bets.ofN' | t: { i: selectedIndex() + 1, n: openMatches().length }
                }}</span>
              </div>
              <button
                type="button"
                class="nav"
                [attr.aria-label]="'bets.next' | t"
                [disabled]="openMatches().length < 2"
                (click)="step(1)"
              >
                ›
              </button>
            </div>
            @if (m.playing) {
              <div class="pair">
                <span>{{ name(m.entrants[0]) }}</span>
                <span class="vs">vs</span>
                <span>{{ name(m.entrants[1]) }}</span>
              </div>
              <p class="muted small">{{ 'bets.ownMatch' | t }}</p>
            } @else {
              <div class="sides">
                @for (e of m.entrants; track e; let i = $index) {
                  <button
                    type="button"
                    class="side"
                    [class.b]="i === 1"
                    [class.picked]="draft(m).pick === e"
                    [attr.aria-pressed]="draft(m).pick === e"
                    (click)="setPick(m, e)"
                  >
                    <span class="nm">{{ name(e) }}</span>
                    @if (rating(e); as r) {
                      <span class="muted small mono">{{ r }}</span>
                    }
                  </button>
                }
              </div>
              <div class="stake">
                <label class="amt"
                  ><span class="sr">{{ 'bets.amount' | t }}</span>
                  <input
                    type="number"
                    min="1"
                    class="mono"
                    [max]="maxFor(m)"
                    [name]="'amt' + m.matchId"
                    [ngModel]="draft(m).amount"
                    (ngModelChange)="setAmount(m, $event)"
                  />
                  <span class="sym">€</span></label
                >
                <button
                  type="button"
                  class="primary"
                  [disabled]="busy() || !draft(m).pick || !(draft(m).amount >= 1)"
                  (click)="place(m)"
                >
                  {{ (m.mine ? 'bets.change' : 'bets.place') | t }}
                </button>
              </div>
              <div class="quick">
                <button type="button" (click)="setAmount(m, part(m, 0.1))">10 %</button>
                <button type="button" (click)="setAmount(m, part(m, 0.25))">25 %</button>
                <button type="button" (click)="setAmount(m, maxFor(m))">
                  {{ 'bets.allIn' | t }}
                </button>
                @if (m.mine) {
                  <button type="button" class="wd" (click)="withdraw(m)" [disabled]="busy()">
                    {{ 'bets.withdraw' | t }}
                  </button>
                }
              </div>
              @if (m.mine; as b) {
                <p class="small ok">
                  {{ 'bets.yourBet' | t: { amount: neuro(b.amount), name: name(b.pick) } }}
                </p>
              }
            }
            @if (m.expert; as x) {
              <div class="expert small">
                <span class="kpi">{{ 'bets.expertTitle' | t }}</span>
                {{ 'bets.expert' | t: { bot: x.name, name: x.pickName ?? name(x.pick) } }}
              </div>
            }
          }
          @if (myNet(); as n) {
            <p class="small net">
              {{ 'bets.myNet' | t }}
              <b class="mono" [class.gain]="n > 0" [class.loss]="n < 0">{{ signed(n) }}</b>
            </p>
          }
          @if (v.open) {
            <details class="how">
              <summary class="small">{{ 'bets.howTo' | t }}</summary>
              <p class="muted small">
                {{ 'bets.hint' | t: { floor: neuro(wallet()?.floor ?? 0) } }}
              </p>
            </details>
          }
        </div>
      }
    }
    @if (nextMatches().length) {
      <div class="card next">
        <h2>{{ 'bets.nextMatches' | t }}</h2>
        @for (n of nextMatches(); track n.id) {
          <div class="nrow" [class.sel]="n.id === selectedId()">
            <span class="mono muted id">{{ n.id }}</span>
            @if (n.open) {
              <button type="button" class="link vsl" (click)="select(n.id)">
                {{ n.a }} <span class="muted">vs</span> {{ n.b }}
              </button>
              <span class="badge eur">€</span>
            } @else if (n.ready) {
              <a class="vsl" [routerLink]="['/t', tournament().id, 'm', n.id]"
                >{{ n.a }} <span class="muted">vs</span> {{ n.b }}</a
              >
            } @else {
              <span class="vsl muted">{{ n.a }} vs {{ n.b }}</span>
            }
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .top h2 {
      margin: 0;
    }
    .bets {
      border-color: rgba(245, 184, 61, 0.28);
    }
    .bal {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 1.15rem;
    }
    .switch {
      display: grid;
      grid-template-columns: 40px 1fr 40px;
      align-items: center;
      gap: 8px;
      margin: 12px 0 10px;
    }
    .nav {
      min-height: 36px;
      padding: 0;
      font-size: 1.3rem;
      line-height: 1;
    }
    .which {
      display: flex;
      flex-direction: column;
      align-items: center;
      line-height: 1.2;
    }
    .which a {
      font-weight: 700;
    }
    .sides {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .pair {
      display: flex;
      gap: 8px;
      justify-content: center;
      font-weight: 600;
    }
    .vs {
      color: var(--muted);
    }
    button.side {
      min-width: 0;
      flex-direction: column;
      gap: 2px;
      padding: 10px 8px;
      box-shadow: inset 0 3px 0 var(--side-a);
    }
    button.side.b {
      box-shadow: inset 0 3px 0 var(--side-b);
    }
    button.side.picked {
      border-color: var(--accent);
      background: var(--me-bg);
    }
    .nm {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .stake {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .amt {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
    }
    .amt input {
      min-width: 0;
    }
    .sym {
      color: var(--muted);
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
    .quick {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .quick button {
      min-height: 30px;
      padding: 2px 10px;
      font-size: 0.85rem;
      background: transparent;
    }
    .quick .wd {
      margin-left: auto;
    }
    .ok {
      color: var(--live);
    }
    .expert {
      margin-top: 12px;
      padding: 9px 11px;
      border-radius: var(--radius-sm);
      background: var(--panel-2);
    }
    .expert .kpi {
      display: block;
      color: var(--hot-text);
    }
    .net {
      margin-top: 12px;
    }
    .how {
      margin-top: 12px;
      border-top: 1px solid var(--border);
      padding-top: 8px;
    }
    .how summary {
      cursor: pointer;
      color: var(--text-2);
    }
    .next h2 {
      margin-bottom: 8px;
    }
    .nrow {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 6px;
      border-top: 1px solid var(--border);
      font-size: 0.92rem;
    }
    .nrow:first-of-type {
      border-top: 0;
    }
    .nrow.sel {
      background: var(--me-bg);
      border-radius: 6px;
    }
    .id {
      width: 44px;
      flex: none;
    }
    .vsl {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: left;
      color: var(--text);
    }
    button.vsl {
      display: block;
      font-weight: 500;
    }
    button.vsl:hover {
      color: var(--accent);
    }
    .eur {
      color: var(--neuro-text);
      border-color: rgba(245, 184, 61, 0.4);
      background: rgba(245, 184, 61, 0.08);
      height: 20px;
    }
    p {
      margin: 6px 0 0;
    }
  `,
})
export class BetPanel {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  private readonly auth = inject(Auth);
  readonly tournament = input.required<TournamentDetail>();
  /** Entrant names for the bet lists. */
  protected readonly entrantNames = computed(() =>
    Object.fromEntries(
      Object.entries(this.tournament().projection?.entrants ?? {}).map(([k, e]) => [
        k,
        e.displayName,
      ]),
    ),
  );
  /** Matches that take bets now (the bracket marks them). */
  readonly openIds = output<string[]>();
  /** Matches whose bets are closed and that are being played (shown by the page). */
  readonly running = output<BetMatchView[]>();
  /** The panel shows something (the page keeps its side column). */
  readonly active = output<boolean>();
  private readonly chosen = signal<string | null>(null);
  protected readonly view = signal<TournamentBets | null>(null);
  protected readonly busy = signal(false);
  private readonly store = inject(NeuroStore);
  /**
   * The own wallet: the shared Neuro state (the same as in the navbar) while a season runs,
   * else what the bets view brought.
   */
  protected readonly wallet = computed(() => {
    const s = this.store.wallet();
    return s?.running ? s : (this.view()?.wallet ?? null);
  });
  private readonly drafts = signal<Record<string, Draft>>({});

  protected readonly openMatches = computed(() =>
    (this.view()?.matches ?? []).filter((m) => m.state === 'open'),
  );
  /** The open match shown in the form (chosen, else the first). */
  protected readonly selected = computed(() => {
    const l = this.openMatches();
    return l.find((m) => m.matchId === this.chosen()) ?? l[0] ?? null;
  });
  protected readonly selectedId = computed(() => this.selected()?.matchId ?? null);
  protected readonly selectedIndex = computed(() =>
    Math.max(
      0,
      this.openMatches().findIndex((m) => m.matchId === this.selected()?.matchId),
    ),
  );
  /** Net result of the user's decided bets in this tournament (null: none). */
  protected readonly myNet = computed(() => {
    const mine = (this.view()?.matches ?? [])
      .map((m) => m.mine)
      .filter((b) => b && (b.status === 'won' || b.status === 'lost'));
    if (!mine.length) return null;
    return mine.reduce((s, b) => s + (b!.status === 'won' ? b!.payout - b!.amount : -b!.amount), 0);
  });
  /** The next five matches of the bracket (not the one being played), ready ones first. */
  protected readonly nextMatches = computed(() => {
    const p = this.tournament().projection;
    const b = p?.bracket;
    if (!b || ['finished', 'aborted'].includes(this.tournament().phase)) return [];
    const open = new Set(this.view()?.open ? this.openMatches().map((m) => m.matchId) : []);
    const cur = p.currentMatch?.matchId;
    const tbd = this.i18n.t('bracket.tbd');
    return b.matches
      .filter((m) => (m.status === 'ready' || m.status === 'waiting') && m.id !== cur)
      .sort(
        (x, y) =>
          (x.status === 'ready' ? 0 : 1) - (y.status === 'ready' ? 0 : 1) ||
          x.depth - y.depth ||
          x.side.localeCompare(y.side) ||
          x.index - y.index,
      )
      .slice(0, 5)
      .map((m) => ({
        id: m.id,
        a: m.entrants[0] ? this.name(m.entrants[0]) : tbd,
        b: m.entrants[1] ? this.name(m.entrants[1]) : tbd,
        ready: m.status === 'ready',
        open: open.has(m.id),
      }));
  });
  protected readonly mineAny = computed(() => (this.view()?.matches ?? []).some((m) => m.mine));

  constructor() {
    // Reload when the tournament log moves on (match called, started, decided).
    effect(() => {
      const t = this.tournament();
      void t.headSeq;
      void this.load(t.id);
    });
    effect(() => {
      const v = this.view();
      this.running.emit((v?.matches ?? []).filter((m) => m.state === 'closed'));
      this.active.emit(!!v && (v.open || this.mineAny() || this.nextMatches().length > 0));
    });
  }

  protected select(matchId: string) {
    this.chosen.set(matchId);
  }

  protected step(d: number) {
    const l = this.openMatches();
    if (!l.length) return;
    this.chosen.set(l[(this.selectedIndex() + d + l.length) % l.length]!.matchId);
  }

  /** A share of what can be staked, in tens. */
  protected part(m: BetMatchView, f: number): number {
    return Math.max(1, Math.floor((this.maxFor(m) * f) / 10) * 10);
  }

  protected signed(n: number): string {
    return (n > 0 ? '+' : n < 0 ? '−' : '') + this.neuro(Math.abs(n));
  }

  private async load(id: string) {
    try {
      const v = await this.api.tournamentBets(id);
      this.view.set(v);
      this.openIds.emit(
        v.open ? v.matches.filter((m) => m.state === 'open').map((m) => m.matchId) : [],
      );
    } catch {
      // the toast shows the error
    }
  }

  private entrant(id: string): Entrant | undefined {
    return this.tournament().projection?.entrants[id];
  }

  protected name(id: string): string {
    return this.entrant(id)?.displayName ?? id;
  }

  protected rating(id: string): number | undefined {
    return this.tournament().projection?.seedRatings?.[id];
  }

  protected neuro(n: number): string {
    return formatNeuro(n, this.i18n.lang());
  }

  protected draft(m: BetMatchView): Draft {
    return (
      this.drafts()[m.matchId] ?? {
        pick: m.mine?.pick ?? '',
        amount: m.mine?.amount ?? Math.min(100, this.maxFor(m)),
      }
    );
  }

  /** The free Neuro plus what this bet already holds. */
  protected maxFor(m: BetMatchView): number {
    const w = this.wallet();
    if (!w) return 0;
    // A wallet below its rescue target (the floor minus Neuro in Dream Team bots; none in debt)
    // is topped up when the bet is placed.
    const free = Math.max(w.free, (w.rescueTo ?? w.floor) - w.staked);
    return Math.max(0, free + (m.mine?.amount ?? 0));
  }

  protected setPick(m: BetMatchView, pick: string) {
    this.drafts.update((d) => ({ ...d, [m.matchId]: { ...this.draft(m), pick } }));
  }

  protected setAmount(m: BetMatchView, amount: number | string) {
    const n = Math.max(0, Math.floor(Number(amount) || 0));
    this.drafts.update((d) => ({ ...d, [m.matchId]: { ...this.draft(m), amount: n } }));
  }

  private async run(fn: () => Promise<TournamentBets>, matchId: string) {
    this.busy.set(true);
    try {
      this.view.set(await fn());
      this.drafts.update((d) => {
        const { [matchId]: _, ...rest } = d;
        return rest;
      });
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }

  protected place(m: BetMatchView) {
    const d = this.draft(m);
    void this.run(
      () => this.api.placeBet(this.tournament().id, m.matchId, d.pick, d.amount),
      m.matchId,
    );
  }

  protected withdraw(m: BetMatchView) {
    void this.run(() => this.api.withdrawBet(this.tournament().id, m.matchId), m.matchId);
  }

  /** Odds with two decimals in the language's format (×1,31 / ×1.31). */
  protected oddsText(o: number): string {
    return o.toLocaleString(this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  protected total(m: BetMatchView): number {
    return Object.values(m.pools ?? {}).reduce((s, p) => s + p.amount, 0);
  }

  protected share(m: BetMatchView, e: string): number {
    const t = this.total(m);
    return t ? Math.round(((m.pools?.[e]?.amount ?? 0) / t) * 100) : 0;
  }
}
