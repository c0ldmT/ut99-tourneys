import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { Icon } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import type { Season, SeasonsOverview } from '../core/types';
import { SETTINGS_STYLES, type SettingsForm } from './settings-shared';

/** Settings tab "Season": the seasons (plan, move, end, delete) and the rating rules. */
@Component({
  selector: 'app-settings-season',
  imports: [FormsModule, Icon, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card">
      <h2>{{ 'season.title' | t }}</h2>
      @if (o(); as o) {
        <p class="state">
          @if (running(); as s) {
            <span class="pill in">{{ 'season.in' | t }}</span>
            {{
              'season.runningText'
                | t: { n: s.number, from: date(s.startDate), to: date(s.endDate) }
            }}
          } @else {
            <span class="pill out">{{ 'season.out' | t }}</span>
            @if (planned(); as p) {
              {{ 'season.plannedText' | t: { n: p.number, from: date(p.startDate) } }}
            } @else {
              {{ 'season.noneText' | t }}
            }
          }
        </p>

        @if (o.seasons.length) {
          <div class="scroll">
            <table class="seasons">
              <thead>
                <tr>
                  <th>{{ 'season.col.season' | t }}</th>
                  <th>{{ 'season.col.from' | t }}</th>
                  <th>{{ 'season.col.to' | t }}</th>
                  <th>{{ 'season.col.status' | t }}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (s of seasonsNewestFirst(); track s.number) {
                  <tr>
                    <td>
                      <b>{{ 'season.label' | t: { n: s.number } }}</b>
                    </td>
                    <td>
                      @if (editing() === s.number && s.status === 'planned') {
                        <input type="date" [min]="o.today" [(ngModel)]="editFrom" name="ef" />
                      } @else {
                        {{ date(s.startDate) }}
                      }
                    </td>
                    <td>
                      @if (editing() === s.number) {
                        <input type="date" [min]="o.today" [(ngModel)]="editTo" name="et" />
                      } @else {
                        {{ date(s.endDate) }}
                      }
                    </td>
                    <td>
                      <span class="pill" [class]="s.status">{{ 'season.' + s.status | t }}</span>
                    </td>
                    <td class="actions">
                      @if (editing() === s.number) {
                        <button class="primary" (click)="saveEdit(s)" [disabled]="busy()">
                          {{ 'common.save' | t }}
                        </button>
                        <button (click)="editing.set(null)">{{ 'common.cancel' | t }}</button>
                      } @else {
                        @if (s.status !== 'ended') {
                          <button (click)="startEdit(s)" [disabled]="busy()">
                            {{ 'season.move' | t }}
                          </button>
                        }
                        @if (s.status === 'running') {
                          <button (click)="end(s)" [disabled]="busy()">
                            {{ 'season.endNow' | t }}
                          </button>
                        }
                        @if (s.number === newest()) {
                          <button
                            class="icon dng"
                            (click)="remove(s)"
                            [disabled]="busy()"
                            [title]="'common.delete' | t"
                            [attr.aria-label]="'common.delete' | t"
                          >
                            <na-icon name="delete" />
                          </button>
                        }
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        @if (!planned()) {
          <h3>{{ 'season.new' | t: { n: newest() + 1 } }}</h3>
          <form class="row new" data-form="season" (ngSubmit)="create()">
            <label
              >{{ 'season.col.from' | t }}
              <input type="date" name="from" [min]="minStart()" [(ngModel)]="newFrom" required />
            </label>
            <label
              >{{ 'season.col.to' | t }}
              <input
                type="date"
                name="to"
                [min]="newFrom || minStart()"
                [(ngModel)]="newTo"
                required
              />
            </label>
            <button type="submit" class="primary" [disabled]="busy() || !newFrom || !newTo">
              {{ (newFrom === o.today ? 'season.startNow' : 'season.plan') | t }}
            </button>
          </form>
        }
        <p class="muted small">{{ 'season.hint' | t: { tz: o.timeZone } }}</p>
      }
    </section>

    <form class="card" data-form="rating" (ngSubmit)="save()">
      <h2>{{ 'settings.rating' | t }}</h2>
      <p class="muted small">{{ 'settings.ratingHint' | t }}</p>
      <label class="row"
        ><input
          type="checkbox"
          name="botGames"
          [ngModel]="botGames()"
          (ngModelChange)="botGames.set($event)"
        />
        {{ 'settings.botGames' | t }}</label
      >
      <p class="muted small">{{ 'settings.botGamesHint' | t }}</p>
      <label
        >{{ 'settings.levelPoints' | t }}
        <input
          type="number"
          name="levelPoints"
          min="0"
          max="300"
          step="10"
          class="narrow"
          [ngModel]="levelPoints()"
          (ngModelChange)="levelPoints.set($event)"
        />
      </label>
      <p class="muted small">{{ 'settings.levelPointsHint' | t }}</p>
      <div class="row">
        <button type="submit" class="primary" [disabled]="busy()">{{ 'common.save' | t }}</button>
      </div>
    </form>
  `,
  styles: [
    SETTINGS_STYLES,
    `
      .state {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .pill {
        font-size: 0.8rem;
        padding: 2px 10px;
        border-radius: 999px;
        border: 1px solid var(--border);
        color: var(--muted);
        white-space: nowrap;
      }
      .pill.in,
      .pill.running {
        color: var(--live);
        border-color: var(--live);
      }
      .pill.out {
        color: var(--muted);
      }
      .pill.planned {
        color: var(--info);
        border-color: var(--info);
      }
      .scroll {
        overflow-x: auto;
      }
      table.seasons {
        width: 100%;
        white-space: nowrap;
      }
      .actions {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
      }
      form.new {
        align-items: flex-end;
        gap: 12px;
        flex-wrap: wrap;
      }
    `,
  ],
})
export class SettingsSeason {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  /** A form was saved (the page drops its "unsaved" mark). */
  readonly saved = output<SettingsForm>();
  protected readonly botGames = signal(true);
  protected readonly levelPoints = signal(100);
  protected readonly busy = signal(false);
  protected readonly o = signal<SeasonsOverview | null>(null);
  protected readonly editing = signal<number | null>(null);
  protected editFrom = '';
  protected editTo = '';
  protected newFrom = '';
  protected newTo = '';

  protected readonly running = computed(
    () => this.o()?.seasons.find((s) => s.status === 'running') ?? null,
  );
  protected readonly planned = computed(
    () => this.o()?.seasons.find((s) => s.status === 'planned') ?? null,
  );
  protected readonly newest = computed(() => this.o()?.seasons.at(-1)?.number ?? 0);
  protected readonly seasonsNewestFirst = computed(() => [...(this.o()?.seasons ?? [])].reverse());
  /** A new season starts after the last one and not in the past. */
  protected readonly minStart = computed(() => {
    const o = this.o();
    if (!o) return '';
    const last = o.seasons.at(-1);
    const afterLast = last ? addDay(last.endDate) : '';
    return afterLast > o.today ? afterLast : o.today;
  });

  constructor() {
    void this.load();
  }

  protected date(d: string): string {
    return this.i18n.day(d);
  }

  private async load() {
    try {
      const [s, o] = await Promise.all([this.api.settings(), this.api.seasons()]);
      this.botGames.set(s.rating.botGames);
      this.levelPoints.set(s.rating.levelPoints);
      this.o.set(o);
    } catch {
      // the toast shows the error
    }
  }

  private async run(fn: () => Promise<unknown>): Promise<boolean> {
    this.busy.set(true);
    try {
      await fn();
      this.editing.set(null);
      this.o.set(await this.api.seasons());
      return true;
    } catch {
      // the toast shows the error
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async create() {
    const ok = await this.run(() => this.api.createSeason(this.newFrom, this.newTo));
    if (!ok) return;
    this.newFrom = '';
    this.newTo = '';
    this.saved.emit('season');
  }

  protected startEdit(s: Season) {
    this.editFrom = s.startDate;
    this.editTo = s.endDate;
    this.editing.set(s.number);
  }

  protected saveEdit(s: Season) {
    const body =
      s.status === 'planned'
        ? { startDate: this.editFrom, endDate: this.editTo }
        : { endDate: this.editTo };
    void this.run(() => this.api.updateSeason(s.number, body));
  }

  protected end(s: Season) {
    if (!confirm(this.i18n.t('season.endConfirm', { n: s.number }))) return;
    void this.run(() => this.api.endSeason(s.number));
  }

  protected remove(s: Season) {
    if (!confirm(this.i18n.t('season.deleteConfirm', { n: s.number }))) return;
    void this.run(() => this.api.deleteSeason(s.number));
  }

  protected async save() {
    this.busy.set(true);
    try {
      const s = await this.api.setRatingSettings({
        botGames: this.botGames(),
        levelPoints: Math.round(Number(this.levelPoints())),
      });
      this.botGames.set(s.rating.botGames);
      this.levelPoints.set(s.rating.levelPoints);
      this.o.set(await this.api.seasons());
      this.saved.emit('rating');
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}

function addDay(d: string): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10);
}
