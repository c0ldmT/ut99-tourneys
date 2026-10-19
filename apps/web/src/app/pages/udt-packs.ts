import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { Coin } from '../core/brand';
import { TPipe } from '../core/i18n';
import { NeuroPipe } from '../core/neuro';
import type { UdtBox, UdtCatalogTrait, UdtInventoryCard, UdtPacks, UdtRarity } from '../core/types';
import { RARITIES, SCRAP, UdtNav } from '../core/udt';
import { BOX_STROKE, UdtPackStage } from './udt-pack-stage';

const BOX_RARITY: Record<UdtBox, UdtRarity> = {
  standard: 'common',
  premium: 'epic',
  elite: 'legendary',
};
/**
 * Dream Team packs: three boxes with open drop rates and pity, the opening (charge up, burst,
 * cards dealt face down, flipped one by one or all), the trait inventory, scrap and crafting.
 */
@Component({
  selector: 'app-udt-packs',
  imports: [RouterLink, TPipe, NeuroPipe, Coin, UdtNav, UdtPackStage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (view(); as v) {
      <div class="udt-head">
        <div>
          <h1 class="disp">{{ 'udt.packs.title' | t }}</h1>
          <p class="muted">{{ 'udt.packs.intro' | t: { i: v.index.toFixed(2) } }}</p>
        </div>
        <div class="udt-kpis">
          <div>
            <div class="kpi">{{ 'udt.packs.scrap' | t }}</div>
            <div class="v">{{ v.scrap }}</div>
          </div>
          <div>
            <div class="kpi">{{ 'udt.packs.opened' | t }}</div>
            <div class="v">{{ opened() }}</div>
          </div>
          <div>
            <div class="kpi">{{ 'udt.spendable' | t }}</div>
            <div class="v neuro"><na-coin [size]="16" /> {{ v.spendable | neuro: false }}</div>
          </div>
        </div>
      </div>
      @if (!v.hasTeam) {
        <p class="card muted">
          {{ 'udt.packs.noTeam' | t }} <a routerLink="/udt">{{ 'udt.nav.team' | t }}</a>
        </p>
      }

      <div class="boxes">
        @for (b of v.boxes; track b.box) {
          <section class="box r-{{ boxRarity(b.box) }}">
            <div class="box-in">
              <div class="bhead">
                <h2 class="disp">{{ 'udt.packs.box.' + b.box | t }}</h2>
                <span class="neuro"><na-coin [size]="14" /> {{ b.price | neuro: false }}</span>
              </div>
              <div class="crate" aria-hidden="true">
                <svg width="130" height="130" viewBox="0 0 64 64">
                  <path
                    d="M32 4 56 18v28L32 60 8 46V18z"
                    fill="#121624"
                    [attr.stroke]="stroke(b.box)"
                    stroke-width="2"
                  />
                  <path
                    d="M8 18l24 14 24-14M32 32v28"
                    fill="none"
                    [attr.stroke]="stroke(b.box)"
                    stroke-width="1.4"
                    opacity=".6"
                  />
                  <path
                    d="M32 14l2.6 6 6.4.6-4.9 4.3 1.5 6.3L32 28l-5.6 3.2 1.5-6.3-4.9-4.3 6.4-.6z"
                    [attr.fill]="stroke(b.box)"
                  />
                </svg>
              </div>
              <div class="rates">
                @for (p of b.rates; track $index) {
                  <div class="rate r-{{ rarities[$index] }}">
                    <span class="rn">{{ 'udt.rarity.' + rarities[$index] | t }}</span>
                    <span class="rbar"><i [style.width.%]="p ? max(p, 2) : 0"></i></span>
                    <span class="mono rp">{{ p }} %</span>
                  </div>
                }
              </div>
              <div class="pity small">
                <div>
                  <span class="muted">{{ 'udt.packs.epicIn' | t }}</span
                  ><span class="mono">{{ 'udt.packs.boxes' | t: { n: b.epicIn } }}</span>
                </div>
                <div>
                  <span class="muted">{{ 'udt.packs.legendaryIn' | t }}</span
                  ><span class="mono">{{ 'udt.packs.boxes' | t: { n: b.legendaryIn } }}</span>
                </div>
              </div>
              <div class="buy">
                <button type="button" [disabled]="!canBuy(b.price)" (click)="open(b.box, false)">
                  {{ 'udt.packs.open' | t }}
                </button>
                <button
                  type="button"
                  class="holo"
                  [disabled]="!canBuy(b.tenPrice)"
                  (click)="open(b.box, true)"
                >
                  {{ 'udt.packs.ten' | t }} ·
                  <span class="mono small">{{ b.tenPrice | neuro: false }}</span>
                </button>
              </div>
              <div class="muted small center">{{ 'udt.packs.tenNote.' + b.box | t }}</div>
            </div>
          </section>
        }
      </div>

      <udt-pack-stage #stage [catalog]="v.catalog" />

      <div class="lower">
        <section class="card">
          <h2>{{ 'udt.packs.inventory' | t }} ({{ v.inventory.length }})</h2>
          @for (c of v.inventory; track c.id) {
            <div class="irow">
              <span class="udt-trait r-{{ c.rarity }}">{{ 'udt.trait.' + c.code | t }}</span>
              <span class="grow muted small">{{ 'udt.traitE.' + c.code | t }}</span>
              <button type="button" [disabled]="busy()" (click)="scrap(c)">
                {{ 'udt.packs.scrapIt' | t }} +{{ scrapOf(c.rarity) }}
              </button>
            </div>
          } @empty {
            <p class="muted small">{{ 'udt.traits.none' | t }}</p>
          }
          <p class="muted small">{{ 'udt.packs.mod' | t }}</p>
        </section>
        <section class="card">
          <h2>{{ 'udt.packs.craftTitle' | t }}</h2>
          <p class="muted small">{{ 'udt.packs.craftText' | t }}</p>
          @for (c of v.catalog; track c.code) {
            <div class="irow">
              <span class="udt-trait r-{{ c.rarity }}">{{ 'udt.trait.' + c.code | t }}</span>
              <span class="grow muted small">{{ 'udt.traitE.' + c.code | t }}</span>
              <button
                type="button"
                [disabled]="busy() || c.owned || v.scrap < c.craft || !v.hasTeam"
                (click)="craft(c)"
              >
                {{ 'udt.packs.craft' | t }} · <span class="mono">{{ c.craft }}</span>
              </button>
            </div>
          }
        </section>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .boxes {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 18px;
    }
    .box {
      position: relative;
      border-radius: 16px;
      padding: 2px;
      background: var(--rc);
    }
    .box.r-legendary {
      background-size: 200% 200%;
      animation: udt-holo 6s linear infinite;
    }
    .box-in {
      border-radius: 14px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      height: 100%;
      box-sizing: border-box;
      background: radial-gradient(90% 60% at 50% 18%, var(--rg), transparent 70%), #0c0f16;
    }
    .bhead {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .bhead h2 {
      margin: 0;
      font-size: 1.9rem;
      font-weight: 800;
      font-style: italic;
      color: var(--rt);
    }
    .crate {
      height: 140px;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: udt-float 4s ease-in-out infinite;
    }
    .rates {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .rate {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.75rem;
    }
    .rn {
      width: 96px;
      color: var(--text-2);
    }
    .rp {
      width: 40px;
      text-align: right;
    }
    .rbar {
      flex: 1;
      height: 6px;
      border-radius: 3px;
      background: var(--border);
      overflow: hidden;
    }
    .rbar i {
      display: block;
      height: 100%;
      background: var(--rc);
    }
    .pity div {
      display: flex;
      justify-content: space-between;
    }
    .buy {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: auto;
    }
    .holo {
      border: 0;
      color: #0b0614;
      font-weight: 700;
      background: linear-gradient(90deg, #22d3ee, #8b5cf6, #f0468c, #a3e635, #22d3ee);
      background-size: 200% 100%;
      animation: udt-holo 4s linear infinite;
    }
    .center {
      text-align: center;
    }
    .lower {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 18px;
    }
    .lower .card {
      margin: 0;
    }
    .irow {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-top: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .grow {
      flex: 1 1 160px;
      min-width: 0;
    }
    @media (prefers-reduced-motion: reduce) {
      .crate,
      .box.r-legendary,
      .holo {
        animation: none;
      }
    }
  `,
})
export class UdtPacksPage {
  private readonly api = inject(Api);
  protected readonly view = signal<UdtPacks | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly rarities = RARITIES;
  protected readonly max = Math.max;
  private readonly stage = viewChild<UdtPackStage>('stage');

  protected readonly opened = computed(() =>
    (this.view()?.boxes ?? []).reduce((n, b) => n + b.opened, 0),
  );

  constructor() {
    void this.load();
  }

  async load() {
    try {
      this.view.set(await this.api.udtPacks());
      this.error.set('');
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  protected boxRarity(b: UdtBox): UdtRarity {
    return BOX_RARITY[b];
  }

  protected stroke(b: UdtBox) {
    return BOX_STROKE[b];
  }

  protected scrapOf(r: UdtRarity) {
    return SCRAP[r];
  }

  protected canBuy(price: number) {
    const v = this.view();
    return !!v && v.hasTeam && !this.busy() && !this.stage()?.animating() && v.spendable >= price;
  }

  protected async open(box: UdtBox, ten: boolean) {
    await this.act(async () => {
      const p = await this.api.udtOpen(box, ten);
      this.view.set(p.view);
      this.stage()?.play(p);
    });
  }

  protected async scrap(c: UdtInventoryCard) {
    await this.act(async () => this.view.set(await this.api.udtScrap(c.id)));
  }

  protected async craft(c: UdtCatalogTrait) {
    await this.act(async () => this.view.set(await this.api.udtCraft(c.code)));
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
