import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { Icon } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import type { SeriesView } from '../core/types';

/** Tournament series: weekly templates that create the next tournament by themselves. */
@Component({
  selector: 'app-series',
  imports: [RouterLink, TPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="spread">
      <h1>{{ 'series.title' | t }}</h1>
      <a class="btn primary" routerLink="/new" [queryParams]="{ mode: 'series' }">
        <na-icon name="plus" [size]="16" /> {{ 'series.new' | t }}
      </a>
    </div>
    <p class="muted small intro">{{ 'series.intro' | t }}</p>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }

    <div class="card tablepanel">
      @if (!list().length) {
        <p class="muted">{{ 'series.empty' | t }}</p>
      } @else {
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th>{{ 'series.name' | t }}</th>
                <th>{{ 'series.rhythm' | t }}</th>
                <th>{{ 'series.next' | t }}</th>
                <th class="acts">
                  <span class="sr">{{ 'bots.actions' | t }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              @for (s of list(); track s.id) {
                <tr [class.paused]="!s.active">
                  <td>
                    <div class="nm">
                      {{ s.name }}
                      @if (!s.active) {
                        <span class="badge">{{ 'series.paused' | t }}</span>
                      }
                    </div>
                    <div class="muted small">
                      {{ 'series.created' | t: { n: s.tournaments } }} · {{ mode(s) }}
                    </div>
                  </td>
                  <td>
                    {{ rhythm(s) }}
                    <div class="muted small">{{ 'series.leadShort' | t: { n: s.leadDays } }}</div>
                  </td>
                  <td>
                    @if (s.active) {
                      <b>{{ s.nextName }}</b>
                      <div class="muted small">
                        {{ date(s.nextStart) }} ·
                        {{ 'series.createAt' | t: { when: date(s.nextCreateAt) } }}
                      </div>
                    } @else {
                      <span class="muted">–</span>
                    }
                  </td>
                  <td class="acts">
                    <div class="iconbtns">
                      <button
                        class="icon"
                        (click)="toggle(s)"
                        [disabled]="busy()"
                        [title]="(s.active ? 'series.pause' : 'series.resume') | t"
                        [attr.aria-label]="(s.active ? 'series.pause' : 'series.resume') | t"
                      >
                        <na-icon [name]="s.active ? 'pause' : 'play'" />
                      </button>
                      <button
                        class="icon"
                        (click)="runNow(s)"
                        [disabled]="busy()"
                        [title]="'series.runNow' | t"
                        [attr.aria-label]="'series.runNow' | t"
                      >
                        <na-icon name="copyToNew" />
                      </button>
                      <a
                        class="btn icon"
                        [routerLink]="['/series', s.id, 'edit']"
                        [title]="'common.edit' | t"
                        [attr.aria-label]="('common.edit' | t) + ' ' + s.name"
                      >
                        <na-icon name="edit" />
                      </a>
                      <button
                        class="icon dng"
                        (click)="remove(s)"
                        [disabled]="busy()"
                        [title]="'common.delete' | t"
                        [attr.aria-label]="('common.delete' | t) + ' ' + s.name"
                      >
                        <na-icon name="delete" />
                      </button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <p class="muted small hint">
        {{ 'series.howTo' | t }}
      </p>
    </div>
  `,
  styles: `
    .intro {
      margin-top: 0;
    }
    .nm {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
    }
    tr.paused td {
      opacity: 0.65;
    }
    th.acts,
    td.acts {
      width: 1%;
      text-align: right;
      white-space: nowrap;
    }
    .hint {
      margin: 12px 0 8px;
    }
    .scroll {
      overflow-x: auto;
    }
  `,
})
export class SeriesPage {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  protected readonly list = signal<SeriesView[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly weekdays = computed(() => {
    const loc = this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB';
    // 2026-10-19 is a Monday.
    return [1, 2, 3, 4, 5, 6, 7].map((n) => ({
      n,
      name: new Date(Date.UTC(2026, 9, 18 + n)).toLocaleDateString(loc, {
        weekday: 'long',
        timeZone: 'UTC',
      }),
    }));
  });

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      this.list.set(await this.api.series());
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  private async run(fn: () => Promise<unknown>) {
    this.busy.set(true);
    this.error.set('');
    try {
      await fn();
      await this.load();
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected toggle(s: SeriesView) {
    void this.run(() => this.api.updateSeries(s.id, { active: !s.active }));
  }

  protected runNow(s: SeriesView) {
    if (!confirm(this.i18n.t('series.runNowConfirm', { name: s.nextName }))) return;
    void this.run(() => this.api.runSeries(s.id));
  }

  protected remove(s: SeriesView) {
    if (!confirm(this.i18n.t('series.deleteConfirm', { name: s.name }))) return;
    void this.run(() => this.api.deleteSeries(s.id));
  }

  protected rhythm(s: SeriesView): string {
    const day = this.weekdays().find((w) => w.n === s.weekday)?.name ?? '';
    return this.i18n.t(s.everyWeeks > 1 ? 'series.rhythmN' : 'series.rhythm1', {
      day,
      time: s.time,
      n: s.everyWeeks,
    });
  }

  protected mode(s: SeriesView): string {
    const st = s.settings;
    const mode =
      st.game.adapter === 'ut99-mh'
        ? 'Monster Hunt'
        : st.teamSize > 1
          ? this.i18n.t('team.mode', { k: st.teamSize })
          : '1v1';
    return `${mode} · ${this.i18n.t('format.' + st.format)} · ${st.size}`;
  }

  protected date(iso: string): string {
    return this.i18n.date(iso);
  }
}
