import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { Auth } from '../core/auth';
import { BetBoardView } from '../components/bet-board';
import { TPipe } from '../core/i18n';
import { raceTime } from '../core/race';
import { defaultScope, parseScope, startedSeasons } from '../core/season';
import { percent, playerLink, playTime, recordValue } from '../core/stats-format';
import type {
  MapRecord,
  RatingRow,
  SeasonsOverview,
  StatMode,
  StatScope,
  StatsPlayerRow,
  StatsRecord,
} from '../core/types';

type Tab = 'ratings' | 'players' | 'records' | 'bets';
type SortKey = keyof StatsPlayerRow | 'record' | 'runs';

interface Column {
  key: SortKey;
  label: string;
  value: (r: StatsPlayerRow) => string | number;
}

/** Normalised text for the search (case and accents ignored). */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

@Component({
  selector: 'app-stats',
  imports: [TPipe, RouterLink, DatePipe, BetBoardView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'stats.title' | t }}</h1>

    <div class="toolbar">
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
      <div class="tabs">
        @if (scope() !== 'lifetime') {
          <button [class.active]="tab() === 'ratings'" (click)="setTab('ratings')">
            {{ 'rating.list' | t }}
          </button>
        }
        <button [class.active]="tab() === 'players'" (click)="setTab('players')">
          {{ 'stats.players' | t }}
        </button>
        @if (scope() !== 'lifetime') {
          <button [class.active]="tab() === 'records'" (click)="setTab('records')">
            {{ 'stats.records' | t }}
          </button>
          <button [class.active]="tab() === 'bets'" (click)="setTab('bets')">
            {{ 'bets.tab' | t }}
          </button>
        }
      </div>
    </div>

    <div class="filters" [style.display]="tab() === 'bets' ? 'none' : null">
      <label class="small"
        >{{ 'stats.mode' | t }}
        <select
          [value]="tab() === 'ratings' ? ratingMode() : mode()"
          (change)="setMode($any($event.target).value)"
        >
          @if (tab() !== 'ratings') {
            <option value="">{{ 'stats.modeAll' | t }}</option>
          }
          <option value="dm">{{ 'stats.modeDm' | t }}</option>
          <option value="tdm">{{ 'stats.modeTdm' | t }}</option>
          <option value="mh">{{ 'stats.modeMh' | t }}</option>
        </select>
      </label>
      @if (tab() !== 'records') {
        <label class="small grow"
          >{{ 'stats.search' | t }}
          <input
            type="search"
            [value]="query()"
            (input)="query.set($any($event.target).value)"
            [placeholder]="'stats.searchPlayer' | t"
          />
        </label>
        <label class="small check"
          ><input
            type="checkbox"
            [checked]="bots()"
            (change)="setBots($any($event.target).checked)"
          />
          {{ 'stats.showBots' | t }}</label
        >
      }
      @if (tab() === 'ratings') {
        <label class="small check"
          ><input
            type="checkbox"
            [checked]="settledOnly()"
            (change)="settledOnly.set($any($event.target).checked)"
          />
          {{ 'rating.settledOnly' | t }}</label
        >
      }
      @if (tab() === 'players') {
        <label class="small"
          >{{ 'stats.minGames' | t }}
          <select [value]="minGames()" (change)="minGames.set(+$any($event.target).value)">
            @for (n of [0, 3, 5, 10, 25]; track n) {
              <option [value]="n">{{ n ? '≥ ' + n : ('stats.all' | t) }}</option>
            }
          </select>
        </label>
      }
    </div>

    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (!seasons().length) {
      <p class="muted small">{{ 'season.noneYet' | t }}</p>
    }

    @if (tab() === 'ratings') {
      <div class="card table-wrap">
        @if (ratingView().length === 0) {
          <p class="muted">
            {{ (ratingRows().length ? 'stats.noMatch' : 'rating.empty') | t }}
          </p>
        } @else {
          <table class="stats">
            <thead>
              <tr>
                <th class="sticky c0">#</th>
                <th class="sticky c1">{{ 'stats.col.name' | t }}</th>
                <th class="num">{{ 'rating.col.rating' | t }}</th>
                <th class="num">{{ 'stats.col.games' | t }}</th>
                <th class="num">{{ 'rating.col.winRate' | t }}</th>
                <th class="num">{{ 'rating.col.last' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (r of ratingView(); track r.key) {
                <tr [class.provisional]="r.provisional">
                  <td class="muted sticky c0">{{ r.rank ?? '–' }}</td>
                  <td class="sticky c1">
                    <a [routerLink]="link(r.key)" [queryParams]="{ season: scope() }">{{
                      r.name
                    }}</a>
                    @if (r.bot) {
                      <span class="badge">{{ 'stats.bot' | t }}</span>
                    }
                    @if (r.provisional) {
                      <span class="badge">{{ 'rating.provisional' | t }}</span>
                    }
                  </td>
                  <td class="num strong">{{ r.rating }}</td>
                  <td class="num">{{ r.wins }}–{{ r.games - r.wins }}</td>
                  <td class="num">{{ pct(r.wins / r.games) }}</td>
                  <td class="num muted">{{ r.lastAt | date: 'mediumDate' }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
      <p class="muted small">{{ 'rating.hint' | t }}</p>
    } @else if (tab() === 'players') {
      <div class="card table-wrap">
        @if (sorted().length === 0) {
          <p class="muted">{{ (rows().length ? 'stats.noMatch' : 'stats.empty') | t }}</p>
        } @else {
          <table class="stats">
            <thead>
              <tr>
                <th class="sticky c0">#</th>
                <th class="sticky c1 sortable" (click)="sortBy('name')">
                  {{ 'stats.col.name' | t }}{{ arrow('name') }}
                </th>
                @for (c of columns(); track c.key) {
                  <th class="sortable num" (click)="sortBy(c.key)">
                    {{ c.label | t }}{{ arrow(c.key) }}
                  </th>
                }
              </tr>
            </thead>
            <tbody>
              @for (r of sorted(); track r.key; let i = $index) {
                <tr>
                  <td class="muted sticky c0">{{ i + 1 }}</td>
                  <td class="sticky c1">
                    <a [routerLink]="link(r.key)" [queryParams]="{ season: scope() }">{{
                      r.name
                    }}</a>
                    @if (r.bot) {
                      <span class="badge">{{ 'stats.bot' | t }}</span>
                    }
                  </td>
                  @for (c of columns(); track c.key) {
                    <td class="num">{{ c.value(r) }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
      <p class="muted small">
        {{ 'stats.playersHint' | t }}
        {{ (scope() === 'lifetime' ? 'stats.lifetimeHint' : 'stats.seasonHint') | t }}
      </p>
    } @else if (tab() === 'bets') {
      <app-bet-board [season]="seasonNo()" [meId]="auth.me()?.id ?? null" />
    } @else {
      @if (records().length === 0 && maps().length === 0) {
        <div class="card">
          <p class="muted">{{ 'stats.noRecords' | t }}</p>
        </div>
      }
      @for (g of recordGroups(); track g.title) {
        @if (g.items.length) {
          <section class="group">
            <h2>{{ g.title | t }}</h2>
            <div class="records">
              @for (r of g.items; track r.id) {
                <div class="card record">
                  <div class="muted small">{{ 'rec.' + r.id | t }}</div>
                  <div class="value">{{ value(r) }}</div>
                  <div>
                    @if (r.holders.length === 1) {
                      <a
                        [routerLink]="link(r.holders[0]!.key)"
                        [queryParams]="{ season: scope() }"
                        >{{ r.label }}</a
                      >
                    } @else {
                      <strong>{{ r.label }}</strong>
                      <div class="small muted">
                        @for (h of r.holders; track h.key; let last = $last) {
                          <a [routerLink]="link(h.key)" [queryParams]="{ season: scope() }">{{
                            h.name
                          }}</a
                          >{{ last ? '' : ', ' }}
                        }
                      </div>
                    }
                  </div>
                  @if (r.tournamentName) {
                    <div class="small muted">
                      <a [routerLink]="['/t', r.tournamentId]">{{ r.tournamentName }}</a>
                      @if (r.map) {
                        · {{ r.map }}
                      }
                      @if (r.at) {
                        · {{ r.at | date: 'mediumDate' }}
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </section>
        }
      }
      @if (maps().length && mode() !== 'dm' && mode() !== 'tdm') {
        <section class="group">
          <h2>{{ 'stats.mapRecords' | t }}</h2>
          <p class="muted small">{{ 'stats.mapRecordsHint' | t }}</p>
          <div class="filters">
            <label class="small"
              >{{ 'stats.col.skill' | t }}
              <select [value]="mapSkill()" (change)="mapSkill.set(+$any($event.target).value)">
                @for (s of mapSkills(); track s) {
                  <option [value]="s">{{ s }}</option>
                }
              </select>
            </label>
            <label class="small grow"
              >{{ 'stats.search' | t }}
              <input
                type="search"
                [value]="mapQuery()"
                (input)="mapQuery.set($any($event.target).value)"
                [placeholder]="'stats.searchMap' | t"
              />
            </label>
          </div>
          <div class="card table-wrap">
            @if (mapView().length === 0) {
              <p class="muted">{{ 'stats.noMatch' | t }}</p>
            } @else {
              <table class="stats">
                <thead>
                  <tr>
                    <th class="sticky c0">{{ 'stats.col.map' | t }}</th>
                    <th class="num">{{ 'stats.col.final' | t }}</th>
                    <th class="num">{{ 'stats.col.runTime' | t }}</th>
                    <th class="num">{{ 'stats.col.deaths' | t }}</th>
                    <th>{{ 'stats.col.team' | t }}</th>
                    <th>{{ 'stats.col.tournament' | t }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (m of mapView(); track m.map) {
                    <tr>
                      <td class="sticky c0">{{ m.map }}</td>
                      <td class="num strong">{{ time(m.finalMs) }}</td>
                      <td class="num">{{ time(m.timeMs) }}</td>
                      <td class="num">{{ m.deaths }}</td>
                      <td>
                        {{ m.team }}
                        <div class="small muted">
                          @for (h of m.members; track h.key; let last = $last) {
                            <a [routerLink]="link(h.key)" [queryParams]="{ season: scope() }">{{
                              h.name
                            }}</a
                            >{{ last ? '' : ', ' }}
                          }
                        </div>
                      </td>
                      <td>
                        <a [routerLink]="['/t', m.tournamentId]">{{ m.tournamentName }}</a>
                        <div class="small muted">{{ m.at | date: 'mediumDate' }}</div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            }
          </div>
        </section>
      }
    }
  `,
  styles: `
    .toolbar,
    .filters {
      display: flex;
      align-items: flex-end;
      gap: 12px 16px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .toolbar .tabs {
      margin-bottom: 0;
    }
    .filters label.grow {
      flex: 1 1 200px;
      max-width: 320px;
    }
    .filters input[type='search'] {
      display: block;
      width: 100%;
      margin-top: 4px;
    }
    .filters label.check {
      display: flex;
      gap: 6px;
      align-items: center;
      padding-bottom: 8px;
    }
    /* Long tables scroll inside the card: the horizontal scroll bar stays in view, the header
       row and the name column stay put. */
    .table-wrap {
      overflow: auto;
      max-height: calc(100vh - 260px);
      min-height: 120px;
      padding: 0;
    }
    .table-wrap > p {
      padding: 16px;
      margin: 0;
    }
    table.stats {
      width: 100%;
      white-space: nowrap;
      border-collapse: separate;
      border-spacing: 0;
    }
    table.stats thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--panel);
      box-shadow: inset 0 -1px 0 var(--border);
    }
    table.stats .sticky {
      position: sticky;
      background: var(--panel);
      z-index: 1;
    }
    table.stats thead .sticky {
      z-index: 3;
    }
    table.stats .c0 {
      left: 0;
      min-width: 3rem;
    }
    table.stats .c1 {
      left: 3rem;
      box-shadow: inset -1px 0 0 var(--border);
    }
    table.stats th:first-child,
    table.stats td:first-child {
      padding-left: 16px;
    }
    table.stats th:last-child,
    table.stats td:last-child {
      padding-right: 16px;
    }
    .num {
      text-align: right;
    }
    .sortable {
      cursor: pointer;
      user-select: none;
    }
    .strong {
      font-weight: 700;
      color: var(--accent);
    }
    tr.provisional td {
      opacity: 0.7;
    }
    .badge {
      margin-left: 6px;
      font-size: 0.75rem;
      padding: 1px 6px;
      border-radius: 8px;
      border: 1px solid var(--border);
      color: var(--muted);
    }
    section.group {
      margin-top: 36px;
    }
    section.group:first-of-type {
      margin-top: 8px;
    }
    section.group h2 {
      margin-bottom: 12px;
    }
    .records {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 14px;
    }
    .record {
      margin-bottom: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .record .value {
      font-size: 1.6rem;
      font-weight: 700;
      color: var(--accent);
    }
  `,
})
export class StatsPage {
  private readonly api = inject(Api);
  protected readonly overview = signal<SeasonsOverview | null>(null);
  protected readonly scope = signal<StatScope>('lifetime');
  protected readonly tab = signal<Tab>(
    (['ratings', 'players', 'records', 'bets'] as const).find((x) => x === readPref('tab')) ??
      'ratings',
  );
  protected readonly auth = inject(Auth);
  /** The season shown (betting exists per season only). */
  protected readonly seasonNo = computed(() => {
    const s = this.scope();
    return s === 'lifetime' ? undefined : s;
  });
  protected readonly mode = signal<StatMode | ''>((readPref('mode') as StatMode | '') ?? '');
  protected readonly bots = signal(readPref('bots') === '1');
  protected readonly query = signal('');
  protected readonly settledOnly = signal(false);
  protected readonly minGames = signal(0);
  protected readonly mapSkill = signal(5);
  protected readonly mapQuery = signal('');
  protected readonly rows = signal<StatsPlayerRow[]>([]);
  protected readonly ratingRows = signal<RatingRow[]>([]);
  protected readonly records = signal<StatsRecord[]>([]);
  protected readonly maps = signal<MapRecord[]>([]);
  protected readonly error = signal('');
  protected readonly sortKey = signal<SortKey>('titles');
  protected readonly sortDesc = signal(true);

  protected readonly seasons = computed(() => startedSeasons(this.overview()));
  /** Ratings exist per mode only: "all modes" shows 1 on 1. */
  protected readonly ratingMode = computed<StatMode>(() => this.mode() || 'dm');

  protected readonly ratingView = computed(() => {
    const q = norm(this.query().trim());
    return this.ratingRows().filter(
      (r) => (!q || norm(r.name).includes(q)) && (!this.settledOnly() || !r.provisional),
    );
  });

  /** Monster skills that have map records. */
  protected readonly mapSkills = computed(() =>
    [...new Set(this.maps().map((m) => m.monsterSkill))].sort((a, b) => a - b),
  );
  protected readonly mapView = computed(() => {
    const q = norm(this.mapQuery().trim());
    return this.maps().filter(
      (m) => m.monsterSkill === this.mapSkill() && (!q || norm(m.map).includes(q)),
    );
  });

  protected readonly columns = computed<Column[]>(() => {
    const base: Column[] = [
      { key: 'tournaments', label: 'stats.col.tournaments', value: (r) => r.tournaments },
      { key: 'titles', label: 'stats.col.titles', value: (r) => r.titles },
      {
        key: 'matchesWon',
        label: 'stats.col.matches',
        value: (r) => `${r.matchesWon}–${r.matches - r.matchesWon}`,
      },
      {
        key: 'gamesWon',
        label: 'stats.col.games',
        value: (r) => `${r.gamesWon}–${r.games - r.gamesWon}`,
      },
    ];
    const dm: Column[] = [
      { key: 'frags', label: 'stats.col.frags', value: (r) => r.frags },
      { key: 'kills', label: 'stats.col.kills', value: (r) => r.kills },
      { key: 'deaths', label: 'stats.col.deaths', value: (r) => r.deaths },
      { key: 'kd', label: 'stats.col.kd', value: (r) => r.kd.toFixed(2) },
      { key: 'efficiency', label: 'stats.col.efficiency', value: (r) => percent(r.efficiency) },
      { key: 'headshots', label: 'stats.col.headshots', value: (r) => r.headshots },
      { key: 'bestSpree', label: 'stats.col.bestSpree', value: (r) => r.bestSpree },
      { key: 'multiKills', label: 'stats.col.multiKills', value: (r) => r.multiKills },
      { key: 'firstBloods', label: 'stats.col.firstBloods', value: (r) => r.firstBloods },
    ];
    const mh: Column[] = [
      { key: 'runsFinished', label: 'stats.col.runs', value: (r) => `${r.runsFinished}/${r.runs}` },
      { key: 'monsters', label: 'stats.col.monsters', value: (r) => r.monsters },
      { key: 'monsterPoints', label: 'stats.col.monsterPoints', value: (r) => r.monsterPoints },
    ];
    const tail: Column[] = [
      { key: 'timeSec', label: 'stats.col.time', value: (r) => playTime(r.timeSec) },
    ];
    const m = this.mode();
    const fav: Column = {
      key: 'favoriteWeapon',
      label: 'stats.col.weapon',
      value: (r) => r.favoriteWeapon?.name ?? '–',
    };
    if (m === 'mh') return [...base, ...mh, ...tail];
    if (m === '') {
      const pick = (keys: SortKey[]) => dm.filter((c) => keys.includes(c.key));
      return [
        ...base,
        ...pick(['frags', 'kd', 'efficiency', 'headshots', 'bestSpree']),
        ...mh.slice(0, 2),
        fav,
        ...tail,
      ];
    }
    return [...base, ...dm, fav, ...tail];
  });

  protected readonly sorted = computed(() => {
    const key = this.sortKey();
    const dir = this.sortDesc() ? -1 : 1;
    const q = norm(this.query().trim());
    const min = this.minGames();
    const val = (r: StatsPlayerRow): number | string => {
      if (key === 'favoriteWeapon') return r.favoriteWeapon?.name ?? '';
      const v = r[key as keyof StatsPlayerRow];
      return typeof v === 'number' || typeof v === 'string' ? v : 0;
    };
    return this.rows()
      .filter((r) => (!q || norm(r.name).includes(q)) && r.games >= min)
      .sort((a, b) => {
        const x = val(a);
        const y = val(b);
        const c = typeof x === 'string' ? x.localeCompare(String(y)) : x - (y as number);
        return c * dir || a.name.localeCompare(b.name);
      });
  });

  protected readonly recordGroups = computed(() => {
    const r = this.records();
    return [
      { title: 'stats.groupGame', items: r.filter((x) => x.id.startsWith('game.')) },
      { title: 'stats.groupCareer', items: r.filter((x) => x.id.startsWith('career.')) },
      { title: 'stats.groupMh', items: r.filter((x) => x.id.startsWith('run.')) },
    ];
  });

  constructor() {
    void this.init();
  }

  protected link = playerLink;
  protected value = recordValue;
  protected pct = percent;
  protected time = (ms: number) => raceTime(ms);

  private async init() {
    try {
      const o = await this.api.seasons();
      this.overview.set(o);
      const pref = readPref('scope');
      const known = pref === 'lifetime' || startedSeasons(o).some((s) => String(s.number) === pref);
      this.scope.set(known && pref ? parseScope(pref) : defaultScope(o));
      this.fixTab();
      await this.load();
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  /** Lifetime has neither ratings nor records. */
  private fixTab() {
    if (this.scope() === 'lifetime' && this.tab() !== 'players') this.tab.set('players');
  }

  protected setScope(v: string) {
    this.scope.set(parseScope(v));
    writePref('scope', v);
    this.fixTab();
    void this.load();
  }

  protected setTab(t: Tab) {
    this.tab.set(t);
    writePref('tab', t);
  }

  protected setMode(m: StatMode | '') {
    this.mode.set(m);
    writePref('mode', m);
    void this.load();
  }

  protected setBots(on: boolean) {
    this.bots.set(on);
    writePref('bots', on ? '1' : '0');
    void this.load();
  }

  protected sortBy(key: SortKey) {
    if (this.sortKey() === key) this.sortDesc.set(!this.sortDesc());
    else {
      this.sortKey.set(key);
      this.sortDesc.set(key !== 'name');
    }
  }

  protected arrow(key: SortKey): string {
    return this.sortKey() === key ? (this.sortDesc() ? ' ▼' : ' ▲') : '';
  }

  private async load() {
    this.error.set('');
    const scope = this.scope();
    try {
      const season = scope === 'lifetime' ? null : scope;
      const [rows, rec, ratings] = await Promise.all([
        this.api.statsPlayers(scope, this.mode(), this.bots()),
        season ? this.api.statsRecords(season, this.mode()) : { records: [], maps: [] },
        season ? this.api.statsRatings(season, this.ratingMode(), this.bots()) : [],
      ]);
      this.rows.set(rows);
      this.ratingRows.set(ratings);
      this.records.set(rec.records);
      this.maps.set(rec.maps);
      const skills = [...new Set(rec.maps.map((m) => m.monsterSkill))];
      if (skills.length && !skills.includes(this.mapSkill())) this.mapSkill.set(skills[0]!);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }
}

function readPref(k: string): string | null {
  try {
    return localStorage.getItem(`tourney.stats.${k}`);
  } catch {
    return null;
  }
}

function writePref(k: string, v: string) {
  try {
    localStorage.setItem(`tourney.stats.${k}`, v);
  } catch {
    // storage blocked: the filter only lasts until the page is left
  }
}
