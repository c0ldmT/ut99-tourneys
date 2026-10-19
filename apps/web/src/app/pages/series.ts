import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { Icon } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import type { SeriesFields, SeriesView } from '../core/types';

interface Draft extends SeriesFields {
  id: string | null;
  fromTournament: string;
  fromName: string;
}

/** Tournament series: weekly templates that create the next tournament by themselves. */
@Component({
  selector: 'app-series',
  imports: [FormsModule, RouterLink, TPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'series.title' | t }}</h1>
    <p class="muted small intro">{{ 'series.intro' | t }}</p>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }

    @if (draft(); as d) {
      <form class="card editor" (ngSubmit)="save(d)">
        <h2>{{ (d.id ? 'series.edit' : 'series.new') | t }}</h2>
        @if (!d.id) {
          <p class="muted small">{{ 'series.from' | t: { name: d.fromName } }}</p>
        }
        <div class="fields">
          <div class="field wide">
            <label for="sn">{{ 'series.name' | t }}</label>
            <input id="sn" name="name" [(ngModel)]="d.name" maxlength="90" required />
            <p class="muted small">{{ 'series.nameHint' | t }}</p>
          </div>
          <div class="field">
            <label for="sw">{{ 'series.weekday' | t }}</label>
            <select id="sw" name="wd" [(ngModel)]="d.weekday">
              @for (w of weekdays(); track w.n) {
                <option [ngValue]="w.n">{{ w.name }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label for="st">{{ 'series.time' | t }}</label>
            <input id="st" name="time" type="time" [(ngModel)]="d.time" required />
          </div>
          <div class="field">
            <label for="se">{{ 'series.every' | t }}</label>
            <select id="se" name="every" [(ngModel)]="d.everyWeeks">
              @for (n of [1, 2, 3, 4]; track n) {
                <option [ngValue]="n">
                  {{ n === 1 ? ('series.everyWeek' | t) : ('series.everyN' | t: { n }) }}
                </option>
              }
            </select>
          </div>
          <div class="field">
            <label for="sl">{{ 'series.lead' | t }}</label>
            <input id="sl" name="lead" type="number" min="0" max="28" [(ngModel)]="d.leadDays" />
          </div>
        </div>
        <p class="muted small">{{ 'series.leadHint' | t }}</p>
        <div class="row">
          <button type="submit" class="primary" [disabled]="busy() || !d.name.trim()">
            {{ 'common.save' | t }}
          </button>
          <button type="button" (click)="draft.set(null)">{{ 'common.cancel' | t }}</button>
        </div>
      </form>
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
                      <button
                        class="icon"
                        (click)="edit(s)"
                        [title]="'common.edit' | t"
                        [attr.aria-label]="('common.edit' | t) + ' ' + s.name"
                      >
                        <na-icon name="edit" />
                      </button>
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
        {{ 'series.howTo' | t }} <a routerLink="/">{{ 'nav.tournaments' | t }}</a>
      </p>
    </div>
  `,
  styles: `
    .intro {
      margin-top: 0;
    }
    .editor .wide {
      grid-column: 1 / -1;
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
  /** ?from=<tournament id>: open the form for a new series from that tournament. */
  readonly from = input<string | undefined>(undefined);

  protected readonly list = signal<SeriesView[]>([]);
  protected readonly draft = signal<Draft | null>(null);
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
    void this.load().then(() => this.openFrom());
  }

  private async load() {
    try {
      this.list.set(await this.api.series());
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  /** Prefills a new series from the tournament given in the address. */
  private async openFrom() {
    const id = this.from();
    if (!id) return;
    try {
      const t = await this.api.tournament(id);
      const at = t.scheduledAt ? new Date(t.scheduledAt) : null;
      const weekday = at ? ((at.getDay() + 6) % 7) + 1 : 5;
      const time = at
        ? `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
        : '20:00';
      this.draft.set({
        id: null,
        fromTournament: t.id,
        fromName: t.name,
        name: `${t.name.replace(/\s*#?\d+$/, '')} #{n}`,
        weekday,
        time,
        everyWeeks: 1,
        leadDays: 7,
      });
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  protected edit(s: SeriesView) {
    this.draft.set({
      id: s.id,
      fromTournament: '',
      fromName: '',
      name: s.name,
      weekday: s.weekday,
      time: s.time,
      everyWeeks: s.everyWeeks,
      leadDays: s.leadDays,
    });
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

  protected save(d: Draft) {
    const body = {
      name: d.name.trim(),
      weekday: Number(d.weekday),
      time: d.time,
      everyWeeks: Number(d.everyWeeks),
      leadDays: Math.max(0, Math.round(Number(d.leadDays) || 0)),
    };
    void this.run(async () => {
      if (d.id) await this.api.updateSeries(d.id, body);
      else await this.api.createSeries({ ...body, fromTournament: d.fromTournament });
      this.draft.set(null);
    });
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
