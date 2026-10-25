import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { SettingsBets } from '../components/settings-bets';
import { SettingsBots } from '../components/settings-bots';
import { SettingsSeason } from '../components/settings-season';
import type { SettingsForm } from '../components/settings-shared';
import { SettingsSystem } from '../components/settings-system';
import { SettingsUdt } from '../components/settings-udt';
import { I18n, TPipe } from '../core/i18n';

const TABS = ['season', 'bets', 'bots', 'udt', 'system'] as const;
export type SettingsTab = (typeof TABS)[number];

/**
 * Website settings (admins) as tabs: season and ratings, bets and shop, bots and live data,
 * Dream Team, system (reset). The tab is in the address (`?tab=`), so links and the back button
 * work; every tab saves its own forms. A tab with changes not saved yet shows a dot, and
 * leaving it asks first (a tab's values are lost when another one opens).
 */
@Component({
  selector: 'app-settings',
  imports: [TPipe, SettingsSeason, SettingsBets, SettingsBots, SettingsUdt, SettingsSystem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'settings.title' | t }}</h1>

    <div class="tabs" role="tablist" [attr.aria-label]="'settings.tabs' | t">
      @for (t of tabs; track t) {
        <button
          type="button"
          role="tab"
          [id]="'st-tab-' + t"
          [attr.aria-selected]="tab() === t"
          [attr.aria-controls]="tab() === t ? 'st-panel' : null"
          [attr.tabindex]="tab() === t ? 0 : -1"
          [class.active]="tab() === t"
          (click)="open(t)"
          (keydown)="key($event, t)"
        >
          {{ 'settings.tab.' + t | t }}
          @if (tab() === t && unsaved()) {
            <span class="dot" [title]="'settings.unsaved' | t"
              ><span class="sr">{{ 'settings.unsaved' | t }}</span></span
            >
          }
        </button>
      }
    </div>

    <div
      class="panel"
      role="tabpanel"
      id="st-panel"
      tabindex="0"
      [attr.aria-labelledby]="'st-tab-' + tab()"
      (input)="changed($event)"
      (change)="changed($event)"
    >
      @switch (tab()) {
        @case ('season') {
          <app-settings-season (saved)="saved($event)" />
        }
        @case ('bets') {
          <app-settings-bets (saved)="saved($event)" />
        }
        @case ('bots') {
          <app-settings-bots (saved)="saved($event)" />
        }
        @case ('udt') {
          <app-settings-udt (saved)="saved($event)" />
        }
        @case ('system') {
          <app-settings-system />
        }
      }
    </div>
  `,
  styles: `
    .tabs button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--neuro);
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class SettingsPage {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18n);
  protected readonly tabs = TABS;
  private readonly query = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('tab'))), {
    initialValue: this.route.snapshot.queryParamMap.get('tab'),
  });
  protected readonly tab = computed<SettingsTab>(() => {
    const q = this.query();
    return (TABS as readonly string[]).includes(q ?? '') ? (q as SettingsTab) : 'season';
  });
  /** Forms of the open tab with changes not saved yet. */
  private readonly dirty = signal<ReadonlySet<string>>(new Set());
  protected readonly unsaved = computed(() => this.dirty().size > 0);

  constructor() {
    // Another tab (also by the back button): the old tab's values are gone with it.
    effect(() => {
      this.tab();
      untracked(() => this.dirty.set(new Set()));
    });
  }

  /** Opens tab `t`; false when the admin keeps the unsaved changes of the open tab. */
  protected open(t: SettingsTab): boolean {
    if (t === this.tab()) return true;
    if (this.unsaved() && !confirm(this.i18n.t('settings.unsavedConfirm'))) return false;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: t === 'season' ? null : t },
      queryParamsHandling: 'merge',
    });
    return true;
  }

  /** Arrow keys, Home and End move between the tabs (the tab pattern of ARIA). */
  protected key(e: KeyboardEvent, t: SettingsTab) {
    const i = TABS.indexOf(t);
    const next =
      e.key === 'ArrowRight'
        ? TABS[(i + 1) % TABS.length]
        : e.key === 'ArrowLeft'
          ? TABS[(i - 1 + TABS.length) % TABS.length]
          : e.key === 'Home'
            ? TABS[0]
            : e.key === 'End'
              ? TABS[TABS.length - 1]
              : null;
    if (!next) return;
    e.preventDefault();
    // Focus follows only when the tab really changes (not when the admin keeps the changes).
    if (this.open(next)) document.getElementById(`st-tab-${next}`)?.focus();
  }

  /** A field of a saving form changed. */
  protected changed(e: Event) {
    const form = (e.target as Element | null)?.closest?.('form[data-form]');
    const key = form?.getAttribute('data-form');
    if (!key || this.dirty().has(key)) return;
    this.dirty.update((d) => new Set([...d, key]));
  }

  protected saved(key: SettingsForm) {
    if (!this.dirty().has(key)) return;
    this.dirty.update((d) => new Set([...d].filter((k) => k !== key)));
  }
}
