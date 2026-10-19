import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { NameTag } from '../core/looks';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import { formatNeuro, NeuroPipe } from '../core/neuro';
import type { BetBoard, BetRecordView } from '../core/types';

/** Records shown as Neuro amounts (the others are counts, odds or percent). */
const MONEY = new Set(['peak', 'bestWin', 'worstLoss', 'profit', 'allInWin', 'biggestPool']);

/** Statistics tab "Bets": Neuro ranking and betting records of a season. */
@Component({
  selector: 'app-bet-board',
  imports: [TPipe, RouterLink, NeuroPipe, NameTag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (board()?.versus; as v) {
      @if (v.humans || v.bots) {
        <div class="card versus">
          <div class="spread small">
            <span
              >{{ 'bets.humans' | t }}
              <b [class.plus]="v.humans > 0" [class.minus]="v.humans < 0">{{
                signed(v.humans)
              }}</b></span
            >
            <span class="muted">{{ 'bets.versus' | t }}</span>
            <span
              ><b [class.plus]="v.bots > 0" [class.minus]="v.bots < 0">{{ signed(v.bots) }}</b>
              {{ 'bets.bots' | t }}</span
            >
          </div>
          <div class="vbar">
            <span class="h" [style.width.%]="humanShare()"></span>
          </div>
        </div>
      }
    }
    @if (records().length) {
      <div class="records">
        @for (r of records(); track r.key) {
          <div class="card record">
            <span class="muted small">{{ 'bets.rec.' + r.key | t }}</span>
            <span class="value">{{ value(r) }}</span>
            @if (r.userId) {
              <a [routerLink]="['/stats/p', 'u:' + r.userId]"
                ><na-name [name]="r.name ?? ''" [id]="r.userId"
              /></a>
            } @else if (r.tournamentId) {
              <a [routerLink]="['/t', r.tournamentId]">{{ r.tournamentName }} · {{ r.matchId }}</a>
            }
          </div>
        }
      </div>
    }
    @if (botRecords().length) {
      <h3>{{ 'bets.botRecords' | t }}</h3>
      <div class="records">
        @for (r of botRecords(); track r.key) {
          <div class="card record">
            <span class="muted small">{{ 'bets.rec.' + r.key | t }}</span>
            <span class="value">{{ value(r) }}</span>
            <a [routerLink]="['/bots', r.botId]">{{ r.name }}</a>
          </div>
        }
      </div>
    }
    <label class="small check"
      ><input
        type="checkbox"
        [checked]="showBots()"
        (change)="showBots.set($any($event.target).checked)"
      />
      {{ 'stats.showBots' | t }}</label
    >
    <div class="card table-wrap">
      @if (!rows().length) {
        <p class="muted">{{ 'bets.noBets' | t }}</p>
      } @else {
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{{ 'stats.col.name' | t }}</th>
              <th class="num">{{ 'bets.balance' | t }}</th>
              <th class="num">{{ 'bets.col.profit' | t }}</th>
              <th class="num">{{ 'bets.col.bets' | t }}</th>
              <th class="num">{{ 'bets.col.hit' | t }}</th>
              <th class="num">{{ 'bets.col.peak' | t }}</th>
              <th class="num">{{ 'bets.col.bailouts' | t }}</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.userId; let i = $index) {
              <tr [class.me]="r.userId === meId()">
                <td>{{ i + 1 }}</td>
                <td>
                  @if (r.bot) {
                    <a [routerLink]="['/bots', r.id]">{{ r.name }}</a>
                    <span class="badge bot">BOT</span>
                  } @else {
                    <a [routerLink]="['/stats/p', 'u:' + r.userId]"
                      ><na-name [name]="r.name" [id]="r.userId"
                    /></a>
                  }
                </td>
                <td class="num">
                  <b>{{ r.balance | neuro }}</b>
                </td>
                <td class="num" [class.plus]="r.profit > 0" [class.minus]="r.profit < 0">
                  {{ (r.profit > 0 ? '+' : '') + neuro(r.profit) }}
                </td>
                <td class="num">{{ r.bets }}</td>
                <td class="num">{{ hit(r.won, r.lost) }}</td>
                <td class="num">{{ r.peak | neuro }}</td>
                <td class="num">{{ r.bailouts || '' }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
    <p class="muted small">
      {{ 'bets.boardHint' | t: { start: neuro(board()?.startBalance ?? 1000) } }}
    </p>
  `,
  styles: `
    .records {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .record {
      margin-bottom: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .record .value {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--accent);
    }
    .table-wrap {
      overflow-x: auto;
    }
    table {
      white-space: nowrap;
    }
    .num {
      text-align: right;
    }
    .versus {
      margin-bottom: 16px;
    }
    .vbar {
      height: 10px;
      border-radius: 5px;
      background: var(--hot);
      overflow: hidden;
      margin-top: 8px;
    }
    .vbar .h {
      display: block;
      height: 100%;
      background: var(--accent);
    }
    h3 {
      font-size: 0.95rem;
      margin: 8px 0;
    }
    .check {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    .badge {
      margin-left: 6px;
    }
    .plus {
      color: var(--live);
    }
    .minus {
      color: var(--danger);
    }
    tr.me td {
      background: var(--me-bg);
    }
  `,
})
export class BetBoardView {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  /** Season number (undefined: the running or the last one). */
  readonly season = input<number | undefined>(undefined);
  readonly meId = input<string | null>(null);
  protected readonly board = signal<BetBoard | null>(null);
  protected readonly recs = signal<BetRecordView[]>([]);
  protected readonly error = signal('');
  protected readonly botRecs = signal<BetRecordView[]>([]);
  protected readonly records = computed(() => this.recs());
  protected readonly botRecords = computed(() => this.botRecs());
  protected readonly showBots = signal(true);
  protected readonly rows = computed(() =>
    (this.board()?.rows ?? []).filter((r) => this.showBots() || !r.bot),
  );
  /** Width of the players' part of the bar: 50 % at a draw. */
  protected readonly humanShare = computed(() => {
    const v = this.board()?.versus;
    if (!v) return 50;
    const span = Math.max(1, Math.abs(v.humans) + Math.abs(v.bots));
    return Math.round(50 + (50 * (v.humans - v.bots)) / (2 * span));
  });

  constructor() {
    effect(() => {
      const s = this.season();
      void this.load(s);
    });
  }

  private async load(season: number | undefined) {
    this.error.set('');
    try {
      const [b, r] = await Promise.all([this.api.betBoard(season), this.api.betRecords(season)]);
      this.board.set(b);
      this.recs.set(r.records);
      this.botRecs.set(r.botRecords ?? []);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  protected neuro(n: number): string {
    return formatNeuro(n, this.i18n.lang());
  }

  protected signed(n: number): string {
    return (n > 0 ? '+' : n < 0 ? '−' : '') + this.neuro(Math.abs(n));
  }

  protected hit(won: number, lost: number): string {
    return won + lost ? `${Math.round((won / (won + lost)) * 100)} %` : '–';
  }

  protected value(r: BetRecordView): string {
    if (MONEY.has(r.key)) return this.neuro(r.value);
    if (r.key === 'bestOdds')
      return `×${r.value.toLocaleString(this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (r.key === 'hitRate') return `${r.value} %`;
    return String(r.value);
  }
}
