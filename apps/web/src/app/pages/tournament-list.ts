import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { finalMs, raceTime } from '../core/race';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import type { TournamentSummary } from '../core/types';

@Component({
  selector: 'app-tournament-list',
  imports: [RouterLink, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h1>{{ 'list.title' | t }}</h1>
      @if (auth.me()?.isAdmin) {
        <div class="row">
          <a class="btn" routerLink="/admin/series">{{ 'series.title' | t }}</a>
          <a class="btn primary" routerLink="/new">+ {{ 'list.new' | t }}</a>
        </div>
      }
    </div>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (items(); as list) {
      @for (t of live(); track t.id) {
        <a class="hero" [routerLink]="['/t', t.id]">
          <div class="hero-l">
            <div class="row">
              <span class="badge" [class]="t.phase">{{ 'phase.' + t.phase | t }}</span>
              @if (t.seasonal) {
                <span class="badge season">Season</span>
              }
            </div>
            <div class="hero-name">{{ t.name }}</div>
            <div class="muted small">{{ meta(t) }}</div>
          </div>
          @if (t.now; as n) {
            <div class="hero-r">
              <div class="kpi">
                {{ 'list.now' | t }} · {{ n.matchId }} · {{ 'list.game' | t: { n: n.game } }}
                @if (n.live?.map ?? n.map; as map) {
                  · {{ map }}
                }
              </div>
              <div class="vs">
                <span class="nm a">{{ n.names[0] }}</span>
                @if (t.game === 'mh') {
                  <span class="sc race"
                    ><b class="sa">{{ runText(n, 0) }}</b
                    ><i>:</i><b class="sb">{{ runText(n, 1) }}</b></span
                  >
                } @else {
                  <span class="sc"
                    ><b class="sa">{{ n.live?.scores?.[n.entrants[0]] ?? '–' }}</b
                    ><i>:</i><b class="sb">{{ n.live?.scores?.[n.entrants[1]] ?? '–' }}</b></span
                  >
                }
                <span class="nm b">{{ n.names[1] }}</span>
              </div>
              <div class="state small">
                @if (n.live?.phase === 'live' || n.live?.phase === 'overtime') {
                  <span class="lv"><span class="dot on"></span> {{ 'list.liveNow' | t }}</span>
                } @else {
                  <span class="muted">{{ 'list.phase.' + (n.live?.phase ?? 'waiting') | t }}</span>
                }
                @if (n.bestOf > 1) {
                  <span class="muted"
                    >· {{ 'list.series' | t }} {{ n.wins[0] }}:{{ n.wins[1] }} (Bo{{
                      n.bestOf
                    }})</span
                  >
                }
              </div>
            </div>
          }
        </a>
      }
      <div class="tabs" role="tablist">
        @for (f of filters; track f) {
          <button
            type="button"
            role="tab"
            [class.active]="filter() === f"
            [attr.aria-selected]="filter() === f"
            (click)="filter.set(f)"
          >
            {{ 'list.filter.' + f | t }} <span class="count">{{ count(f) }}</span>
          </button>
        }
      </div>
      @if (!shown().length) {
        <p class="muted">{{ 'list.empty' | t }}</p>
      }
      <div class="cards">
        @for (t of shown(); track t.id) {
          <a class="item" [routerLink]="['/t', t.id]">
            <div class="row">
              <span class="badge" [class]="t.phase">{{ 'phase.' + t.phase | t }}</span>
              @if (t.seasonal) {
                <span class="badge season">Season</span>
              }
              @if (t.registeredMe) {
                <span class="me">{{ 'list.youPlay' | t }}</span>
              }
            </div>
            <div class="name">{{ t.name }}</div>
            <div class="muted small">{{ meta(t) }}</div>
            <div class="foot">
              @if (t.champion) {
                <span class="champ"
                  ><svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M7 4h10v5a5 5 0 0 1-10 0zM5 5H3v2a4 4 0 0 0 4 4M19 5h2v2a4 4 0 0 1-4 4M12 14v4M8 21h8"
                      fill="none"
                      stroke="var(--neuro)"
                      stroke-width="2"
                      stroke-linecap="round"
                    /></svg
                  >{{ t.champion }}</span
                >
              } @else if (t.scheduledAt) {
                <span>{{ i18n.date(t.scheduledAt) }}</span>
              } @else if (t.phase === 'draft' && t.registrationOpen) {
                <span class="open">{{ 'list.open' | t }}</span>
              } @else {
                <span></span>
              }
              <span class="mono muted">{{ fill(t) }}</span>
            </div>
            @if (t.phase === 'draft') {
              <div class="bar"><div [style.width.%]="fillPct(t)"></div></div>
            }
          </a>
        }
      </div>
    } @else {
      <p class="muted">{{ 'common.loading' | t }}</p>
    }
  `,
  styles: `
    .head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 22px;
    }
    .head h1 {
      font-size: 3.2rem;
      margin: 0;
    }
    .hero {
      display: flex;
      flex-wrap: wrap;
      border: 1px solid #1f4a55;
      border-radius: var(--radius);
      overflow: hidden;
      color: var(--text);
      margin-bottom: 22px;
      background: var(--panel);
    }
    .hero:hover {
      color: var(--text);
      border-color: var(--accent-dim);
    }
    .hero-l {
      flex: 1 1 380px;
      padding: 22px 26px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      background: #0c1219;
    }
    .hero-name {
      font-family: var(--font-display);
      font-weight: 800;
      font-style: italic;
      text-transform: uppercase;
      font-size: 2.4rem;
      line-height: 1;
    }
    .hero-r {
      flex: 1 1 380px;
      padding: 22px 26px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 12px;
      border-left: 1px solid var(--border);
    }
    .vs {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 14px;
    }
    .nm {
      font-weight: 700;
      font-size: 1.15rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nm.a {
      text-align: right;
    }
    .sc {
      font-family: var(--font-display);
      font-weight: 800;
      font-size: 2.5rem;
      line-height: 1;
    }
    .sc i {
      color: var(--muted);
      font-style: normal;
      font-size: 1.6rem;
      padding: 0 6px;
    }
    .sc.race {
      font-size: 1.7rem;
    }
    .state {
      display: flex;
      justify-content: center;
      gap: 6px;
    }
    .lv {
      color: var(--live);
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .sa {
      color: var(--side-a);
    }
    .sb {
      color: var(--side-b);
    }
    .count {
      font-family: var(--font-mono);
      font-size: 0.8em;
      color: var(--muted);
      margin-left: 4px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 16px;
    }
    .item {
      display: flex;
      flex-direction: column;
      gap: 10px;
      color: var(--text);
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px 20px;
      transition:
        border-color 0.12s,
        transform 0.12s;
    }
    .item:hover {
      color: var(--text);
      border-color: #2f3a4f;
      transform: translateY(-1px);
    }
    .name {
      font-family: var(--font-display);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      font-size: 1.65rem;
      line-height: 1.05;
    }
    .me {
      margin-left: auto;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--accent);
    }
    .foot {
      margin-top: auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      border-top: 1px solid var(--border);
      padding-top: 12px;
      font-size: 0.92rem;
    }
    .champ {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-weight: 600;
    }
    .open {
      color: var(--accent);
      font-weight: 600;
    }
    .bar {
      height: 6px;
      border-radius: 3px;
      background: var(--panel-2);
      overflow: hidden;
    }
    .bar div {
      height: 100%;
      background: var(--accent);
    }
    @media (max-width: 640px) {
      .head h1 {
        font-size: 2.4rem;
      }
      .hero-r {
        border-left: 0;
        border-top: 1px solid var(--border);
      }
      .hero-name {
        font-size: 2rem;
      }
    }
  `,
})
export class TournamentListPage {
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  private readonly api = inject(Api);
  protected readonly items = signal<TournamentSummary[] | null>(null);
  protected readonly error = signal('');

  /** Monster Hunt: a side's finished run (final time), the running clock, or a dash. */
  protected runText(n: NonNullable<TournamentSummary['now']>, i: 0 | 1): string {
    const id = n.entrants[i];
    const done = n.runs?.find((r) => r.entrantId === id);
    if (done)
      return done.finished
        ? raceTime(finalMs(done), false)
        : this.i18n.t(done.forfeit ? 'race.forfeit' : 'race.dnf');
    const r = n.live?.race;
    return r && r.runner === id ? raceTime(r.timeMs + r.penaltyMs, false) : '–';
  }

  protected readonly filters = ['all', 'live', 'open', 'done'] as const;
  protected readonly filter = signal<(typeof this.filters)[number]>('all');
  /** Running tournaments: shown big on top. */
  protected readonly live = computed(() =>
    (this.items() ?? []).filter((t) => t.phase === 'running' || t.phase === 'paused'),
  );
  protected readonly shown = computed(() =>
    (this.items() ?? []).filter((t) => this.matches(t, this.filter())),
  );

  private matches(t: TournamentSummary, f: (typeof this.filters)[number]): boolean {
    if (f === 'live') return ['seeded', 'checkIn', 'running', 'paused'].includes(t.phase);
    if (f === 'open') return t.phase === 'draft';
    if (f === 'done') return t.phase === 'finished' || t.phase === 'aborted';
    return true;
  }

  protected count(f: (typeof this.filters)[number]): number {
    return (this.items() ?? []).filter((t) => this.matches(t, f)).length;
  }

  protected meta(t: TournamentSummary): string {
    const tr = (k: string, p?: Record<string, string | number>) => this.i18n.t(k, p);
    const mode =
      t.game === 'mh'
        ? `${tr('team.mode', { k: t.teamSize })} ${tr('race.mode')}`
        : t.teamSize > 1
          ? tr('team.mode', { k: t.teamSize })
          : '1v1';
    const size = `${t.size} ${tr(t.teamSize > 1 ? 'list.teams' : 'list.slots')}`;
    return `${mode} · ${tr('format.' + t.format)} · ${size}`;
  }

  /** "9 / 16" registered (teams in team tournaments). */
  protected fill(t: TournamentSummary): string {
    return `${t.teamSize > 1 ? t.teams : t.registered} / ${t.size}`;
  }

  protected fillPct(t: TournamentSummary): number {
    return Math.min(100, (100 * (t.teamSize > 1 ? t.teams : t.registered)) / Math.max(1, t.size));
  }

  constructor() {
    void this.load();
    // While a tournament runs the banner shows the live score: refresh every few seconds.
    const timer = setInterval(() => {
      if (this.live().length) void this.load();
    }, 4000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private async load() {
    try {
      this.items.set(await this.api.tournaments());
    } catch (e) {
      this.error.set(errorText(e));
    }
  }
}
