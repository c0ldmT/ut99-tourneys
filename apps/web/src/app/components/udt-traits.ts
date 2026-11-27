import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { formatNeuro, NeuroPipe } from '../core/neuro';
import {
  FILTER_KEY,
  filterActive,
  NO_FILTER,
  readFilter,
  toggleRarity,
  TRAIT_CATEGORIES,
  type TraitCategory,
  type TraitFilter,
  traitMatches,
} from '../core/trait-filter';
import { RARITIES, SCRAP } from '../core/udt';
import type {
  UdtCatalogTrait,
  UdtInventoryCard,
  UdtPacks,
  UdtRarity,
  UdtWorkshopCost,
} from '../core/types';
import { type Choice, Segment, Tabs } from './choice';
import { EmptyState } from './empty-state';

export type TraitsTab = 'inventory' | 'craft' | 'workshop';
export const TRAITS_TABS: readonly TraitsTab[] = ['inventory', 'craft', 'workshop'];

/**
 * The trait cards of the packs page (decision 323): one card with three tabs – inventory,
 * crafting, workshop – instead of three boxes of different heights. Inventory and crafting share
 * a search and filter row (remembered per browser) and show tiles; crafting groups them by
 * category. The workshop shows the chosen card with its two options side by side. The page does
 * the calls (outputs) and passes the new state back in.
 */
