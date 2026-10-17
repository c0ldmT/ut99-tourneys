import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { TPipe } from '../core/i18n';
import { raceTime } from '../core/race';
import { percent, playerLink, playTime, recordValue } from '../core/stats-format';
import type { MapRecord, RatingRow, StatMode, StatsPlayerRow, StatsRecord } from '../core/types';

type Tab = 'ratings' | 'players' | 'records';
type SortKey = keyof StatsPlayerRow | 'record' | 'runs';

interface Column {
  key: SortKey;
  label: string;
  value: (r: StatsPlayerRow) => string | number;
}

@Component({
  selector: 'app-stats',
  imports: [TPipe, RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'stats.title' | t }}</h1>
    <div class="row filters">
      <div class="tabs">
        <button [class.active]="tab() === 'ratings'" (click)="setTab('ratings')">
          {{ 'rating.list' | t }}
        </button>
        <button [class.active]="tab() === 'players'" (click)="setTab('players')">
          {{ 'stats.players' | t }}
        </button>
        <button [class.active]="tab() === 'records'" (click)="setTab('records')">
          {{ 'stats.records' | t }}
        </button>
      </div>
      <span class="grow"></span>
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
        <label class="small"
          ><input
            type="checkbox"
            [checked]="bots()"
            (change)="setBots($any($event.target).checked)"
          />
          {{ 'stats.showBots' | t }}</label
        >
      }
    </div>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }

    @if (tab() === 'ratings') {
      <div class="card scroll">
        @if (ratingRows().length === 0) {
          <p class="muted">{{ 'rating.empty' | t }}</p>
        } @else {
          <table class="stats">
            <thead>
              <tr>
                <th>#</th>
                <th>{{ 'stats.col.name' | t }}</th>
                <th class="num">{{ 'rating.col.rating' | t }}</th>
                <th class="num">{{ 'stats.col.games' | t }}</th>
                <th class="num">{{ 'rating.col.winRate' | t }}</th>
                <th class="num">{{ 'rating.col.last' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (r of ratingRows(); track r.key) {
                <tr [class.provisional]="r.provisional">
                  <td class="muted">{{ r.rank ?? '–' }}</td>
                  <td>
                    <a [routerLink]="link(r.key)">{{ r.name }}</a>
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
      <div class="card scroll">
        @if (sorted().length === 0) {
          <p class="muted">{{ 'stats.empty' | t }}</p>
        } @else {
          <table class="stats">
            <thead>
              <tr>
                <th>#</th>
                <th class="sortable" (click)="sortBy('name')">
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
                  <td class="muted">{{ i + 1 }}</td>
                  <td>
                    <a [routerLink]="link(r.key)">{{ r.name }}</a>
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
      <p class="muted small">{{ 'stats.playersHint' | t }}</p>
    } @else {
      @if (records().length === 0 && maps().length === 0) {
        <div class="card">
          <p class="muted">{{ 'stats.empty' | t }}</p>
        </div>
      }
      @for (g of recordGroups(); track g.title) {
        @if (g.items.length) {
          <h2>{{ g.title | t }}</h2>
          <div class="records">
            @for (r of g.items; track r.id) {
              <div class="card record">
                <div class="muted small">{{ 'rec.' + r.id | t }}</div>
                <div class="value">{{ value(r) }}</div>
                <div>
                  @if (r.holders.length === 1) {
                    <a [routerLink]="link(r.holders[0]!.key)">{{ r.label }}</a>
                  } @else {
                    <strong>{{ r.label }}</strong>
                    <div class="small muted">
                      @for (h of r.holders; track h.key; let last = $last) {
                        <a [routerLink]="link(h.key)">{{ h.name }}</a
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
        }
      }
      @if (maps().length && mode() !== 'dm' && mode() !== 'tdm') {
        <h2>{{ 'stats.mapRecords' | t }}</h2>
        <p class="muted small">{{ 'stats.mapRecordsHint' | t }}</p>
        <div class="card scroll">
          <table class="stats">
            <thead>
              <tr>
                <th>{{ 'stats.col.map' | t }}</th>
                <th class="num">{{ 'stats.col.final' | t }}</th>
                <th class="num">{{ 'stats.col.runTime' | t }}</th>
                <th class="num">{{ 'stats.col.deaths' | t }}</th>
                <th class="num">{{ 'stats.col.skill' | t }}</th>
                <th>{{ 'stats.col.team' | t }}</th>
                <th>{{ 'stats.col.tournament' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (m of maps(); track m.map) {
                <tr>
                  <td>{{ m.map }}</td>
                  <td class="num strong">{{ time(m.finalMs) }}</td>
                  <td class="num">{{ time(m.timeMs) }}</td>
                  <td class="num">{{ m.deaths }}</td>
                  <td class="num">{{ m.monsterSkill }}</td>
                  <td>
                    {{ m.team }}
                    <div class="small muted">
                      @for (h of m.members; track h.key; let last = $last) {
                        <a [routerLink]="link(h.key)">{{ h.name }}</a
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
        </div>
      }
    }
  `,
  styles: `
    .filters {
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .filters .tabs {
      margin-bottom: 0;
    }
    .scroll {
      overflow-x: auto;
    }
    table.stats {
      width: 100%;
      white-space: nowrap;
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
    .records {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
    }
    .record {
      margin-bottom: 0;
    }
    .record .value {
      font-size: 1.6rem;
      font-weight: 700;
      color: var(--accent);
      margin: 4px 0;
    }
  `,
})
export class StatsPage {
  private readonly api = inject(Api);
  protected readonly tab = signal<Tab>(
    (['ratings', 'players', 'records'] as const).find((x) => x === readPref('tab')) ?? 'ratings',
  );
  protected readonly mode = signal<StatMode | ''>((readPref('mode') as StatMode | '') ?? '');
  protected readonly bots = signal(readPref('bots') === '1');
  protected readonly rows = signal<StatsPlayerRow[]>([]);
  protected readonly ratingRows = signal<RatingRow[]>([]);
  /** Ratings exist per mode only: "all modes" shows 1 on 1. */
  protected readonly ratingMode = computed<StatMode>(() => this.mode() || 'dm');
  protected readonly records = signal<StatsRecord[]>([]);
  protected readonly maps = signal<MapRecord[]>([]);
  protected readonly error = signal('');
  protected readonly sortKey = signal<SortKey>('titles');
  protected readonly sortDesc = signal(true);

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
    const val = (r: StatsPlayerRow): number | string => {
      if (key === 'favoriteWeapon') return r.favoriteWeapon?.name ?? '';
      const v = r[key as keyof StatsPlayerRow];
      return typeof v === 'number' || typeof v === 'string' ? v : 0;
    };
    return [...this.rows()].sort((a, b) => {
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
    void this.load();
  }

  protected link = playerLink;
  protected value = recordValue;
  protected time = (ms: number) => raceTime(ms);

  protected pct = percent;

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
    try {
      const [rows, rec, ratings] = await Promise.all([
        this.api.statsPlayers(this.mode(), this.bots()),
        this.api.statsRecords(this.mode()),
        this.api.statsRatings(this.ratingMode(), this.bots()),
      ]);
      this.rows.set(rows);
      this.ratingRows.set(ratings);
      this.records.set(rec.records);
      this.maps.set(rec.maps);
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
