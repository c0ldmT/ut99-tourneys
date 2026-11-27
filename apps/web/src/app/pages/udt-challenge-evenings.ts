import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EmptyState } from '../components/empty-state';
import { Guide } from '../components/guide';
import { Api } from '../core/api';
import { Coin } from '../core/brand';
import { I18n, TPipe, WhenPipe } from '../core/i18n';
import { formatNeuro } from '../core/neuro';
import type { UdtChallenge, UdtChallengeEvenings } from '../core/types';
import { UdtNav } from '../core/udt';

type Item = UdtChallenge & { record: boolean };

/**
 * The challenge evenings of the season (decision 338, preview "Challenge-Abend"): per day the
 * main fight (a Monster Hunt showcase first, then the highest stake) and the other games with
 * their state, today and the next days first, then the past ones.
 */
@Component({
  selector: 'app-udt-challenge-evenings',
  imports: [RouterLink, EmptyState, Guide, Coin, TPipe, WhenPipe, UdtNav],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    <div class="udt-head">
      <div>
        <div class="kpi udt-kick" style="color: var(--chall)">{{ 'udt.area.chall' | t }}</div>
        <h1 class="disp">{{ 'udt.ch.ev.title' | t }}</h1>
        <p class="muted">{{ 'udt.ch.ev.lead' | t }}</p>
      </div>
      <na-guide page="challenges" />
    </div>
    @if (data(); as d) {
      @for (g of groups(); track g.key) {
        @if (g.days.length) {
          <h2 class="grp">{{ g.key | t }}</h2>
          @for (day of g.days; track day.date) {
            <section class="card eve" [class.today]="day.date === d.today">
              <h3>
                {{ day.date === d.today ? ('udt.ch.ev.today' | t) : whenDay(day.date) }}
                <span class="muted small">{{
                  'udt.ch.ev.games' | t: { n: day.items.length }
                }}</span>
              </h3>
              @if (main(day); as m) {
                <div class="main" [class.mh]="m.mode === 'mh'">
                  <div class="mtop">
                    <span class="show">{{
                      (m.mode === 'mh' ? 'udt.ch.showcase' : 'udt.ch.ev.main') | t
                    }}</span>
                    <span class="mono">{{ m.scheduledAt | when: 'time' }}</span>
                    <span class="muted small"
                      >{{ m.mode === 'mh' ? 'Monster Hunt · ' + hard(m) : format(m)
                      }}{{ m.map ? ' · ' + m.map : '' }}</span
                    >
                    @if (m.status !== 'accepted') {
                      <span class="badge">{{ state(m) }}</span>
                    }
                  </div>
                  <div class="vs">
                    <b [class.win]="m.winner === m.from.userId"
                      >{{ m.from.tag }} {{ m.from.name }}</b
                    >
                    <span class="v">vs</span>
                    <b [class.win]="m.winner === m.to?.userId">{{ m.to?.tag }} {{ m.to?.name }}</b>
                  </div>
                  <div class="mfoot">
                    @if (m.stake) {
                      <span class="pot"
                        ><na-coin [size]="13" />
                        {{ 'udt.ch.ev.pot' | t: { n: neuro(m.pot) } }}</span
                      >
                    } @else {
                      <span class="fr">{{ 'udt.ch.friendly' | t }}</span>
                    }
                    @if (m.record) {
                      <span class="rec">{{ 'udt.ch.ev.record' | t }}</span>
                    }
                    @if (m.tournamentId) {
                      <a class="btn" [routerLink]="['/t', m.tournamentId]">{{
                        (m.status === 'locked' ? 'udt.ch.ev.watch' : 'udt.ch.toMatch') | t
                      }}</a>
                    }
                  </div>
                </div>
              }
              <ul class="list">
                @for (c of others(day); track c.id) {
                  <li [class.mine]="c.mine || c.incoming">
                    <span class="mono t">{{ c.scheduledAt | when: 'time' }}</span>
                    <span class="who">
                      <span [class.win]="c.winner === c.from.userId">{{ c.from.tag }}</span>
                      –
                      <span [class.win]="c.winner === c.to?.userId">{{ c.to?.tag }}</span>
                      <span class="muted small">{{ format(c) }}</span>
                    </span>
                    <span class="st small">{{ state(c) }}</span>
                    @if (c.tournamentId) {
                      <a [routerLink]="['/t', c.tournamentId]" class="small">{{
                        'udt.ch.toMatch' | t
                      }}</a>
                    }
                  </li>
                }
              </ul>
            </section>
          }
        }
      }
      @if (!d.days.length) {
        <na-empty [text]="'udt.ch.ev.none' | t" />
      }
    }
  `,
  styles: `
    .grp {
      margin: 18px 0 8px;
    }
    .eve {
      display: grid;
      gap: 12px;
      margin-bottom: 14px;
    }
    .eve.today {
      border-color: var(--chall);
    }
    h3 {
      margin: 0;
      display: flex;
      gap: 10px;
      align-items: baseline;
    }
    .main {
      display: grid;
      gap: 10px;
      padding: 14px;
      border-radius: var(--radius);
      background: var(--panel-2);
    }
    .main.mh {
      background:
        linear-gradient(90deg, color-mix(in srgb, var(--chall) 16%, transparent), transparent 70%),
        var(--panel-2);
    }
    .mtop,
    .mfoot {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: center;
    }
    .show {
      padding: 2px 10px;
      border-radius: var(--radius-pill);
      font-weight: 700;
      font-size: var(--fs-xs);
      color: var(--chall-ink);
      background: linear-gradient(90deg, var(--chall), var(--neuro));
    }
    .vs {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      gap: 12px;
      align-items: center;
      font-size: var(--fs-lg);
    }
    .vs b:last-child {
      text-align: right;
    }
    .v {
      font-family: var(--font-display);
      font-style: italic;
      font-size: var(--fs-2xl);
      color: var(--muted);
    }
    .win {
      color: var(--live);
    }
    .pot {
      color: var(--neuro);
      font-weight: 700;
    }
    .fr {
      color: var(--live);
    }
    .rec {
      color: var(--chall);
      font-weight: 700;
    }
    .mfoot .btn {
      margin-left: auto;
    }
    .list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 4px;
    }
    .list li {
      display: grid;
      grid-template-columns: 3.4em minmax(0, 1fr) auto auto;
      gap: 10px;
      align-items: center;
      padding: 6px 10px;
      border-radius: var(--radius-sm);
      background: var(--panel-2);
    }
    .list li.mine {
      box-shadow: inset 3px 0 0 var(--chall);
    }
    .t {
      color: var(--muted);
    }
    .who {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      align-items: baseline;
    }
    .st {
      color: var(--text-2);
    }
  `,
})
export class UdtChallengeEveningsPage {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  protected readonly data = signal<UdtChallengeEvenings | null>(null);

  /** Today and later first (soonest first), then the past (newest first). */
  protected readonly groups = computed(() => {
    const d = this.data();
    if (!d) return [];
    return [
      { key: 'udt.ch.ev.coming', days: d.days.filter((x) => x.date >= d.today) },
      { key: 'udt.ch.ev.past', days: d.days.filter((x) => x.date < d.today).reverse() },
    ];
  });

  constructor() {
    void this.load();
  }

  async load() {
    try {
      this.data.set(await this.api.udtChallengeEvenings());
    } catch {
      // the toast shows the error
    }
  }

  protected main(day: { main: string | null; items: Item[] }): Item | null {
    return day.items.find((c) => c.id === day.main) ?? null;
  }

  protected others(day: { main: string | null; items: Item[] }): Item[] {
    return day.items.filter((c) => c.id !== day.main);
  }

  protected whenDay(d: string): string {
    return this.i18n.whenDay(d, 'dayLong');
  }

  protected neuro(n: number): string {
    return formatNeuro(n, this.i18n.lang());
  }

  protected hard(c: UdtChallenge): string {
    return this.i18n.t(`udt.ch.hard.${c.hardness ?? 'normal'}`);
  }

  protected format(c: UdtChallenge): string {
    return c.mode === 'mh' ? `MH · ${this.hard(c)}` : `${c.teamSize}v${c.teamSize} · Bo${c.bestOf}`;
  }

  protected state(c: UdtChallenge): string {
    if (c.status !== 'played') return this.i18n.t(`udt.ch.st.${c.status}`);
    return this.i18n.t(c.reason === 'forfeit' ? 'udt.ch.ev.forfeit' : 'udt.ch.st.played');
  }
}
