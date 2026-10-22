import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TPipe } from '../core/i18n';
import { split } from '../core/live';
import type { ItemCounts } from '../core/types';

export interface SideTotals {
  damage: number;
  items: ItemCounts;
}

/** A row of the comparison: label key, values of both sides. */
export interface CompareRow {
  label: string;
  a: number | string;
  b: number | string;
  /** Numbers for the bar (defaults to a and b). */
  va?: number;
  vb?: number;
}

/**
 * Two sides side by side as split bars: damage dealt and the items taken (deathmatch), or any
 * rows (Monster Hunt: run 1 at the same time against run 2 now).
 */
@Component({
  selector: 'app-damage-items',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (r of view(); track r.label; let first = $first) {
      <div class="row" [class.big]="first && big()">
        <span class="lab">{{ r.label | t }}</span>
        <span class="n a mono">{{ r.a }}</span>
        <span class="lc-split"
          ><span class="a" [style.width.%]="r.wa"></span
          ><span class="b" [style.width.%]="r.wb"></span
        ></span>
        <span class="n b mono">{{ r.b }}</span>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .row {
      display: grid;
      grid-template-columns: 96px 44px minmax(0, 1fr) 44px;
      gap: 8px;
      align-items: center;
      padding: 4px 0;
      font-size: 0.86rem;
    }
    .row.big {
      margin-bottom: 8px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border);
    }
    .row:not(.big) .lc-split {
      height: 7px;
    }
    .lab {
      color: var(--text-2);
    }
    .n {
      text-align: center;
    }
    .n.a {
      color: var(--side-a);
    }
    .n.b {
      color: var(--side-b);
    }
  `,
})
export class DamageItems {
  readonly a = input<SideTotals | null>(null);
  readonly b = input<SideTotals | null>(null);
  /** Instead of damage and items: these rows. */
  readonly rows = input<readonly CompareRow[] | null>(null);

  protected readonly big = computed(() => this.rows() === null);
  protected readonly view = computed(() => {
    const rows = this.rows() ?? this.itemRows();
    return rows.map((r) => {
      const [wa, wb] = split(r.va ?? Number(r.a), r.vb ?? Number(r.b));
      return { ...r, wa, wb };
    });
  });

  private itemRows(): CompareRow[] {
    const a = this.a();
    const b = this.b();
    if (!a || !b) return [];
    return [
      { label: 'live.damage', a: a.damage, b: b.damage },
      { label: 'live.item.amp', a: a.items.amp, b: b.items.amp },
      { label: 'live.item.belt', a: a.items.belt, b: b.items.belt },
      { label: 'live.item.armor', a: a.items.armor, b: b.items.armor },
      { label: 'live.item.keg', a: a.items.keg, b: b.items.keg },
    ];
  }
}
