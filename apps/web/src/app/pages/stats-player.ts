import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  DestroyRef,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Avatar, NameTag, Looks } from '../core/looks';
import { PageTitle } from '../core/page-title';
import { RouterLink } from '@angular/router';
import { Api, ApiError, errorText } from '../core/api';
import { Toasts } from '../core/toast';
import { I18n, TPipe } from '../core/i18n';
import { NeuroPipe } from '../core/neuro';
import { RatingChart } from '../components/rating-chart';
import { Coin } from '../core/brand';
import { raceTime } from '../core/race';
import { percent, playerLink, playTime, recordValue } from '../core/stats-format';
import { defaultScope, parseScope, startedSeasons } from '../core/season';
import type {
  PlayerRatings,
  SeasonsOverview,
  StatMode,
  StatScope,
  StatsPlayerDetail,
  StatsPlayerRow,
  UserBets,
} from '../core/types';

@Component({
  selector: 'app-stats-player',
  imports: [TPipe, RouterLink, DatePipe, NeuroPipe, Coin, RatingChart, Avatar, NameTag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="top">
      <a routerLink="/stats">← {{ 'stats.title' | t }}</a>
      <label class="small"
        >{{ 'season.scope' | t }}
        <select [value]="scope()" (change)="setScope($any($event.target).value)">
          @for (s of seasons(); track s.number) {
            <option [value]="s.number">
              {{ 'season.label' | t: { n: s.number } }}
              @if (s.status === 'running') {
                ({{ 'season.running' | t }})
              }
            </option>
          }
          <option value="lifetime">{{ 'season.lifetime' | t }}</option>
        </select>
      </label>
    </div>
    @if (d(); as d) {
      <div class="hero" [class]="banner() ? 'hero bn-' + banner() : 'hero'">
        @if (userId(); as uid) {
          <na-avatar [name]="d.row.name" [id]="uid" [size]="64" />
        }
        <div>
          <h1>
            <na-name [name]="d.row.name" [id]="userId()" [withTitle]="true" [badgeSize]="22" />
            @if (d.row.bot) {
              <span class="badge bot">{{ 'stats.bot' | t }}</span>
            }
            @if (botId(); as id) {
              <a class="profile-link small" [routerLink]="['/bots', id]">{{
                'bots.profileLink' | t
              }}</a>
            }
          </h1>
        </div>
      </div>
      <div class="tiles">
        <div class="card tile">
          <div class="value">{{ d.row.titles }}</div>
          <div class="muted small">{{ 'stats.col.titles' | t }}</div>
        </div>
        <div class="card tile">
          <div class="value">{{ d.row.tournaments }}</div>
          <div class="muted small">{{ 'stats.col.tournaments' | t }}</div>
        </div>
        <div class="card tile">
          <div class="value">{{ d.row.matchesWon }}–{{ d.row.matches - d.row.matchesWon }}</div>
          <div class="muted small">{{ 'stats.col.matches' | t }}</div>
        </div>
        <div class="card tile">
          <div class="value">{{ d.row.frags }}</div>
          <div class="muted small">{{ 'stats.col.frags' | t }}</div>
        </div>
        <div class="card tile">
          <div class="value">{{ d.row.kd.toFixed(2) }}</div>
          <div class="muted small">{{ 'stats.col.kd' | t }}</div>
        </div>
        <div class="card tile">
          <div class="value">{{ time(d.row.timeSec) }}</div>
          <div class="muted small">{{ 'stats.col.time' | t }}</div>
        </div>
      </div>

      @if (scope() !== 'lifetime' && ratingModes().length) {
        <h2>{{ 'rating.title' | t }}</h2>
        <div class="tiles">
          @for (m of ratingModes(); track m.mode) {
            <div class="card tile">
              <div class="value">
                {{ m.r.rating }}
                @if (m.r.provisional) {
                  <span class="small muted">({{ 'rating.provisional' | t }})</span>
                }
              </div>
              <div class="muted small">
                {{ m.label | t }} · {{ m.r.wins }}–{{ m.r.games - m.r.wins }}
              </div>
            </div>
          }
        </div>
        @if (chartPoints().length) {
          <div class="card chart">
            <div class="spread">
              <h3>{{ 'rating.chart' | t }}</h3>
              @if (ratingModes().length > 1) {
                <div class="tabs mini" role="tablist">
                  @for (m of ratingModes(); track m.mode) {
                    <button
                      type="button"
                      role="tab"
                      [class.active]="chartMode() === m.mode"
                      [attr.aria-selected]="chartMode() === m.mode"
                      (click)="pickMode.set(m.mode)"
                    >
                      {{ m.label | t }}
                    </button>
                  }
                </div>
              }
            </div>
            <app-rating-chart
              [points]="chartPoints()"
              [label]="'rating.chart' | t"
              [locale]="i18n.lang() === 'de' ? 'de-DE' : 'en-GB'"
            />
            <p class="muted small">{{ 'rating.chartHint' | t }}</p>
          </div>
        }
        @if (ratingRecent().length) {
          <div class="card scroll">
            <table class="stats">
              <tbody>
                @for (g of ratingRecent(); track g.tournamentId + g.matchId + g.game) {
                  <tr>
                    <td class="muted small">{{ g.at | date: 'short' }}</td>
                    <td>
                      <a [routerLink]="['/t', g.tournamentId]">{{
                        g.tournamentName ?? g.tournamentId
                      }}</a>
                      <span class="muted small match-id">{{ g.matchId }} G{{ g.game }}</span>
                      <span class="muted small match-id">{{ modeLabel(g.mode) | t }}</span>
                    </td>
                    <td class="num" [class.win]="g.delta > 0" [class.loss]="g.delta < 0">
                      {{ signed(g.delta) }}
                    </td>
                    <td class="num">{{ g.after }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }

      <h2>{{ 'stats.byMode' | t }}</h2>
      <div class="card scroll">
        <table class="stats">
          <thead>
            <tr>
              <th>{{ 'stats.mode' | t }}</th>
              <th class="num">{{ 'stats.col.tournaments' | t }}</th>
              <th class="num">{{ 'stats.col.titles' | t }}</th>
              <th class="num">{{ 'stats.col.matches' | t }}</th>
              <th class="num">{{ 'stats.col.games' | t }}</th>
              <th class="num">{{ 'stats.col.frags' | t }}</th>
              <th class="num">{{ 'stats.col.kd' | t }}</th>
              <th class="num">{{ 'stats.col.efficiency' | t }}</th>
              <th class="num">{{ 'stats.col.headshots' | t }}</th>
              <th class="num">{{ 'stats.col.bestSpree' | t }}</th>
              <th class="num">{{ 'stats.col.multiKills' | t }}</th>
              <th class="num">{{ 'stats.col.runs' | t }}</th>
              <th class="num">{{ 'stats.col.monsters' | t }}</th>
            </tr>
          </thead>
          <tbody>
            @for (m of modes(); track m.mode) {
              <tr>
                <td>{{ m.label | t }}</td>
                <td class="num">{{ m.r.tournaments }}</td>
                <td class="num">{{ m.r.titles }}</td>
                <td class="num">{{ m.r.matchesWon }}–{{ m.r.matches - m.r.matchesWon }}</td>
                <td class="num">{{ m.r.gamesWon }}–{{ m.r.games - m.r.gamesWon }}</td>
                <td class="num">{{ m.r.frags }}</td>
                <td class="num">{{ m.r.kd.toFixed(2) }}</td>
                <td class="num">{{ pct(m.r.efficiency) }}</td>
                <td class="num">{{ m.r.headshots }}</td>
                <td class="num">{{ m.r.bestSpree }}</td>
                <td class="num">{{ m.r.multiKills }}</td>
                <td class="num">{{ m.r.runsFinished }}/{{ m.r.runs }}</td>
                <td class="num">{{ m.r.monsters }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <div class="two">
        <div>
          <h2>{{ 'stats.weapons' | t }}</h2>
          <div class="card">
            @if (d.weapons.length === 0) {
              <p class="muted">{{ 'stats.noWeapons' | t }}</p>
            }
            @for (w of d.weapons; track w.name) {
              <div class="bar-row">
                <span class="w-name">{{ w.name }}</span>
                <span class="bar"
                  ><span [style.width.%]="(w.kills / maxWeapon()) * 100"></span
                ></span>
                <span class="num">{{ w.kills }}</span>
              </div>
            }
          </div>
        </div>
        <div>
          <h2>{{ 'stats.recordsHeld' | t }}</h2>
          <div class="card">
            @if (scope() === 'lifetime') {
              <p class="muted">{{ 'stats.recordsSeasonOnly' | t }}</p>
            } @else if (d.records.length === 0 && d.mapRecords.length === 0) {
              <p class="muted">{{ 'stats.noRecords' | t }}</p>
            }
            @for (r of d.records; track r.id) {
              <div class="rec-row">
                <span>{{ 'rec.' + r.id | t }}</span>
                <strong>{{ value(r) }}</strong>
              </div>
            }
            @for (m of d.mapRecords; track m.map) {
              <div class="rec-row">
                <span>{{ 'stats.mapRecord' | t: { map: m.map } }}</span>
                <strong>{{ race(m.finalMs) }}</strong>
              </div>
            }
          </div>
        </div>
      </div>

      @if (d.mapBests.length) {
        <h2>{{ 'stats.mapBests' | t }}</h2>
        <div class="card scroll">
          <table class="stats">
            <thead>
              <tr>
                <th>{{ 'stats.col.map' | t }}</th>
                <th class="num">{{ 'stats.col.final' | t }}</th>
                <th class="num">{{ 'stats.col.deaths' | t }}</th>
                <th>{{ 'stats.col.team' | t }}</th>
                <th>{{ 'stats.col.tournament' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (m of d.mapBests; track m.map) {
                <tr>
                  <td>{{ m.map }}</td>
                  <td class="num">{{ race(m.finalMs) }}</td>
                  <td class="num">{{ m.deaths }}</td>
                  <td>{{ m.team }}</td>
                  <td>
                    {{ m.tournamentName }}
                    <span class="muted small">{{ m.at | date: 'mediumDate' }}</span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      <h2>{{ 'stats.recent' | t }}</h2>
      <div class="card scroll">
        @if (d.recent.length === 0) {
          <p class="muted">{{ 'stats.empty' | t }}</p>
        } @else {
          <table class="stats">
            <tbody>
              @for (m of d.recent; track m.tournamentId + m.matchId) {
                <tr>
                  <td class="muted small">{{ m.at | date: 'short' }}</td>
                  <td>
                    <a [routerLink]="['/t', m.tournamentId]">{{ m.tournamentName }}</a>
                    <span class="muted small match-id">{{ m.matchId }}</span>
                  </td>
                  <td>{{ m.team }} – {{ m.opponent }}</td>
                  <td [class.win]="m.won" [class.loss]="!m.won">
                    {{ (m.won ? 'stats.won' : 'stats.lost') | t }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
    }
    @if (missing()) {
      <p class="card muted">{{ 'stats.playerMissing' | t }}</p>
    }
    @if (neuro(); as n) {
      @if (!d() && n.name) {
        <h1>{{ n.name }}</h1>
        <p class="muted">{{ 'stats.noGamesYet' | t }}</p>
      }
      @if (n.wallet && n.season) {
        <h2>{{ 'bets.profileTitle' | t: { n: n.season } }}</h2>
        <div class="tiles">
          <div class="card tile">
            <div class="value neuro">
              <na-coin [size]="22" /> {{ n.wallet.balance | neuro: false }}
            </div>
            <div class="muted small">{{ 'bets.balance' | t }}</div>
          </div>
          <div class="card tile">
            <div class="value">{{ n.wallet.won }}–{{ n.wallet.lost }}</div>
            <div class="muted small">{{ 'bets.wonLost' | t }}</div>
          </div>
          <div class="card tile">
            <div class="value">{{ n.wallet.peak | neuro }}</div>
            <div class="muted small">{{ 'bets.col.peak' | t }}</div>
          </div>
          <div class="card tile">
            <div class="value">{{ n.wallet.bestWin | neuro }}</div>
            <div class="muted small">{{ 'bets.rec.bestWin' | t }}</div>
          </div>
          @if (n.wallet.bailouts) {
            <div class="card tile">
              <div class="value">{{ n.wallet.bailouts }}</div>
              <div class="muted small">{{ 'bets.col.bailouts' | t }}</div>
            </div>
          }
        </div>
        @if (n.recent.length) {
          <div class="card table-wrap">
            <table class="bets">
              <tbody>
                @for (b of n.recent; track b.tournamentId + b.matchId) {
                  <tr>
                    <td>
                      <a [routerLink]="['/t', b.tournamentId]">{{ b.tournamentName }}</a>
                      <span class="muted small"> · {{ b.matchId }}</span>
                    </td>
                    <td>{{ b.pick }}</td>
                    <td class="num">{{ b.amount | neuro }}</td>
                    <td class="num" [class]="b.status">
                      @switch (b.status) {
                        @case ('won') {
                          +{{ b.payout - b.amount | neuro }}
                        }
                        @case ('lost') {
                          −{{ b.amount | neuro }}
                        }
                        @case ('refunded') {
                          {{ 'bets.status.refunded' | t }}
                        }
                        @default {
                          {{ 'bets.status.open' | t }}
                        }
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    }
  `,
  styles: `
    .table-wrap {
      overflow-x: auto;
    }
    .value.neuro {
      color: var(--neuro-text);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    table.bets td.won {
      color: var(--live);
    }
    table.bets td.lost {
      color: var(--danger);
    }
    table.bets .num {
      text-align: right;
      white-space: nowrap;
    }
    .hero {
      display: flex;
      align-items: center;
      gap: 18px;
      padding: 18px 0;
      margin-bottom: 8px;
      border-radius: var(--radius);
    }
    .hero[class*='bn-'] {
      padding: 26px 22px;
      border: 1px solid var(--border);
    }
    .hero h1 {
      margin: 0;
    }
    .profile-link {
      margin-left: 10px;
      font-weight: 400;
    }
    .top {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
      margin: 8px 0 12px;
    }
    .badge {
      font-size: 0.8rem;
      padding: 1px 8px;
      border-radius: 8px;
      border: 1px solid var(--border);
      color: var(--muted);
      vertical-align: middle;
    }
    .chart h3 {
      margin: 0;
    }
    .chart .spread {
      margin-bottom: 8px;
    }
    .tabs.mini {
      margin: 0;
      border: 0;
    }
    .tabs.mini button {
      min-height: 32px;
      padding: 4px 10px;
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
      gap: 12px;
    }
    .tile .value {
      font-family: var(--font-display);
      font-size: 1.9rem;
      line-height: 1.1;
      font-weight: 800;
      color: var(--accent);
    }
    .scroll {
      overflow-x: auto;
    }
    .scroll table.stats th:first-child,
    .scroll table.stats td:first-child {
      position: sticky;
      left: 0;
      background: var(--panel);
      box-shadow: inset -1px 0 0 var(--border);
    }
    table.stats {
      width: 100%;
      white-space: nowrap;
    }
    .num {
      text-align: right;
    }
    .two {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
    }
    .bar-row {
      display: grid;
      grid-template-columns: 9rem 1fr 3rem;
      gap: 8px;
      align-items: center;
      margin: 4px 0;
    }
    .w-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bar {
      background: var(--panel-2);
      border-radius: 4px;
      height: 10px;
      overflow: hidden;
    }
    .bar span {
      display: block;
      height: 100%;
      background: var(--accent);
    }
    .rec-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 4px 0;
      border-bottom: 1px solid var(--border);
    }
    .rec-row:last-child {
      border-bottom: none;
    }
    .match-id {
      margin-left: 6px;
    }
    .win {
      color: var(--live);
    }
    .loss {
      color: var(--danger);
    }
  `,
})
export class StatsPlayerPage {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  /** Only the newest load may set the page (season or route changed meanwhile). */
  private loadSeq = 0;
  readonly key = input.required<string>();
  private readonly looks = inject(Looks);
  /** The website user of the page (players only). */
  protected readonly userId = computed(() => {
    const k = this.key();
    return k.startsWith('u:') ? k.slice(2) : null;
  });
  protected readonly banner = computed(() => {
    const id = this.userId();
    return id ? this.looks.of(id)?.banner : undefined;
  });
  /** ?season=N or lifetime (from the statistics page). */
  readonly season = input<string | undefined>(undefined);
  protected readonly overview = signal<SeasonsOverview | null>(null);
  protected readonly scope = signal<StatScope>('lifetime');
  protected readonly seasons = computed(() => startedSeasons(this.overview()));
  protected readonly d = signal<StatsPlayerDetail | null>(null);
  /** Neither games in this scope nor a website user: nothing to show. */
  protected readonly missing = signal(false);
  protected readonly ratings = signal<PlayerRatings | null>(null);
  /** A bot of the control center: link to its profile. */
  protected readonly botId = signal<string | null>(null);
  /** Players: Neuro of the season (betting), visible to everybody. */
  protected readonly neuro = signal<UserBets | null>(null);

  protected readonly ratingModes = computed(() => {
    const r = this.ratings();
    if (!r) return [];
    return (['dm', 'tdm', 'mh'] as const)
      .filter((m) => r.modes[m])
      .map((m) => ({ mode: m, label: this.modeLabel(m), r: r.modes[m]! }));
  });
  protected readonly i18n = inject(I18n);
  protected readonly pickMode = signal<StatMode | null>(null);
  /** The chart's mode: picked, else the one with the most games. */
  protected readonly chartMode = computed<StatMode | null>(() => {
    const modes = this.ratingModes();
    const p = this.pickMode();
    if (p && modes.some((m) => m.mode === p)) return p;
    return [...modes].sort((a, b) => b.r.games - a.r.games)[0]?.mode ?? null;
  });
  protected readonly chartPoints = computed(() =>
    (this.ratings()?.recent ?? []).filter((g) => g.mode === this.chartMode()),
  );
  /** The last rated games, newest first. */
  protected readonly ratingRecent = computed(() =>
    [...(this.ratings()?.recent ?? [])].reverse().slice(0, 15),
  );

  protected modeLabel(m: StatMode): string {
    return { dm: 'stats.modeDm', tdm: 'stats.modeTdm', mh: 'stats.modeMh' }[m];
  }

  protected signed(n: number): string {
    return n > 0 ? `+${n}` : String(n);
  }

  protected readonly modes = computed(() => {
    const d = this.d();
    if (!d) return [];
    const labels: Record<StatMode, string> = {
      dm: 'stats.modeDm',
      tdm: 'stats.modeTdm',
      mh: 'stats.modeMh',
    };
    return (['dm', 'tdm', 'mh'] as const)
      .filter((m) => d.byMode[m])
      .map((m) => ({ mode: m, label: labels[m], r: d.byMode[m] as StatsPlayerRow }));
  });
  protected readonly maxWeapon = computed(() =>
    Math.max(1, ...(this.d()?.weapons.map((w) => w.kills) ?? [1])),
  );

  private readonly title = inject(PageTitle);

  constructor() {
    effect(() => this.title.set(this.d()?.row.name ?? this.neuro()?.name));
    inject(DestroyRef).onDestroy(() => this.title.set(null));
    effect(() => {
      const key = this.key();
      const season = this.season();
      // Only the route starts a load (init reads signals that it sets itself).
      untracked(() => void this.init(key, season));
    });
    effect(() => {
      const key = this.key();
      this.botId.set(null);
      // Bots of the server's ini have no profile: the request just fails.
      if (key.startsWith('b:'))
        this.api.botProfile(key.slice(2), true).then(
          (b) => this.botId.set(b.id),
          () => undefined,
        );
    });
  }

  private async init(key: string, season: string | undefined) {
    try {
      const o = this.overview() ?? (await this.api.seasons());
      this.overview.set(o);
      this.scope.set(season ? parseScope(season) : defaultScope(o));
      await this.load(key);
    } catch {
      // the toast shows the error
    }
  }

  protected setScope(v: string) {
    this.scope.set(parseScope(v));
    void this.load(this.key());
  }

  protected link = playerLink;
  protected value = recordValue;
  protected pct = percent;
  protected time = playTime;
  protected race = (ms: number) => raceTime(ms);

  private async load(key: string) {
    const scope = this.scope();
    if (scope === 'lifetime') this.ratings.set(null);
    else
      this.api.playerRatings(key, scope, true).then(
        (r) => this.ratings.set(r),
        () => this.ratings.set(null),
      );
    const run = ++this.loadSeq;
    this.neuro.set(null);
    this.missing.set(false);
    const bets = key.startsWith('u:')
      ? this.api.userBets(key.slice(2), scope === 'lifetime' ? undefined : scope, true).then(
          (n) => {
            if (run === this.loadSeq) this.neuro.set(n);
          },
          () => undefined,
        )
      : Promise.resolve();
    // No games in this scope is normal (a user with Neuro only, another season): no toast for
    // "not found", but for every other error.
    let d: StatsPlayerDetail | null = null;
    try {
      d = await this.api.statsPlayer(key, scope, true);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) this.toasts.error(errorText(e));
    }
    await bets;
    if (run !== this.loadSeq) return;
    this.d.set(d);
    if (!d && !this.neuro()?.name) this.missing.set(true);
  }
}
