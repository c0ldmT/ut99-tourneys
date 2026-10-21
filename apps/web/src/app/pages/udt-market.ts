import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { Coin } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { formatNeuro, NeuroPipe, NeuroStore } from '../core/neuro';
import type { UdtMarket, UdtOffer } from '../core/types';
import { bracketOf, UdtCard, UdtNav, weeklySalary } from '../core/udt';

type Filter = 'all' | 'weak' | 'mid' | 'strong';

/** Dream Team transfer market: today's offers at fixed prices (buy at once), the next market day. */
@Component({
  selector: 'app-udt-market',
  imports: [TPipe, NeuroPipe, Coin, UdtCard, UdtNav],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
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
            <div class="v neuro"><na-coin [size]="16" /> {{ spendable() ?? 0 | neuro: false }}</div>
          </div>
          <div>
            <div class="kpi">{{ 'udt.market.roster' | t }}</div>
            <div class="v">{{ m.rosterSize }} / {{ m.rosterMax }}</div>
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
            <p class="muted small legend">{{ 'udt.market.legend' | t }}</p>
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
                  ><b class="disp name" [title]="o.name">{{ o.name }}</b>
                  @if (o.demand > 1.001) {
                    <span class="udt-mark hot" [title]="'udt.market.hotTitle' | t">{{
                      'udt.market.hot' | t
                    }}</span>
                  } @else if (o.demand < 0.999) {
                    <span class="udt-mark cheap" [title]="'udt.market.cheapTitle' | t">{{
                      'udt.market.cheap' | t
                    }}</span>
                  }
                  @if (o.homegrown) {
                    <span
                      class="udt-mark star"
                      [title]="'udt.market.breeder' | t: { n: o.homegrown.breeder }"
                      >{{ 'udt.market.homegrown' | t }}</span
                    >
                  }
                  @if (o.mine) {
                    <span class="udt-mark own">{{ 'udt.market.yours' | t }}</span>
                  } @else if (o.sold) {
                    <span class="udt-mark">{{
                      o.buyer
                        ? ('udt.market.soldTo' | t: { tag: o.buyer })
                        : ('udt.market.sold' | t)
                    }}</span>
                  }
                </span>
                <svg
                  class="spark"
                  width="96"
                  height="30"
                  viewBox="0 0 96 30"
                  role="img"
                  [attr.aria-label]="'udt.market.trendTitle' | t"
                >
                  <title>{{ 'udt.market.trendTitle' | t }}</title>
                  <path
                    [attr.d]="spark(o)"
                    fill="none"
                    [attr.stroke]="trend(o) >= 0 ? 'var(--live)' : 'var(--danger)'"
                    stroke-width="2"
                  />
                </svg>
                <span class="price"
                  ><span class="neuro mono">{{ o.price | neuro }}</span
                  ><span
                    class="mono small"
                    [class.up]="trend(o) > 0"
                    [class.down]="trend(o) < 0"
                    [title]="'udt.market.trendTitle' | t"
                    >{{ trendText(o) }}
                    <span class="muted">{{
                      'udt.market.days' | t: { n: o.history.length }
                    }}</span></span
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
              <div class="card bid">
                <h2>{{ 'udt.market.buyTitle' | t }}</h2>
                <div class="line">
                  <span>{{ 'udt.market.price' | t }}</span
                  ><b class="neuro">{{ o.price | neuro }}</b>
                </div>
                <div class="line">
                  <span>{{ 'udt.market.value' | t }}</span
                  ><span class="mono">{{ o.value | neuro }}</span>
                </div>
                <div class="line">
                  <span>{{ 'udt.market.salary' | t }}</span
                  ><span class="mono">{{ salaryOf(o) | neuro }}</span>
                </div>
                <button
                  type="button"
                  class="primary"
                  [disabled]="busy() || o.sold || full() || tooDear(o)"
                  (click)="buy(o)"
                >
                  {{ 'udt.market.buy' | t: { price: neuro(o.price) } }}
                </button>
                @if (!o.sold) {
                  @if (full()) {
                    <p class="muted small">
                      {{ 'udt.market.full' | t: { max: market()!.rosterMax } }}
                    </p>
                  } @else if (tooDear(o)) {
                    <p class="muted small">{{ 'udt.market.cannotAfford' | t }}</p>
                  }
                }
                <p class="muted small">{{ 'udt.market.surcharge' | t }}</p>
              </div>
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
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 6px;
    }
    .name {
      display: block;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spark {
      flex: none;
    }
    .legend {
      margin: 0;
    }
    .udt-mark.hot {
      color: #fbbf5c;
      border-color: rgba(251, 191, 92, 0.5);
    }
    .udt-mark.cheap {
      color: var(--accent);
      border-color: rgba(34, 211, 238, 0.45);
    }
    @media (max-width: 480px) {
      .spark {
        display: none;
      }
      .price {
        width: auto;
      }
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
  private readonly i18n = inject(I18n);
  private readonly store = inject(NeuroStore);
  protected readonly market = signal<UdtMarket | null>(null);
  protected readonly busy = signal(false);
  protected readonly filter = signal<Filter>('all');
  protected readonly filters: Filter[] = ['all', 'weak', 'mid', 'strong'];
  protected readonly selId = signal<string | null>(null);

  protected readonly shown = computed(() =>
    (this.market()?.offers ?? []).filter(
      (o) => this.filter() === 'all' || bracketOf(o.skill) === this.filter(),
    ),
  );
  protected readonly sel = computed(
    () => this.market()?.offers.find((o) => o.botId === this.selId()) ?? this.shown()[0] ?? null,
  );
  /** The shared Neuro state (the same as in the navbar). */
  protected readonly spendable = this.store.spendable;
  protected readonly full = computed(() => {
    const m = this.market();
    return !!m && m.rosterSize >= m.rosterMax;
  });

  constructor() {
    void this.load();
  }

  async load() {
    try {
      this.market.set(await this.api.udtMarket());
    } catch {
      // the toast shows the error
    }
  }

  protected next(): string {
    const at = this.market()?.nextAt;
    if (!at) return '–';
    return this.i18n.date(new Date(at).toISOString());
  }

  protected pick(o: UdtOffer) {
    this.selId.set(o.botId);
  }

  /** More than can be spent (unknown yet: the server decides). */
  protected tooDear(o: UdtOffer): boolean {
    const s = this.spendable();
    return s !== null && o.price > s;
  }

  protected neuro(n: number): string {
    return formatNeuro(n, this.i18n.lang());
  }

  /**
   * Change of the value without the economy index over the shown days (value / index): what the
   * bot's form and the demand did, not the economy.
   */
  protected trend(o: UdtOffer): number {
    const h = o.history.map(real);
    if (h.length < 2) return 0;
    const a = h[0]!;
    const b = h[h.length - 1]!;
    return a ? Math.round(((b - a) / a) * 100) : 0;
  }

  protected trendText(o: UdtOffer): string {
    const t = this.trend(o);
    return t === 0 ? '± 0 %' : `${t > 0 ? '▲' : '▼'} ${Math.abs(t)} %`;
  }

  protected spark(o: UdtOffer): string {
    const h = o.history.map(real);
    if (h.length < 2) return 'M0 15 L96 15';
    // At least ±5 % around the middle: rounding noise stays a flat line.
    const mid = (Math.min(...h) + Math.max(...h)) / 2;
    const lo = Math.min(...h, mid * 0.95);
    const hi = Math.max(...h, mid * 1.05);
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

  protected async buy(o: UdtOffer) {
    const msg = this.i18n.t('udt.market.buyConfirm', { name: o.name, price: this.neuro(o.price) });
    if (!confirm(msg)) return;
    this.busy.set(true);
    try {
      this.market.set(await this.api.udtBuy(o.botId));
    } catch {
      // the toast shows the error; the offer may be sold meanwhile
      void this.load();
    } finally {
      this.busy.set(false);
    }
  }
}

/** A market value without the economy index of its day. */
const real = (x: { value: number; index: number }) => x.value / (x.index || 1);
