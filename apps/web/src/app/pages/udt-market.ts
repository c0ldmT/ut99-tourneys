import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { Coin } from '../core/brand';
import { TPipe } from '../core/i18n';
import { NeuroPipe } from '../core/neuro';
import type { UdtMarket, UdtOffer, UdtView } from '../core/types';
import { bracketOf, UdtCard, UdtNav, weeklySalary } from '../core/udt';

type Filter = 'all' | 'weak' | 'mid' | 'strong';

/** Dream Team transfer market: today's offers, hidden bids, the next market day. */
@Component({
  selector: 'app-udt-market',
  imports: [FormsModule, TPipe, NeuroPipe, Coin, UdtCard, UdtNav],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (market(); as m) {
      <div class="udt-head">
        <div>
          <h1 class="disp">{{ 'udt.market.title' | t }}</h1>
          <p class="muted">{{ 'udt.market.intro' | t }}</p>
        </div>
        <div class="udt-kpis">
          <div>
            <div class="kpi">{{ 'udt.market.next' | t }}</div>
            <div class="v">{{ next() }}</div>
          </div>
          <div>
            <div class="kpi">{{ 'udt.index' | t }}</div>
            <div class="v">{{ m.index.toFixed(2) }}</div>
          </div>
          <div>
            <div class="kpi">{{ 'udt.spendable' | t }}</div>
            <div class="v neuro"><na-coin [size]="16" /> {{ spendable() | neuro: false }}</div>
          </div>
        </div>
      </div>
      @if (!m.day) {
        <div class="card">
          <p class="muted">{{ 'udt.market.none' | t }}</p>
        </div>
      } @else {
        <div class="wrap">
          <div class="list">
            <div class="seg">
              @for (f of filters; track f) {
                <button type="button" [class.on]="filter() === f" (click)="filter.set(f)">
                  {{ 'udt.market.f.' + f | t }}
                </button>
              }
            </div>
            @for (o of shown(); track o.botId) {
              <button
                type="button"
                class="offer"
                [class.on]="sel() !== null && sel()!.botId === o.botId"
                (click)="pick(o)"
              >
                <span class="udt-chip r-{{ o.rarity }}"
                  ><span>{{ o.skill }}</span></span
                >
                <span class="grow"
                  ><b class="disp">{{ o.name }}</b>
                  @if (o.sold) {
                    <span class="udt-mark">{{ 'udt.market.sold' | t }}</span>
                  }
                  @if (o.myBid !== null) {
                    <span class="udt-mark own"
                      >{{ 'udt.market.myBid' | t }} {{ o.myBid | neuro }}</span
                    >
                  }
                </span>
                <svg width="96" height="30" viewBox="0 0 96 30" aria-hidden="true">
                  <path
                    [attr.d]="spark(o)"
                    fill="none"
                    [attr.stroke]="trend(o) >= 0 ? 'var(--live)' : 'var(--danger)'"
                    stroke-width="2"
                  />
                </svg>
                <span class="price"
                  ><span class="neuro mono">{{ o.minPrice | neuro }}</span
                  ><span class="mono small" [class.up]="trend(o) >= 0" [class.down]="trend(o) < 0"
                    >{{ trend(o) >= 0 ? '▲' : '▼' }} {{ abs(trend(o)) }} %</span
                  ></span
                >
              </button>
            } @empty {
              <p class="muted">{{ 'udt.market.empty' | t }}</p>
            }
          </div>
          <aside>
            @if (sel(); as o) {
              <udt-card [bot]="o" />
              <form class="card bid" (ngSubmit)="bid(o)">
                <h2>{{ 'udt.market.bid' | t }}</h2>
                <div class="line">
                  <span>{{ 'udt.market.min' | t }}</span
                  ><b class="neuro">{{ o.minPrice | neuro }}</b>
                </div>
                <label
                  >{{ 'udt.market.amount' | t }}
                  <input
                    type="number"
                    name="amount"
                    [min]="o.minPrice"
                    step="10"
                    [(ngModel)]="amount"
                    class="mono"
                  />
                </label>
                <div class="row">
                  <button type="button" (click)="raise(o, 5)">+5 %</button>
                  <button type="button" (click)="raise(o, 10)">+10 %</button>
                  <button type="button" (click)="raise(o, 25)">+25 %</button>
                </div>
                <div class="line">
                  <span>{{ 'udt.market.salary' | t }}</span
                  ><span class="mono">{{ salaryOf(o) | neuro }}</span>
                </div>
                <button type="submit" class="primary" [disabled]="busy() || o.sold">
                  {{ 'udt.market.place' | t }}
                </button>
                @if (o.myBid !== null) {
                  <button type="button" (click)="withdraw(o)" [disabled]="busy()">
                    {{ 'udt.market.withdraw' | t }}
                  </button>
                }
                <p class="muted small">{{ 'udt.market.hidden' | t }}</p>
              </form>
            }
          </aside>
        </div>
      }
    }
  `,
  styles: `
    .wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 24px;
      align-items: flex-start;
    }
    .list {
      flex: 999 1 520px;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    aside {
      flex: 1 1 300px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      align-items: center;
    }
    .offer {
      display: flex;
      align-items: center;
      gap: 14px;
      width: 100%;
      text-align: left;
      padding: 10px 12px;
      border-radius: 12px;
      background: #0c0f16;
      border: 1px solid var(--border);
      color: var(--text);
    }
    .offer.on {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.14);
    }
    .grow {
      flex: 1;
      min-width: 0;
    }
    .price {
      width: 110px;
      text-align: right;
      display: flex;
      flex-direction: column;
    }
    .bid {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .line {
      display: flex;
      justify-content: space-between;
    }
    .up {
      color: var(--live);
    }
    .down {
      color: var(--danger);
    }
  `,
})
export class UdtMarketPage {
  private readonly api = inject(Api);
  protected readonly market = signal<UdtMarket | null>(null);
  protected readonly view = signal<UdtView | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly filter = signal<Filter>('all');
  protected readonly filters: Filter[] = ['all', 'weak', 'mid', 'strong'];
  protected readonly selId = signal<string | null>(null);
  protected amount = 0;
  protected readonly abs = Math.abs;

  protected readonly shown = computed(() =>
    (this.market()?.offers ?? []).filter(
      (o) => this.filter() === 'all' || bracketOf(o.skill) === this.filter(),
    ),
  );
  protected readonly sel = computed(
    () => this.market()?.offers.find((o) => o.botId === this.selId()) ?? this.shown()[0] ?? null,
  );
  protected readonly spendable = computed(() => this.view()?.wallet?.spendable ?? 0);

  constructor() {
    void this.load();
  }

  async load() {
    try {
      const [m, v] = await Promise.all([this.api.udtMarket(), this.api.udt()]);
      this.market.set(m);
      this.view.set(v);
      const s = this.sel();
      if (s && !this.amount) this.amount = s.myBid ?? s.minPrice;
      this.error.set('');
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  protected next(): string {
    const at = this.market()?.nextAt;
    if (!at) return '–';
    const d = new Date(at);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }

  protected pick(o: UdtOffer) {
    this.selId.set(o.botId);
    this.amount = o.myBid ?? o.minPrice;
  }

  protected raise(o: UdtOffer, p: number) {
    this.amount = Math.ceil((o.minPrice * (1 + p / 100)) / 10) * 10;
  }

  protected trend(o: UdtOffer): number {
    const h = o.history;
    if (h.length < 2) return 0;
    const a = h[0]!.value;
    const b = h[h.length - 1]!.value;
    return a ? Math.round(((b - a) / a) * 100) : 0;
  }

  protected spark(o: UdtOffer): string {
    const h = o.history.map((x) => x.value);
    if (h.length < 2) return 'M0 15 L96 15';
    const lo = Math.min(...h);
    const hi = Math.max(...h);
    return h
      .map(
        (v, i) =>
          `${i ? 'L' : 'M'}${Math.round((i * 96) / (h.length - 1))} ${Math.round(27 - ((v - lo) / Math.max(1, hi - lo)) * 24)}`,
      )
      .join(' ');
  }

  protected salaryOf(o: UdtOffer) {
    return weeklySalary(o.value, o.skill);
  }

  protected async bid(o: UdtOffer) {
    await this.act(async () => {
      this.market.set(await this.api.udtBid(o.botId, Math.round(Number(this.amount))));
      this.view.set(await this.api.udt());
    });
  }

  protected async withdraw(o: UdtOffer) {
    await this.act(async () => {
      this.market.set(await this.api.udtWithdraw(o.botId));
      this.view.set(await this.api.udt());
    });
  }

  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set('');
    try {
      await fn();
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }
}
