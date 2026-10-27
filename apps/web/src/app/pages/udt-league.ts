import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnDestroy,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { relegationPairs } from '@tourney/udt';
import { map } from 'rxjs';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import { Loading } from '../core/loading';
import type { LeagueGame, LeagueHistorySeason, LeagueRow, LeagueView } from '../core/types';
import { UdtNav } from '../core/udt';

/** A played league game with the pause before the next (as GAME_MINUTES of the API). */
const GAME_MS = 4 * 60_000;

const VIEWS = ['table', 'day', 'plan', 'final', 'history'] as const;
type LeagueTab = (typeof VIEWS)[number];

/** Zones of a table: final four, promotion, relegation ties, relegation. */
type Zone = 'final' | 'up' | 'relup' | 'rel' | 'down' | '';

/**
 * Dream Team league (design "Dream Team Liga"): the table of every tier with its zones and
 * form, the matchday as a conference (games on the server one after another, AI games ticking
 * in), the fixture list, the season's finale (final four, relegation, moves) and the history.
 */
@Component({
  selector: 'app-udt-league',
  imports: [TPipe, RouterLink, UdtNav, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    @if (view(); as v) {
      @if (!v.run) {
        <div class="card">
          <h1 class="disp">{{ 'league.title' | t }}</h1>
          <p class="muted">{{ (v.enabled ? 'league.none.on' : 'league.none.off') | t }}</p>
        </div>
        <!-- Former seasons stay readable without a league this season. -->
        @for (h of history(); track h.season) {
          <section class="lg-card">
            <div class="lg-sechead">
              <h3>Season {{ h.season }}{{ h.test ? ' · ' + ('league.test' | t) : '' }}</h3>
              @if (h.champion; as c) {
                <span class="small"
                  >{{ 'league.champion' | t }}: <b>{{ c.name }}</b></span
                >
              }
            </div>
          </section>
        }
      } @else {
        <div class="lg-top">
          <div>
            <div class="kpi lg-kick">
              {{
                'league.kicker' | t: { s: v.season, md: playedMatchday(), n: v.run.matchdays ?? 0 }
              }}
              @if (v.run.test) {
                · {{ 'league.test' | t }}
              }
            </div>
            <h1 class="disp lg-h1">{{ 'league.title' | t }}</h1>
          </div>
          <!-- The views are the tabs of the league area in the Dream Team navigation (228). -->
        </div>

        @switch (tab()) {
          @case ('table') {
            @for (g of runningGames(); track g.id) {
              <a class="lg-livelink" [routerLink]="['/t', g.tournament!.id]">
                <b class="lg-up">● LIVE</b>
                <span>{{ g.home.name }} – {{ g.away.name }}</span>
                <span aria-hidden="true">›</span>
              </a>
            }
            <div class="lg-cols">
              <section class="lg-card lg-main" [attr.aria-label]="'league.view.table' | t">
                <div class="lg-bar">
                  @for (tb of v.tables ?? []; track tb.tier) {
                    <button
                      type="button"
                      class="lg-tier"
                      [class.on]="tier() === tb.tier"
                      [attr.aria-pressed]="tier() === tb.tier"
                      (click)="tier.set(tb.tier)"
                    >
                      {{ tierName(tb.tier) }}
                    </button>
                  }
                  <span class="muted small lg-note">{{ tableNote() }}</span>
                </div>
                <div class="lg-scroll">
                  <table class="lg-table">
                    <thead>
                      <tr>
                        <th scope="col" class="l">#</th>
                        <th scope="col" class="l">{{ 'league.col.team' | t }}</th>
                        <th scope="col">{{ 'league.col.played' | t }}</th>
                        <th scope="col" class="opt" [title]="'league.col.wonT' | t">
                          {{ 'league.col.won' | t }}
                        </th>
                        <th scope="col" class="opt" [title]="'league.col.wonOtT' | t">
                          {{ 'league.col.wonOt' | t }}
                        </th>
                        <th scope="col" class="opt" [title]="'league.col.lostOtT' | t">
                          {{ 'league.col.lostOt' | t }}
                        </th>
                        <th scope="col" class="opt">{{ 'league.col.lost' | t }}</th>
                        <th scope="col" class="opt">{{ 'league.col.frags' | t }}</th>
                        <th scope="col">{{ 'league.col.diff' | t }}</th>
                        <th scope="col">{{ 'league.col.points' | t }}</th>
                        <th scope="col" class="l opt">{{ 'league.col.form' | t }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (r of rows(); track r.club) {
                        @let z = zone(r.place);
                        <tr [class]="'lg-z-' + (z || 'none')" [class.me]="r.me">
                          <td class="l pl">{{ r.place }}</td>
                          <td class="l">
                            <span class="lg-team">
                              <span class="lg-tag opt" [class.me]="r.me">{{
                                shortTag(r.tag)
                              }}</span>
                              <span class="nm">{{ r.name }}</span>
                              <span
                                class="lg-chip"
                                [class.me]="r.me"
                                [class.mgr]="r.manager && !r.me"
                                >{{ chip(r) | t }}</span
                              >
                            </span>
                          </td>
                          <td class="lg-dim">{{ r.played }}</td>
                          <td class="opt">{{ r.won }}</td>
                          <td class="lg-dim opt">{{ r.wonOt }}</td>
                          <td class="lg-dim opt">{{ r.lostOt }}</td>
                          <td class="opt">{{ r.lost }}</td>
                          <td class="mono lg-dim opt">{{ r.fragsFor }}:{{ r.fragsAgainst }}</td>
                          <td
                            class="mono"
                            [class.lg-up]="diff(r) >= 0"
                            [class.lg-down]="diff(r) < 0"
                          >
                            {{ diff(r) > 0 ? '+' : '' }}{{ diff(r) }}
                          </td>
                          <td class="pts">{{ r.points }}</td>
                          <td class="l opt">
                            <span class="lg-form">
                              @for (f of r.form; track $index) {
                                <span [class]="'f-' + f" [title]="'league.form.' + f | t">{{
                                  'league.formShort.' + f | t
                                }}</span>
                              }
                            </span>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
                <div class="lg-legend small">
                  @for (z of legend(); track z.zone) {
                    <span><i [class]="'lg-z-' + z.zone"></i>{{ z.text }}</span>
                  }
                </div>
              </section>
              <aside class="lg-side">
                @if (v.next; as n) {
                  <section class="lg-card lg-next">
                    <div class="kpi">{{ 'league.next' | t }}</div>
                    <div class="lg-when">{{ gameTitle(n) }} · {{ when(n.scheduledAt) }}</div>
                    <div class="lg-vs">
                      <div>
                        <b>{{ n.home.name }}</b>
                        <span class="muted small">{{
                          'league.placeHome' | t: { p: n.place ?? '–' }
                        }}</span>
                      </div>
                      <span class="mono muted">vs</span>
                      <div>
                        <b>{{ n.away.name }}</b>
                        <span class="muted small">{{
                          (n.away.manager ? 'league.placeMgr' : 'league.placeAi')
                            | t: { p: n.awayPlace ?? '–' }
                        }}</span>
                      </div>
                    </div>
                    <p class="muted small">
                      {{ n.map ? n.map + ' · ' : ''
                      }}{{
                        (n.home.me ? 'league.nextHome' : 'league.nextAway')
                          | t: { home: n.home.name }
                      }}
                    </p>
                    <a class="btn primary lg-wide" routerLink="/udt/team">{{
                      'league.checkLineup' | t
                    }}</a>
                  </section>
                }
                <section class="lg-card">
                  <div class="kpi">{{ 'league.seasonTitle' | t }}</div>
                  <ol class="lg-steps">
                    @for (st of steps(); track st.key) {
                      <li [class.now]="st.now" [class.done]="st.done"><i></i>{{ st.text }}</li>
                    }
                  </ol>
                </section>
                <section class="lg-card small muted">
                  <div class="kpi">{{ 'league.scoring' | t }}</div>
                  <p>{{ 'league.scoringText' | t }}</p>
                  <p>
                    {{ 'league.moneyText' | t }}
                    <span class="neuro mono">{{ moneyText() }}</span>
                  </p>
                </section>
              </aside>
            </div>
          }
          @case ('day') {
            <div class="lg-dayhead">
              <div>
                <div class="kpi lg-kick">{{ dayKicker() }}</div>
                <h2 class="disp lg-h2">
                  {{ dayTitle() }}
                  @if (liveNow()) {
                    <span class="lg-live-b">LIVE</span>
                  }
                </h2>
              </div>
              <div class="pills" role="group" [attr.aria-label]="'league.filter' | t">
                @for (f of filters; track f) {
                  <button
                    type="button"
                    [class.on]="filter() === f"
                    [attr.aria-pressed]="filter() === f"
                    (click)="filter.set(f)"
                  >
                    {{ 'league.filter.' + f | t }}
                  </button>
                }
              </div>
            </div>
            <div class="lg-cols">
              <div class="lg-main lg-stack">
                @if (filter() !== 'sim') {
                  <section class="lg-card">
                    <div class="lg-sechead">
                      <h3>{{ 'league.server' | t }}</h3>
                      <span class="muted small">{{ 'league.serverHint' | t }}</span>
                    </div>
                    @for (g of runningGames(); track g.id) {
                      <a class="lg-run" [routerLink]="['/t', g.tournament!.id]">
                        <span class="lg-runhead small">
                          <b class="lg-up">● {{ 'league.badge.live' | t }}</b>
                          <span
                            >{{ g.map ?? '' }} · 5v5 ·
                            {{ 'league.fragLimit' | t: { n: v.rules?.fragLimit ?? 30 } }}</span
                          >
                        </span>
                        <span class="lg-runteams">
                          <span class="r"
                            >{{ g.home.name }}
                            <span
                              class="lg-chip"
                              [class.me]="g.home.me"
                              [class.mgr]="g.home.manager && !g.home.me"
                              >{{ chip(g.home) | t }}</span
                            ></span
                          >
                          <span class="mono muted">vs</span>
                          <span
                            >{{ g.away.name }}
                            <span
                              class="lg-chip"
                              [class.me]="g.away.me"
                              [class.mgr]="g.away.manager && !g.away.me"
                              >{{ chip(g.away) | t }}</span
                            ></span
                          >
                        </span>
                        <span class="muted small">{{ 'league.runHint' | t }}</span>
                      </a>
                    }
                    @for (g of queue(); track g.id) {
                      <div class="lg-q">
                        <span class="lg-badge" [class]="'b-' + badge(g)">{{
                          'league.badge.' + badge(g) | t
                        }}</span>
                        <span class="lg-qteams">
                          <span [class.lg-win]="g.winner === g.home.id">{{ g.home.name }}</span>
                          <span class="muted">vs</span>
                          <span [class.lg-win]="g.winner === g.away.id">{{ g.away.name }}</span>
                        </span>
                        <span class="mono small muted">{{ info(g) }}</span>
                        @if (g.tournament; as t) {
                          <a class="lg-bet" [class.done]="!!g.winner" [routerLink]="['/t', t.id]">{{
                            (g.winner ? 'league.toGame' : 'league.bet') | t
                          }}</a>
                        }
                      </div>
                    }
                    @if (!realGames().length) {
                      <p class="muted small lg-pad">{{ 'league.noReal' | t }}</p>
                    }
                  </section>
                }
                @if (filter() !== 'real') {
                  <section class="lg-card">
                    <div class="lg-sechead">
                      <h3>{{ 'league.conference' | t }}</h3>
                      <span class="muted small">{{ 'league.conferenceHint' | t }}</span>
                    </div>
                    <div class="lg-sims">
                      @for (g of simGames(); track g.id) {
                        <div class="lg-sim">
                          <div [class.lg-win]="g.winner === g.home.id">
                            <span>{{ g.home.name }}</span
                            ><b class="mono">{{ g.homeFrags ?? '·' }}</b>
                          </div>
                          <div [class.lg-win]="g.winner === g.away.id">
                            <span>{{ g.away.name }}</span
                            ><b class="mono">{{ g.awayFrags ?? '·' }}</b>
                          </div>
                          <div class="muted small">
                            {{
                              g.winner
                                ? ('league.simulated' | t) + (g.overtime ? ' · OT' : '')
                                : ('league.simPending' | t)
                            }}
                          </div>
                        </div>
                      } @empty {
                        <p class="muted small">{{ 'league.noSim' | t }}</p>
                      }
                    </div>
                  </section>
                }
              </div>
              <aside class="lg-side">
                <section class="lg-card">
                  <h3>{{ 'league.liveTable' | t }}</h3>
                  <ol class="lg-live">
                    @for (r of liveRows(); track r.club) {
                      <li
                        [class.me]="r.me"
                        [class.lg-gap]="$index > 0 && r.place > liveRows()[$index - 1]!.place + 1"
                      >
                        <span class="pl">{{ r.place }}</span>
                        <span
                          class="mv"
                          role="img"
                          [class.lg-up]="r.move > 0"
                          [class.lg-down]="r.move < 0"
                          [attr.aria-label]="
                            (r.move > 0
                              ? 'league.moveUp'
                              : r.move < 0
                                ? 'league.moveDown'
                                : 'league.moveSame'
                            ) | t
                          "
                          >{{ r.move > 0 ? '▲' : r.move < 0 ? '▼' : '–' }}</span
                        >
                        <span class="nm">{{ r.name }}</span>
                        <b>{{ r.points }}</b>
                      </li>
                    }
                  </ol>
                </section>
                @if (v.evening; as e) {
                  <section class="lg-card">
                    <h3>{{ 'league.serverToday' | t }}</h3>
                    <div class="lg-tl">
                      <div>
                        <span class="mono">{{ time(e.slot) }}</span
                        ><span>{{
                          'league.slotLine' | t: { n: e.games, min: minutes(e.slot, e.until) }
                        }}</span>
                      </div>
                      @for (c of e.cups; track c.name) {
                        <div class="muted">
                          <span class="mono">{{ time(c.scheduledAt) }}</span
                          ><span>{{ c.name }}</span>
                        </div>
                      }
                    </div>
                    <p class="muted small">{{ 'league.slotHint' | t }}</p>
                  </section>
                }
              </aside>
            </div>
          }
          @case ('plan') {
            <section class="lg-card">
              <div class="lg-bar">
                @for (tb of v.tables ?? []; track tb.tier) {
                  <button
                    type="button"
                    class="lg-tier"
                    [class.on]="tier() === tb.tier"
                    [attr.aria-pressed]="tier() === tb.tier"
                    (click)="tier.set(tb.tier)"
                  >
                    {{ tierName(tb.tier) }}
                  </button>
                }
                @if (v.myClub?.tier === tier()) {
                  <label class="switch small lg-note"
                    ><input
                      type="checkbox"
                      [checked]="mineOnly()"
                      (change)="mineOnly.set(!mineOnly())"
                    /><span class="tr"></span>{{ 'league.mineOnly' | t }}</label
                  >
                }
              </div>
              @for (d of planDays(); track d.day) {
                <h3 class="lg-pday">
                  {{ dayName(d.day) }} · {{ 'league.mdList' | t: { md: d.mds } }}
                </h3>
                <div class="lg-plist">
                  @for (g of d.games; track g.id) {
                    <div class="lg-prow" [class.me]="g.home.me || g.away.me">
                      <span class="small muted">{{ g.matchday }}</span>
                      <span class="r" [class.lg-win]="g.winner === g.home.id">{{
                        g.home.name
                      }}</span>
                      <span class="mono">{{ score(g) }}</span>
                      <span [class.lg-win]="g.winner === g.away.id">{{ g.away.name }}</span>
                      <span class="small muted">{{ g.real ? ('league.real' | t) : '' }}</span>
                    </div>
                  }
                </div>
              }
            </section>
          }
          @case ('final') {
            <section class="lg-card lg-ff" aria-labelledby="lg-ff">
              <div class="lg-sechead">
                <h3 id="lg-ff">{{ 'league.ff' | t }}</h3>
                <span class="muted small">{{
                  'league.ffHint' | t: { day: dayName(v.run.plan.final) }
                }}</span>
              </div>
              <div class="lg-ffgrid">
                <div class="lg-stack">
                  <div class="kpi">{{ 'league.semis' | t }}</div>
                  @for (g of byKind('semi'); track g.id) {
                    <ng-container *ngTemplateOutlet="tie; context: { $implicit: g, seeds: true }" />
                  } @empty {
                    <p class="muted small">{{ 'league.ffOpen' | t }}</p>
                  }
                </div>
                <div class="lg-stack">
                  <div class="kpi">{{ 'league.finalGame' | t }}</div>
                  @for (g of byKind('final'); track g.id) {
                    <ng-container *ngTemplateOutlet="tie; context: { $implicit: g, gold: true }" />
                  } @empty {
                    <p class="muted small">{{ 'league.ffOpen' | t }}</p>
                  }
                  <div class="kpi">{{ 'league.third' | t }}</div>
                  @for (g of byKind('third'); track g.id) {
                    <ng-container *ngTemplateOutlet="tie; context: { $implicit: g }" />
                  } @empty {
                    <p class="muted small">{{ 'league.ffOpen' | t }}</p>
                  }
                </div>
                <div class="lg-champ">
                  <svg
                    width="56"
                    height="56"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path
                      d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3"
                    ></path>
                  </svg>
                  <div class="lg-ctitle">{{ 'league.champion' | t }}</div>
                  <div class="disp lg-cname">{{ champion() ?? '–' }}</div>
                  <div class="muted small">{{ 'league.championHint' | t }}</div>
                </div>
              </div>
            </section>
            @for (tier of relegationTiers(); track tier) {
              <section class="lg-card" [attr.aria-labelledby]="'lg-rel' + tier">
                <div class="lg-sechead">
                  <h3 [id]="'lg-rel' + tier">
                    {{ 'league.relegation' | t: { a: tierName(tier - 1), b: tierName(tier) } }}
                  </h3>
                  <span class="muted small">{{
                    'league.relHint'
                      | t: { day: dayName(v.run.plan.relegation), a: tierName(tier - 1) }
                  }}</span>
                </div>
                <div class="lg-rels">
                  @for (g of relegation(tier); track g.id) {
                    <div class="lg-tie">
                      <div [class.lg-win]="g.winner === g.away.id">
                        <span
                          ><span class="lg-from up2"
                            >{{ tierShort(tier) }} · {{ placeIn(tier, g.away.id) }}</span
                          ><br />{{ g.away.name }}</span
                        ><b class="mono">{{ g.awayWins ?? '' }}</b>
                      </div>
                      <div [class.lg-win]="g.winner === g.home.id">
                        <span
                          ><span class="lg-from rel"
                            >{{ tierShort(tier - 1) }} · {{ placeIn(tier - 1, g.home.id) }}</span
                          ><br />{{ g.home.name }}</span
                        ><b class="mono">{{ g.homeWins ?? '' }}</b>
                      </div>
                      <div class="lg-res small muted">{{ relResult(g, tier) }}</div>
                    </div>
                  } @empty {
                    <p class="muted small">{{ 'league.relOpen' | t }}</p>
                  }
                </div>
              </section>
            }
            @if (moves().length) {
              <div class="lg-moves">
                @for (m of moves(); track m.key) {
                  <section class="lg-card">
                    <h3 class="lg-mh" [class.lg-up]="m.up" [class.lg-down]="!m.up">
                      {{ 'league.into' | t: { tier: tierName(m.tier), s: v.season + 1 } }}
                    </h3>
                    <ul>
                      @for (c of m.clubs; track c.id) {
                        <li>
                          <b>{{ c.name }}</b>
                          @if (c.manager) {
                            <span class="lg-chip" [class.me]="c.me" [class.mgr]="!c.me">{{
                              chip(c) | t
                            }}</span>
                          }
                          · {{ c.how }}
                        </li>
                      }
                    </ul>
                  </section>
                }
              </div>
            }
            <p class="muted small">{{ 'league.fallback' | t }}</p>
            <ng-template #tie let-g let-seeds="seeds" let-gold="gold">
              <div class="lg-tie" [class.gold]="gold">
                <div [class.lg-win]="g.winner === g.home.id">
                  <span>
                    @if (seeds) {
                      <span class="muted">{{ proPlace(g.home.id) }}</span>
                    }
                    {{ g.home.name }}
                    @if (g.home.manager) {
                      <span class="lg-chip" [class.me]="g.home.me" [class.mgr]="!g.home.me">{{
                        chip(g.home) | t
                      }}</span>
                    }</span
                  ><b class="mono">{{ g.homeWins ?? '' }}</b>
                </div>
                <div [class.lg-win]="g.winner === g.away.id">
                  <span>
                    @if (seeds) {
                      <span class="muted">{{ proPlace(g.away.id) }}</span>
                    }
                    {{ g.away.name }}
                    @if (g.away.manager) {
                      <span class="lg-chip" [class.me]="g.away.me" [class.mgr]="!g.away.me">{{
                        chip(g.away) | t
                      }}</span>
                    }</span
                  ><b class="mono">{{ g.awayWins ?? '' }}</b>
                </div>
              </div>
            </ng-template>
          }
          @case ('history') {
            @for (h of history(); track h.season) {
              <section class="lg-card">
                <div class="lg-sechead">
                  <h3>Season {{ h.season }}{{ h.test ? ' · ' + ('league.test' | t) : '' }}</h3>
                  @if (h.champion; as c) {
                    <span class="small"
                      >{{ 'league.champion' | t }}: <b>{{ c.name }}</b></span
                    >
                  }
                </div>
                <div class="lg-hist">
                  @for (tb of h.tiers; track $index) {
                    <div>
                      <div class="kpi">{{ tierName($index) }}</div>
                      <ol class="lg-live">
                        @for (r of tb; track r.name) {
                          <li>
                            <span class="pl">{{ r.place }}</span>
                            <span class="nm"
                              >{{ r.name }}
                              @if (r.manager) {
                                <span class="lg-chip mgr">{{ 'league.manager' | t }}</span>
                              }
                            </span>
                            <b>{{ r.points }}</b>
                          </li>
                        }
                      </ol>
                    </div>
                  }
                </div>
              </section>
            } @empty {
              <div class="card">
                <p class="muted">{{ 'league.noHistory' | t }}</p>
              </div>
            }
          }
        }
      }
    }
  `,
})
export class UdtLeaguePage implements OnDestroy {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  private readonly loading = inject(Loading);
  private readonly route = inject(ActivatedRoute);
  protected readonly filters = ['all', 'real', 'sim'] as const;
  protected readonly view = signal<LeagueView | null>(null);
  protected readonly history = signal<LeagueHistorySeason[]>([]);
  protected readonly tier = signal(0);
  protected readonly filter = signal<'all' | 'real' | 'sim'>('all');
  private readonly param = toSignal(this.route.paramMap.pipe(map((p) => p.get('view'))), {
    initialValue: this.route.snapshot.paramMap.get('view'),
  });
  protected readonly tab = computed<LeagueTab>(() => {
    const v = this.param();
    return (VIEWS as readonly string[]).includes(v ?? '') ? (v as LeagueTab) : 'table';
  });
  private timer?: ReturnType<typeof setInterval>;
  /** The website's clock minus the browser's (test mode shifts it). */
  private offset = 0;
  /** The website's time, renewed with the refresh timer. */
  private readonly now = signal(Date.now());

  constructor() {
    void this.load(true);
    // During the league evening the conference and the tables follow (quiet, in the background).
    this.timer = setInterval(() => {
      this.now.set(Date.now() + this.offset);
      if (this.evening()) this.loading.background(() => void this.load(false, true));
    }, 20_000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async load(first = false, quiet = false) {
    try {
      const v = await this.api.udtLeague(undefined, quiet);
      if (v.now) this.offset = Date.parse(v.now) - Date.now();
      this.now.set(Date.now() + this.offset);
      this.view.set(v);
      if (first && v.myClub?.tier !== null && v.myClub?.tier !== undefined)
        this.tier.set(v.myClub.tier);
      if (this.tab() === 'history' || first) this.history.set(await this.api.udtLeagueHistory());
    } catch {
      // the toast shows the error
    }
  }

  protected readonly rows = computed<LeagueRow[]>(
    () => this.view()?.tables?.find((t) => t.tier === this.tier())?.rows ?? [],
  );
  private readonly size = computed(() => this.view()?.run?.size ?? 16);
  private readonly tiers = computed(() => this.view()?.run?.tiers ?? 1);

  /** The zone of a place in the shown tier (as in promotion / finalFour of packages/udt). */
  protected zone(place: number): Zone {
    const n = this.size();
    const t = this.tier();
    const last = this.tiers() - 1;
    if (t === 0 && place <= 4) return 'final';
    if (t > 0 && place <= 2) return 'up';
    const pairs = this.relPairs();
    if (t > 0 && place <= 2 + (pairs[t] ?? 0)) return 'relup';
    if (t < last && place > n - 2) return 'down';
    if (t < last && place > n - 2 - (pairs[t + 1] ?? 0)) return 'rel';
    return '';
  }

  /** Relegation ties per boundary. */
  private readonly relPairs = computed(() => relegationPairs(this.tiers(), this.size()));

  /** The legend under the table: its zones with the places of the other tier. */
  protected readonly legend = computed(() => {
    const t = this.tier();
    const n = this.size();
    const last = this.tiers() - 1;
    const pairs = this.relPairs();
    const out: { zone: Zone; text: string }[] = [];
    const tx = (zone: Zone, p: Record<string, string | number> = {}) =>
      out.push({ zone, text: this.i18n.t(`league.zone.${zone}`, p) });
    if (t === 0) tx('final');
    else {
      tx('up');
      if (pairs[t])
        tx('relup', { tier: this.tierShort(t - 1), from: n - 1 - pairs[t]!, to: n - 2 });
    }
    if (t < last) {
      if (pairs[t + 1]) tx('rel', { tier: this.tierShort(t + 1), from: 3, to: 2 + pairs[t + 1]! });
      tx('down');
    }
    return out;
  });

  protected tierName(t: number): string {
    return t === 0 ? 'Pro Series' : this.i18n.t('league.division', { n: t });
  }

  protected tierShort(t: number): string {
    return t === 0 ? 'Pro' : `Div ${t}`;
  }

  protected readonly tableNote = computed(() => {
    const r = this.rows();
    const m = r.filter((x) => x.manager).length;
    return this.i18n.t(
      this.tier() === this.tiers() - 1 && this.tiers() > 1 ? 'league.noteLow' : 'league.note',
      {
        n: r.length,
        m,
        ai: r.length - m,
      },
    );
  });

  protected shortTag(tag: string): string {
    return tag.replace(/[[\]]/g, '').slice(0, 3);
  }

  protected diff(r: LeagueRow): number {
    return r.fragsFor - r.fragsAgainst;
  }

  protected readonly playedMatchday = computed(() =>
    Math.max(
      0,
      ...(this.view()?.fixtures ?? [])
        .filter((f) => f.kind === 'league' && f.winner)
        .map((f) => f.matchday),
    ),
  );

  protected readonly moneyText = computed(() =>
    (this.view()?.rules?.tableMoney ?? []).map((x) => x.toLocaleString(this.locale())).join(' / '),
  );

  private locale() {
    return this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB';
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleString(this.locale(), {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected time(iso: string): string {
    return new Date(iso).toLocaleTimeString(this.locale(), { hour: '2-digit', minute: '2-digit' });
  }

  protected minutes(a: string, b: string): number {
    return Math.round((Date.parse(b) - Date.parse(a)) / 60_000);
  }

  protected dayName(day: string): string {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(this.locale(), {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      timeZone: 'UTC',
    });
  }

  protected gameTitle(g: LeagueGame): string {
    return g.kind === 'league'
      ? this.i18n.t('league.matchday', { n: g.matchday })
      : this.i18n.t(`league.kind.${g.kind}`);
  }

  /** The season's steps (design: preparation, matchdays, relegation, final four, keepers). */
  protected readonly steps = computed(() => {
    const v = this.view();
    const plan = v?.run?.plan;
    if (!plan) return [];
    const today = v?.today ?? new Date().toISOString().slice(0, 10);
    const first = plan.evenings[0]?.day ?? today;
    const last = plan.evenings.at(-1)?.day ?? today;
    const done = v?.run?.status === 'done';
    return [
      {
        key: 'prep',
        text: this.i18n.t('league.step.prep'),
        done: today >= first,
        now: today < first,
      },
      {
        key: 'days',
        text: this.i18n.t('league.step.days', {
          n: v?.run?.matchdays ?? 0,
          from: this.dayName(first),
          to: this.dayName(last),
        }),
        done: today > last,
        now: today >= first && today <= last,
      },
      // One tier: no relegation.
      ...(this.tiers() > 1
        ? [
            {
              key: 'rel',
              text: this.i18n.t('league.step.rel', { day: this.dayName(plan.relegation) }),
              done: today > plan.relegation || done,
              now: today === plan.relegation,
            },
          ]
        : []),
      {
        key: 'ff',
        text: this.i18n.t('league.step.ff', { day: this.dayName(plan.final) }),
        done,
        now: today === plan.final && !done,
      },
      { key: 'end', text: this.i18n.t('league.step.end'), done: false, now: done },
    ];
  });

  /** A game of the evening runs (a tournament on the server, an AI game kicked off). */
  protected readonly liveNow = computed(() => {
    const now = this.now();
    return (this.view()?.conference ?? []).some(
      (g) =>
        (g.tournament && ['checkIn', 'running', 'paused'].includes(g.tournament.phase)) ||
        (!g.real && !g.winner && Date.parse(g.scheduledAt) <= now),
    );
  });

  /** The league evening is on: from a few minutes before its slot until an hour after it. */
  private readonly evening = computed(() => {
    const e = this.view()?.evening;
    const now = this.now();
    if (this.liveNow()) return true;
    return (
      !!e && now >= Date.parse(e.slot) - 10 * 60_000 && now <= Date.parse(e.until) + 60 * 60_000
    );
  });

  protected readonly dayKicker = computed(() => {
    const e = this.view()?.evening;
    return e ? `${this.dayName(e.day)}, ${this.time(e.slot)}` : '';
  });

  protected readonly dayTitle = computed(() => {
    const md = this.view()?.matchdays ?? [];
    const conf = this.view()?.conference ?? [];
    if (md.length)
      return md.length === 1
        ? this.i18n.t('league.matchday', { n: md[0]! })
        : this.i18n.t('league.matchdays', { a: md[0]!, b: md.at(-1)! });
    const kind = conf[0]?.kind;
    return kind ? this.i18n.t(`league.kind.${kind}`) : this.i18n.t('league.view.day');
  });

  protected readonly realGames = computed(() =>
    (this.view()?.conference ?? []).filter((g) => g.real),
  );
  protected readonly simGames = computed(() =>
    (this.view()?.conference ?? []).filter((g) => !g.real),
  );

  protected readonly runningGames = computed(() =>
    this.realGames().filter((g) => this.isRunning(g)),
  );
  protected readonly queue = computed(() => this.realGames().filter((g) => !this.isRunning(g)));

  protected chip(c: { me: boolean; manager: boolean }): string {
    return c.me ? 'league.you' : c.manager ? 'league.manager' : 'league.ai';
  }

  protected isRunning(g: LeagueGame): boolean {
    return !!g.tournament && ['checkIn', 'running', 'paused'].includes(g.tournament.phase);
  }

  /** The badge of a played game: over, over after overtime, running, next, later. */
  protected badge(g: LeagueGame): 'done' | 'doneOt' | 'next' | 'later' {
    if (g.winner) return g.overtime ? 'doneOt' : 'done';
    const open = this.queue().filter((x) => !x.winner);
    return open[0]?.id === g.id ? 'next' : 'later';
  }

  protected info(g: LeagueGame): string {
    if (g.winner) return this.score(g) + (g.overtime ? ' OT' : '');
    // The games run one after another: about a game's time (4 min) per game before it.
    const e = this.view()?.evening;
    const i = this.realGames().indexOf(g);
    const at = e
      ? new Date(Date.parse(e.slot) + Math.max(0, i) * GAME_MS).toISOString()
      : g.scheduledAt;
    return `${this.i18n.t('league.approx')} ${this.time(at)}${g.map ? ' · ' + g.map : ''}`;
  }

  protected score(g: LeagueGame): string {
    if (!g.winner) return '–';
    if (g.kind !== 'league') return `${g.homeWins ?? 0}:${g.awayWins ?? 0}`;
    return `${g.homeFrags ?? 0}:${g.awayFrags ?? 0}`;
  }

  /** The live table of the evening: the viewer's tier (else the Pro Series). */
  protected readonly liveRows = computed(() => {
    const v = this.view();
    const t = v?.myClub?.tier ?? 0;
    const rows = v?.tables?.find((x) => x.tier === t)?.rows ?? [];
    // The top six and the viewer's club with its neighbours.
    const me = rows.findIndex((r) => r.me);
    return rows.filter((_, i) => i < 6 || (me >= 6 && Math.abs(i - me) <= 1));
  });

  /** The fixture list: only the viewer's games (when the shown tier is theirs). */
  protected readonly mineOnly = signal(true);

  protected readonly planDays = computed(() => {
    const mine = this.mineOnly() && this.view()?.myClub?.tier === this.tier();
    const games = (this.view()?.fixtures ?? []).filter(
      (f) => f.kind === 'league' && f.tier === this.tier() && (!mine || f.home.me || f.away.me),
    );
    const days = [...new Set(games.map((g) => g.day))].sort();
    return days.map((day) => {
      const list = games.filter((g) => g.day === day);
      const mds = [...new Set(list.map((g) => g.matchday))].sort((a, b) => a - b);
      return { day, games: list, mds: mds.join(', ') };
    });
  });

  protected byKind(kind: LeagueGame['kind']): LeagueGame[] {
    return (this.view()?.fixtures ?? []).filter((f) => f.kind === kind);
  }

  protected readonly champion = computed(() => {
    const f = this.byKind('final')[0];
    if (!f?.winner) return null;
    return f.winner === f.home.id ? f.home.name : f.away.name;
  });

  protected readonly relegationTiers = computed(() =>
    Array.from({ length: Math.max(0, this.tiers() - 1) }, (_, i) => i + 1),
  );

  protected relegation(tier: number): LeagueGame[] {
    return this.byKind('relegation').filter((g) => g.tier === tier);
  }

  protected placeIn(tier: number, club: string): string {
    const p = this.view()
      ?.tables?.find((t) => t.tier === tier)
      ?.rows.find((r) => r.club === club)?.place;
    return p ? this.i18n.t('league.place', { p }) : '';
  }

  protected proPlace(club: string): number | string {
    return this.view()?.tables?.[0]?.rows.find((r) => r.club === club)?.place ?? '';
  }

  /**
   * The moves into the next season (once the season is over): per boundary who goes up
   * (places 1-2 and the relegation winners of the lower tier) and down (the last two and the
   * relegation losers of the upper tier).
   */
  protected readonly moves = computed(() => {
    const v = this.view();
    if (v?.run?.status !== 'done') return [];
    const tables = v.tables ?? [];
    const out: {
      key: string;
      tier: number;
      up: boolean;
      clubs: (LeagueRow & { how: string })[];
    }[] = [];
    for (let t = 1; t < tables.length; t++) {
      const upper = tables[t - 1]!.rows;
      const lower = tables[t]!.rows;
      const ties = this.relegation(t).filter((g) => g.winner);
      const direct = this.i18n.t('league.direct');
      const up = [
        ...lower
          .slice(0, 2)
          .map((r) => ({ ...r, how: this.i18n.t('league.place', { p: r.place }) + ', ' + direct })),
        ...ties
          .filter((g) => g.winner === g.away.id)
          .map((g) => ({
            ...lower.find((r) => r.club === g.away.id)!,
            how: this.i18n.t('league.viaRel'),
          })),
      ];
      const down = [
        ...upper
          .slice(-2)
          .map((r) => ({ ...r, how: this.i18n.t('league.place', { p: r.place }) + ', ' + direct })),
        ...ties
          .filter((g) => g.winner === g.away.id)
          .map((g) => ({
            ...upper.find((r) => r.club === g.home.id)!,
            how: this.i18n.t('league.relLost'),
          })),
      ];
      out.push({ key: `u${t}`, tier: t - 1, up: true, clubs: up.filter((c) => c.club) });
      out.push({ key: `d${t}`, tier: t, up: false, clubs: down.filter((c) => c.club) });
    }
    return out;
  });

  protected relResult(g: LeagueGame, tier: number): string {
    if (!g.winner) return this.i18n.t('league.relPending');
    return g.winner === g.away.id
      ? this.i18n.t('league.relUp', { a: g.away.name, b: g.home.name })
      : this.i18n.t('league.relStay', { b: g.home.name, tier: this.tierName(tier - 1) });
  }
}
