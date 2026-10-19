import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { Auth } from '../core/auth';
import { Coin, Icon } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { Avatar, Looks, nameStyle } from '../core/looks';
import { NeuroPipe } from '../core/neuro';
import type { ShopItem, ShopPurchaseView, ShopSlot, ShopView } from '../core/types';

type Tab = 'shop' | 'wardrobe' | 'admin';
const SLOT_ORDER: ShopSlot[] = [
  'title',
  'color',
  'frame',
  'badge',
  'banner',
  'fanfare',
  'dedication',
];
const WEAR_SLOTS = ['title', 'color', 'frame', 'badge', 'banner', 'fanfare'] as const;

/** The Neuro shop: cosmetics for Neuro, the wardrobe, and (admins) prices and approvals. */
@Component({
  selector: 'app-shop',
  imports: [FormsModule, RouterLink, TPipe, NeuroPipe, Coin, Icon, Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pagehead">
      <h1>{{ 'shop.title' | t }}</h1>
      @if (view(); as v) {
        <div class="wallet">
          <b class="neuro"><na-coin [size]="20" /> {{ v.wallet.balance | neuro: false }}</b>
          <span class="muted small">{{
            'shop.spendable' | t: { n: neuro(v.wallet.spendable), floor: neuro(v.wallet.floor) }
          }}</span>
        </div>
      }
    </div>
    <p class="muted small intro">{{ 'shop.intro' | t }}</p>
    <div class="tabs">
      <button [class.active]="tab() === 'shop'" (click)="tab.set('shop')">
        {{ 'shop.tab.shop' | t }}
      </button>
      <button [class.active]="tab() === 'wardrobe'" (click)="tab.set('wardrobe')">
        {{ 'shop.tab.wardrobe' | t }}
      </button>
      @if (auth.me()?.isAdmin) {
        <button [class.active]="tab() === 'admin'" (click)="openAdmin()">
          {{ 'shop.tab.admin' | t }}
          @if (pending().length) {
            <span class="badge season">{{ pending().length }}</span>
          }
        </button>
      }
    </div>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }

    @if (view(); as v) {
      @if (!v.enabled && tab() !== 'admin') {
        <p class="notice">{{ 'shop.closed' | t }}</p>
      }
      @if (v.wallet.season === null && tab() === 'shop') {
        <p class="notice">{{ 'shop.noSeason' | t }}</p>
      }

      @switch (tab()) {
        @case ('shop') {
          @for (g of groups(); track g.slot) {
            <section class="group">
              <h2>{{ 'shop.slot.' + g.slot | t }}</h2>
              <p class="muted small">{{ 'shop.slotHint.' + g.slot | t }}</p>
              <div class="items">
                @for (i of g.items; track i.id) {
                  <div class="item" [class]="'tier' + i.tier" [class.owned]="i.owned">
                    <div class="prev">
                      @switch (i.slot) {
                        @case ('title') {
                          <span class="pn">{{ me() }}</span>
                          <span class="pt">{{ i.value }}</span>
                        }
                        @case ('color') {
                          <span
                            class="pn big"
                            [class.aurora]="i.value === 'aurora'"
                            [style]="style(i.value)"
                            >{{ me() }}</span
                          >
                        }
                        @case ('frame') {
                          <na-avatar [name]="me()" [size]="52" [preview]="i.value" />
                        }
                        @case ('badge') {
                          <span class="pn"
                            >{{ me() }}
                            <span class="pb"><na-icon [name]="i.value" [size]="18" /></span
                          ></span>
                        }
                        @case ('banner') {
                          <span class="bnp" [class]="'bn-' + i.value"></span>
                        }
                        @case ('fanfare') {
                          <span class="bnp fan confetti">🏆</span>
                        }
                        @case ('dedication') {
                          <span class="bubble">„{{ 'shop.dedicationSample' | t }}“</span>
                        }
                      }
                    </div>
                    <div class="meta">
                      <div>
                        <b>{{ i.name }}</b>
                        <div class="tier small">{{ 'shop.tier.' + i.tier | t }}</div>
                      </div>
                      <span class="neuro price"
                        ><na-coin [size]="15" /> {{ i.price | neuro: false }}</span
                      >
                    </div>
                    @if (i.slot === 'dedication') {
                      @if (v.dedication && v.dedication.status !== 'rejected') {
                        <button type="button" (click)="tab.set('wardrobe')">
                          {{ 'shop.dedicationEdit' | t }}
                        </button>
                      } @else {
                        <button
                          type="button"
                          class="primary"
                          (click)="dedOpen.set(true)"
                          [disabled]="busy() || !canBuy(i)"
                        >
                          {{ 'shop.buy' | t }}
                        </button>
                      }
                    } @else if (i.owned) {
                      @if (worn(i)) {
                        <span class="worn small"
                          ><na-icon name="check" [size]="15" /> {{ 'shop.worn' | t }}</span
                        >
                      } @else {
                        <button type="button" (click)="wear(i)" [disabled]="busy()">
                          {{ 'shop.wear' | t }}
                        </button>
                      }
                    } @else {
                      <button
                        type="button"
                        class="primary"
                        (click)="buy(i)"
                        [disabled]="busy() || !canBuy(i)"
                        [title]="canBuy(i) ? '' : ('shop.tooExpensive' | t)"
                      >
                        {{ 'shop.buy' | t }}
                      </button>
                    }
                  </div>
                }
              </div>
              @if (g.slot === 'dedication' && dedOpen()) {
                <form class="card ded" (ngSubmit)="buyDedication()">
                  <p class="muted small">{{ 'shop.dedicationHint' | t }}</p>
                  <label for="dk">{{ 'shop.dedicationKill' | t }}</label>
                  <input
                    id="dk"
                    name="dk"
                    maxlength="120"
                    [(ngModel)]="dedKill"
                    [placeholder]="'shop.dedicationKillPh' | t"
                  />
                  <label for="dd">{{ 'shop.dedicationDeath' | t }}</label>
                  <input
                    id="dd"
                    name="dd"
                    maxlength="120"
                    [(ngModel)]="dedDeath"
                    [placeholder]="'shop.dedicationDeathPh' | t"
                  />
                  <div class="row">
                    <button
                      type="submit"
                      class="primary"
                      [disabled]="busy() || (!dedKill.trim() && !dedDeath.trim())"
                    >
                      {{ 'shop.buyFor' | t: { n: neuro(dedicationPrice()) } }}
                    </button>
                    <button type="button" (click)="dedOpen.set(false)">
                      {{ 'common.cancel' | t }}
                    </button>
                  </div>
                </form>
              }
            </section>
          }
        }
        @case ('wardrobe') {
          <div class="card tablepanel">
            <div class="wardrobe">
              @for (s of wearSlots; track s) {
                <label class="slot">
                  <span>{{ 'shop.slot.' + s | t }}</span>
                  <select
                    [ngModel]="v.look[s] ?? ''"
                    (ngModelChange)="wearSlot(s, $event)"
                    [name]="'w' + s"
                  >
                    <option value="">{{ 'shop.nothing' | t }}</option>
                    @for (i of ownedFor(s); track i.id) {
                      <option [value]="i.id">{{ i.name }}</option>
                    }
                  </select>
                </label>
              }
            </div>
            @if (v.awards.length) {
              <p class="small">
                <b>{{ 'shop.awards' | t }}:</b>
                @for (a of v.awards; track a.id; let last = $last) {
                  {{ a.name }}{{ last ? '' : ', ' }}
                }
              </p>
            }
            <p class="muted small">{{ 'shop.wardrobeHint' | t }}</p>
          </div>
          @if (v.dedication; as d) {
            <form class="card ded" (ngSubmit)="saveDedication()">
              <h2>
                {{ 'shop.slot.dedication' | t }}
                <span
                  class="badge"
                  [class.season]="d.status === 'pending'"
                  [class.running]="d.status === 'approved'"
                  >{{ 'shop.status.' + d.status | t }}</span
                >
              </h2>
              <p class="muted small">{{ 'shop.dedicationHint' | t }}</p>
              <label for="ek">{{ 'shop.dedicationKill' | t }}</label>
              <input id="ek" name="ek" maxlength="120" [(ngModel)]="dedKill" />
              <label for="ed">{{ 'shop.dedicationDeath' | t }}</label>
              <input id="ed" name="ed" maxlength="120" [(ngModel)]="dedDeath" />
              @if (d.status !== 'rejected') {
                <button type="submit" class="primary" [disabled]="busy()">
                  {{ 'shop.dedicationSave' | t }}
                </button>
              } @else {
                <p class="muted small">{{ 'shop.dedicationRejected' | t }}</p>
              }
            </form>
          }
        }
        @case ('admin') {
          @if (admin(); as a) {
            @if (pending().length) {
              <div class="card">
                <h2>{{ 'shop.pending' | t }}</h2>
                @for (p of pending(); track p.id) {
                  <div class="pend">
                    <div>
                      <b>{{ p.name }}</b>
                      <div class="small">⚔ {{ p.dedication?.kill || '–' }}</div>
                      <div class="small">☠ {{ p.dedication?.death || '–' }}</div>
                    </div>
                    <div class="iconbtns">
                      <button
                        class="icon"
                        (click)="review(p, true)"
                        [title]="'shop.approve' | t"
                        [attr.aria-label]="'shop.approve' | t"
                      >
                        <na-icon name="check" />
                      </button>
                      <button
                        class="icon dng"
                        (click)="review(p, false)"
                        [title]="'shop.reject' | t"
                        [attr.aria-label]="'shop.reject' | t"
                      >
                        <na-icon name="close" />
                      </button>
                    </div>
                  </div>
                }
              </div>
            }
            <p class="muted small">
              {{ 'shop.pricesMoved' | t }}
              <a routerLink="/admin/settings">{{ 'nav.settings' | t }}</a>
            </p>
            <div class="card tablepanel">
              <h2>{{ 'shop.log' | t }}</h2>
              <div class="scroll">
                <table>
                  <tbody>
                    @for (p of a.log; track p.id) {
                      <tr>
                        <td class="muted small">{{ i18n.date(p.at) }}</td>
                        <td>{{ p.name }}</td>
                        <td>{{ p.itemName }}</td>
                        <td class="num neuro">{{ p.price | neuro }}</td>
                        <td class="muted small">
                          S{{ p.season }} · {{ 'shop.status.' + p.status | t }}
                        </td>
                      </tr>
                    } @empty {
                      <tr>
                        <td class="muted">{{ 'shop.noPurchases' | t }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }
        }
      }
    }
  `,
  styles: `
    .pagehead {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
    }
    .pagehead h1 {
      margin: 0;
    }
    .wallet {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }
    .wallet b {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 1.4rem;
    }
    .intro {
      margin: 6px 0 14px;
    }
    .group {
      margin: 22px 0 8px;
    }
    .group h2 {
      margin-bottom: 2px;
    }
    .items {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(210px, 44%), 1fr));
      gap: 12px;
      margin-top: 10px;
    }
    .item {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
    }
    .item.tier3 {
      border-color: rgba(240, 70, 140, 0.4);
    }
    .item.tier4 {
      border-color: rgba(251, 191, 36, 0.55);
      box-shadow: 0 0 18px rgba(251, 191, 36, 0.12);
    }
    .item.owned {
      background: linear-gradient(180deg, rgba(34, 211, 238, 0.06), transparent 60%), var(--panel);
    }
    .prev {
      height: 86px;
      border-radius: 8px;
      background: var(--bg-2);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .pn {
      font-weight: 700;
      font-size: 1.1rem;
    }
    .pn.big {
      font-family: var(--font-display);
      font-size: 1.7rem;
      text-transform: uppercase;
      font-style: italic;
    }
    .pt {
      font-family: var(--font-display);
      font-weight: 600;
      font-size: 0.85rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--hot-text);
    }
    .pb {
      color: var(--neuro);
      vertical-align: -3px;
    }
    .bnp {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.8rem;
    }
    .fan {
      background: linear-gradient(90deg, rgba(245, 184, 61, 0.15), transparent);
    }
    .bubble {
      font-size: 0.85rem;
      padding: 8px 12px;
      border-radius: 12px;
      background: var(--panel-3);
      max-width: 90%;
      text-align: center;
    }
    .aurora {
      background-image: linear-gradient(90deg, #22d3ee, #a78bfa, #f0468c, #fbbf24, #22d3ee);
      background-size: 300% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      animation: shopaurora 6s linear infinite;
    }
    @keyframes shopaurora {
      to {
        background-position: 300% 0;
      }
    }
    .meta {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
    }
    .tier {
      color: var(--muted);
    }
    .tier4 .tier {
      color: var(--neuro-text);
    }
    .tier3 .tier {
      color: var(--hot-text);
    }
    .price {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .worn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--live);
      min-height: 38px;
    }
    .ded {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .ded label {
      margin-top: 6px;
    }
    .wardrobe {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 12px;
    }
    .slot span {
      display: block;
      margin-bottom: 4px;
    }
    .pend {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-top: 1px solid var(--border);
    }
    .scroll {
      overflow-x: auto;
    }
  `,
})
export class ShopPage {
  private readonly api = inject(Api);
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  private readonly looks = inject(Looks);

  protected readonly tab = signal<Tab>('shop');
  protected readonly view = signal<ShopView | null>(null);
  protected readonly admin = signal<{ catalog: ShopItem[]; log: ShopPurchaseView[] } | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly dedOpen = signal(false);
  protected dedKill = '';
  protected dedDeath = '';
  protected readonly wearSlots = WEAR_SLOTS;

  protected readonly me = computed(() => this.auth.me()?.displayName ?? 'Player');
  protected readonly groups = computed(() => {
    const items = this.view()?.items ?? [];
    return SLOT_ORDER.map((slot) => ({ slot, items: items.filter((i) => i.slot === slot) })).filter(
      (g) => g.items.length,
    );
  });
  protected readonly pending = computed(() =>
    (this.admin()?.log ?? []).filter((p) => p.status === 'pending'),
  );
  protected readonly dedicationPrice = computed(
    () => this.view()?.items.find((i) => i.slot === 'dedication')?.price ?? 0,
  );

  constructor() {
    void this.load();
    if (this.auth.me()?.isAdmin) {
      void this.loadAdmin();
      if (inject(ActivatedRoute).snapshot.queryParamMap.get('tab') === 'admin')
        this.tab.set('admin');
    }
  }

  private async load() {
    try {
      const v = await this.api.shop();
      this.view.set(v);
      if (v.dedication) {
        this.dedKill = v.dedication.kill;
        this.dedDeath = v.dedication.death;
      }
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  private async loadAdmin() {
    try {
      this.admin.set(await this.api.shopAdmin());
    } catch {
      // not an admin
    }
  }

  protected openAdmin() {
    this.tab.set('admin');
    void this.loadAdmin();
  }

  private async run(fn: () => Promise<ShopView | unknown>) {
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await fn();
      if (r && typeof r === 'object' && 'items' in r) this.view.set(r as ShopView);
      void this.looks.reload();
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected canBuy(i: ShopItem): boolean {
    const v = this.view();
    return !!v && v.enabled && v.wallet.season !== null && i.price <= v.wallet.spendable;
  }

  protected worn(i: ShopItem): boolean {
    const look = this.view()?.look ?? {};
    return (look as Record<string, string>)[i.slot] === i.id;
  }

  protected buy(i: ShopItem) {
    if (!confirm(this.i18n.t('shop.confirm', { name: i.name, n: this.neuro(i.price) }))) return;
    void this.run(() => this.api.buy(i.id));
  }

  protected buyDedication() {
    void this.run(async () => {
      const v = await this.api.buy('dedication', {
        kill: this.dedKill.trim(),
        death: this.dedDeath.trim(),
      });
      this.dedOpen.set(false);
      return v;
    });
  }

  protected saveDedication() {
    void this.run(() =>
      this.api.setDedication({ kill: this.dedKill.trim(), death: this.dedDeath.trim() }),
    );
  }

  protected wear(i: ShopItem) {
    void this.run(() => this.api.wear(i.slot, i.id));
  }

  protected wearSlot(slot: string, id: string) {
    void this.run(() => this.api.wear(slot, id || null));
  }

  protected ownedFor(slot: string): ShopItem[] {
    const v = this.view();
    if (!v) return [];
    return [
      ...v.items.filter((i) => i.owned && i.slot === slot),
      ...v.awards.filter((a) => a.slot === slot),
    ];
  }

  protected review(p: ShopPurchaseView, approve: boolean) {
    void this.run(async () => {
      await this.api.reviewDedication(p.id, approve);
      await this.loadAdmin();
    });
  }

  protected style(v: string) {
    return nameStyle(v);
  }

  protected neuro(n: number): string {
    return `${Math.round(n).toLocaleString(this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB')} €`;
  }
}
