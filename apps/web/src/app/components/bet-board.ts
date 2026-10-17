import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
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
  imports: [TPipe, RouterLink, NeuroPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (records().length) {
      <div class="records">
        @for (r of records(); track r.key) {
          <div class="card record">
            <span class="muted small">{{ 'bets.rec.' + r.key | t }}</span>
            <span class="value">{{ value(r) }}</span>
            @if (r.userId) {
              <a [routerLink]="['/stats/p', 'u:' + r.userId]">{{ r.name }}</a>
            } @else if (r.tournamentId) {
              <a [routerLink]="['/t', r.tournamentId]">{{ r.tournamentName }} · {{ r.matchId }}</a>
            }
          </div>
        }
      </div>
    }
    <div class="card table-wrap">
      @if (!board()?.rows?.length) {
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
            @for (r of board()!.rows; track r.userId; let i = $index) {
              <tr [class.me]="r.userId === meId()">
                <td>{{ i + 1 }}</td>
                <td>
                  <a [routerLink]="['/stats/p', 'u:' + r.userId]">{{ r.name }}</a>
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
  protected readonly records = computed(() => this.recs());

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
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  protected neuro(n: number): string {
    return formatNeuro(n, this.i18n.lang());
  }

  protected hit(won: number, lost: number): string {
    return won + lost ? `${Math.round((won / (won + lost)) * 100)} %` : '–';
  }

  protected value(r: BetRecordView): string {
    if (MONEY.has(r.key)) return this.neuro(r.value);
    if (r.key === 'bestOdds') return `×${r.value.toFixed(2)}`;
    if (r.key === 'hitRate') return `${r.value} %`;
    return String(r.value);
  }
}
