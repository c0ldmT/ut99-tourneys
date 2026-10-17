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
import { Api, errorText } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import { formatNeuro, NeuroPipe } from '../core/neuro';
import type { BetMatchView, Entrant, TournamentBets, TournamentDetail } from '../core/types';

interface Draft {
  pick: string;
  amount: number;
}

/** Betting with Neuro on the tournament page: open matches, closed pools, own results. */
@Component({
  selector: 'app-bet-panel',
  imports: [TPipe, FormsModule, NeuroPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as v) {
      @if (v.open || mineAny()) {
        <div class="card bets">
          <div class="spread">
            <h2>{{ 'bets.title' | t }}</h2>
            @if (v.wallet; as w) {
              <div class="wallet">
                <span
                  >{{ 'bets.balance' | t }} <b>{{ w.balance | neuro }}</b></span
                >
                @if (w.staked) {
                  <span class="muted"
                    >{{ 'bets.staked' | t }} {{ w.staked | neuro }} · {{ 'bets.free' | t }}
                    {{ w.free | neuro }}</span
                  >
                }
              </div>
            }
          </div>
          @if (!v.open) {
            <p class="muted small">{{ 'bets.closed.' + (v.reason ?? 'phase') | t }}</p>
          } @else {
            <p class="muted small">
              {{ 'bets.hint' | t: { floor: neuro(v.wallet?.floor ?? 0) } }}
            </p>
          }
          @if (error()) {
            <p class="error">{{ error() }}</p>
          }

          @if (v.open && openMatches().length) {
            <h3>{{ 'bets.openMatches' | t }}</h3>
            @for (m of openMatches(); track m.matchId) {
              <div class="match">
                <div class="label muted small">{{ m.matchId }}</div>
                @if (m.playing) {
                  <div class="pair">
                    <span>{{ name(m.entrants[0]) }}</span>
                    <span class="vs">vs</span>
                    <span>{{ name(m.entrants[1]) }}</span>
                  </div>
                  <p class="muted small">{{ 'bets.ownMatch' | t }}</p>
                } @else {
                  <div class="sides">
                    @for (e of m.entrants; track e) {
                      <button
                        type="button"
                        class="side"
                        [class.picked]="draft(m).pick === e"
                        (click)="setPick(m, e)"
                      >
                        <span class="nm">{{ name(e) }}</span>
                        @if (rating(e); as r) {
                          <span class="muted small">{{ r }}</span>
                        }
                      </button>
                      @if ($first) {
                        <span class="vs">vs</span>
                      }
                    }
                  </div>
                  <div class="row stake">
                    <input
                      type="number"
                      min="1"
                      [max]="maxFor(m)"
                      [name]="'amt' + m.matchId"
                      [ngModel]="draft(m).amount"
                      (ngModelChange)="setAmount(m, $event)"
                    />
                    <span class="sym">€</span>
                    <button type="button" (click)="setAmount(m, maxFor(m))">
                      {{ 'bets.allIn' | t }}
                    </button>
                    <button
                      type="button"
                      class="primary"
                      [disabled]="busy() || !draft(m).pick || !(draft(m).amount >= 1)"
                      (click)="place(m)"
                    >
                      {{ (m.mine ? 'bets.change' : 'bets.place') | t }}
                    </button>
                    @if (m.mine) {
                      <button type="button" (click)="withdraw(m)" [disabled]="busy()">
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
              </div>
            }
          }

          @if (closedMatches().length) {
            <h3>{{ 'bets.running' | t }}</h3>
            @for (m of closedMatches(); track m.matchId) {
              <div class="match">
                <div class="label muted small">{{ m.matchId }} · {{ 'bets.closedNow' | t }}</div>
                @for (e of m.entrants; track e) {
                  <div class="pool">
                    <span class="nm">{{ name(e) }}</span>
                    <span class="bar"><span [style.width.%]="share(m, e)"></span></span>
                    <span class="mono small"
                      >{{ m.pools?.[e]?.amount ?? 0 | neuro }}
                      @if (odds(m, e); as o) {
                        · ×{{ o }}
                      }
                    </span>
                  </div>
                }
                @if (m.mine; as b) {
                  <p class="small ok">
                    {{ 'bets.yourBet' | t: { amount: neuro(b.amount), name: name(b.pick) } }}
                  </p>
                }
              </div>
            }
          }

          @if (doneMatches().length) {
            <h3>{{ 'bets.done' | t }}</h3>
            @for (m of doneMatches(); track m.matchId) {
              <div class="match">
                <div class="label muted small">{{ m.matchId }}</div>
                <div class="pair">
                  @for (e of m.entrants; track e) {
                    <span [class.winner]="m.winnerId === e">{{ name(e) }}</span>
                    @if ($first) {
                      <span class="vs">vs</span>
                    }
                  }
                </div>
                @if (m.mine; as b) {
                  <p class="small result" [class]="b.status">
                    @switch (b.status) {
                      @case ('won') {
                        {{ 'bets.won' | t: { amount: neuro(b.payout - b.amount) } }}
                      }
                      @case ('lost') {
                        {{ 'bets.lost' | t: { amount: neuro(b.amount) } }}
                      }
                      @default {
                        {{ 'bets.refunded' | t: { amount: neuro(b.amount) } }}
                      }
                    }
                  </p>
                } @else if (m.state === 'refunded') {
                  <p class="small muted">{{ 'bets.refundedMatch' | t }}</p>
                }
                @if (m.pools && m.bettors) {
                  <p class="small muted">
                    {{ 'bets.poolTotal' | t: { amount: neuro(total(m)), n: m.bettors } }}
                  </p>
                }
              </div>
            }
          }
        </div>
      }
    }
  `,
  styles: `
    .bets h2 {
      margin: 0;
    }
    h3 {
      font-size: 0.95rem;
      margin: 16px 0 6px;
    }
    .wallet {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      align-items: baseline;
    }
    .wallet b {
      color: var(--accent);
      font-size: 1.15rem;
    }
    .match {
      border-top: 1px solid var(--border);
      padding: 8px 0;
    }
    .sides,
    .pair {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .vs {
      color: var(--muted);
      font-size: 0.85rem;
    }
    button.side {
      flex: 1;
      min-width: 140px;
      justify-content: space-between;
    }
    button.side.picked {
      border-color: var(--accent);
      background: var(--me-bg);
    }
    .stake {
      margin-top: 6px;
    }
    .stake input {
      width: 120px;
    }
    .sym {
      color: var(--muted);
    }
    .winner {
      font-weight: 700;
      color: var(--live);
    }
    .pool {
      display: grid;
      grid-template-columns: minmax(100px, 200px) 1fr auto;
      gap: 8px;
      align-items: center;
      margin: 3px 0;
    }
    .bar {
      height: 8px;
      background: var(--panel-2);
      border-radius: 4px;
      overflow: hidden;
    }
    .bar span {
      display: block;
      height: 100%;
      background: var(--accent);
    }
    .nm {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .result.won,
    .ok {
      color: var(--live);
    }
    .result.lost {
      color: var(--danger);
    }
    .result.refunded {
      color: var(--muted);
    }
    p {
      margin: 4px 0 0;
    }
  `,
})
export class BetPanel {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  readonly tournament = input.required<TournamentDetail>();
  /** Matches that take bets now (the bracket marks them). */
  readonly openIds = output<string[]>();
  protected readonly view = signal<TournamentBets | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private readonly drafts = signal<Record<string, Draft>>({});

  protected readonly openMatches = computed(() =>
    (this.view()?.matches ?? []).filter((m) => m.state === 'open'),
  );
  protected readonly closedMatches = computed(() =>
    (this.view()?.matches ?? []).filter((m) => m.state === 'closed'),
  );
  /** Decided matches with bets of the user or any pool, newest last in the bracket order. */
  protected readonly doneMatches = computed(() =>
    (this.view()?.matches ?? []).filter(
      (m) => (m.state === 'settled' || m.state === 'refunded') && (m.mine || m.bettors),
    ),
  );
  protected readonly mineAny = computed(() => (this.view()?.matches ?? []).some((m) => m.mine));

  constructor() {
    // Reload when the tournament log moves on (match called, started, decided).
    effect(() => {
      const t = this.tournament();
      void t.headSeq;
      void this.load(t.id);
    });
  }

  private async load(id: string) {
    try {
      const v = await this.api.tournamentBets(id);
      this.view.set(v);
      this.openIds.emit(
        v.open ? v.matches.filter((m) => m.state === 'open').map((m) => m.matchId) : [],
      );
    } catch (e) {
      this.error.set(errorText(e));
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
    const w = this.view()?.wallet;
    if (!w) return 0;
    // A wallet below the floor is topped up when the bet is placed.
    const free = Math.max(w.free, w.floor - w.staked);
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
    this.error.set('');
    try {
      this.view.set(await fn());
      this.drafts.update((d) => {
        const { [matchId]: _, ...rest } = d;
        return rest;
      });
    } catch (e) {
      this.error.set(errorText(e));
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

  protected total(m: BetMatchView): number {
    return Object.values(m.pools ?? {}).reduce((s, p) => s + p.amount, 0);
  }

  protected share(m: BetMatchView, e: string): number {
    const t = this.total(m);
    return t ? Math.round(((m.pools?.[e]?.amount ?? 0) / t) * 100) : 0;
  }

  /** What one Neuro on this side would bring back (pari-mutuel). */
  protected odds(m: BetMatchView, e: string): string | null {
    const side = m.pools?.[e]?.amount ?? 0;
    const t = this.total(m);
    return side && t > side ? (t / side).toFixed(2) : null;
  }
}
