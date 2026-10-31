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
import { PageTitle } from '../core/page-title';
import { TournamentStream } from '../core/stream';
import { KillFeed, type FeedSection } from '../components/kill-feed';
import { LiveBoard, type LiveSide } from '../components/live-board';
import { MomentumChart, type RaceLine } from '../components/momentum-chart';
import { DamageItems, type CompareRow, type SideTotals } from '../components/damage-items';
import { RacePanel } from '../components/race-panel';
import { mmss, sideSum, withKills } from '../core/live';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { botRoute } from '../core/bots';
import { Loading } from '../core/loading';
import { I18n, TPipe } from '../core/i18n';
import { MH_ADAPTER, raceTime } from '../core/race';
import { playTime } from '../core/stats-format';
import { BetColumns } from '../components/bet-columns';
import type {
  BetMatchView,
  KillFeedEntry,
  LiveSnapshot,
  MatchDetailView,
  MatchGameView,
  MatchPlayerView,
  MatchRunView,
  ReplayView,
  TournamentDetail,
} from '../core/types';

/** A player row of the view: the stats plus share and MVP. */
interface Row extends MatchPlayerView {
  /** Share of the side's frags (Monster Hunt: monster points), percent. */
  share: number;
  mvp: boolean;
  favWeapon?: string;
}

/** What one tab shows: a game, or the whole series ("total"). */
interface View {
  key: string;
  game?: MatchGameView;
  players: MatchPlayerView[];
  runs: MatchRunView[];
}

const SUM_KEYS = [
  'kills',
  'deaths',
  'suicides',
  'teamKills',
  'headshots',
  'bestSpree',
  'sprees',
  'multi2',
  'multi3',
  'multi4',
  'multi5',
  'timeSec',
  'monsters',
  'monsterPoints',
] as const;

