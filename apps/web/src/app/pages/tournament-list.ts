import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { finalMs, raceTime } from '../core/race';
import { Api } from '../core/api';
import { Loading } from '../core/loading';
import { Auth } from '../core/auth';
import { UdtMark } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { scheduleText } from '../core/series-text';
import type {
  SeriesOverview,
  TournamentArchive,
  TournamentFilter,
  TournamentSummary,
} from '../core/types';

type LeagueGame = TournamentSummary & { league: NonNullable<TournamentSummary['league']> };

/** The league's games of one evening (one row of the list). */
interface LeagueEvening {
  id: string;
  at: string;
  label: string;
  games: LeagueGame[];
}

/** A row of the list: a tournament, or a league evening. */
type ListRow = { id: string; t?: TournamentSummary; ev?: LeagueEvening };

/** The filters are kept per browser (not the series: that one is a jump from its card). */
const STORE = 'tourney.listFilter';
const RUNNING = ['running', 'paused'];
const KINDS: string[] = ['classic', 'udt', 'league'];

function storedFilter(): TournamentFilter {
  try {
    const f = JSON.parse(localStorage.getItem(STORE) ?? '{}') as TournamentFilter;
    // "season" was a kind before the league came (decision 224).
    const kind = f.kind && KINDS.includes(f.kind) ? f.kind : undefined;
    return { kind, mode: f.mode, mine: f.mine, status: f.status };
  } catch {
    return {};
  }
}

/**
 * The tournaments (decision 170). Overview: what runs now, what comes next (by day), the series
 * as one card each and the last results. Archive: every finished and aborted tournament, by
 * day, in pages. The filters (search, kind, mode, mine) hold for both.
 */
