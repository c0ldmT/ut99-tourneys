import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EmptyState } from '../components/empty-state';
import { Guide } from '../components/guide';
import { Api } from '../core/api';
import { I18n, TPipe, WhenPipe } from '../core/i18n';
import { NeuroPipe, formatNeuro } from '../core/neuro';
import type { UdtChallenge, UdtChallengeRecord, UdtChallengeRules } from '../core/types';
import { UdtNav } from '../core/udt';

/** "9:58" from milliseconds. */
const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The manager's challenge record (decision 338): won, lost and the Neuro they brought (all
 * seasons), the managers played against (rivals from three games on, with a challenge button),
 * the last results and the season's Monster Hunt records to beat.
 */
@Component({
  selector: 'app-udt-challenge-record',
  imports: [RouterLink, EmptyState, Guide, TPipe, WhenPipe, NeuroPipe, UdtNav],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    @if (data(); as d) {
      <div class="udt-head">
        <div>
          <div class="kpi udt-kick" style="color: var(--chall)">{{ 'udt.area.chall' | t }}</div>
          <h1 class="disp">{{ 'udt.ch.rec.title' | t }}</h1>
          <p class="muted">{{ 'udt.ch.rec.lead' | t }}</p>
        </div>
        <div class="udt-kpis">
          <div>
            <div class="kpi">{{ 'udt.ch.rec.wl' | t }}</div>
            <div class="v">{{ d.won }}–{{ d.lost }}</div>
          </div>
          <div>
            <div class="kpi">{{ 'udt.ch.rec.net' | t }}</div>
            <div class="v" [class.pos]="d.net > 0" [class.neg]="d.net < 0">
              {{ signed(d.net) }}
            </div>
          </div>
          @if (d.records) {
            <div>
              <div class="kpi">{{ 'udt.ch.rec.records' | t }}</div>
              <div class="v">{{ d.records }} · {{ d.recordNeuro | neuro }}</div>
            </div>
          }
        </div>
        <na-guide page="challenges" />
      </div>

      <div class="cols">
        <section class="card">
          <h2>{{ 'udt.ch.rec.rivals' | t }}</h2>
          @if (d.rivals.length) {
            <table>
              <thead>
                <tr>
                  <th>{{ 'udt.ch.rec.team' | t }}</th>
                  <th class="r">{{ 'udt.ch.rec.wl' | t }}</th>
                  <th class="r">{{ 'udt.ch.rec.net' | t }}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (r of d.rivals; track r.userId) {
                  <tr>
                    <td>
                      <a [routerLink]="['/udt/squads', r.userId]">{{ r.tag }} {{ r.name }}</a>
                      @if (r.rival) {
                        <span class="riv">{{ 'udt.ch.rival' | t }}</span>
                      }
                      @if (r.ai) {
                        <span class="muted small">{{ 'udt.ch.ai' | t }}</span>
                      }
                    </td>
                    <td class="r mono">{{ r.won }}–{{ r.lost }}</td>
                    <td class="r mono" [class.pos]="r.net > 0" [class.neg]="r.net < 0">
                      {{ signed(r.net) }}
                    </td>
                    <td class="r">
                      <a
                        class="small"
                        routerLink="/udt/challenges"
                        [queryParams]="{ to: r.userId }"
                        >{{ 'udt.ch.challenge' | t }}</a
                      >
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          } @else {
            <na-empty [text]="'udt.ch.rec.noRivals' | t" />
          }
        </section>

        <section class="card">
          <h2>{{ 'udt.ch.rec.mh' | t }}</h2>
          @if (rules()?.mh?.records?.length) {
            <ul class="recs">
              @for (r of rules()!.mh.records; track r.map + r.hardness) {
                <li>
                  <span>{{ r.map }}</span>
                  <span class="muted small">{{ 'udt.ch.hard.' + r.hardness | t }}</span>
                  <b class="mono">{{ time(r.finalMs) }}</b>
                  <span class="muted small">{{ r.team }}</span>
                </li>
              }
            </ul>
            <p class="muted small">
              {{ 'udt.ch.rec.mhHint' | t: { bonus: rules()!.mh.recordBonus } }}
            </p>
          } @else {
            <na-empty [text]="'udt.ch.rec.noMh' | t" />
          }
        </section>
      </div>

      <section class="card">
        <h2>{{ 'udt.ch.rec.history' | t }}</h2>
        @for (c of d.history; track c.id) {
          <div class="h">
            <span class="badge" [class.win]="c.winner === d.me" [class.loss]="c.winner !== d.me">{{
              (c.winner === d.me ? 'udt.ch.won' : 'udt.ch.lost') | t
            }}</span>
            <span class="vs">{{ vs(c, d.me) }}</span>
            <span class="muted small">{{ format(c) }} · {{ c.scheduledAt | when: 'date' }}</span>
            @if (c.record) {
              <span class="rec small">{{ 'udt.ch.ev.record' | t }}</span>
            }
            <span class="mono grow r" [class.pos]="c.net > 0" [class.neg]="c.net < 0">{{
              c.stake ? signed(c.net) : ('udt.ch.friendly' | t)
            }}</span>
            @if (c.tournamentId) {
              <a class="small" [routerLink]="['/t', c.tournamentId]">{{ 'udt.ch.toMatch' | t }}</a>
            }
          </div>
        } @empty {
          <na-empty [text]="'udt.ch.noRecent' | t" />
        }
      </section>
    }
  `,
  styles: `
    .cols {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
      gap: 16px;
      align-items: start;
      margin-bottom: 16px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th {
      text-align: left;
      font-size: var(--fs-xs);
      color: var(--muted);
      padding: 4px 6px;
      border-bottom: 1px solid var(--line);
    }
    td {
      padding: 8px 6px;
      border-bottom: 1px solid var(--border);
    }
    .r {
      text-align: right;
    }
    .pos {
      color: var(--live);
    }
    .neg {
      color: var(--danger);
    }
    .riv {
      margin-left: 6px;
      padding: 1px 8px;
      border-radius: var(--radius-pill);
      font-size: var(--fs-xs);
      font-weight: 700;
      color: var(--hot-text);
      background: color-mix(in srgb, var(--hot) 14%, transparent);
    }
    .recs {
      list-style: none;
      margin: 0 0 8px;
      padding: 0;
      display: grid;
      gap: 4px;
    }
    .recs li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 2px 10px;
      padding: 6px 10px;
      border-radius: var(--radius-sm);
      background: var(--panel-2);
    }
    .recs li span:last-child {
      grid-column: 1 / -1;
    }
    .h {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
    }
    .badge.win {
      color: var(--live);
    }
    .badge.loss {
      color: var(--danger);
    }
    .vs {
      font-weight: 700;
    }
    .rec {
      color: var(--chall);
      font-weight: 700;
    }
    .grow {
      flex: 1 1 auto;
    }
    @media (max-width: 860px) {
      .cols {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class UdtChallengeRecordPage {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  protected readonly data = signal<UdtChallengeRecord | null>(null);
  protected readonly rules = signal<UdtChallengeRules | null>(null);

  constructor() {
    void this.load();
  }

  async load() {
    try {
      const [d, v] = await Promise.all([this.api.udtChallengeRecord(), this.api.udtChallenges()]);
      this.data.set(d);
      this.rules.set(v.rules);
    } catch {
      // the toast shows the error
    }
  }

  protected signed(n: number): string {
    return (n > 0 ? '+' : n < 0 ? '−' : '±') + formatNeuro(Math.abs(n), this.i18n.lang());
  }

  protected time(ms: number): string {
    return clock(ms);
  }

  protected vs(c: UdtChallenge, me: string): string {
    const o = c.from.userId === me ? c.to : c.from;
    return this.i18n.t('udt.ch.vs', { team: o ? `${o.tag} ${o.name}` : '?' });
  }

  protected format(c: UdtChallenge): string {
    return c.mode === 'mh'
      ? `MH · ${this.i18n.t(`udt.ch.hard.${c.hardness ?? 'normal'}`)}`
      : `${c.teamSize}v${c.teamSize} · Bo${c.bestOf}`;
  }
}
