import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  PRESTIGE_EFFECT,
  PRESTIGE_STAT_MAX,
  PRESTIGE_VIEW_DEGREES,
  valueAtTop,
} from '@tourney/udt';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import { formatNeuro, NeuroPipe } from '../core/neuro';
import type { UdtPrestige, UdtPrestigeStat, UdtRosterBot } from '../core/types';

const STATS: readonly UdtPrestigeStat[] = [
  'aim',
  'react',
  'dodge',
  'view',
  'tough',
  'fire',
  'armour',
  'sprint',
  'ammo',
];

/**
 * Prestige of an own bot at the end of its development (decision 265, design preview "Prestige –
 * Vorschau (Season 3)"): the stage, the points with their source, the menu of nine stats (a free
 * point per click, at most 3 a stat), buying a point, resetting, the ascension of a Godlike and
 * the stars of an ascended bot. Every action reloads the page (`changed`).
 */
@Component({
  selector: 'udt-prestige',
  imports: [TPipe, NeuroPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = prestige();
    @let b = bot();
    <section class="pres" [class.has]="p.free > 0" aria-labelledby="pres-title">
      <div class="phead">
        <div class="col">
          <div class="row">
            <h3 id="pres-title">{{ 'udt.pres.title' | t }}</h3>
            <span class="stage st-{{ p.stage }}">{{ 'udt.pres.stage.' + p.stage | t }}</span>
          </div>
          <span class="muted small">{{
            p.stage === 'settled'
              ? ('udt.pres.sourceSettled' | t)
              : ('udt.pres.source' | t: { lv: p.fromLevels, b: p.bought })
          }}</span>
        </div>
        <div class="count">
          <span class="num"
            ><b>{{ p.spent }}</b> <span class="muted">/ {{ p.cap }}</span></span
          >
          <span class="small" [class.gold]="p.free > 0">{{
            p.free > 0
              ? ('udt.pres.free' | t: { n: p.free })
              : p.points >= p.cap
                ? ('udt.pres.full' | t)
                : ('udt.pres.allSet' | t)
          }}</span>
        </div>
      </div>

      <div class="pgrid">
        @for (s of tiles(); track s.key) {
          <div class="tile" [class.on]="s.n > 0">
            <div class="row between">
              <b>{{ 'udt.pres.stat.' + s.key | t }}</b>
              <span class="pips" [attr.aria-label]="'udt.pres.pips' | t: { n: s.n, max: max }">
                @for (i of pips; track i) {
                  <i [class.full]="i < s.n"></i>
                }
              </span>
            </div>
            <span class="muted small eff">{{ s.effect }}</span>
            <button
              type="button"
              class="add"
              [disabled]="busy() || !s.can"
              [attr.aria-label]="('udt.pres.stat.' + s.key | t) + ' +1'"
              (click)="allocate(s.key)"
            >
              {{ s.n >= max ? ('udt.pres.max' | t) : '+1' }}
            </button>
          </div>
        }
      </div>

      <div class="acts">
        <!-- A settled bought bot never buys points (decision 269). -->
        @if (p.stage !== 'settled') {
          <button
            type="button"
            class="primary"
            [disabled]="busy() || p.prices.point === null || tooDear(p.prices.point)"
            (click)="buy()"
          >
            {{
              p.prices.point === null
                ? ('udt.pres.capReached' | t: { n: p.cap })
                : ('udt.pres.buy' | t: { price: (p.prices.point | neuro) })
            }}
          </button>
        }
        <button
          type="button"
          [disabled]="busy() || p.prices.respec === null || tooDear(p.prices.respec)"
          (click)="reset()"
        >
          {{
            p.prices.respec === null
              ? ('udt.pres.resetPlain' | t)
              : ('udt.pres.reset' | t: { price: (p.prices.respec | neuro) })
          }}
        </button>
        @if (p.stage !== 'settled') {
          <span class="muted small note">{{ 'udt.pres.priceNote' | t }}</span>
        }
      </div>
      <p class="muted small">{{ 'udt.pres.season' | t }}</p>
    </section>

    @if (p.stage === 'godlike') {
      <section class="pcard dashed" aria-labelledby="asc-title">
        <div class="row between">
          <h3 id="asc-title">{{ 'udt.asc.title' | t }}</h3>
          @if (ascendPrice(); as ap) {
            <span class="price">{{ ap | neuro }}</span>
          }
        </div>
        <p class="muted small">{{ 'udt.asc.explain' | t }}</p>
        <ul class="req small">
          <li [class.ok]="b.level >= 30">{{ 'udt.asc.reqLevel' | t: { n: 30, now: b.level } }}</li>
          <li [class.ok]="valuesTop()">{{ 'udt.asc.reqValues' | t }}</li>
        </ul>
        <button
          type="button"
          class="primary"
          [disabled]="
            busy() || p.ascend !== null || p.prices.ascend === null || tooDear(p.prices.ascend)
          "
          (click)="ascend()"
        >
          {{ 'udt.asc.button' | t }}
        </button>
      </section>
    }

    @if (p.stage === 'ascended') {
      <section class="pcard stars" aria-labelledby="star-title">
        <div class="row between">
          <h3 id="star-title">{{ 'udt.star.title' | t }}</h3>
          <span
            class="starline"
            role="img"
            [attr.aria-label]="'udt.star.aria' | t: { n: p.stars, max: p.maxStars }"
            >{{ starLine() }}</span
          >
        </div>
        <p class="muted small">{{ 'udt.star.explain' | t }}</p>
        <button
          type="button"
          class="primary"
          [disabled]="busy() || p.prices.star === null || tooDear(p.prices.star)"
          (click)="star()"
        >
          {{
            p.prices.star === null
              ? ('udt.star.all' | t)
              : ('udt.star.buy' | t: { n: p.stars + 1, price: (p.prices.star | neuro) })
          }}
        </button>
      </section>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    section {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    h3 {
      margin: 0;
      font-size: 1rem;
    }
    p {
      margin: 0;
    }
    .pcard > button {
      align-self: flex-start;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .between {
      justify-content: space-between;
    }
    .col {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .pres {
      padding: 12px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
      background: var(--panel-2);
    }
    .pres.has {
      border-color: rgba(245, 199, 94, 0.7);
      box-shadow: 0 0 0 3px rgba(245, 199, 94, 0.1);
    }
    .phead {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: flex-start;
    }
    .count {
      margin-left: auto;
      text-align: right;
      display: flex;
      flex-direction: column;
      line-height: 1.1;
    }
    .count .num {
      white-space: nowrap;
    }
    .count b {
      font-size: 1.6rem;
    }
    .gold {
      color: #f5c75e;
      font-weight: 700;
    }
    .stage {
      padding: 1px 9px;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #07080c;
    }
    .st-mature {
      background: #4f9dff;
    }
    .st-godlike {
      background: #b26bff;
    }
    .st-ascended {
      background: #f5c75e;
    }
    .st-settled {
      background: #4f9dff;
    }
    .pgrid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
    }
    .tile {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
      background: var(--panel);
    }
    .tile.on {
      border-color: rgba(245, 199, 94, 0.45);
      background: rgba(245, 199, 94, 0.05);
    }
    .eff {
      flex: 1;
      min-height: 2.4em;
    }
    .pips {
      display: inline-flex;
      gap: 3px;
    }
    .pips i {
      display: block;
      width: 13px;
      height: 6px;
      border-radius: 3px;
      background: var(--panel-3);
    }
    .pips i.full {
      background: #f5c75e;
    }
    .add {
      min-height: 34px;
    }
    .acts {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .note {
      flex: 1 1 200px;
    }
    .pcard {
      padding: 12px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
      background: var(--panel-2);
    }
    .pcard.dashed {
      border-style: dashed;
    }
    .pcard.stars {
      border-color: rgba(245, 199, 94, 0.35);
    }
    .price {
      color: var(--neuro-text);
      font-family: var(--mono, monospace);
    }
    .starline {
      color: #f5c75e;
      font-size: 1.4rem;
      letter-spacing: 3px;
    }
    .req {
      margin: 0;
      padding-left: 18px;
    }
    .req li {
      color: #ff9aa4;
    }
    .req li.ok {
      color: #4ade80;
    }
  `,
})
export class UdtPrestigeBox {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  readonly bot = input.required<UdtRosterBot>();
  readonly prestige = input.required<UdtPrestige>();
  readonly spendable = input<number | null>(null);
  readonly changed = output<void>();

  protected readonly busy = signal(false);
  protected readonly max = PRESTIGE_STAT_MAX;
  protected readonly pips = Array.from({ length: PRESTIGE_STAT_MAX }, (_, i) => i);

  /** The nine stats with their points, what they do now (or per point) and whether +1 works. */
  protected readonly tiles = computed(() => {
    const p = this.prestige();
    return STATS.map((key) => {
      const n = p.alloc[key] ?? 0;
      const effect = this.effect(key, Math.max(1, n));
      return {
        key,
        n,
        can: n < PRESTIGE_STAT_MAX && p.free > 0,
        effect: n ? effect : this.i18n.t('udt.pres.perPoint', { e: effect }),
      };
    });
  });

  /** Every value at 100 (an ascension needs it). */
  protected readonly valuesTop = computed(() => {
    const t = this.bot().traits;
    return [t.accuracy, t.alertness, t.strafing].every((v) => valueAtTop(v));
  });

  protected readonly ascendPrice = computed(() => {
    const p = this.prestige();
    return p.prices.ascend;
  });

  protected readonly starLine = computed(() => {
    const p = this.prestige();
    return '★'.repeat(p.stars) + '☆'.repeat(Math.max(0, p.maxStars - p.stars));
  });

  /** The effect of n points of a stat as the menu shows it. */
  private effect(key: UdtPrestigeStat, n: number): string {
    const pct = (x: number) => Math.round(x * n * 100);
    const v =
      key === 'armour'
        ? PRESTIGE_EFFECT.armour * n
        : key === 'view'
          ? pct(PRESTIGE_EFFECT.view)
          : pct(PRESTIGE_EFFECT[key]);
    return this.i18n.t(`udt.pres.eff.${key}`, { v, deg: PRESTIGE_VIEW_DEGREES * n });
  }

  protected tooDear(price: number): boolean {
    const s = this.spendable();
    return s !== null && price > s;
  }

  protected allocate(stat: UdtPrestigeStat) {
    return this.act(() => this.api.udtPrestige(this.bot().botId, stat));
  }

  protected buy() {
    return this.act(() => this.api.udtPrestigeBuy(this.bot().botId));
  }

  protected reset() {
    const p = this.prestige();
    const price = formatNeuro(p.prices.respec ?? 0, this.i18n.lang());
    if (!confirm(this.i18n.t('udt.pres.resetConfirm', { n: p.spent, price }))) return;
    return this.act(() => this.api.udtPrestigeReset(this.bot().botId));
  }

  protected ascend() {
    const p = this.prestige();
    const price = formatNeuro(p.prices.ascend ?? 0, this.i18n.lang());
    if (!confirm(this.i18n.t('udt.asc.confirm', { name: this.bot().name, price }))) return;
    return this.act(() => this.api.udtAscend(this.bot().botId));
  }

  protected star() {
    return this.act(() => this.api.udtStar(this.bot().botId));
  }

  private async act(fn: () => Promise<unknown>) {
    this.busy.set(true);
    try {
      await fn();
      this.changed.emit();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
