import { type Choice, Tabs } from '../components/choice';
import { Confirm } from '../components/confirm-dialog';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { SettingsBets } from '../components/settings-bets';
import { SettingsBots } from '../components/settings-bots';
import { SettingsLeague } from '../components/settings-league';
import { SettingsSeason } from '../components/settings-season';
import type { SettingsForm } from '../components/settings-shared';
import { SettingsSystem } from '../components/settings-system';
import { SettingsUdt } from '../components/settings-udt';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { Guide } from '../components/guide';

const TABS = ['season', 'bets', 'bots', 'udt', 'league', 'system'] as const;
export type SettingsTab = (typeof TABS)[number];

/**
 * Website settings (admins) as tabs: season and ratings, bets and shop, bots and live data,
 * Dream Team, system (reset). The tab is in the address (`?tab=`), so links and the back button
 * work; every tab saves its own forms. A tab with changes not saved yet shows a dot, and
 * leaving it asks first (a tab's values are lost when another one opens).
 */
@Component({
  selector: 'app-settings',
  imports: [
    Guide,
    Tabs,
    TPipe,
    SettingsSeason,
    SettingsBets,
    SettingsBots,
    SettingsUdt,
    SettingsLeague,
    SettingsSystem,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="spread">
      <h1>{{ 'settings.title' | t }}</h1>
      <na-guide page="settings" />
    </div>

    <na-tabs
      [options]="tabOptions()"
      [value]="tab()"
      (valueChange)="open($event)"
      label="settings.tabs"
      panel="st-panel"
      ids="st-tab"
    />

    <div class="st-body" [class.withtoc]="toc().length > 1">
      <div
        #panel
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
          @case ('league') {
            <app-settings-league (saved)="saved($event)" />
          }
          @case ('system') {
            <app-settings-system />
          }
        }
      </div>
      @if (toc().length > 1) {
        <nav class="toc" [attr.aria-label]="'settings.toc' | t">
          <span class="kpi">{{ 'settings.toc' | t }}</span>
          @for (s of toc(); track s.id; let i = $index) {
            <a
              [href]="'#' + s.id"
              [class.on]="i === current()"
              [attr.aria-current]="i === current() || null"
              (click)="jump($event, s.id)"
              >{{ s.text }}</a
            >
          }
        </nav>
      }
    </div>
  `,
  styles: `
    /* The title takes the free space: actions and the guide stay right (decision 329). */
    .spread > h1 {
      flex: 1 1 auto;
    }
    /* Section index in the free space right of the forms (wide screens, tabs with 2+ cards). */
    .toc {
      display: none;
    }
    @media (min-width: 1100px) {
      .st-body.withtoc {
        display: grid;
        grid-template-columns: minmax(0, 820px) 200px;
        gap: 32px;
        align-items: start;
      }
      .toc {
        display: flex;
        flex-direction: column;
        gap: 2px;
        position: sticky;
        top: 84px;
        padding-left: 14px;
        border-left: 1px solid var(--border);
      }
      .toc .kpi {
        margin-bottom: 6px;
      }
      .toc a {
        color: var(--muted);
        font-size: var(--fs-sm);
        padding: 5px 0;
        text-decoration: none;
        line-height: 1.3;
      }
      .toc a:hover {
        color: var(--text);
      }
      .toc a.on {
        color: var(--accent);
        font-weight: 600;
      }
    }
    .panel h2 {
      scroll-margin-top: 84px;
    }
    .tabs button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .tabs button[aria-disabled] {
      color: var(--faint);
      cursor: not-allowed;
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
  private readonly confirm = inject(Confirm);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18n);
  private readonly auth = inject(Auth);
  protected readonly tabs = TABS;
  private readonly query = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('tab'))), {
    initialValue: this.route.snapshot.queryParamMap.get('tab'),
  });
  protected readonly tab = computed<SettingsTab>(() => {
    const q = this.query();
    const t = (TABS as readonly string[]).includes(q ?? '') ? (q as SettingsTab) : 'season';
    return this.off(t) ? 'season' : t;
  });
  protected readonly tabOptions = computed<Choice<SettingsTab>[]>(() =>
    TABS.map((t) => ({
      value: t,
      label: 'settings.tab.' + t,
      disabled: this.off(t),
      title: this.off(t) ? 'settings.leagueOff' : undefined,
      dot: t === this.tab() && this.unsaved(),
      dotLabel: 'settings.unsaved',
    })),
  );
  /** Forms of the open tab with changes not saved yet. */
  private readonly dirty = signal<ReadonlySet<string>>(new Set());
  protected readonly unsaved = computed(() => this.dirty().size > 0);
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  /** The card headings of the open tab (the league tab has its own side column: none). */
  protected readonly toc = signal<{ id: string; text: string }[]>([]);
  /** The section the reader is in (index into `toc`). */
  protected readonly current = signal(0);

  constructor() {
    // Tabs load their data after opening: collect the headings whenever the panel changes.
    let frame = 0;
    const collect = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => this.collect());
    };
    const watch = new MutationObserver(collect);
    const onScroll = () => this.track();
    queueMicrotask(() =>
      watch.observe(this.panel().nativeElement, { childList: true, subtree: true }),
    );
    window.addEventListener('scroll', onScroll, { passive: true });
    inject(DestroyRef).onDestroy(() => {
      watch.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    });

    // Another tab (also by the back button): the old tab's values are gone with it.
    effect(() => {
      this.tab();
      untracked(() => this.dirty.set(new Set()));
    });
  }

  private collect() {
    const root = this.panel().nativeElement;
    const heads = root.querySelector('.lgs')
      ? []
      : [...root.querySelectorAll<HTMLElement>('.card')]
          .filter((c) => !c.parentElement?.closest('.card, dialog'))
          .map((c) => c.querySelector<HTMLElement>('h2'))
          .filter((h): h is HTMLElement => !!h);
    const next = heads.map((h, i) => {
      h.id ||= `st-sec-${this.tab()}-${i}`;
      return { id: h.id, text: (h.textContent ?? '').replace('⚠', '').trim() };
    });
    const old = this.toc();
    if (
      next.length !== old.length ||
      next.some((s, i) => s.id !== old[i].id || s.text !== old[i].text)
    )
      this.toc.set(next);
    this.track();
  }

  /** The last heading above the upper quarter of the window is the current section. */
  private track() {
    const toc = this.toc();
    if (toc.length < 2) return;
    let at = 0;
    toc.forEach((s, i) => {
      const el = document.getElementById(s.id);
      if (el && el.getBoundingClientRect().top < window.innerHeight * 0.25) at = i;
    });
    // At the bottom of the page the last section counts (it may be too short to reach the line).
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4)
      at = toc.length - 1;
    this.current.set(at);
  }

  protected jump(e: Event, id: string) {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Opens tab `t`; false when the admin keeps the unsaved changes of the open tab. */
  protected async open(t: SettingsTab): Promise<boolean> {
    if (t === this.tab()) return true;
    if (this.off(t)) return false;
    if (this.unsaved() && !(await this.confirm.ask(this.i18n.t('settings.unsavedConfirm'))))
      return false;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: t === 'season' ? null : t },
      queryParamsHandling: 'merge',
    });
    return true;
  }

  /** The league tab needs the Dream Team module (switched on in the tab "Dream Team"). */
  protected off(t: SettingsTab): boolean {
    return t === 'league' && !this.auth.config().udt;
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
