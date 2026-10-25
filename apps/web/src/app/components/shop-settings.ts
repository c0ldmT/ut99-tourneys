import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { TPipe } from '../core/i18n';
import type { ShopItem } from '../core/types';

/** Settings page (admins): Neuro shop on/off, prices and the items on sale. */
@Component({
  selector: 'app-shop-settings',
  imports: [FormsModule, RouterLink, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="card tablepanel" data-form="shop" (ngSubmit)="save()">
      <div class="toolbar">
        <h2>{{ 'shop.settings' | t }}</h2>
        <span class="grow"></span>
        <label class="check"
          ><input type="checkbox" name="shopOn" [(ngModel)]="enabled" />
          {{ 'shop.enabled' | t }}</label
        >
        <button type="submit" class="primary" [disabled]="busy() || !catalog().length">
          {{ 'common.save' | t }}
        </button>
      </div>
      <p class="muted small hint">
        {{ 'shop.settingsHint' | t }}
        <a routerLink="/shop" [queryParams]="{ tab: 'admin' }">{{ 'shop.toAdmin' | t }}</a>
      </p>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>{{ 'shop.item' | t }}</th>
              <th>{{ 'shop.slotCol' | t }}</th>
              <th class="num">{{ 'shop.price' | t }}</th>
              <th class="ctr">{{ 'shop.visible' | t }}</th>
            </tr>
          </thead>
          <tbody>
            @for (i of catalog(); track i.id) {
              <tr [class.off]="i.hidden">
                <td>{{ i.name }}</td>
                <td class="muted small">{{ 'shop.slot.' + i.slot | t }}</td>
                <td class="num">
                  <input
                    class="price mono"
                    type="number"
                    min="1"
                    [name]="'p' + i.id"
                    [(ngModel)]="i.price"
                  />
                  @if (changed(i)) {
                    <span class="base muted small">({{ i.basePrice }})</span>
                  }
                </td>
                <td class="ctr">
                  <input
                    type="checkbox"
                    [name]="'v' + i.id"
                    [ngModel]="!i.hidden"
                    (ngModelChange)="i.hidden = !$event"
                    [attr.aria-label]="('shop.visible' | t) + ': ' + i.name"
                  />
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="muted small hint">{{ 'shop.hiddenHint' | t }}</p>
    </form>
  `,
  styles: `
    :host {
      display: block;
      max-width: 820px;
    }
    .toolbar h2 {
      margin: 0;
    }
    .hint {
      padding: 0 16px;
      margin: 8px 0;
    }
    .scroll {
      overflow-x: auto;
      max-height: 480px;
    }
    input.price {
      width: 96px;
      text-align: right;
    }
    .base {
      margin-left: 6px;
    }
    .ctr {
      text-align: center;
    }
    tr.off td:first-child {
      color: var(--text-3);
      text-decoration: line-through;
    }
  `,
})
export class ShopSettings {
  private readonly api = inject(Api);
  /** Saved (the settings page drops its "unsaved" mark). */
  readonly saved = output<void>();
  protected readonly catalog = signal<ShopItem[]>([]);
  protected readonly busy = signal(false);
  protected enabled = true;

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      const [s, a] = await Promise.all([this.api.settings(), this.api.shopAdmin()]);
      this.enabled = s.shop?.enabled ?? true;
      this.catalog.set(a.catalog.map((i) => ({ ...i })));
    } catch {
      // the toast shows the error
    }
  }

  protected changed(i: ShopItem): boolean {
    return i.basePrice !== undefined && Number(i.price) !== i.basePrice;
  }

  protected async save() {
    const prices: Record<string, number> = {};
    for (const i of this.catalog())
      if (this.changed(i)) prices[i.id] = Math.max(1, Math.round(Number(i.price)));
    const hidden = this.catalog()
      .filter((i) => i.hidden)
      .map((i) => i.id);
    this.busy.set(true);
    try {
      await this.api.setShopSettings({ enabled: this.enabled, prices, hidden });
      this.saved.emit();
      await this.load();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