/** Match page: entrants, series score, every game with the players' statistics, bets. */
@Component({
  selector: 'app-match-page',
  imports: [
    TPipe,
    RouterLink,
    BetColumns,
    KillFeed,
    LiveBoard,
    MomentumChart,
    DamageItems,
    RacePanel,
    NgTemplateOutlet,
  ],
  providers: [TournamentStream],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (t(); as t) {
      <a [routerLink]="['/t', t.id]">← {{ t.name }}</a>
    }
    @if (d(); as d) {
      <h1>
        {{ d.matchId }}
        @if (d.bestOf > 1) {
          <span class="muted small">· Bo{{ d.bestOf }}</span>
        }
        <span class="pill" [class]="state()">{{ 'match.state.' + state() | t }}</span>
      </h1>

      <div class="versus">
        @for (s of d.entrants; track s.id; let i = $index) {
          <div class="side card" [class.b]="i === 1" [class.won]="d.winnerId === s.id">
            <div class="spread">
              <h2>
                @if (s.tag) {
                  <span class="muted">{{ s.tag }}</span>
                }
                {{ s.name }}
              </h2>
              <span class="score">{{ d.wins[s.id] ?? 0 }}</span>
            </div>
            @if (s.rating) {
              <div class="muted small">{{ 'match.rating' | t }} {{ s.rating }}</div>
            }
            <div class="who small">
              @for (m of s.members; track m.userId) {
                <a [routerLink]="['/stats/p', 'u:' + m.userId]">{{ m.name }}</a>
                @if (m.sub) {
                  <span class="muted">({{ 'team.sub' | t }})</span>
                }
              }
              @for (b of s.bots; track b.name) {
                @if (b.id) {
                  <a [routerLink]="botRoute(b.id, udt())">{{ b.name }}</a>
                } @else {
                  <span>{{ b.name }}</span>
                }
                <span class="badge bot">BOT</span>
              }
            </div>
          </div>
        }
      </div>
      @if (d.outcome && d.outcome !== 'played') {
        <p class="muted small">{{ 'match.outcome.' + d.outcome | t }}</p>
      }

      @if (views().length) {
        <div class="tabs">
          @for (v of views(); track v.key) {
            <button [class.active]="tab() === v.key" (click)="tab.set(v.key)">
              @if (v.game; as g) {
                {{ 'match.game' | t: { n: g.game } }}
                @if (g.live) {
                  <span class="live-dot"></span>
                }
              } @else {
                {{ 'match.total' | t }}
              }
            </button>
          }
        </div>

        @if (current(); as v) {
          @if (v.game; as g) {
            <p class="meta">
              @if (g.map) {
                <b>{{ g.map }}</b>
              }
              @if (g.scores && !race()) {
                · {{ g.scores[d.entrants[0]!.id] ?? 0 }} : {{ g.scores[d.entrants[1]!.id] ?? 0 }}
              }
              @if (g.endReason) {
                · {{ 'match.end.' + g.endReason | t }}
              }
              @if (g.durationSec) {
                · {{ time(g.durationSec) }}
              }
              @if (g.live) {
                · <span class="live">{{ 'match.live' | t }}</span>
                @if (delayed(); as n) {
                  <span class="delay" [title]="'live.delayHint' | t">{{
                    'live.delayed' | t: { n }
                  }}</span>
                }
              }
            </p>
          }

          @if (v.game?.live) {
            @if (!race() && liveScore(); as ls) {
              <div class="livescore card">
                <span class="nm">{{ d.entrants[0]!.name }}</span>
                <span class="mid">
                  <span class="sc"
                    ><b class="sa">{{ ls[0] }}</b
                    ><i>:</i><b class="sb">{{ ls[1] }}</b></span
                  >
                  <span class="clk muted small">
                    @if (clock(); as c) {
                      <b class="mono">{{ c }}</b> ·
                    }
                    {{ limits() }}
                  </span>
                </span>
                <span class="nm">{{ d.entrants[1]!.name }}</span>
              </div>
            }
            @if (race()) {
              <app-race-panel
                [runs]="v.runs"
                [race]="liveRace()"
                [state]="liveState()"
                [names]="names()"
              />
            }
            @if (liveState(); as st) {
              <app-live-board [players]="st.players" [sides]="liveSides()" [race]="race()" />
            }
          }
          @if (v.game?.live) {
            <ng-container *ngTemplateOutlet="extras; context: { $implicit: v, d: d }" />
          }
          @if (v.game?.live && !race()) {
            <p class="muted small">{{ 'match.statsAfter' | t }}</p>
          }

          @if (race() && v.runs.length && !v.game?.live) {
            <div class="versus">
              @for (s of d.entrants; track s.id; let i = $index) {
                <div class="card runs" [class.b]="i === 1">
                  @for (r of runsOf(v, s.id); track $index) {
                    <div class="run">
                      <b>{{ raceTime(r.timeMs + r.penaltyMs) }}</b>
                      <span class="muted small">
                        {{ raceTime(r.timeMs) }} + {{ raceTime(r.penaltyMs) }} ({{
                          'match.deaths' | t: { n: r.deaths }
                        }}) · {{ r.points }} {{ 'match.points' | t }}
                        @if (!r.finished) {
                          · <span class="lost">{{ 'match.notFinished' | t }}</span>
                        }
                      </span>
                    </div>
                  } @empty {
                    <span class="muted small">–</span>
                  }
                </div>
              }
            </div>
          }

          @if (v.players.length) {
            @if (v.game?.live) {
              <h3 class="sh">{{ 'match.statsDone' | t }}</h3>
            }
            <div class="versus">
              @for (s of d.entrants; track s.id; let i = $index) {
                <div class="card players" [class.b]="i === 1">
                  @for (p of rows(v, s.id); track p.name + (p.run ?? 0)) {
                    <div class="player" [class.mvp]="p.mvp">
                      <div class="spread">
                        <span class="nm">
                          @if (p.botId) {
                            <a [routerLink]="botRoute(p.botId, udt())">{{ p.name }}</a>
                          } @else if (p.userId) {
                            <a [routerLink]="['/stats/p', 'u:' + p.userId]">{{ p.name }}</a>
                          } @else {
                            {{ p.name }}
                          }
                          @if (p.bot) {
                            <span class="badge bot">BOT</span>
                          }
                          @if (p.mvp) {
                            <span class="badge mvp">MVP</span>
                          }
                        </span>
                        @if (race()) {
                          <span class="main mono"
                            >{{ p.monsterPoints }} {{ 'match.points' | t }}</span
                          >
                        } @else {
                          <span class="main mono">{{ p.kills }} / {{ p.deaths }}</span>
                        }
                      </div>
                      @if (showShare()) {
                        <div class="sharebar" [title]="p.share + ' %'">
                          <span [style.width.%]="p.share"></span>
                        </div>
                      }
                      <div class="details muted small">
                        @if (race()) {
                          {{ 'match.monsters' | t }} {{ p.monsters }} ·
                          {{ 'match.deathsShort' | t }}
                          {{ p.deaths }}
                        } @else {
                          K/D {{ kd(p) }} · HS {{ p.headshots }} · {{ 'match.spree' | t }}
                          {{ p.bestSpree }} · Multi {{ multi(p) }}
                          @if (p.firstBlood) {
                            · <span class="fb">First Blood</span>
                          }
                          @if (p.teamKills || p.suicides) {
                            · TK {{ p.teamKills }} · {{ 'match.suicides' | t }} {{ p.suicides }}
                          }
                        }
                        @if (showShare()) {
                          · {{ 'match.share' | t }} {{ p.share }} %
                        }
                        @if (p.favWeapon) {
                          · {{ p.favWeapon }}
                        }
                        @if (p.damageDealt !== undefined) {
                          · {{ 'match.damage' | t: { d: p.damageDealt, t: p.damageTaken ?? 0 } }}
                        }
                        @if (p.items; as it) {
                          @if (it.amp || it.belt || it.armor || it.keg) {
                            ·
                            {{
                              'match.items' | t: { a: it.amp, b: it.belt, r: it.armor, k: it.keg }
                            }}
                          }
                        }
                        @if (p.run) {
                          · {{ 'match.run' | t: { n: p.run } }}
                        }
                      </div>
                    </div>
                  } @empty {
                    <span class="muted small">{{
                      (v.game?.live && liveRace()?.runner === s.id
                        ? 'match.statsRunning'
                        : 'match.noStats'
                      ) | t
                    }}</span>
                  }
                </div>
              }
            </div>
            <p class="muted small">{{ (race() ? 'match.mvpHintMh' : 'match.mvpHint') | t }}</p>
          }
          @if (!v.game?.live) {
            <ng-container *ngTemplateOutlet="extras; context: { $implicit: v, d: d }" />
          }
        }
      } @else {
        <p class="muted">{{ 'match.notPlayed' | t }}</p>
      }

      <h2 class="bets-title">{{ 'bets.title' | t }}</h2>
      @if (bets(); as b) {
        @if (b.state === 'open') {
          <p class="muted small">
            {{ 'match.betsOpen' | t }}
            @if (t(); as t) {
              <a [routerLink]="['/t', t.id]">{{ 'match.toBets' | t }}</a>
            }
          </p>
        } @else if (b.bettors) {
          <app-bet-columns [match]="b" [names]="names()" />
        } @else {
          <p class="muted small">{{ 'bets.noBets' | t }}</p>
        }
      } @else {
        <p class="muted small">{{ 'match.noBetting' | t }}</p>
      }
    }

    <!-- Momentum, damage and items, feed: below the live board, after the statistics later. -->
    <ng-template #extras let-v let-d="d">
      @if (chart(); as c) {
        <div class="grid2" [class.one]="!totals() && !raceCompare()">
          <div class="card">
            <div class="lc-head">
              <h3>{{ c.title | t }}</h3>
              <span class="muted small">{{ c.hint }}</span>
            </div>
            <app-momentum-chart
              [samples]="c.samples"
              [race]="c.race"
              [duration]="c.duration"
              [now]="c.now"
              [label]="c.title | t"
            />
          </div>
          @if (totals(); as tt) {
            <div class="card">
              <div class="lc-head">
                <h3>{{ 'live.dmgItems' | t }}</h3>
              </div>
              <app-damage-items [a]="tt.a" [b]="tt.b" />
            </div>
          } @else if (raceCompare(); as rc) {
            <div class="card">
              <div class="lc-head">
                <h3>{{ 'live.compare' | t: { t: rc.at } }}</h3>
              </div>
              <app-damage-items [rows]="rc.rows" />
              <p class="muted small">{{ 'live.compareHint' | t }}</p>
            </div>
          }
        </div>
      }
      @if (sections().length) {
        <app-kill-feed
          [sections]="sections()"
          [sideA]="d.entrants[0]!.id"
          [live]="!!v.game?.live"
          [title]="v.game?.live ? 'feed.title' : 'feed.titleDone'"
          [thoughts]="fewBots()"
        />
      }
    </ng-template>
  `,
  styles: `
    h1 {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .pill {
      font-family: var(--font);
      font-style: normal;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      height: 22px;
      display: inline-flex;
      align-items: center;
      padding: 0 10px;
      border-radius: 999px;
      border: 1px solid var(--line);
      color: var(--text-2);
    }
    .pill.live {
      color: var(--live);
      border-color: rgba(74, 222, 128, 0.4);
      background: rgba(74, 222, 128, 0.1);
    }
    .pill.done {
      color: var(--text);
    }
    .versus {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 10px;
    }
    .versus > .card {
      min-width: 0;
      margin-bottom: 0;
      padding: 20px 22px;
      box-shadow: inset 0 4px 0 var(--side-a);
      background: linear-gradient(180deg, rgba(255, 77, 94, 0.08), transparent 70%), var(--panel);
    }
    .versus > .card.b {
      box-shadow: inset 0 4px 0 var(--side-b);
      background: linear-gradient(180deg, rgba(76, 141, 255, 0.08), transparent 70%), var(--panel);
    }
    .side.won {
      border-color: rgba(74, 222, 128, 0.55);
    }
    .side .spread {
      flex-wrap: nowrap;
    }
    .side h2 {
      margin: 0;
      font-size: 2rem;
      font-weight: 800;
      font-style: italic;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .side.won h2 {
      color: var(--live);
    }
    .score {
      font-family: var(--font-display);
      font-size: 3.4rem;
      line-height: 1;
      font-weight: 800;
      color: var(--side-a);
    }
    .b .score {
      color: var(--side-b);
    }
    .who {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      margin-top: 6px;
    }
    .badge {
      font-size: 0.6rem;
      padding: 0 5px;
      margin-left: 4px;
      height: 17px;
    }
    .badge.mvp {
      color: var(--hot-text);
      border-color: rgba(240, 70, 140, 0.5);
      background: rgba(240, 70, 140, 0.1);
    }
    .meta {
      margin: 0 0 10px;
    }
    .live,
    .fb {
      color: var(--live);
    }
    .live-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--live);
      margin-left: 6px;
    }
    .player {
      padding: 6px 0;
      border-bottom: 1px solid var(--border);
    }
    .player:last-child {
      border-bottom: none;
    }
    .player.mvp .nm a,
    .player.mvp .nm {
      font-weight: 700;
    }
    .nm {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .main {
      white-space: nowrap;
      font-weight: 700;
    }
    .sharebar {
      height: 4px;
      background: var(--panel-2);
      border-radius: 2px;
      margin: 4px 0;
      overflow: hidden;
    }
    .sharebar span {
      display: block;
      height: 100%;
      background: var(--side-a);
    }
    .b .sharebar span {
      background: var(--side-b);
    }
    .details {
      line-height: 1.5;
    }
    .run {
      display: flex;
      flex-direction: column;
      margin-bottom: 4px;
    }
    .lost {
      color: var(--danger);
    }
    .livescore {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
      gap: 16px;
      margin: 4px 0 10px;
      padding: 12px 20px;
      background:
        linear-gradient(
          90deg,
          rgba(255, 77, 94, 0.1),
          transparent 35%,
          transparent 65%,
          rgba(76, 141, 255, 0.1)
        ),
        var(--panel);
    }
    .livescore .nm {
      font-family: var(--font-display);
      font-weight: 800;
      font-style: italic;
      text-transform: uppercase;
      font-size: 1.6rem;
      color: var(--side-a);
    }
    .livescore .nm:last-child {
      text-align: right;
      color: var(--side-b);
    }
    .livescore .mid {
      display: grid;
      justify-items: center;
    }
    .grid2 {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
      gap: 10px;
    }
    .grid2.one {
      grid-template-columns: minmax(0, 1fr);
    }
    .sh {
      margin: 6px 0 8px;
    }
    @media (max-width: 760px) {
      .grid2 {
        grid-template-columns: minmax(0, 1fr);
      }
      .livescore {
        gap: 8px;
        padding: 10px 12px;
      }
      .livescore .nm {
        font-size: 1.05rem;
      }
      .livescore .sc {
        font-size: 2.4rem;
      }
    }
    .livescore .sc {
      font-family: var(--font-display);
      font-weight: 800;
      font-size: 3rem;
      line-height: 1;
    }
    .livescore i {
      color: var(--muted);
      font-style: normal;
      padding: 0 8px;
    }
    .sa {
      color: var(--side-a);
    }
    .sb {
      color: var(--side-b);
    }
    .bets-title {
      margin-top: 24px;
    }
    .delay {
      font-size: 0.78rem;
      color: var(--neuro-text);
      border: 1px solid rgba(245, 184, 61, 0.4);
      background: rgba(245, 184, 61, 0.08);
      border-radius: 999px;
      padding: 1px 10px;
      margin-left: 6px;
    }
  `,
})
export class MatchPage {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  readonly id = input.required<string>();
  readonly matchId = input.required<string>();
  protected readonly t = signal<TournamentDetail | null>(null);
  protected readonly d = signal<MatchDetailView | null>(null);
  protected readonly bets = signal<BetMatchView | null>(null);
  protected readonly tab = signal<string>('');
  protected readonly raceTime = (ms: number) => raceTime(ms);

  protected readonly race = computed(() => this.t()?.settings.game.adapter === MH_ADAPTER);
  /** Share of the side only matters with more than one player per side. */
  protected readonly showShare = computed(
    () => this.race() || (this.t()?.settings.teamSize ?? 1) > 1,
  );
  protected readonly names = computed(() =>
    Object.fromEntries((this.d()?.entrants ?? []).map((s) => [s.id, s.name])),
  );
  protected readonly state = computed(() => {
    const d = this.d();
    if (!d) return 'waiting';
    if (d.status === 'completed') return 'done';
    if (d.games.some((g) => g.live)) return 'live';
    return d.status === 'ready' ? 'ready' : 'waiting';
  });

  /** Tabs: the whole series (more than one game) and every game. */
  protected readonly views = computed<View[]>(() => {
    const d = this.d();
    if (!d || !d.games.length) return [];
    const games: View[] = d.games.map((g) => ({
      key: `g${g.game}`,
      game: g,
      players: g.players,
      runs: g.runs ?? [],
    }));
    if (d.games.length < 2) return games;
    return [
      {
        key: 'total',
        players: mergePlayers(d.games.flatMap((g) => g.players)),
        runs: d.games.flatMap((g) => g.runs ?? []),
      },
      ...games,
    ];
  });
  protected readonly current = computed(
    () => this.views().find((v) => v.key === this.tab()) ?? this.views()[0] ?? null,
  );

  private readonly title = inject(PageTitle);
  private readonly loading = inject(Loading);
  /** Dream Team tournament: bot names lead to their Dream Team page. */
  protected readonly udt = computed(() => this.t()?.kind === 'udt');
  protected readonly botRoute = botRoute;
  private readonly stream = inject(TournamentStream);
  /** Kills of the game in progress (live only). */
  protected readonly feed = signal<KillFeedEntry[]>([]);
  /** Frags of the game in progress (telemetry). */
  protected readonly liveScore = computed(() => {
    const l = this.stream.live() ?? this.t()?.live ?? null;
    const d = this.d();
    if (!l || !d || l.matchId !== d.matchId || !l.scores) return null;
    return [l.scores[d.entrants[0]!.id] ?? 0, l.scores[d.entrants[1]!.id] ?? 0] as const;
  });

  protected gameFeed(game: number): KillFeedEntry[] {
    return this.feed().filter((e) => e.game === game);
  }

  /** Live state and timeline when the page opened during a game (then the stream). */
  protected readonly snapshot = signal<LiveSnapshot | null>(null);
  /** Stored replays of the match's finished games (runs). */
  protected readonly replays = signal<ReplayView[]>([]);
  private replayKey = '';
  private liveKey = '';
  /** Monster Hunt: points of the run in progress from the telemetry, `[sec, points, deaths]`. */
  private readonly racePts = signal<number[][]>([]);

  /** The game of the open tab while it is played. */
  private readonly liveGame = computed(() => {
    const g = this.current()?.game;
    return g?.live ? g : null;
  });
  /** Monster Hunt: the run on the server (telemetry). */
  protected readonly liveRace = computed(() => {
    const l = this.stream.live() ?? this.t()?.live ?? null;
    const d = this.d();
    return l?.race && d && l.matchId === d.matchId ? l.race : null;
  });
  /** Players of the game in progress (mod 0.16.0), newest of stream and snapshot. */
  protected readonly liveState = computed(() => {
    const g = this.liveGame();
    const d = this.d();
    if (!g || !d) return null;
    const a = this.stream.state();
    const b = this.snapshot()?.state ?? null;
    const s = !a ? b : !b ? a : a.at >= b.at ? a : b;
    if (!s || s.matchId !== d.matchId || s.game !== g.game) return null;
    const r = this.liveRace();
    if (this.race() && r && s.run !== r.run) return null;
    return s;
  });
  protected readonly liveSides = computed<LiveSide[]>(() => {
    const d = this.d();
    if (!d) return [];
    const all = d.entrants.map((e, index) => ({ id: e.id, name: e.name, index }));
    if (!this.race()) return all;
    const r = this.liveRace();
    return r ? all.filter((e) => e.id === r.runner) : [];
  });
  /** Bot thoughts show by default with a few bots (more would fill the feed). */
  protected readonly fewBots = computed(() => {
    const g = this.current()?.game;
    const players = g?.live
      ? (this.liveState()?.players ?? [])
      : (this.gameReplays(g?.game ?? 0)[0]?.players ?? []);
    return players.filter((p) => p.bot).length <= 4;
  });
  /** The state is held back while a human plays (setting). */
  protected readonly delayed = computed(() =>
    this.liveState()?.humans ? (this.snapshot()?.delaySec ?? 0) : 0,
  );
  /**
   * Seconds of the game so far: the state's time plus its delay (it is that old), or the last
   * kill (kills are live), whichever is later.
   */
  private readonly nowSec = computed(() => {
    const s = this.liveState();
    const g = this.liveGame();
    if (!s || !g) return null;
    let sec = s.sec + this.delayed();
    for (const e of this.feed())
      if (e.game === g.game && e.sec !== undefined && (e.kind ?? 'kill') === 'kill')
        sec = Math.max(sec, e.sec);
    return sec;
  });
  protected readonly clock = computed(() => {
    const n = this.nowSec();
    return n === null ? null : mmss(n);
  });
  private readonly rules = computed(() => {
    const r = (this.t()?.settings.game.rules ?? {}) as {
      fragLimit?: number;
      timeLimitMin?: number;
    };
    // Missing values are the rules' defaults (20 frags, 10 minutes; 0 = none).
    return { frags: r.fragLimit ?? 20, timeSec: (r.timeLimitMin ?? 10) * 60 };
  });
  protected readonly limits = computed(() => {
    const r = this.rules();
    const parts: string[] = [];
    if (r.frags) parts.push(this.i18n.t('live.fragLimit', { n: r.frags }));
    if (r.timeSec) parts.push(this.i18n.t('live.timeLimit', { t: mmss(r.timeSec) }));
    return parts.join(' · ');
  });

  private gameReplays(game: number): ReplayView[] {
    return this.replays().filter((r) => r.game === game);
  }

  /** Momentum: frag difference (deathmatch) or the runs' points (Monster Hunt). */
  protected readonly chart = computed(() => {
    const d = this.d();
    const g = this.current()?.game;
    if (!d || !g) return null;
    const a = d.entrants[0]!.id;
    const b = d.entrants[1]!.id;
    const reps = this.gameReplays(g.game);
    if (this.race()) {
      const lr = g.live ? this.liveRace() : null;
      const lines: RaceLine[] = [];
      for (const r of reps)
        if (r.run && r.run !== lr?.run && r.samples.length)
          lines.push({ samples: r.samples, side: r.sides[0] === a ? 'a' : 'b', dashed: true });
      if (lr) {
        const tl = this.snapshot()?.timeline;
        const base =
          tl && tl.matchId === d.matchId && tl.game === g.game && tl.run === lr.run
            ? tl.samples
            : [];
        const last = base.at(-1)?.[0] ?? -1;
        lines.push({
          samples: [...base, ...this.racePts().filter((p) => (p[0] ?? 0) > last)],
          side: lr.runner === a ? 'a' : 'b',
        });
      } else if (lines.length > 1) lines[lines.length - 1] = { ...lines.at(-1)!, dashed: false };
      if (!lines.some((l) => l.samples.length)) return null;
      const end = Math.max(...lines.map((l) => l.samples.at(-1)?.[0] ?? 0));
      return {
        title: 'live.racePoints',
        hint: this.i18n.t('live.raceHint'),
        samples: [] as number[][],
        race: lines,
        duration: Math.max(120, Math.round(end * 1.08)),
        now: lr ? lr.timeMs / 1000 : null,
      };
    }
    let samples: number[][];
    let now: number | null = null;
    if (g.live) {
      const tl = this.snapshot()?.timeline;
      const flip = tl?.sides[0] === b;
      const base =
        tl && tl.matchId === d.matchId && tl.game === g.game
          ? tl.samples.map((x) => [x[0] ?? 0, x[flip ? 2 : 1] ?? 0, x[flip ? 1 : 2] ?? 0])
          : [];
      samples = withKills(base, this.gameFeed(g.game), a, b);
      now = this.nowSec() ?? samples.at(-1)?.[0] ?? null;
    } else {
      const rep = reps[0];
      if (!rep) return null;
      const flip = rep.sides[0] === b;
      samples = rep.samples.map((x) => [x[0] ?? 0, x[flip ? 2 : 1] ?? 0, x[flip ? 1 : 2] ?? 0]);
    }
    if (!samples.length) return null;
    const end = samples.at(-1)![0] ?? 0;
    return {
      title: 'live.momentum',
      hint: this.i18n.t('live.momentumHint', { name: d.entrants[0]!.name }),
      samples,
      race: null,
      duration: g.live ? Math.max(this.rules().timeSec, (now ?? end) + 60) : Math.max(60, end),
      now,
    };
  });

  /** Damage and items per side: live from the state, afterwards from the statistics. */
  protected readonly totals = computed<{ a: SideTotals; b: SideTotals } | null>(() => {
    const d = this.d();
    const g = this.current()?.game;
    if (!d || !g || this.race()) return null;
    const [a, b] = [d.entrants[0]!.id, d.entrants[1]!.id];
    if (g.live) {
      const s = this.liveState();
      return s ? { a: sideSum(s.players, a), b: sideSum(s.players, b) } : null;
    }
    const stats = g.players.filter((p) => p.damageDealt !== undefined);
    if (stats.length) return { a: statSum(stats, a), b: statSum(stats, b) };
    const rep = this.gameReplays(g.game)[0];
    return rep?.players.length ? { a: sideSum(rep.players, a), b: sideSum(rep.players, b) } : null;
  });

  /** Monster Hunt: the finished run at the same time against the run on the server. */
  protected readonly raceCompare = computed<{ at: string; rows: CompareRow[] } | null>(() => {
    const d = this.d();
    const g = this.liveGame();
    const lr = this.liveRace();
    if (!this.race() || !d || !g || !lr) return null;
    const first = this.gameReplays(g.game).find((r) => r.run && r.run !== lr.run);
    if (!first?.samples.length) return null;
    const now = lr.timeMs / 1000;
    let then = first.samples[0]!;
    for (const x of first.samples) {
      if ((x[0] ?? 0) > now) break;
      then = x;
    }
    // left: side a's run, right: side b's run
    const firstIsA = first.sides[0] === d.entrants[0]!.id;
    const pair = (x: number, y: number) => (firstIsA ? { a: x, b: y } : { a: y, b: x });
    const rows: CompareRow[] = [
      { label: 'match.points', ...pair(then[1] ?? 0, lr.points) },
      { label: 'match.deathsShort', ...pair(then[2] ?? 0, lr.deaths) },
    ];
    return { at: raceTime(lr.timeMs, false), rows };
  });

  /** Feed: the game in progress, its runs (Monster Hunt), or the stored feed afterwards. */
  protected readonly sections = computed<FeedSection[]>(() => {
    const d = this.d();
    const v = this.current();
    const g = v?.game;
    if (!d || !g) return [];
    const reps = this.gameReplays(g.game);
    const byAt = (l: KillFeedEntry[]) => [...l].sort((x, y) => x.at - y.at);
    const side = (id: string | undefined) =>
      id === d.entrants[0]!.id ? 'a' : id === d.entrants[1]!.id ? 'b' : null;
    const name = (id: string | undefined) => (id ? (this.names()[id] ?? '?') : '?');
    if (this.race()) {
      const lr = g.live ? this.liveRace() : null;
      const out: FeedSection[] = [];
      for (const n of [2, 1]) {
        const rep = reps.find((r) => r.run === n);
        const live = lr?.run === n;
        const entries =
          live || !rep ? byAt(this.gameFeed(g.game).filter((e) => (e.run ?? 1) === n)) : rep.feed;
        if (!entries.length && !live) continue;
        const team = live ? lr.runner : (rep?.sides[0] ?? v.runs[n - 1]?.entrantId);
        out.push({
          key: `r${n}`,
          title: this.i18n.t('live.runOf', { n, team: name(team) }),
          side: side(team),
          sub: live ? this.i18n.t('match.live') : this.i18n.t('feed.count', { n: entries.length }),
          entries,
          open: live,
        });
      }
      return out;
    }
    if (g.live) return [{ key: 'g', entries: byAt(this.gameFeed(g.game)), open: true }];
    const rep = reps[0];
    if (!rep?.feed.length) return [];
    return [
      {
        key: 'all',
        title: this.i18n.t('feed.whole'),
        sub: this.i18n.t('feed.count', { n: rep.feed.length }),
        entries: rep.feed,
        open: false,
      },
    ];
  });

  constructor() {
    effect(() =>
      this.title.set(this.d() ? `${this.d()!.matchId} · ${this.t()?.name ?? ''}` : null),
    );
    inject(DestroyRef).onDestroy(() => this.title.set(null));
    effect(() => {
      const id = this.id();
      const m = this.matchId();
      void this.load(id, m, true);
      this.feed.set([]);
      untracked(() => {
        this.replays.set([]);
        this.snapshot.set(null);
      });
      this.replayKey = '';
      this.liveKey = '';
      this.api.killFeed(id).then(
        (l) => this.feed.set(l.filter((e) => e.matchId === m)),
        () => undefined,
      );
      this.stream.open(id, () => void this.load(this.id(), this.matchId(), false));
    });
    // New feed entries from the stream (all of them, also when several come at once).
    this.stream.onFeed = (k) => {
      if (k.matchId !== this.matchId()) return;
      this.feed.update((l) =>
        l.some(
          (x) =>
            x.at === k.at &&
            x.kind === k.kind &&
            x.killer === k.killer &&
            x.victim === k.victim &&
            x.chat === k.chat &&
            x.item === k.item &&
            x.thought?.state === k.thought?.state,
        )
          ? l
          : [...l, k].slice(-600),
      );
    };
    // A game (run) went live: its state and timeline so far.
    effect(() => {
      const g = this.liveGame();
      const r = this.liveRace();
      const key = g ? `${this.matchId()}/${g.game}/${r?.run ?? 0}` : '';
      if (key === this.liveKey) return;
      this.liveKey = key;
      this.racePts.set([]);
      if (!key) return;
      const id = this.id();
      this.api.liveState(id).then(
        (s) => {
          if (this.liveKey === key) this.snapshot.set(s);
        },
        () => undefined,
      );
    });
    // Monster Hunt: the run's points over time from the telemetry.
    effect(() => {
      const r = this.liveRace();
      if (!r) return;
      const sec = r.timeMs / 1000;
      untracked(() =>
        this.racePts.update((l) =>
          (l.at(-1)?.[0] ?? -1) < sec ? [...l, [sec, r.points, r.deaths]].slice(-2000) : l,
        ),
      );
    });
    // While the match is not decided, refresh now and then (games end, stats arrive).
    const timer = setInterval(() => {
      if (this.d() && this.state() !== 'done')
        this.loading.background(() => void this.load(this.id(), this.matchId(), false));
    }, 15_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private async load(id: string, matchId: string, first: boolean) {
    try {
      const [t, d, b] = await Promise.all([
        first || !this.t() ? this.api.tournament(id) : Promise.resolve(this.t()!),
        this.api.matchDetail(id, matchId),
        this.api.tournamentBets(id, true).catch(() => null),
      ]);
      this.t.set(t);
      this.d.set(d);
      // Replays of the finished games (runs), again when one more is done.
      const key = d.games
        .map((g) => `${g.game}:${g.runs?.length ?? 0}:${g.winnerId ? 1 : 0}`)
        .join('|');
      if (key !== this.replayKey && d.games.some((g) => g.winnerId || g.runs?.length)) {
        this.replayKey = key;
        void this.api.matchReplays(id, matchId).then(
          (r) => this.replays.set(r),
          () => undefined,
        );
      }
      this.bets.set(b?.matches.find((m) => m.matchId === matchId) ?? null);
      if (first) {
        // Decided series: the total; else the game being played (or the last one).
        const live = d.games.find((g) => g.live);
        this.tab.set(
          live ? `g${live.game}` : d.games.length > 1 ? 'total' : `g${d.games.at(-1)?.game ?? 1}`,
        );
      }
    } catch {
      // the toast shows the error
    }
  }

  protected time(sec: number): string {
    return playTime(sec);
  }

  protected runsOf(v: View, entrantId: string): MatchRunView[] {
    return v.runs.filter((r) => r.entrantId === entrantId);
  }

  /** Players of a side with share and MVP (MVP across both sides of the view). */
  protected rows(v: View, entrantId: string): Row[] {
    const race = this.race();
    const value = (p: MatchPlayerView) =>
      race ? p.monsterPoints : p.kills - p.suicides - p.teamKills;
    const all = v.players;
    let mvp: MatchPlayerView | undefined;
    if (all.length > 2 || race)
      for (const p of all)
        if (!mvp || value(p) > value(mvp) || (value(p) === value(mvp) && p.deaths < mvp.deaths))
          mvp = p;
    const side = all.filter((p) => p.entrantId === entrantId);
    const total = side.reduce((s, p) => s + Math.max(0, race ? p.monsterPoints : p.kills), 0);
    return side
      .map((p) => {
        const fav = Object.entries(p.weapons ?? {}).sort((a, b) => b[1] - a[1])[0];
        return {
          ...p,
          share: total
            ? Math.round((Math.max(0, race ? p.monsterPoints : p.kills) / total) * 100)
            : 0,
          mvp: p === mvp && value(p) > 0,
          ...(fav ? { favWeapon: fav[0] } : {}),
        };
      })
      .sort((a, b) => value(b) - value(a) || a.deaths - b.deaths);
  }

  protected kd(p: MatchPlayerView): string {
    const v = p.deaths ? p.kills / p.deaths : p.kills;
    return v.toLocaleString(this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  protected multi(p: MatchPlayerView): number {
    return p.multi2 + p.multi3 + p.multi4 + p.multi5;
  }
}

/** Damage and items of a side from the statistics. */
function statSum(players: readonly MatchPlayerView[], side: string): SideTotals {
  const out: SideTotals = { damage: 0, items: { amp: 0, belt: 0, armor: 0, keg: 0 } };
  for (const p of players) {
    if (p.entrantId !== side) continue;
    out.damage += p.damageDealt ?? 0;
    for (const k of ['amp', 'belt', 'armor', 'keg'] as const) out.items[k] += p.items?.[k] ?? 0;
  }
  return out;
}

/** The series in total: one row per player and side, numbers added up. */
function mergePlayers(list: readonly MatchPlayerView[]): MatchPlayerView[] {
  const out = new Map<string, MatchPlayerView>();
  for (const p of list) {
    const k = `${p.entrantId}|${p.userId ?? p.botId ?? p.name.toLowerCase()}`;
    const x = out.get(k);
    if (!x) {
      const { run: _run, ...rest } = p;
      out.set(k, {
        ...rest,
        weapons: { ...p.weapons },
        ...(p.items ? { items: { ...p.items } } : {}),
      });
      continue;
    }
    for (const key of SUM_KEYS)
      x[key] = key === 'bestSpree' ? Math.max(x[key], p[key]) : x[key] + p[key];
    x.firstBlood ||= p.firstBlood;
    if (p.damageDealt !== undefined) {
      x.damageDealt = (x.damageDealt ?? 0) + p.damageDealt;
      x.damageTaken = (x.damageTaken ?? 0) + (p.damageTaken ?? 0);
    }
    if (p.items) {
      const it = (x.items ??= { amp: 0, belt: 0, armor: 0, keg: 0 });
      for (const k of ['amp', 'belt', 'armor', 'keg'] as const) it[k] += p.items[k];
    }
    for (const [w, n] of Object.entries(p.weapons)) x.weapons[w] = (x.weapons[w] ?? 0) + n;
  }
  return [...out.values()];
}