@Component({
  selector: 'udt-traits',
  imports: [RouterLink, TPipe, NeuroPipe, Icon, Tabs, Segment, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <na-tabs
      class="tr-tabs"
      [options]="tabOptions()"
      [value]="tab()"
      (valueChange)="tabChange.emit($event)"
      label="udt.packs.traits"
      ids="tr"
      panel="tr-panel"
    />
    <div id="tr-panel" role="tabpanel" [attr.aria-labelledby]="'tr-' + tab()">
      @if (tab() !== 'workshop') {
        <div class="tr-bar">
          <label class="tr-q">
            <na-icon name="search" [size]="16" />
            <input
              type="search"
              [value]="f().q"
              (input)="patch({ q: $any($event.target).value })"
              [placeholder]="'udt.packs.search' | t"
              [attr.aria-label]="'udt.packs.search' | t"
              maxlength="60"
              autocomplete="off"
            />
          </label>
          <na-segment
            class="fit"
            [options]="catOptions"
            [value]="f().category"
            (valueChange)="patch({ category: $event })"
            label="udt.packs.category"
          />
          <div class="tr-rs" role="group" [attr.aria-label]="'udt.packs.rarity' | t">
            @for (r of rarities; track r) {
              <button
                type="button"
                class="r-{{ r }}"
                [attr.aria-pressed]="f().rarities.includes(r)"
                (click)="patch({ rarities: toggle(r) })"
              >
                {{ 'udt.rarity.' + r | t }}
              </button>
            }
          </div>
          @if (tab() === 'craft') {
            <label class="switch">
              <input
                type="checkbox"
                [checked]="f().craftable"
                (change)="patch({ craftable: $any($event.target).checked })"
              /><span class="tr"></span>
              {{ 'udt.packs.onlyCraftable' | t }}
            </label>
          }
        </div>
        @if (active()) {
          <div class="tr-shown small">
            <span class="muted">{{ 'udt.packs.shown' | t: shownCount() }}</span>
            <button type="button" class="link" (click)="reset()">
              {{ 'udt.packs.reset' | t }}
            </button>
          </div>
        }
      }

      @switch (tab()) {
        @case ('inventory') {
          @if (inventory().length) {
            <div class="tr-grid">
              @for (c of inventory(); track c.id) {
                <div class="tr-tile r-{{ c.rarity }}" [class.new]="fresh().has(c.id)">
                  <div class="tr-top">
                    <span class="udt-trait r-{{ c.rarity }}">{{ 'udt.trait.' + c.code | t }}</span>
                    @if (fresh().has(c.id)) {
                      <span class="tr-new">{{ 'udt.packs.new' | t }}</span>
                    }
                  </div>
                  <p class="tr-e">{{ 'udt.traitE.' + c.code | t }}</p>
                  <div class="tr-foot">
                    <button type="button" [disabled]="busy()" (click)="scrap.emit(c)">
                      {{ 'udt.packs.scrapIt' | t }} +{{ scrapOf(c.rarity) }}
                    </button>
                    <button type="button" (click)="toWorkshop(c)">
                      {{ 'udt.tab.workshop' | t }}
                    </button>
                  </div>
                </div>
              }
            </div>
          } @else {
            <na-empty
              [text]="(view().inventory.length ? 'udt.packs.noMatch' : 'udt.traits.none') | t"
            />
          }
          @if (view().blueprints.length && !active()) {
            <h3 class="tr-h">
              {{ 'udt.packs.blueprints' | t }} <span class="n">{{ view().blueprints.length }}</span>
            </h3>
            <div class="tr-grid">
              @for (b of view().blueprints; track b.id) {
                <div class="tr-tile r-{{ b.rarity }}">
                  <div class="tr-top">
                    <span class="udt-trait r-{{ b.rarity }}">{{ 'udt.bp.' + b.rarity | t }}</span>
                  </div>
                  <p class="tr-e">
                    @if (b.gift) {
                      {{ 'udt.packs.bpGift' | t }} ·
                    }
                    {{ 'udt.bpE.' + b.rarity | t }}
                  </p>
                  <div class="tr-foot">
                    <button type="button" [disabled]="busy()" (click)="scrapBlueprint.emit(b.id)">
                      {{ 'udt.packs.scrapIt' | t }} +{{ b.scrap }}
                    </button>
                    <a class="btn" routerLink="/udt/academy">{{ 'udt.nav.academy' | t }}</a>
                  </div>
                </div>
              }
            </div>
          }
          <p class="muted small tr-note">{{ 'udt.packs.mod' | t }}</p>
        }
        @case ('craft') {
          <p class="muted small tr-note">{{ 'udt.packs.craftText' | t }}</p>
          @for (g of craftGroups(); track g.category) {
            <div class="tr-group">
              <button
                type="button"
                class="tr-gh"
                [attr.aria-expanded]="!folded().has(g.category)"
                (click)="fold(g.category)"
              >
                {{ 'udt.cat.' + g.category | t }} <span class="n">{{ g.traits.length }}</span>
              </button>
              @if (!folded().has(g.category)) {
                <div class="tr-grid">
                  @for (c of g.traits; track c.code) {
                    @let why = craftWhy(c);
                    <div class="tr-tile r-{{ c.rarity }}">
                      <div class="tr-top">
                        <span class="udt-trait r-{{ c.rarity }}">{{
                          'udt.trait.' + c.code | t
                        }}</span>
                      </div>
                      <p class="tr-e">{{ 'udt.traitE.' + c.code | t }}</p>
                      <div class="tr-foot buy">
                        <span class="tr-price">
                          <span class="tr-cost mono">{{
                            'udt.packs.scrapN' | t: { n: c.craft }
                          }}</span>
                          @if (why) {
                            <span class="tr-why" [class.miss]="why.miss">{{ why.text }}</span>
                          }
                        </span>
                        <button type="button" [disabled]="busy() || !!why" (click)="craft.emit(c)">
                          {{ 'udt.packs.craft' | t }}
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          } @empty {
            <na-empty [text]="'udt.packs.noMatch' | t" />
          }
        }
        @case ('workshop') {
          @if (workList().length) {
            @let c = chosen()!;
            <div class="ws">
              <div class="ws-list" role="group" [attr.aria-label]="'udt.workshop.pick' | t">
                @for (x of workList(); track x.id) {
                  <button type="button" [attr.aria-pressed]="x.id === c.id" (click)="sel.set(x.id)">
                    <span class="udt-trait r-{{ x.rarity }}">{{ 'udt.trait.' + x.code | t }}</span>
                    <span class="muted small">{{ 'udt.rarity.' + x.rarity | t }}</span>
                  </button>
                }
              </div>
              <div class="ws-main">
                <div class="ws-sel">
                  <span class="udt-trait r-{{ c.rarity }}">{{ 'udt.trait.' + c.code | t }}</span>
                  <span class="small">{{ 'udt.traitE.' + c.code | t }}</span>
                </div>
                <div class="ws-opts">
                  @for (k of kinds; track k) {
                    @let w = cost(c, k);
                    <div class="ws-opt">
                      <h3>{{ 'udt.workshop.' + k | t }}</h3>
                      <p class="small">{{ 'udt.workshop.' + k + 'Hint' | t }}</p>
                      @if (w) {
                        <div class="ws-costs">
                          <span class="mono neuro">{{ w.neuro | neuro }}</span>
                          <span class="mono">{{ 'udt.packs.scrapN' | t: { n: w.scrap } }}</span>
                        </div>
                        @if (workLack(w); as l) {
                          <span class="lack">{{ l }}</span>
                        }
                        <button
                          type="button"
                          [disabled]="busy() || !view().hasTeam || !!workLack(w)"
                          (click)="work.emit({ card: c, kind: k })"
                        >
                          {{ 'udt.workshop.' + k + 'Go' | t }}
                        </button>
                      } @else {
                        <p class="muted small">{{ 'udt.workshop.top' | t }}</p>
                      }
                    </div>
                  }
                </div>
                <p class="muted small tr-note">
                  {{ 'udt.workshop.note' | t: { i: view().index.toFixed(2) } }}
                </p>
              </div>
            </div>
          } @else {
            <na-empty [text]="'udt.workshop.empty' | t" />
          }
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .tr-tabs {
      margin: -4px 0 14px;
    }
    .tr-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 14px;
      margin-bottom: 10px;
    }
    .tr-q {
      flex: 1 1 220px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--bg);
      color: var(--muted);
    }
    .tr-q input {
      flex: 1;
      min-width: 0;
      border: 0;
      background: none;
      padding: 9px 0;
    }
    .tr-q input:focus {
      outline: none;
    }
    .tr-q:focus-within {
      border-color: var(--accent);
    }
    .tr-rs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .tr-rs button {
      min-height: 32px;
      padding: 2px 11px 2px 9px;
      gap: 6px;
      border-radius: var(--radius-pill);
      background: none;
      color: var(--text-2);
      font-size: var(--fs-sm);
    }
    .tr-rs button::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--rc);
    }
    .tr-rs button[aria-pressed='true'] {
      color: var(--rt);
      background: var(--rg);
      border-color: var(--rt);
    }
    .tr-shown {
      display: flex;
      gap: 12px;
      align-items: baseline;
      margin-bottom: 4px;
    }
    .tr-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 10px;
      padding: 10px 0 4px;
    }
    .tr-tile {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 12px 10px 15px;
      border-radius: var(--radius);
      background: var(--panel-2);
      overflow: hidden;
    }
    .tr-tile::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 0;
      width: 3px;
      background: var(--rc);
    }
    .tr-tile.new {
      box-shadow: inset 0 0 0 1px var(--live);
    }
    .tr-top {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .tr-new {
      margin-left: auto;
      padding: 0 7px;
      border-radius: var(--radius-pill);
      background: var(--live);
      color: var(--bg);
      font-size: var(--fs-2xs);
      font-weight: 700;
    }
    .tr-e {
      margin: 0;
      font-size: var(--fs-sm);
      color: var(--text-2);
      line-height: 1.35;
      min-height: 2.7em;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .tr-foot {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 8px;
      margin-top: auto;
    }
    .tr-foot button,
    .tr-foot .btn {
      min-height: 32px;
      padding: 3px 10px;
      font-size: var(--fs-sm);
    }
    .tr-cost {
      font-size: var(--fs-sm);
      color: var(--text-2);
    }
    .tr-why {
      font-size: var(--fs-xs);
      color: var(--muted);
    }
    .tr-why.miss {
      color: var(--danger);
    }
    /* Crafting: price and reason on the left, the button always on the right. */
    .tr-foot.buy {
      flex-wrap: nowrap;
      justify-content: space-between;
    }
    .tr-price {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .tr-h,
    .tr-gh {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      margin: 12px 0 0;
      padding: 8px 0 4px;
      border: 0;
      border-bottom: 1px solid var(--border);
      border-radius: 0;
      background: none;
      color: var(--muted);
      font-size: var(--fs-sm);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      justify-content: flex-start;
      min-height: 40px;
    }
    .tr-gh::after {
      content: '▾';
      margin-left: auto;
    }
    .tr-gh[aria-expanded='false']::after {
      content: '▸';
    }
    .n {
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
    }
    .tr-note {
      margin: 12px 0 0;
    }
    .ws {
      display: grid;
      grid-template-columns: minmax(0, 260px) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
    }
    .ws-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 460px;
      overflow-y: auto;
    }
    .ws-list button {
      justify-content: space-between;
      min-height: 44px;
      padding: 6px 10px;
      border-color: transparent;
      background: var(--panel-2);
      font-weight: 500;
    }
    .ws-list button[aria-pressed='true'] {
      border-color: var(--accent);
    }
    .ws-main {
      background: var(--panel-2);
      border-radius: var(--radius);
      padding: 14px;
    }
    .ws-sel {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
      align-items: center;
      margin-bottom: 12px;
      color: var(--text-2);
    }
    .ws-opts {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .ws-opt {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 14px;
      border-radius: var(--radius);
      background: var(--panel);
    }
    .ws-opt h3 {
      margin: 0;
      font-size: var(--fs-lg);
    }
    .ws-opt p {
      margin: 0;
      color: var(--text-2);
    }
    .ws-opt button {
      margin-top: auto;
    }
    .ws-opt .lack {
      margin: 0;
    }
    .ws-costs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .ws-costs span {
      padding: 3px 8px;
      border-radius: var(--radius-xs);
      background: var(--well);
      font-size: var(--fs-sm);
    }
    .neuro {
      color: var(--neuro-text);
    }
    @media (max-width: 760px) {
      .ws,
      .ws-opts {
        grid-template-columns: minmax(0, 1fr);
      }
      .ws-list {
        max-height: 220px;
      }
    }
  `,
})
export class UdtTraits {
  private readonly i18n = inject(I18n);
  readonly view = input.required<UdtPacks>();
  readonly tab = input<TraitsTab>('inventory');
  readonly busy = input(false);
  /** Neuro the manager can spend (the shared state of the header). */
  readonly spendable = input(0);
  /** Cards new since the last change (a pull, a craft, a workshop step). */
  readonly fresh = input<ReadonlySet<string>>(new Set());
  readonly tabChange = output<TraitsTab>();
  readonly scrap = output<UdtInventoryCard>();
  readonly scrapBlueprint = output<string>();
  readonly craft = output<UdtCatalogTrait>();
  readonly work = output<{ card: UdtInventoryCard; kind: 'reroll' | 'upgrade' }>();

  protected readonly rarities = RARITIES;
  protected readonly kinds = ['reroll', 'upgrade'] as const;
  protected readonly catOptions: Choice<TraitCategory | 'all'>[] = [
    { value: 'all', label: 'udt.packs.all' },
    ...TRAIT_CATEGORIES.map((c) => ({ value: c, label: 'udt.cat.' + c })),
  ];
  protected readonly f = signal<TraitFilter>(readFilter(stored()));
  protected readonly folded = signal<ReadonlySet<string>>(new Set());
  /** The card chosen in the workshop (the first one until a choice). */
  protected readonly sel = signal<string | null>(null);

  protected readonly active = computed(() => filterActive(this.f(), this.tab() === 'craft'));

  protected readonly tabOptions = computed<Choice<TraitsTab>[]>(() => {
    const v = this.view();
    return [
      {
        value: 'inventory',
        label: 'udt.tab.inventory',
        // Trait cards only, as the hub counts them; blueprints have their own heading.
        badge: v.inventory.length,
      },
      { value: 'craft', label: 'udt.tab.craft', badge: v.catalog.length },
      { value: 'workshop', label: 'udt.tab.workshop' },
    ];
  });

  /** Category, then rarity (common first), then the name in the viewer's language. */
  private order = (a: { code: string; rarity: UdtRarity; category: string }, b: typeof a) =>
    TRAIT_CATEGORIES.indexOf(a.category as TraitCategory) -
      TRAIT_CATEGORIES.indexOf(b.category as TraitCategory) ||
    RARITIES.indexOf(a.rarity) - RARITIES.indexOf(b.rarity) ||
    this.name(a.code).localeCompare(this.name(b.code));

  private passes(t: { code: string; rarity: UdtRarity; category: string }): boolean {
    const text = `${this.name(t.code)} ${this.i18n.t(`udt.traitE.${t.code}`)}`;
    return traitMatches(t, text, this.f());
  }

  protected readonly workList = computed(() => [...this.view().inventory].sort(this.order));
  protected readonly inventory = computed(() => this.workList().filter((c) => this.passes(c)));
  private readonly crafts = computed(() =>
    [...this.view().catalog]
      .sort(this.order)
      .filter((c) => this.passes(c) && (!this.f().craftable || !this.craftWhy(c))),
  );
  protected readonly craftGroups = computed(() =>
    TRAIT_CATEGORIES.map((category) => ({
      category,
      traits: this.crafts().filter((t) => t.category === category),
    })).filter((g) => g.traits.length),
  );
  protected readonly shownCount = computed(() =>
    this.tab() === 'craft'
      ? { n: this.crafts().length, of: this.view().catalog.length }
      : { n: this.inventory().length, of: this.view().inventory.length },
  );
  protected readonly chosen = computed(() => {
    const list = this.workList();
    return list.find((c) => c.id === this.sel()) ?? list[0] ?? null;
  });

  protected name(code: string): string {
    return this.i18n.t(`udt.trait.${code}`);
  }

  protected scrapOf(r: UdtRarity): number {
    return SCRAP[r];
  }

  protected toggle(r: UdtRarity): UdtRarity[] {
    return toggleRarity(this.f().rarities, r);
  }

  protected patch(p: Partial<TraitFilter>): void {
    this.f.update((f) => ({ ...f, ...p }));
    try {
      localStorage.setItem(FILTER_KEY, JSON.stringify(this.f()));
    } catch {
      // storage unavailable: the filter lasts for this visit
    }
  }

  protected reset(): void {
    this.patch({ ...NO_FILTER });
  }

  protected fold(c: string): void {
    this.folded.update((s) => {
      const n = new Set(s);
      if (!n.delete(c)) n.add(c);
      return n;
    });
  }

  protected toWorkshop(c: UdtInventoryCard): void {
    this.sel.set(c.id);
    this.tabChange.emit('workshop');
  }

  /** Why a trait cannot be crafted now (null: it can). */
  protected craftWhy(c: UdtCatalogTrait): { text: string; miss: boolean } | null {
    const v = this.view();
    if (c.owned) return { text: this.i18n.t('udt.packs.inInventory'), miss: false };
    if (!v.hasTeam) return { text: this.i18n.t('udt.packs.noTeamShort'), miss: false };
    if (v.scrap < c.craft)
      return {
        text: this.i18n.t('common.lack', {
          n: this.i18n.t('udt.packs.scrapN', { n: c.craft - v.scrap }),
        }),
        miss: true,
      };
    return null;
  }

  protected cost(c: UdtInventoryCard, k: 'reroll' | 'upgrade'): UdtWorkshopCost | null {
    return c.workshop?.[k] ?? null;
  }

  /** What a workshop step still needs ("Es fehlen 230 N + 5 Schrott"), '' when affordable. */
  protected workLack(w: UdtWorkshopCost): string {
    const parts: string[] = [];
    const n = w.neuro - this.spendable();
    if (n > 0) parts.push(formatNeuro(n, this.i18n.lang()));
    const s = w.scrap - this.view().scrap;
    if (s > 0) parts.push(this.i18n.t('udt.packs.scrapN', { n: s }));
    return parts.length ? this.i18n.t('common.lack', { n: parts.join(' + ') }) : '';
  }
}

function stored(): string | null {
  try {
    return localStorage.getItem(FILTER_KEY);
  } catch {
    return null;
  }
}
