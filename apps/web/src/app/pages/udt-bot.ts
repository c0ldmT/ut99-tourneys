import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { UdtPotential } from '../components/udt-potential';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import { NeuroPipe } from '../core/neuro';
import { PageTitle } from '../core/page-title';
import type { StatsPlayerRow, UdtBotPage } from '../core/types';
import { botRarity, rosterCard, UdtCard, UdtNav, type CardBot } from '../core/udt';

/**
 * A bot as Dream Team sees it: its card with team, level, traits and potential, its career and
 * its statistics from the Dream Team tournaments (this season, all seasons, latest matches). The
 * website's bot profile (normal tournaments) is linked only when the bot plays there too.
 */
@Component({
  selector: 'app-udt-bot',
  imports: [RouterLink, TPipe, NeuroPipe, UdtNav, UdtCard, UdtPotential],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    @if (p(); as p) {
      <p>
        @if (p.team; as tm) {
          <a [routerLink]="['/udt/squads', tm.userId]"
            >← <b style="color: var(--hot-text)">{{ tm.tag }}</b> {{ tm.name }}</a
          >
        } @else {
          <a routerLink="/udt/market">← {{ 'udt.nav.market' | t }}</a>
        }
      </p>
      <div class="udt-head">
        <div>
          <h1 class="disp">{{ p.bot.gameName }}</h1>
          <p class="muted ub-sub">
            @if (p.team; as tm) {
              <span>{{ 'udt.squads.managedBy' | t: { name: tm.manager } }}</span>
              @if (tm.ai) {
                <span class="udt-mark">{{ 'udt.ai' | t }}</span>
              }
              @if (tm.mine) {
                <span class="udt-mark own">{{ 'udt.squads.mine' | t }}</span>
              }
            } @else {
              <span>{{ 'udt.bot.free' | t }}</span>
            }
            @if (p.roster?.starter) {
              <span class="udt-mark own">{{ 'udt.starter' | t }}</span>
            } @else if (p.made; as m) {
              <span class="udt-mark own">{{ 'udt.academy.origin.' + m.origin | t }}</span>
              <span>{{ 'udt.bot.madeBy' | t: { name: m.breeder, s: m.season } }}</span>
            }
          </p>
        </div>
        <div class="udt-kpis">
          <div>
            <div class="kpi">{{ 'udt.bot.games' | t }}</div>
            <div class="v">{{ kpi()?.games ?? 0 }}</div>
          </div>
          <div>
            <div class="kpi">{{ 'udt.bot.wins' | t }}</div>
            <div class="v">{{ kpi()?.gamesWon ?? 0 }}</div>
          </div>
          @if (!p.roster?.starter && p.bot.value !== null) {
            <div>
              <div class="kpi">{{ 'udt.bot.value' | t }}</div>
              <div class="v">{{ p.bot.value | neuro }}</div>
            </div>
          }
        </div>
      </div>

      <div class="ub-grid">
        <div class="ub-left">
          <udt-card [bot]="card()!" />
          @if (p.roster?.own; as own) {
            <udt-potential [skill]="p.roster!.skill" [potential]="own.potential" />
          }
          @if (p.team?.mine) {
            <a class="btn primary" routerLink="/udt" [queryParams]="{ bot: p.bot.id }">{{
              'udt.bot.openTeam' | t
            }}</a>
          }
        </div>

        <div class="ub-right">
          <section class="card">
            <h2>{{ 'udt.bot.stats' | t }}</h2>
            @if (p.lifetime) {
              <div class="tablepanel ub-scroll">
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th class="num">{{ 'udt.bot.games' | t }}</th>
                      <th class="num">{{ 'udt.bot.wins' | t }}</th>
                      <th class="num">{{ 'udt.bot.winRate' | t }}</th>
                      <th class="num">K / D</th>
                      <th class="num">{{ 'udt.bot.damage' | t }}</th>
                      <th class="num ub-opt">{{ 'udt.bot.spree' | t }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (r of rows(); track r.label) {
                      <tr>
                        <td class="ub-nw">{{ r.label }}</td>
                        @if (r.row; as x) {
                          <td class="num mono">{{ x.games }}</td>
                          <td class="num mono">{{ x.gamesWon }}</td>
                          <td class="num mono">{{ rate(x) }}</td>
                          <td class="num mono" [title]="x.kills + ' / ' + x.deaths">
                            {{ x.kd.toFixed(2) }}
                          </td>
                          <td class="num mono">{{ x.damageGames ? x.damageDealt : '–' }}</td>
                          <td class="num mono ub-opt">{{ x.bestSpree }}</td>
                        } @else {
                          <td class="num mono muted" colspan="6">–</td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="muted">{{ 'udt.bot.noGames' | t }}</p>
            }
          </section>

          @if (p.recent.length) {
            <section class="card">
              <h2>{{ 'udt.bot.recent' | t }}</h2>
              <ul class="ub-recent">
                @for (m of p.recent; track m.tournamentId + m.matchId) {
                  <li>
                    <span class="ub-res" [class.won]="m.won">{{
                      (m.won ? 'udt.bot.won' : 'udt.bot.lost') | t
                    }}</span>
                    <a [routerLink]="['/t', m.tournamentId, 'm', m.matchId]"
                      >{{ m.tournamentName }} · {{ m.matchId }}</a
                    >
                    <span class="muted small">{{ 'udt.bot.vs' | t: { team: m.opponent } }}</span>
                  </li>
                }
              </ul>
            </section>
          }

          @if (p.career; as c) {
            <section class="card">
              <h2>{{ 'udt.career.title' | t }}</h2>
              <dl class="ub-career">
                <dt>{{ 'udt.career.phase' | t }}</dt>
                <dd>{{ 'udt.career.' + c.phase | t }}</dd>
                <dt>{{ 'udt.career.ageLabel' | t }}</dt>
                <dd>{{ 'udt.career.seasons' | t: { n: c.age } }}</dd>
                <dt>{{ 'udt.career.level' | t }}</dt>
                <dd>{{ c.level }}</dd>
                <dt>{{ 'udt.career.gamesLabel' | t }}</dt>
                <dd>{{ c.games }} ({{ c.wins }} {{ 'udt.career.wins' | t }})</dd>
                <dt>{{ 'udt.career.form' | t }}</dt>
                <dd [title]="'udt.form.title.' + c.form | t">
                  {{ 'udt.career.form.' + c.form | t }}
                </dd>
              </dl>
              <p class="muted small">
                {{ 'udt.career.effect.' + c.phase | t }} {{ 'udt.bot.careerAll' | t }}
              </p>
            </section>
          }

          @if (p.normalGames > 0) {
            <p class="small">
              <a [routerLink]="['/bots', p.bot.id]">{{
                'udt.bot.normal' | t: { n: p.normalGames }
              }}</a>
            </p>
          }
        </div>
      </div>
    }
  `,
  styles: `
    .ub-sub {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .ub-grid {
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr);
      gap: 20px;
      align-items: start;
      margin-top: 16px;
    }
    .ub-left {
      display: grid;
      gap: 12px;
    }
    .ub-right {
      display: grid;
      gap: 16px;
      min-width: 0;
    }
    .ub-right > * {
      min-width: 0;
    }
    .ub-scroll {
      overflow-x: auto;
    }
    .ub-nw {
      white-space: nowrap;
    }
    .ub-right .card h2 {
      margin-top: 0;
    }
    .ub-recent {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
    }
    .ub-recent li {
      display: flex;
      gap: 8px;
      align-items: baseline;
      flex-wrap: wrap;
    }
    .ub-res {
      min-width: 64px;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--danger);
    }
    .ub-res.won {
      color: var(--live);
    }
    .ub-career {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 16px;
      margin: 0 0 8px;
    }
    .ub-career dt {
      color: var(--muted);
    }
    .ub-career dd {
      margin: 0;
    }
    @media (max-width: 760px) {
      .ub-grid {
        grid-template-columns: minmax(0, 1fr);
      }
      .ub-left {
        max-width: 280px;
      }
      .ub-opt {
        display: none;
      }
    }
  `,
})
export class UdtBotProfilePage {
  private readonly api = inject(Api);
  private readonly title = inject(PageTitle);
  readonly id = input.required<string>();
  protected readonly p = signal<UdtBotPage | null>(null);

  protected readonly card = computed<CardBot | null>(() => {
    const p = this.p();
    if (!p) return null;
    if (p.roster) return rosterCard({ ...p.roster, career: p.career }, p.team?.tag);
    return {
      name: p.bot.name,
      skill: p.bot.skill,
      rarity: botRarity(p.bot.skill),
      traits: p.bot.traits,
      ...(p.bot.value !== null ? { value: p.bot.value } : {}),
      career: p.career,
    };
  });

  protected readonly rows = computed(() => {
    const p = this.p();
    if (!p) return [];
    const rows: { label: string; row: StatsPlayerRow | null }[] = [];
    if (p.season !== null) rows.push({ label: this.seasonLabel(p.season), row: p.stats });
    // All seasons only when the bot played Dream Team before this season (or between seasons).
    if (p.season === null || (p.lifetime?.games ?? 0) > (p.stats?.games ?? 0))
      rows.push({ label: this.allLabel(), row: p.lifetime });
    return rows;
  });
  /** The head's games and wins: this season, between seasons all of them. */
  protected readonly kpi = computed(() => {
    const p = this.p();
    return p ? (p.season === null ? p.lifetime : p.stats) : null;
  });

  private readonly i18n = inject(I18n);

  constructor() {
    effect(() => {
      this.id();
      // Another bot (back and forward): not the last one's page meanwhile.
      this.p.set(null);
      void this.load();
    });
    effect(() => this.title.set(this.p()?.bot.gameName));
    inject(DestroyRef).onDestroy(() => this.title.set(null));
  }

  async load() {
    const id = this.id();
    try {
      const p = await this.api.udtBot(id);
      if (id === this.id()) this.p.set(p);
    } catch {
      // the toast shows the error
    }
  }

  protected rate(r: StatsPlayerRow) {
    return r.games ? `${Math.round((r.gamesWon / r.games) * 100)} %` : '–';
  }

  private seasonLabel(n: number) {
    return this.i18n.t('udt.bot.season', { n });
  }

  private allLabel() {
    return this.i18n.t('udt.bot.allSeasons');
  }
}
