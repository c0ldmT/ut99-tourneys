import { Guide } from '../components/guide';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Api } from '../core/api';
import { Coin } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { Toasts } from '../core/toast';
import { NeuroPipe, NeuroStore } from '../core/neuro';
import type { UdtBox, UdtCatalogTrait, UdtInventoryCard, UdtPacks, UdtRarity } from '../core/types';
import { RARITIES, UdtNav } from '../core/udt';
import { BOX_STROKE, UdtPackStage } from './udt-pack-stage';
import { TRAITS_TABS, type TraitsTab, UdtTraits } from '../components/udt-traits';

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
  imports: [Guide, RouterLink, TPipe, NeuroPipe, Coin, UdtNav, UdtPackStage, UdtTraits],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    @if (view(); as v) {
      <div class="udt-head">
        <na-guide page="packs" [params]="{ i: v.index.toFixed(2) }" />
        <div>
          <div class="kpi udt-kick">{{ 'udt.area.packs' | t }}</div>
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
            <div class="v neuro">
              <na-coin [size]="16" /> {{ spendable() ?? v.spendable | neuro: false }}
            </div>
          </div>
        </div>
      </div>
      @if (!v.hasTeam) {
        <p class="card muted">
          {{ 'udt.packs.noTeam' | t }} <a routerLink="/udt/team">{{ 'udt.nav.team' | t }}</a>
        </p>
      }

      @if (v.blueprintsOver > 0) {
        <section class="card bp-full" role="alert" aria-labelledby="bp-full-h">
          <h2 id="bp-full-h">{{ 'udt.packs.bpFullTitle' | t }}</h2>
          <p class="small">
            {{
              'udt.packs.bpFullText'
                | t: { n: v.blueprints.length - giftCount(v), max: v.blueprintMax }
            }}
          </p>
          <!-- gifts do not count towards the limit: scrapping one would not free the packs -->
          @for (b of v.blueprints; track b.id) {
            @if (!b.gift) {
              <div class="irow">
                <span class="udt-trait r-{{ b.rarity }}">{{ 'udt.bp.' + b.rarity | t }}</span>
                <span class="grow muted small">{{ 'udt.bpE.' + b.rarity | t }}</span>
                <button type="button" [disabled]="busy()" (click)="scrapBlueprint(b.id)">
                  {{ 'udt.packs.scrapIt' | t }} +{{ b.scrap }}
                </button>
              </div>
            }
          }
          <a class="btn" routerLink="/udt/academy">{{ 'udt.packs.bpBuild' | t }}</a>
        </section>
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
                  <span>{{ 'udt.packs.ten' | t }}</span
                  ><span aria-hidden="true">·</span
                  ><span class="mono small price">{{ b.tenPrice | neuro: false }}</span>
                </button>
              </div>
              @if (lack(b.price); as n) {
                <span class="lack center">{{ 'common.lack' | t: { n: (n | neuro) } }}</span>
              }
              <div class="muted small center">{{ 'udt.packs.tenNote.' + b.box | t }}</div>
            </div>
          </section>
        }
      </div>

      <udt-pack-stage
        #stage
        [catalog]="v.catalog"
        [againPrice]="againPrice()"
        [canAgain]="againPrice() !== null && canBuy(againPrice()!)"
        (again)="open($event.box, $event.ten)"
        (settled)="settle()"
      />

      <!-- Inventory, crafting, workshop: one card with tabs (decision 323). -->
      <section class="card traits" [id]="tab()">
        <udt-traits
          [view]="v"
          [tab]="tab()"
          [busy]="busy()"
          [spendable]="spendable() ?? v.spendable"
          [fresh]="fresh()"
          (tabChange)="pickTab($event)"
          (scrap)="scrap($event)"
          (scrapBlueprint)="scrapBlueprint($event)"
          (craft)="craft($event)"
          (work)="workshop($event.card, $event.kind)"
        />
      </section>
    }
  `,
  styles: `
    .buy .holo {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      line-height: 1;
    }
    .buy .holo .price {
      line-height: 1;
    }
    /* Locked: grey, so the gradient does not look clickable. */
    .buy .holo:disabled {
      filter: grayscale(1);
    }
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
      border-radius: var(--radius-lg);
      padding: 2px;
      background: var(--rc);
    }
    .box.r-legendary {
      background-size: 200% 200%;
      animation: udt-holo 6s linear infinite;
    }
    .box-in {
      border-radius: var(--radius);
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      height: 100%;
      box-sizing: border-box;
      background: radial-gradient(90% 60% at 50% 18%, var(--rg), transparent 70%), var(--well);
    }
    .bhead {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
    }
    .bhead h2 {
      margin: 0;
      font-size: var(--fs-3xl);
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
      font-size: var(--fs-xs);
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
      border-radius: var(--radius-xs);
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
      background: linear-gradient(
        90deg,
        var(--accent),
        #8b5cf6,
        var(--hot),
        #a3e635,
        var(--accent)
      );
      background-size: 200% 100%;
      animation: udt-holo 4s linear infinite;
    }
    .center {
      text-align: center;
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
    .traits {
      scroll-margin-top: 84px;
    }
    .bp-full {
      border-color: var(--hot-text);
      box-shadow: inset 0 3px 0 var(--hot-text);
    }
    .bp-full h2 {
      margin-top: 0;
    }
    .bp-full .btn {
      margin-top: 10px;
    }
  `,
})
export class UdtPacksPage {
  private readonly api = inject(Api);
  protected readonly view = signal<UdtPacks | null>(null);
  /**
   * The state after the last pull, shown once its cards are face up (`settle`): the inventory,
   * scrap and crafting list would otherwise tell the result while the box is still charging.
   */
  private readonly pending = signal<UdtPacks | null>(null);
  /** The last box opened (for "again"). */
  private readonly last = signal<{ box: UdtBox; ten: boolean } | null>(null);
  /** Today's price of the last box again (the index may have moved). */
  protected readonly againPrice = computed(() => {
    const l = this.last();
    const b = l ? this.view()?.boxes.find((x) => x.box === l.box) : undefined;
    return b ? (l!.ten ? b.tenPrice : b.price) : null;
  });
  /** The shared Neuro state (the same as in the navbar). */
  protected readonly spendable = inject(NeuroStore).spendable;
  protected readonly busy = signal(false);
  protected readonly rarities = RARITIES;
  private readonly i18n = inject(I18n);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);
  /** The tab of the trait card, from the address (#inventory, #craft, #workshop: the tabs). */
  private readonly fragment = toSignal(inject(ActivatedRoute).fragment, { initialValue: null });
  protected readonly tab = computed<TraitsTab>(() => {
    const f = this.fragment();
    return (TRAITS_TABS as readonly string[]).includes(f ?? '') ? (f as TraitsTab) : 'inventory';
  });
  /** The page has its data (a computed: later states do not scroll again). */
  private readonly ready = computed(() => !!this.view());
  /** Cards new or changed since the state before (shown with a "New" marker). */
  protected readonly fresh = signal<ReadonlySet<string>>(new Set());
  protected readonly max = Math.max;
  private readonly stage = viewChild<UdtPackStage>('stage');

  protected readonly opened = computed(() =>
    (this.view()?.boxes ?? []).reduce((n, b) => n + b.opened, 0),
  );

  /** The next change of the tab came from the card itself (no scrolling to it). */
  private quiet = false;

  constructor() {
    void this.load();
    // A Dream Team tab or a link to #craft (also from another page): to the card.
    effect(() => {
      const f = this.fragment();
      const ready = this.ready();
      untracked(() => {
        if (this.quiet) {
          this.quiet = false;
          return;
        }
        if (!ready || !f || !(TRAITS_TABS as readonly string[]).includes(f)) return;
        setTimeout(() =>
          document.getElementById(f)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        );
      });
    });
  }

  async load() {
    try {
      const v = await this.api.udtPacks();
      this.fresh.set(new Set());
      this.pending.set(null);
      this.view.set(v);
    } catch {
      // the toast shows the error
    }
  }

  protected boxRarity(b: UdtBox): UdtRarity {
    return BOX_RARITY[b];
  }

  protected stroke(b: UdtBox) {
    return BOX_STROKE[b];
  }

  /** Neuro missing for a price (0: affordable, or no team yet). */
  protected lack(price: number): number {
    const v = this.view();
    if (!v?.hasTeam) return 0;
    return Math.max(0, price - (this.spendable() ?? v.spendable));
  }

  protected canBuy(price: number) {
    const v = this.view();
    return (
      !!v &&
      v.hasTeam &&
      (this.pending() ?? v).blueprintsOver === 0 &&
      !this.busy() &&
      !this.stage()?.animating() &&
      (this.spendable() ?? v.spendable) >= price
    );
  }

  protected async open(box: UdtBox, ten: boolean) {
    await this.act(async () => {
      const p = await this.api.udtOpen(box, ten);
      this.last.set({ box, ten });
      this.settle();
      this.pending.set(p.view);
      this.stage()?.play(p);
    });
  }

  /** A state newer than any pull still face down (reload, scrap, craft, workshop). */
  private show(v: UdtPacks) {
    this.pending.set(null);
    this.set(v);
  }

  /** A new state; the cards it brings (or changed, the workshop) are marked new. */
  private set(v: UdtPacks) {
    const old = this.view();
    if (old) {
      const before = new Set(old.inventory.map((c) => `${c.id}:${c.code}`));
      this.fresh.set(
        new Set(v.inventory.filter((c) => !before.has(`${c.id}:${c.code}`)).map((c) => c.id)),
      );
    }
    this.view.set(v);
  }

  /** A tab of the trait card: in the address, so the Dream Team tabs follow (no scrolling). */
  protected pickTab(t: TraitsTab) {
    this.quiet = true;
    void this.router.navigate([], { fragment: t, replaceUrl: true });
  }

  /** The pull's cards are all face up (or the stage closed): show the new state. */
  protected settle() {
    const p = this.pending();
    if (!p) return;
    this.pending.set(null);
    this.set(p);
  }

  protected async scrap(c: UdtInventoryCard) {
    await this.act(async () => this.show(await this.api.udtScrap(c.id)));
  }

  protected giftCount(v: UdtPacks): number {
    return v.blueprints.filter((b) => b.gift).length;
  }

  protected async scrapBlueprint(id: string) {
    await this.act(async () => this.show(await this.api.udtScrapBlueprint(id)));
  }

  protected async workshop(c: UdtInventoryCard, kind: 'reroll' | 'upgrade') {
    const from = this.i18n.t(`udt.trait.${c.code}`);
    await this.act(async () => {
      const r = await this.api.udtWorkshop(c.id, kind);
      this.show(r.view);
      this.toasts.success(
        this.i18n.t('ok.udt.workshop', { from, to: this.i18n.t(`udt.trait.${r.card.code}`) }),
      );
    });
  }

  protected async craft(c: UdtCatalogTrait) {
    await this.act(async () => this.show(await this.api.udtCraft(c.code)));
  }

  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    try {
      await fn();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