@Component({
  selector: 'app-tournament-list',
  imports: [RouterLink, TPipe, UdtMark, FormsModule, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h1>{{ 'list.title' | t }}</h1>
      @if (auth.me()?.isAdmin) {
        <div class="row">
          <a class="btn hide-sm" routerLink="/admin/series">{{ 'series.title' | t }}</a>
          <a class="btn primary" routerLink="/new">+ {{ 'list.new' | t }}</a>
        </div>
      }
    </div>

    <nav class="views">
      <a
        routerLink="/"
        [queryParams]="{ view: null }"
        queryParamsHandling="merge"
        [class.on]="tab() === 'now'"
        [attr.aria-current]="tab() === 'now' ? 'page' : null"
        >{{ 'list.view.now' | t }}</a
      >
      <a
        routerLink="/"
        [queryParams]="{ view: 'archive' }"
        [class.on]="tab() === 'archive'"
        [attr.aria-current]="tab() === 'archive' ? 'page' : null"
        >{{ 'list.view.archive' | t }}
        @if (doneTotal() !== null) {
          <span class="count">{{ doneTotal() }}</span>
        }
      </a>
    </nav>

    <div class="filters">
      <input
        class="search"
        type="search"
        [ngModel]="qInput()"
        (ngModelChange)="typed($event)"
        [placeholder]="'list.search' | t"
        [attr.aria-label]="'list.search' | t"
      />
      <!-- Without Dream Team every tournament is classic. -->
      @if (auth.config().udt) {
        <div class="pills" role="group" [attr.aria-label]="'list.kind.label' | t">
          @for (k of kinds; track k) {
            <button
              type="button"
              [class.on]="(filter().kind ?? 'all') === k"
              [attr.aria-pressed]="(filter().kind ?? 'all') === k"
              (click)="set({ kind: k === 'all' ? undefined : k })"
            >
              {{ 'list.kind.' + k | t }}
            </button>
          }
        </div>
      }
      <div class="pills" role="group" [attr.aria-label]="'list.mode.label' | t">
        @for (m of modes; track m) {
          <button
            type="button"
            [class.on]="(filter().mode ?? 'all') === m"
            [attr.aria-pressed]="(filter().mode ?? 'all') === m"
            (click)="set({ mode: m === 'all' ? undefined : m })"
          >
            {{ 'list.mode.' + m | t }}
          </button>
        }
      </div>
      @if (tab() === 'archive') {
        <div class="pills" role="group" [attr.aria-label]="'list.status.label' | t">
          @for (st of statuses; track st) {
            <button
              type="button"
              [class.on]="(filter().status ?? 'all') === st"
              [attr.aria-pressed]="(filter().status ?? 'all') === st"
              (click)="set({ status: st === 'all' ? undefined : st })"
            >
              {{ 'list.status.' + st | t }}
            </button>
          }
        </div>
      }
      <label class="mine">
        <input
          type="checkbox"
          [checked]="!!filter().mine"
          (change)="set({ mine: $any($event.target).checked || undefined })"
        />
        <i aria-hidden="true"></i>{{ 'list.mine' | t }}
      </label>
    </div>

    <ng-template #badges let-t>
      @if (t.league) {
        <span class="badge udt"><na-udt-mark [size]="14" />{{ 'list.kind.league' | t }}</span>
      } @else if (t.kind === 'udt') {
        <span class="badge udt"><na-udt-mark [size]="14" />DT</span>
      }
      @if (t.seasonal && t.kind !== 'udt') {
        <span class="badge season">Season</span>
      }
      @if (t.game === 'mh') {
        <span class="badge mh">MH</span>
      }
    </ng-template>

    <ng-template #result let-t>
      <a
        class="trow done"
        [class.udt]="t.kind === 'udt'"
        [class.aborted]="t.phase === 'aborted'"
        [routerLink]="['/t', t.id]"
      >
        <span class="when"
          >{{ time(at(t)) }}<small>{{ shortDate(at(t)) }}</small></span
        >
        <span class="what">
          <span class="ttl"
            ><span class="nm">{{ t.name }}</span
            ><ng-container *ngTemplateOutlet="badges; context: { $implicit: t }"
          /></span>
          <span class="meta"
            >{{ meta(t) }}
            @if (t.registeredMe) {
              · <span class="was">{{ 'list.wasIn' | t }}</span>
            }
          </span>
        </span>
        <span class="st">
          @if (t.phase === 'aborted') {
            <span class="badge aborted">{{ 'phase.aborted' | t }}</span>
          } @else if (t.champion) {
            <span class="champ"><ng-container *ngTemplateOutlet="trophy" />{{ t.champion }}</span>
          }
        </span>
      </a>
    </ng-template>

    <ng-template #evening let-e let-done="done">
      <div class="tl-ev" [class.open]="isOpen(e.id)">
        <button
          type="button"
          class="trow tl-evhead udt"
          [class.done]="done"
          [attr.aria-expanded]="isOpen(e.id)"
          [attr.aria-controls]="e.id + '-list'"
          (click)="toggle(e.id)"
        >
          <span class="when"
            >{{ time(e.at) }}
            @if (done) {
              <small>{{ shortDate(e.at) }}</small>
            }
          </span>
          <span class="what">
            <span class="ttl"
              ><span class="nm">{{ 'list.ev.title' | t }}</span
              ><span class="badge udt"
                ><na-udt-mark [size]="14" />{{ 'list.kind.league' | t }}</span
              ></span
            >
            <span class="meta">{{ e.label }}</span>
          </span>
          <span class="st tl-evn"
            >{{ 'list.ev.games' | t: { n: e.games.length } }}
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="m6 9 6 6 6-6"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              /></svg
          ></span>
        </button>
        <div class="tl-evlist" [id]="e.id + '-list'" [attr.inert]="isOpen(e.id) ? null : ''">
          <div>
            @for (g of e.games; track g.id) {
              <a class="h" [routerLink]="['/t', g.id]">
                <span class="d">{{ time(at(g)) }}</span>
                <span class="tl-evvs">{{ g.league.home }} – {{ g.league.away }}</span>
                @if (g.phase === 'aborted') {
                  <span class="badge aborted">{{ 'phase.aborted' | t }}</span>
                } @else if (g.champion) {
                  <span class="champ"
                    ><ng-container *ngTemplateOutlet="trophy" />{{ g.champion }}</span
                  >
                } @else if (g.league.kind !== 'league') {
                  <span class="muted">{{ 'league.kind.' + g.league.kind | t }}</span>
                }
              </a>
            }
            @if (!done) {
              <a class="all" routerLink="/udt/league/day">{{ 'list.ev.conference' | t }} →</a>
            }
          </div>
        </div>
      </div>
    </ng-template>

    <ng-template #trophy>
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M7 4h10v5a5 5 0 0 1-10 0zM5 5H3v2a4 4 0 0 0 4 4M19 5h2v2a4 4 0 0 1-4 4M12 14v4M8 21h8"
          fill="none"
          stroke="var(--neuro)"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    </ng-template>

    @if (tab() === 'now') {
      @if (live().length) {
        <section>
          <h2 class="sec"><span class="badge running">Live</span> {{ 'list.liveTitle' | t }}</h2>
          @for (t of live(); track t.id; let first = $first) {
            @if (!first) {
              <a class="liverow" [class.udt]="t.kind === 'udt'" [routerLink]="['/t', t.id]">
                <span class="badge running">{{ 'phase.running' | t }}</span>
                <span class="lt"
                  >{{ t.name }}
                  @if (t.now; as n) {
                    <span class="muted small">· {{ n.names[0] }} – {{ n.names[1] }}</span>
                  }
                </span>
                @if (t.now; as n) {
                  @if (t.game === 'mh') {
                    <span class="ls"
                      ><b class="sa">{{ runText(n, 0) }}</b> <i>:</i>
                      <b class="sb">{{ runText(n, 1) }}</b></span
                    >
                  } @else {
                    <span class="ls"
                      ><b class="sa">{{ n.live?.scores?.[n.entrants[0]] ?? '–' }}</b> <i>:</i>
                      <b class="sb">{{ n.live?.scores?.[n.entrants[1]] ?? '–' }}</b></span
                    >
                  }
                }
              </a>
            } @else {
              <a class="hero" [class.udt]="t.kind === 'udt'" [routerLink]="['/t', t.id]">
                <div class="hero-l">
                  <div class="row">
                    <span class="badge" [class]="t.phase">{{ 'phase.' + t.phase | t }}</span>
                    @if (t.kind === 'udt') {
                      <span class="badge udt"
                        ><na-udt-mark [size]="16" />{{ 'udt.title' | t }}</span
                      >
                    }
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
                          ><i>:</i
                          ><b class="sb">{{ n.live?.scores?.[n.entrants[1]] ?? '–' }}</b></span
                        >
                      }
                      <span class="nm b">{{ n.names[1] }}</span>
                    </div>
                    <div class="state small">
                      @if (n.live?.phase === 'live' || n.live?.phase === 'overtime') {
                        <span class="lv"
                          ><span class="dot on"></span> {{ 'list.liveNow' | t }}</span
                        >
                      } @else {
                        <span class="muted">{{
                          'list.phase.' + (n.live?.phase ?? 'waiting') | t
                        }}</span>
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
          }
        </section>
      }

      <section>
        <div class="sechead">
          <h2 class="sec">
            {{ 'list.next' | t }} <span class="n">{{ upcoming().length }}</span>
          </h2>
        </div>
        <div class="tlist">
          @for (g of upcomingGroups(); track g.label) {
            <div class="gttl">{{ g.label }}</div>
            @for (r of g.items; track r.id) {
              @if (r.ev; as e) {
                <ng-container *ngTemplateOutlet="evening; context: { $implicit: e, done: false }" />
              } @else if (r.t; as t) {
                <a class="trow" [class.udt]="t.kind === 'udt'" [routerLink]="['/t', t.id]">
                  <span class="when">{{ t.scheduledAt ? time(t.scheduledAt) : '–' }}</span>
                  <span class="what">
                    <span class="ttl"
                      ><span class="nm">{{ t.name }}</span
                      ><ng-container *ngTemplateOutlet="badges; context: { $implicit: t }"
                    /></span>
                    <span class="meta">{{ meta(t) }}</span>
                  </span>
                  <span class="fill">
                    @if (!t.league) {
                      <span class="mono">{{ fill(t) }}</span>
                      <span class="meter"><span [style.width.%]="fillPct(t)"></span></span>
                    }
                  </span>
                  <span class="st {{ state(t).cls }}">{{ state(t).text }}</span>
                </a>
              }
            }
          } @empty {
            <p class="empty">{{ 'list.nothingNext' | t }}</p>
          }
        </div>
      </section>

      @if (seriesShown().length) {
        <section>
          <h2 class="sec">
            {{ 'series.title' | t }} <span class="n">{{ seriesShown().length }}</span>
          </h2>
          <div class="series">
            @for (s of seriesShown(); track s.id) {
              <div class="scard" [class.udt]="s.kind === 'udt'" [class.open]="isOpen(s.id)">
                <div class="stop">
                  <div class="row">
                    <ng-container
                      *ngTemplateOutlet="
                        badges;
                        context: {
                          $implicit: { kind: s.kind, seasonal: s.seasonal, game: s.game },
                        }
                      "
                    />
                    @if (s.kind !== 'udt' && !s.seasonal && s.game !== 'mh') {
                      <span class="badge">{{ 'list.seriesTag' | t }}</span>
                    }
                  </div>
                  <div class="sname">{{ s.name }}</div>
                  <dl>
                    <dt>{{ 'list.seriesWhen' | t }}</dt>
                    <dd>{{ schedule(s) }}</dd>
                    <dt>{{ 'list.seriesNext' | t }}</dt>
                    <dd>
                      @if (s.next; as n) {
                        @if (n.id) {
                          <a [routerLink]="['/t', n.id]">{{ dayTime(n.at) }}</a>
                          @if (activeById().get(n.id); as t) {
                            · {{ fill(t) }}
                          }
                        } @else {
                          {{ dayTime(n.at) }}
                        }
                      } @else {
                        –
                      }
                    </dd>
                    <dt>{{ 'list.seriesLast' | t }}</dt>
                    <dd>
                      @if (s.recent[0]; as r) {
                        @if (r.phase === 'aborted') {
                          <span class="badge aborted">{{ 'phase.aborted' | t }}</span>
                        } @else if (r.champion) {
                          <span class="champ"
                            ><ng-container *ngTemplateOutlet="trophy" />{{ r.champion }}</span
                          >
                        } @else {
                          <span class="muted">–</span>
                        }
                      } @else {
                        –
                      }
                    </dd>
                  </dl>
                </div>
                <div class="sfoot">
                  <span class="muted">{{ 'list.seriesPlayed' | t: { n: s.finished } }}</span>
                  @if (s.recent.length) {
                    <button
                      type="button"
                      [attr.aria-expanded]="isOpen(s.id)"
                      [attr.aria-controls]="'hist-' + s.id"
                      (click)="toggle(s.id)"
                    >
                      {{ 'list.seriesHistory' | t }}
                      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="m6 9 6 6 6-6"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                        />
                      </svg>
                    </button>
                  }
                </div>
                <div class="hist" [id]="'hist-' + s.id" [attr.inert]="isOpen(s.id) ? null : ''">
                  <div>
                    @for (r of s.recent; track r.id) {
                      <a class="h" [routerLink]="['/t', r.id]"
                        ><span
                          ><span class="d">{{ shortDate(r.at) }}</span>
                          {{ short(r.name, s.name) }}</span
                        >
                        @if (r.phase === 'aborted') {
                          <span class="badge aborted">{{ 'phase.aborted' | t }}</span>
                        } @else if (r.champion) {
                          <span class="champ"
                            ><ng-container *ngTemplateOutlet="trophy" />{{ r.champion }}</span
                          >
                        } @else {
                          <span class="muted">–</span>
                        }
                      </a>
                    }
                    <a
                      class="all"
                      routerLink="/"
                      [queryParams]="{ view: 'archive' }"
                      (click)="seriesFilter(s)"
                      >{{ 'list.seriesAll' | t: { n: s.finished + s.aborted } }} →</a
                    >
                  </div>
                </div>
              </div>
            }
          </div>
        </section>
      }

      <section>
        <div class="sechead">
          <h2 class="sec">{{ 'list.recent' | t }}</h2>
          <a routerLink="/" [queryParams]="{ view: 'archive' }" class="small"
            >{{ 'list.toArchive' | t }} →</a
          >
        </div>
        <div class="tlist">
          @for (r of recentRows(); track r.id) {
            @if (r.ev; as e) {
              <ng-container *ngTemplateOutlet="evening; context: { $implicit: e, done: true }" />
            } @else if (r.t; as t) {
              <ng-container *ngTemplateOutlet="result; context: { $implicit: t }" />
            }
          } @empty {
            <p class="empty">{{ 'list.nothingDone' | t }}</p>
          }
        </div>
      </section>
    } @else {
      <section>
        <div class="sechead">
          <h2 class="sec">
            {{ 'list.view.archive' | t }}
            @if (archive(); as a) {
              <span class="n">{{ 'list.archiveCount' | t: { n: a.total, a: a.aborted } }}</span>
            }
          </h2>
          @if (filter().series) {
            <button type="button" class="chip-x" (click)="set({ series: undefined })">
              {{ 'list.seriesFilter' | t: { name: seriesName() } }} ×
            </button>
          }
        </div>
        <div class="tlist">
          @for (g of archiveGroups(); track g.label) {
            <div class="gttl">{{ g.label }}</div>
            @for (r of g.items; track r.id) {
              @if (r.ev; as e) {
                <ng-container *ngTemplateOutlet="evening; context: { $implicit: e, done: true }" />
              } @else if (r.t; as t) {
                <ng-container *ngTemplateOutlet="result; context: { $implicit: t }" />
              }
            }
          } @empty {
            @if (archive()) {
              <p class="empty">{{ 'list.nothingFound' | t }}</p>
            }
          }
          @if (archive()?.next) {
            <div class="more">
              <button type="button" [disabled]="moreBusy()" (click)="more()">
                {{ 'list.more' | t: { n: archive()!.total - archiveItems().length } }}
              </button>
            </div>
          }
        </div>
      </section>
    }
  `,
  styles: `
    .head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }
    .head h1 {
      font-size: 3.2rem;
      margin: 0;
    }
    section {
      margin-top: 28px;
    }
    .sechead {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .sechead h2.sec {
      margin: 0;
    }
    h2.sec {
      font-family: var(--font-display);
      font-weight: 700;
      font-style: normal;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-size: 1.15rem;
      color: var(--text-2);
      margin: 0 0 12px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    h2 .n {
      font-family: var(--font-mono);
      font-size: 0.78rem;
      color: var(--faint);
      letter-spacing: 0;
      text-transform: none;
    }
    .views {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 16px;
    }
    .views a {
      padding: 10px 14px;
      font-weight: 600;
      color: var(--text-2);
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
    }
    .views a.on {
      color: var(--text);
      border-color: var(--accent);
    }
    .count {
      font-family: var(--font-mono);
      font-size: 0.8em;
      color: var(--muted);
      margin-left: 4px;
    }
    .filters {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }
    .search {
      flex: 1 1 220px;
      min-width: 0;
      width: auto;
    }
    .mine {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 0.88rem;
      color: var(--text-2);
      cursor: pointer;
      white-space: nowrap;
      margin: 0;
    }
    .mine input {
      position: absolute;
      opacity: 0;
      width: 1px;
      height: 1px;
    }
    .mine i {
      width: 34px;
      height: 20px;
      border-radius: 999px;
      background: var(--panel-3);
      border: 1px solid var(--line);
      position: relative;
      transition: background 0.2s;
    }
    .mine i::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--text-2);
      transition: transform 0.2s;
    }
    .mine input:checked + i {
      background: var(--accent-dim);
    }
    .mine input:checked + i::after {
      transform: translateX(14px);
      background: var(--accent);
    }
    .mine input:focus-visible + i {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .badge.mh {
      color: #ffb36b;
      border-color: rgba(255, 160, 80, 0.4);
      background: rgba(255, 160, 80, 0.08);
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
    .hero.udt {
      border-color: rgba(178, 107, 255, 0.55);
    }
    .hero.udt .hero-l {
      background:
        radial-gradient(120% 120% at 0% 0%, rgba(178, 107, 255, 0.18), transparent 60%), #0e0c1a;
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

    .liverow {
      margin-top: 10px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border: 1px solid #1f4a55;
      border-radius: var(--radius);
      background: #0c1219;
      color: var(--text);
    }
    .liverow.udt {
      border-color: rgba(178, 107, 255, 0.45);
    }
    .liverow:hover {
      color: var(--text);
      border-color: var(--accent-dim);
    }
    .lt {
      font-weight: 700;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ls {
      font-family: var(--font-display);
      font-weight: 800;
      font-size: 1.3rem;
      white-space: nowrap;
    }
    .ls i {
      color: var(--muted);
      font-style: normal;
    }
    .empty {
      margin: 0;
      padding: 22px;
      text-align: center;
      color: var(--muted);
    }
    .more {
      display: flex;
      justify-content: center;
      padding: 12px;
      border-top: 1px solid var(--border);
    }
    .chip-x {
      min-height: 0;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 0.85rem;
    }
    .series {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 14px;
      align-items: start;
    }
    .scard {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--panel);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .scard.udt {
      border-color: rgba(178, 107, 255, 0.45);
    }
    .stop {
      padding: 16px 18px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .sname {
      font-family: var(--font-display);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      font-size: 1.45rem;
      line-height: 1.05;
    }
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 12px;
      font-size: 0.86rem;
      margin: 4px 0 0;
    }
    dt {
      color: var(--muted);
    }
    dd {
      margin: 0;
    }
    .sfoot {
      margin-top: auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid var(--border);
      padding: 6px 10px 6px 18px;
      font-size: 0.86rem;
    }
    .sfoot button {
      background: none;
      border: 0;
      min-height: 32px;
      color: var(--accent);
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 6px;
    }
    .sfoot svg {
      transition: transform 0.25s;
    }
    .scard.open .sfoot svg {
      transform: rotate(180deg);
    }
    .hist {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.3s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .scard.open .hist {
      grid-template-rows: 1fr;
    }
    .hist > div {
      overflow: hidden;
    }
    .hist .h {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      padding: 7px 18px;
      border-top: 1px solid var(--border);
      font-size: 0.85rem;
      color: var(--text);
    }
    .hist .h:hover {
      background: var(--panel-2);
    }
    .hist .d {
      color: var(--muted);
      font-family: var(--font-mono);
      font-size: 0.78rem;
    }
    .hist .all {
      display: block;
      padding: 8px 18px 12px;
      border-top: 1px solid var(--border);
      font-size: 0.85rem;
      font-weight: 600;
    }
    /* Phones: every filter group a full row; the rows in two columns, the state below. */
    @media (max-width: 640px) {
      .head h1 {
        font-size: 2.4rem;
      }
      .hide-sm {
        display: none;
      }
      .filters {
        gap: 8px;
      }
      .search,
      .pills {
        flex: 1 1 100%;
      }
      .pills button {
        flex: 1 1 auto;
        padding: 5px 6px;
        font-size: 0.8rem;
      }
      .mine {
        margin-left: auto;
      }
      .hero-r {
        border-left: 0;
        border-top: 1px solid var(--border);
      }
      .hero-name {
        font-size: 2rem;
      }
      .series {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class TournamentListPage {
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  private readonly api = inject(Api);
  private readonly loading = inject(Loading);
  private readonly router = inject(Router);

  /** The query parameter `view` (archive), bound by the router. */
  readonly view = input<string | undefined>(undefined);
  protected readonly tab = computed(() => (this.view() === 'archive' ? 'archive' : 'now'));

  /**
   * Classic tournaments, Dream Team cups, the league (only with Dream Team on; season and Dream
   * Team show as badges on the rows).
   */
  protected readonly kinds = ['all', 'classic', 'udt', 'league'] as const;
  protected readonly modes = ['all', '1v1', 'team', 'mh'] as const;
  protected readonly statuses = ['all', 'finished', 'aborted'] as const;

  protected readonly filter = signal<TournamentFilter>(storedFilter());
  /** The filter as it counts: without Dream Team the kind filter is hidden and ignored. */
  private readonly serverFilter = computed(() =>
    this.auth.config().udt ? this.filter() : { ...this.filter(), kind: undefined },
  );
  /** The search as typed (the filter follows after a short pause). */
  protected readonly qInput = signal('');
  private typing?: ReturnType<typeof setTimeout>;

  protected readonly active = signal<TournamentSummary[] | null>(null);
  protected readonly series = signal<SeriesOverview[]>([]);
  protected readonly recent = signal<TournamentSummary[]>([]);
  protected readonly doneTotal = signal<number | null>(null);
  protected readonly archive = signal<TournamentArchive | null>(null);
  protected readonly archiveItems = signal<TournamentSummary[]>([]);
  protected readonly moreBusy = signal(false);
  private readonly opened = signal<ReadonlySet<string>>(new Set());
  /** Answers of older requests are dropped. */
  private req = 0;

  protected readonly activeById = computed(
    () => new Map((this.active() ?? []).map((t) => [t.id, t])),
  );
  private readonly shownActive = computed(() =>
    (this.active() ?? []).filter((t) => this.matches(t, this.filter())),
  );
  /** Running tournaments: big on top. */
  protected readonly live = computed(() =>
    this.shownActive().filter((t) => RUNNING.includes(t.phase)),
  );
  /** Everything else not over yet, by start (without one: last). */
  protected readonly upcoming = computed(() =>
    this.shownActive()
      .filter((t) => !RUNNING.includes(t.phase))
      .sort((a, b) =>
        (a.scheduledAt ?? '~' + a.createdAt).localeCompare(b.scheduledAt ?? '~' + b.createdAt),
      ),
  );
  protected readonly upcomingGroups = computed(() =>
    this.rowGroups(this.upcoming(), (t) => t.scheduledAt, this.i18n.t('list.noDate')),
  );
  /** The last results: five rows, a league evening as one. */
  protected readonly recentRows = computed(() => this.fold(this.recent(), 'recent').slice(0, 5));
  protected readonly archiveGroups = computed(() =>
    this.rowGroups(this.archiveItems(), (t) => this.at(t), ''),
  );
  protected readonly seriesShown = computed(() => {
    const f = this.filter();
    const q = f.q?.toLowerCase();
    return this.series().filter((s) => {
      if (f.kind === 'udt' && s.kind !== 'udt') return false;
      if (f.kind === 'classic' && s.kind === 'udt') return false;
      if (f.kind === 'league') return false;
      if (f.mode && f.mode !== this.modeOf(s.game, s.teamSize)) return false;
      if (q && !s.name.toLowerCase().includes(q)) return false;
      if (f.mine && !(s.next?.id && this.activeById().get(s.next.id)?.registeredMe)) return false;
      return true;
    });
  });
  protected readonly seriesName = computed(
    () => this.series().find((s) => s.id === this.filter().series)?.name ?? '…',
  );

  constructor() {
    void this.loadActive();
    void this.loadSeries();
    // The server-side part: the last results (overview) or the archive's first page.
    effect(() => {
      const f = this.serverFilter();
      const tab = this.tab();
      untracked(() => void (tab === 'archive' ? this.loadArchive(f) : this.loadRecent(f)));
    });
    effect(() => {
      const { kind, mode, mine, status } = this.filter();
      try {
        localStorage.setItem(STORE, JSON.stringify({ kind, mode, mine, status }));
      } catch {
        // storage unavailable: the filters are not kept
      }
    });
    // While a tournament runs, its score is shown: refresh every few seconds.
    const timer = setInterval(() => {
      if (this.live().length) this.loading.background(() => void this.loadActive());
    }, 4000);
    const destroy = inject(DestroyRef);
    destroy.onDestroy(() => {
      clearInterval(timer);
      clearTimeout(this.typing);
    });
  }

  protected set(change: Partial<TournamentFilter>) {
    this.filter.update((f) => ({ ...f, ...change }));
  }

  protected typed(q: string) {
    this.qInput.set(q);
    clearTimeout(this.typing);
    this.typing = setTimeout(() => this.set({ q: q.trim() || undefined }), 250);
  }

  protected seriesFilter(s: SeriesOverview) {
    // All of the series, as the link says (not only the player's own).
    this.set({ series: s.id, status: undefined, mine: undefined });
  }

  protected isOpen(id: string) {
    return this.opened().has(id);
  }

  protected toggle(id: string) {
    this.opened.update((o) => {
      const n = new Set(o);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  }

  protected async more() {
    const a = this.archive();
    if (!a?.next || this.moreBusy()) return;
    this.moreBusy.set(true);
    const req = this.req;
    try {
      const page = await this.api.archive(this.serverFilter(), 20, a.next);
      // Filters changed meanwhile (a new first page): this page belongs to the old list.
      if (req !== this.req || this.archive() !== a) return;
      this.archive.set(page);
      this.archiveItems.update((l) => [...l, ...page.items]);
    } catch {
      // the toast shows the error
    } finally {
      this.moreBusy.set(false);
    }
  }

  private async loadActive() {
    try {
      this.active.set(await this.api.tournaments());
    } catch {
      // the toast shows the error
    }
  }

  private async loadSeries() {
    try {
      this.series.set(await this.api.seriesOverview());
    } catch {
      // the toast shows the error
    }
  }

  private async loadRecent(f: TournamentFilter) {
    const req = ++this.req;
    try {
      // A league evening has many games: enough results for five rows with the evenings
      // folded (see recentRows).
      const page = await this.api.archive({ ...f, status: undefined, series: undefined }, 30);
      if (req !== this.req) return;
      this.recent.set(page.items);
      this.doneTotal.set(page.total);
    } catch {
      // the toast shows the error
    }
  }

  private async loadArchive(f: TournamentFilter) {
    const req = ++this.req;
    try {
      const page = await this.api.archive(f, 20);
      if (req !== this.req) return;
      this.archive.set(page);
      this.archiveItems.set(page.items);
      this.doneTotal.set(page.total);
    } catch {
      // the toast shows the error
    }
  }

  private modeOf(game: string | undefined, teamSize: number): '1v1' | 'team' | 'mh' {
    return game === 'mh' ? 'mh' : teamSize > 1 ? 'team' : '1v1';
  }

  /** The filters in the browser (the overview: its lists are complete). */
  private matches(t: TournamentSummary, f: TournamentFilter): boolean {
    // Without Dream Team the kind filter is hidden (a stored one does not count).
    if (!this.auth.config().udt) f = { ...f, kind: undefined };
    if (f.kind === 'udt' && (t.kind !== 'udt' || t.league)) return false;
    if (f.kind === 'league' && !t.league) return false;
    if (f.kind === 'classic' && t.kind === 'udt') return false;
    if (f.mode && f.mode !== this.modeOf(t.game, t.teamSize)) return false;
    if (f.mine && !t.registeredMe) return false;
    if (f.q && !t.name.toLowerCase().includes(f.q.toLowerCase())) return false;
    return true;
  }

  /** When a tournament was (or is) played: its start, else its creation. */
  protected at(t: TournamentSummary): string {
    return t.scheduledAt ?? t.createdAt;
  }

  /**
   * The day groups as rows: the league's games of an evening become one row (opened, it shows
   * them), the user's own league games and everything else stay rows of their own. With the
   * league filter every game is a row.
   */
  private rowGroups(
    list: TournamentSummary[],
    when: (t: TournamentSummary) => string | null,
    none: string,
  ): { label: string; items: ListRow[] }[] {
    return this.groups(list, when, none).map((g) => ({
      label: g.label,
      items: this.fold(g.items, g.label),
    }));
  }

  /** The tournaments as rows, the league's games of an evening folded into one (see rowGroups). */
  private fold(list: TournamentSummary[], scope: string): ListRow[] {
    // Ids without spaces (aria-controls refers to them).
    const scopeKey = scope.replace(/[^a-z0-9]+/gi, '_');
    const single = this.filter().kind === 'league';
    const rows: ListRow[] = [];
    const evenings = new Map<string, LeagueEvening>();
    for (const t of list) {
      const l = t.league;
      if (!l || l.mine || single) {
        rows.push({ id: t.id, t });
        continue;
      }
      const key = `${l.season}:${l.day}`;
      let e = evenings.get(key);
      if (!e) {
        e = { id: `ev-${l.season}-${l.day}-${scopeKey}`, at: this.at(t), label: '', games: [] };
        evenings.set(key, e);
        rows.push({ id: e.id, ev: e });
      }
      e.games.push(t as LeagueGame);
    }
    for (const e of evenings.values()) {
      e.games.sort((a, b) => this.at(a).localeCompare(this.at(b)));
      e.at = this.at(e.games[0]!);
      e.label = this.eveningLabel(e.games);
    }
    // An evening of one game is that game.
    return rows.map((r) =>
      r.ev?.games.length === 1 ? { id: r.ev.games[0]!.id, t: r.ev.games[0] } : r,
    );
  }

  /** "Matchdays 12–13 · Relegation" */
  private eveningLabel(games: LeagueGame[]): string {
    const days = games.map((g) => g.league.matchday).filter((d): d is number => d !== null);
    const parts: string[] = [];
    if (days.length) {
      const a = Math.min(...days);
      const b = Math.max(...days);
      parts.push(
        a === b
          ? this.i18n.t('list.ev.matchday', { n: a })
          : this.i18n.t('list.ev.matchdays', { a, b }),
      );
    }
    for (const k of new Set(games.map((g) => g.league.kind)))
      if (k !== 'league') parts.push(this.i18n.t(`league.kind.${k}`));
    return parts.join(' · ');
  }

  private groups(
    list: TournamentSummary[],
    when: (t: TournamentSummary) => string | null,
    none: string,
  ): { label: string; items: TournamentSummary[] }[] {
    const out: { label: string; items: TournamentSummary[] }[] = [];
    for (const t of list) {
      const w = when(t);
      const label = w ? this.dayLabel(w) : none;
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(t);
      else out.push({ label, items: [t] });
    }
    return out;
  }

  private locale() {
    return this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB';
  }

  /** "Today", "Tomorrow", "Yesterday", a weekday within a week, else the date. */
  protected dayLabel(iso: string): string {
    const d = new Date(iso);
    const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const n = Math.round((day(d) - day(new Date())) / 86_400_000);
    if (n === 0) return this.i18n.t('list.today');
    if (n === 1) return this.i18n.t('list.tomorrow');
    if (n === -1) return this.i18n.t('list.yesterday');
    const loc = this.locale();
    if (n > 1 && n < 7)
      return d.toLocaleDateString(loc, { weekday: 'long', day: '2-digit', month: '2-digit' });
    if (n < 0 && n > -7) return d.toLocaleDateString(loc, { weekday: 'long' });
    const year = d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined;
    return d.toLocaleDateString(loc, { weekday: 'short', day: '2-digit', month: 'long', year });
  }

  protected time(iso: string): string {
    return new Date(iso).toLocaleTimeString(this.locale(), { hour: '2-digit', minute: '2-digit' });
  }

  protected shortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(this.locale(), { day: '2-digit', month: '2-digit' });
  }

  protected dayTime(iso: string): string {
    return `${this.dayLabel(iso)}, ${this.time(iso)}`;
  }

  protected schedule(s: SeriesOverview): string {
    return scheduleText(this.i18n, s);
  }

  /** A tournament of the series without the series' name ("Friday Cup #12" -> "#12"). */
  protected short(name: string, series: string): string {
    return name.startsWith(series) ? name.slice(series.length).trim() || name : name;
  }

  /** What the player can do or is: check-in, registered, registration open or closed. */
  protected state(t: TournamentSummary): { cls: string; text: string } {
    const tr = (k: string) => this.i18n.t(k);
    if (t.phase === 'checkIn') return { cls: 'ci', text: tr('list.stateCheckIn') };
    if (t.registeredMe)
      return {
        cls: 'me',
        text:
          '✓ ' +
          tr(t.league ? 'list.yourGame' : t.kind === 'udt' ? 'list.youEntered' : 'list.youPlay'),
      };
    if (t.phase === 'seeded') return { cls: 'closed', text: tr('phase.seeded') };
    if (t.registrationOpen) return { cls: '', text: tr('list.open') };
    return { cls: 'closed', text: tr('list.closed') };
  }

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

  protected meta(t: TournamentSummary): string {
    const tr = (k: string, p?: Record<string, string | number>) => this.i18n.t(k, p);
    const mode =
      t.game === 'mh'
        ? `${tr('team.mode', { k: t.teamSize })} ${tr('race.mode')}`
        : t.teamSize > 1
          ? tr('team.mode', { k: t.teamSize })
          : '1v1';
    const size = `${t.size} ${tr(t.teamSize > 1 ? 'list.teams' : 'list.slots')}`;
    const parts = [mode, tr('format.' + t.format), size];
    if (t.seriesId) parts.push(tr('list.seriesTag'));
    return parts.join(' · ');
  }

  /** "9 / 16" registered (teams in team tournaments). */
  protected fill(t: TournamentSummary): string {
    return `${t.teamSize > 1 ? t.teams : t.registered} / ${t.size}`;
  }

  protected fillPct(t: TournamentSummary): number {
    return Math.min(100, (100 * (t.teamSize > 1 ? t.teams : t.registered)) / Math.max(1, t.size));
  }
}
