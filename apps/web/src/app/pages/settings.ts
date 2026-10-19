import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Icon } from '../core/brand';
import { ShopSettings } from '../components/shop-settings';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import type { Season, SeasonsOverview } from '../core/types';

/** Website settings (admins): seasons, ratings, bets, the Neuro shop and the reset. */
@Component({
  selector: 'app-settings',
  imports: [TPipe, FormsModule, Icon, ShopSettings],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'settings.title' | t }}</h1>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }

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
          <form class="row new" (ngSubmit)="create()">
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

    <form class="card" (ngSubmit)="save()">
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
        @if (saved()) {
          <span class="muted small">{{ 'settings.saved' | t }}</span>
        }
      </div>
    </form>

    <form class="card" (ngSubmit)="saveBetting()">
      <h2>{{ 'bets.settings' | t }}</h2>
      <p class="muted small">{{ 'bets.settingsHint' | t }}</p>
      <div class="row gap">
        <label
          >{{ 'bets.startBalance' | t }}
          <input
            type="number"
            name="startBalance"
            min="10"
            step="10"
            class="narrow"
            [(ngModel)]="startBalance"
          />
        </label>
        <label
          >{{ 'bets.floor' | t }}
          <input type="number" name="floor" min="0" step="10" class="narrow" [(ngModel)]="floor" />
        </label>
      </div>
      <div class="row gap">
        <label
          >{{ 'bets.windowSec' | t }}
          <input
            type="number"
            name="windowSec"
            min="0"
            max="600"
            step="5"
            class="narrow"
            [(ngModel)]="windowSec"
          />
        </label>
      </div>
      <p class="muted small">{{ 'bets.windowSecHint' | t }}</p>
      <label class="row"
        ><input type="checkbox" name="betsDiscord" [(ngModel)]="betsDiscord" />
        {{ 'bets.discordLabel' | t }}</label
      >
      <label class="row"
        ><input type="checkbox" name="botsBet" [(ngModel)]="botsBet" />
        {{ 'bets.botsBetLabel' | t }}</label
      >
      <div class="row gap">
        <label
          >{{ 'bets.botsPerMatch' | t }}
          <input
            type="number"
            name="botsPerMatch"
            min="0"
            max="50"
            class="narrow"
            [(ngModel)]="botsPerMatch"
            [disabled]="!botsBet"
          />
        </label>
      </div>
      <div class="row">
        <button type="submit" class="primary" [disabled]="busy()">{{ 'common.save' | t }}</button>
        @if (savedBetting()) {
          <span class="muted small">{{ 'settings.saved' | t }}</span>
        }
      </div>
    </form>

    <form class="card" (ngSubmit)="saveBotAi()">
      <h2>{{ 'botAi.title' | t }}</h2>
      <p class="muted small">{{ 'botAi.hint' | t }}</p>
      <label
        >{{ 'botAi.level' | t }}
        <select name="botAiLevel" [(ngModel)]="botAiLevel">
          <option [ngValue]="2">{{ 'botAi.level2' | t }}</option>
          <option [ngValue]="1">{{ 'botAi.level1' | t }}</option>
          <option [ngValue]="0">{{ 'botAi.level0' | t }}</option>
        </select>
      </label>
      <p class="muted small">{{ 'botAi.modHint' | t }}</p>
      <div class="row">
        <button type="submit" class="primary" [disabled]="busy()">{{ 'common.save' | t }}</button>
        @if (savedBotAi()) {
          <span class="muted small">{{ 'settings.saved' | t }}</span>
        }
      </div>
    </form>

    <app-shop-settings />

    <section class="card danger-zone">
      <h2>⚠ {{ 'reset.title' | t }}</h2>
      <p>{{ 'reset.what' | t }}</p>
      <p class="muted small">{{ 'reset.keeps' | t }}</p>
      @if (resetDone(); as r) {
        <p class="notice">{{ 'reset.done' | t: { t: r.tournaments, s: r.seasons } }}</p>
      }
      @if (!resetOpen()) {
        <button class="danger" (click)="openReset()">{{ 'reset.open' | t }}</button>
      } @else {
        <div class="reset-box">
          <p class="warn">
            <b>{{ 'reset.warning' | t }}</b>
          </p>
          <label class="row"
            ><input type="checkbox" name="resetOk" [(ngModel)]="resetUnderstood" />
            {{ 'reset.understood' | t }}</label
          >
          <label
            >{{ 'reset.typeWord' | t: { word: resetWord } }}
            <input
              name="resetWord"
              class="word"
              autocomplete="off"
              [(ngModel)]="resetTyped"
              [placeholder]="resetWord"
            />
          </label>
          <div class="row">
            <button
              class="danger solid"
              [disabled]="busy() || !resetUnderstood || resetTyped !== resetWord"
              (click)="reset()"
            >
              {{ 'reset.confirm' | t }}
            </button>
            <button (click)="resetOpen.set(false)">{{ 'common.cancel' | t }}</button>
          </div>
        </div>
      }
    </section>
  `,
  styles: `
    .card {
      max-width: 820px;
    }
    .row.gap {
      gap: 16px;
      align-items: flex-end;
    }
    .danger-zone {
      border: 2px solid var(--danger);
      background: rgba(248, 81, 73, 0.05);
      margin-top: 40px;
    }
    .danger-zone h2 {
      color: var(--danger);
    }
    .reset-box {
      border-top: 1px solid rgba(248, 81, 73, 0.4);
      padding-top: 12px;
    }
    .warn {
      color: var(--danger);
    }
    input.word {
      max-width: 200px;
      display: block;
      margin-top: 4px;
      font-family: ui-monospace, monospace;
    }
    button.danger.solid:not(:disabled) {
      background: var(--danger);
      color: #fff;
      font-weight: 700;
    }
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
    h3 {
      margin: 20px 0 8px;
      font-size: 1rem;
    }
    form.new {
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
    }
    input.narrow {
      width: 120px;
      display: block;
      margin-top: 4px;
    }
    input[type='date'] {
      display: block;
      margin-top: 4px;
    }
  `,
})
export class SettingsPage {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  protected readonly botGames = signal(true);
  protected readonly levelPoints = signal(100);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal('');
  protected readonly o = signal<SeasonsOverview | null>(null);
  protected readonly editing = signal<number | null>(null);
  protected editFrom = '';
  protected editTo = '';
  protected newFrom = '';
  protected startBalance = 1000;
  protected floor = 100;
  protected botsBet = true;
  protected windowSec = 20;
  protected betsDiscord = true;
  protected botsPerMatch = 6;
  protected readonly savedBetting = signal(false);
  protected botAiLevel = 2;
  protected readonly savedBotAi = signal(false);
  /** Website reset: opened, ticked and the word typed before the button works. */
  protected readonly resetWord = 'RESET';
  protected readonly resetOpen = signal(false);
  protected readonly resetDone = signal<{ tournaments: number; seasons: number } | null>(null);
  protected resetUnderstood = false;
  protected resetTyped = '';
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
      this.startBalance = s.betting.startBalance;
      this.floor = s.betting.floor;
      this.botsBet = s.betting.botsBet;
      this.botsPerMatch = s.betting.botsPerMatch;
      this.windowSec = s.betting.windowSec;
      this.betsDiscord = s.betting.discord;
      this.botAiLevel = s.botAi?.level ?? 2;
      this.o.set(o);
      this.saved.set(false);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  private async run(fn: () => Promise<unknown>) {
    this.busy.set(true);
    this.error.set('');
    try {
      await fn();
      this.editing.set(null);
      this.o.set(await this.api.seasons());
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected create() {
    void this.run(async () => {
      await this.api.createSeason(this.newFrom, this.newTo);
      this.newFrom = '';
      this.newTo = '';
    });
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

  protected async saveBetting() {
    this.busy.set(true);
    this.error.set('');
    this.savedBetting.set(false);
    try {
      const s = await this.api.setBettingSettings({
        startBalance: Math.round(Number(this.startBalance)),
        floor: Math.round(Number(this.floor)),
        botsBet: this.botsBet,
        botsPerMatch: Math.round(Number(this.botsPerMatch)),
        windowSec: Math.round(Number(this.windowSec)),
        discord: this.betsDiscord,
      });
      this.startBalance = s.betting.startBalance;
      this.floor = s.betting.floor;
      this.savedBetting.set(true);
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveBotAi() {
    this.busy.set(true);
    this.error.set('');
    this.savedBotAi.set(false);
    try {
      const s = await this.api.setBotAiSettings({ level: Number(this.botAiLevel) });
      this.botAiLevel = s.botAi.level;
      this.savedBotAi.set(true);
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected openReset() {
    this.resetUnderstood = false;
    this.resetTyped = '';
    this.resetDone.set(null);
    this.resetOpen.set(true);
  }

  protected async reset() {
    if (!this.resetUnderstood || this.resetTyped !== this.resetWord) return;
    if (!confirm(this.i18n.t('reset.lastChance'))) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.resetDone.set(await this.api.resetAll(this.resetTyped));
      this.resetOpen.set(false);
      this.o.set(await this.api.seasons());
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async save() {
    this.busy.set(true);
    this.error.set('');
    try {
      const s = await this.api.setRatingSettings({
        botGames: this.botGames(),
        levelPoints: Math.round(Number(this.levelPoints())),
      });
      this.botGames.set(s.rating.botGames);
      this.levelPoints.set(s.rating.levelPoints);
      this.saved.set(true);
      this.o.set(await this.api.seasons());
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }
}

function addDay(d: string): string {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10);
}
