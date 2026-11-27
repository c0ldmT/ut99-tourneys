import { Guide, Guides } from '../components/guide';
import { type Choice, Segment } from '../components/choice';
import { Confirm } from '../components/confirm-dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { Coin } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { formatNeuro, NeuroPipe, NeuroStore } from '../core/neuro';
import type { UdtMarket, UdtOffer } from '../core/types';
import { bracketOf, UdtCard, UdtNav, weeklySalary } from '../core/udt';
import { UdtSignatureBox } from '../components/udt-signature';
import { buyPrice } from '@tourney/udt';

type Filter = 'all' | 'weak' | 'mid' | 'strong';

/** Dream Team transfer market: today's offers at fixed prices (buy at once), the next market day. */
@Component({
  selector: 'app-udt-market',
  imports: [Guide, Segment, TPipe, NeuroPipe, Coin, UdtCard, UdtNav, UdtSignatureBox],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    @if (market(); as m) {
      <div class="udt-head">
        <na-guide page="market" />
        <div>
          <div class="kpi udt-kick">{{ 'udt.area.trans' | t }}</div>
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
            <na-segment [options]="filterOptions" [(value)]="filter" label="udt.market.filter" />
            <button
              type="button"
              class="link small legend"
              (click)="guides.open('market', 'legend')"
            >
              {{ 'udt.market.legendLink' | t }}
            </button>
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
                  <!-- Demand marks only while the bot can be bought. -->
                  @if (!o.sold && o.demand > 1.001) {
                    <span class="udt-mark hot" [title]="'udt.market.hotTitle' | t">{{
                      'udt.market.hot' | t
                    }}</span>
                  } @else if (!o.sold && o.demand < 0.999) {
                    <span class="udt-mark cheap" [title]="'udt.market.cheapTitle' | t">{{
                      'udt.market.cheap' | t
                    }}</span>
                  }
                  @if (o.signature; as sg) {
                    <udt-signature [signature]="sg" [mark]="true" />
                  }
                  @if (o.mentor) {
                    <span class="udt-mark mentor" [title]="'udt.market.mentorTitle' | t">{{
                      'udt.market.mentor' | t
                    }}</span>
                  }
                  @if (o.homegrown) {
                    <span
                      class="udt-mark star"
                      [title]="'udt.market.breeder' | t: { n: o.homegrown.breeder }"
                      >{{ 'udt.market.homegrown' | t }}</span
                    >
                  }
                  @if (o.mine && o.onLoan) {
                    <span class="udt-mark loan">{{ 'udt.market.yourLoan' | t }}</span>
                  } @else if (o.mine) {
                    <span class="udt-mark own">{{ 'udt.market.yours' | t }}</span>
                  } @else if (o.onLoan) {
                    <span class="udt-mark loan">{{ 'udt.market.onLoan' | t }}</span>
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
                  >
                  @if (o.loanFee && !o.sold) {
                    <span class="muted small">{{
                      'udt.market.loanShort' | t: { fee: (o.loanFee | neuro) }
                    }}</span>
                  }
                </span>
              </button>
            } @empty {
              <p class="muted">{{ 'udt.market.empty' | t }}</p>
            }
          </div>
          <aside>
            @if (sel(); as o) {
              <udt-card [bot]="o" />
              @if (o.signature; as sg) {
                <udt-signature class="full" [signature]="sg" />
              }
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
                @if (o.mine && o.onLoan) {
                  <!-- The team's loaned bot (decision 270): buy it for the price less the fee. -->
                  <p class="small loaninfo">
                    {{ 'udt.market.loanedUntil' | t: { at: dayText(m.loan?.until) } }}
                  </p>
                  <button
                    type="button"
                    class="primary"
                    [disabled]="busy() || tooDearN(loanBuyPrice(o))"
                    (click)="buy(o, loanBuyPrice(o))"
                  >
                    {{ 'udt.market.buyLoaned' | t: { price: neuro(loanBuyPrice(o)) } }}
                  </button>
                } @else {
                  <button
                    type="button"
                    class="primary"
                    [disabled]="busy() || o.sold || full() || tooDear(o)"
                    (click)="buy(o)"
                  >
                    {{ 'udt.market.buy' | t: { price: neuro(o.price) } }}
                  </button>
                }
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
                @if (!o.sold && o.loanFee) {
                  <div class="sep"></div>
                  <div class="line">
                    <b>{{ 'udt.market.loanTitle' | t: { n: m.loanDays ?? 7 } }}</b
                    ><span class="neuro mono">{{ o.loanFee | neuro }}</span>
                  </div>
                  <p class="muted small">{{ 'udt.market.loanText' | t }}</p>
                  <button
                    type="button"
                    [disabled]="busy() || !!m.loan || full() || tooDearN(o.loanFee)"
                    (click)="loan(o)"
                  >
                    {{ 'udt.market.loan' | t: { price: neuro(o.loanFee) } }}
                  </button>
                  @if (m.loan) {
                    <p class="muted small">{{ 'udt.market.oneLoan' | t }}</p>
                  }
                }
                <p class="muted small">{{ 'udt.market.settleHint' | t }}</p>
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
      border-radius: var(--radius);
      background: var(--well);
      border: 1px solid var(--border);
      color: var(--text);
    }
    .offer.on {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
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
      border-color: color-mix(in srgb, var(--accent) 45%, transparent);
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
    .sep {
      height: 1px;
      background: var(--border);
    }
    .bid p {
      margin: 0;
    }
    udt-signature.full {
      width: 100%;
    }
    .loaninfo {
      margin: 0;
      color: var(--info);
    }
    .down {
      color: var(--danger);
    }
  `,
})
export class UdtMarketPage {
  protected readonly guides = inject(Guides);
  private readonly confirm = inject(Confirm);
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  private readonly store = inject(NeuroStore);
  protected readonly market = signal<UdtMarket | null>(null);
  protected readonly busy = signal(false);
  protected readonly filter = signal<Filter>('all');
  protected readonly filters: Filter[] = ['all', 'weak', 'mid', 'strong'];
  protected readonly filterOptions: Choice<Filter>[] = this.filters.map((f) => ({
    value: f,
    label: 'udt.market.f.' + f,
  }));
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
    return this.i18n.when(new Date(at).toISOString(), 'relShort');
  }

  protected pick(o: UdtOffer) {
    this.selId.set(o.botId);
  }

  /** More than can be spent (unknown yet: the server decides). */
  protected tooDear(o: UdtOffer): boolean {
    return this.tooDearN(o.price);
  }

  protected tooDearN(n: number): boolean {
    const s = this.spendable();
    return s !== null && n > s;
  }

  /** The team's loaned bot: today's buy price less the fee paid (decision 270). */
  protected loanBuyPrice(o: UdtOffer): number {
    return Math.max(0, buyPrice(o.value, o.skill) - (o.loanFee ?? 0));
  }

  protected dayText(day: string | undefined): string {
    return day ? this.i18n.date(`${day}T12:00:00Z`) : '–';
  }

  protected async loan(o: UdtOffer) {
    const days = this.market()?.loanDays ?? 7;
    const msg = this.i18n.t('udt.market.loanConfirm', {
      name: o.name,
      price: this.neuro(o.loanFee ?? 0),
      n: days,
    });
    if (!(await this.confirm.ask(msg))) return;
    this.busy.set(true);
    try {
      this.market.set(await this.api.udtLoan(o.botId));
    } catch {
      void this.load();
    } finally {
      this.busy.set(false);
    }
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
    return weeklySalary(o.value, o.skill, this.market()?.index ?? 1);
  }

  protected async buy(o: UdtOffer, price = o.price) {
    const msg = this.i18n.t('udt.market.buyConfirm', { name: o.name, price: this.neuro(price) });
    if (!(await this.confirm.ask(msg))) return;
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
