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
import { PageTitle } from '../core/page-title';
import { TournamentStream } from '../core/stream';
import { KillFeed } from '../components/kill-feed';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import { MH_ADAPTER, raceTime } from '../core/race';
import { playTime } from '../core/stats-format';
import { BetColumns } from '../components/bet-columns';
import type {
  BetMatchView,
  KillFeedEntry,
  MatchDetailView,
  MatchGameView,
  MatchPlayerView,
  MatchRunView,
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
  imports: [TPipe, RouterLink, BetColumns, KillFeed],
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
                  <a [routerLink]="['/bots', b.id]">{{ b.name }}</a>
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
              }
            </p>
          }

          @if (race() && v.runs.length) {
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
            <div class="versus">
              @for (s of d.entrants; track s.id; let i = $index) {
                <div class="card players" [class.b]="i === 1">
                  @for (p of rows(v, s.id); track p.name + (p.run ?? 0)) {
                    <div class="player" [class.mvp]="p.mvp">
                      <div class="spread">
                        <span class="nm">
                          @if (p.botId) {
                            <a [routerLink]="['/bots', p.botId]">{{ p.name }}</a>
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
                        @if (p.run) {
                          · {{ 'match.run' | t: { n: p.run } }}
                        }
                      </div>
                    </div>
                  } @empty {
                    <span class="muted small">{{ 'match.noStats' | t }}</span>
                  }
                </div>
              }
            </div>
            <p class="muted small">{{ (race() ? 'match.mvpHintMh' : 'match.mvpHint') | t }}</p>
          } @else if (v.game?.live) {
            @if (liveScore(); as ls) {
              <div class="livescore">
                <span class="nm">{{ d.entrants[0]!.name }}</span>
                <span class="sc"
                  ><b class="sa">{{ ls[0] }}</b
                  ><i>:</i><b class="sb">{{ ls[1] }}</b></span
                >
                <span class="nm">{{ d.entrants[1]!.name }}</span>
              </div>
            }
            <app-kill-feed [entries]="gameFeed(v.game!.game)" [sideA]="d.entrants[0]!.id" />
            <p class="muted small">{{ 'match.statsAfter' | t }}</p>
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
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: 16px;
      margin: 4px 0 14px;
    }
    .livescore .nm {
      font-weight: 700;
      font-size: 1.1rem;
    }
    .livescore .nm:first-child {
      text-align: right;
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
      this.api.killFeed(id).then(
        (l) => this.feed.set(l.filter((e) => e.matchId === m)),
        () => undefined,
      );
      this.stream.open(id, () => void this.load(this.id(), this.matchId(), false));
    });
    // New kills from the stream.
    effect(() => {
      const k = this.stream.kill();
      if (!k || k.matchId !== this.matchId()) return;
      this.feed.update((l) =>
        l.some(
          (x) =>
            x.at === k.at && x.killer === k.killer && x.victim === k.victim && x.chat === k.chat,
        )
          ? l
          : [...l, k].slice(-80),
      );
    });
    // While the match is not decided, refresh now and then (games end, stats arrive).
    const timer = setInterval(() => {
      if (this.d() && this.state() !== 'done') void this.load(this.id(), this.matchId(), false);
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

/** The series in total: one row per player and side, numbers added up. */
function mergePlayers(list: readonly MatchPlayerView[]): MatchPlayerView[] {
  const out = new Map<string, MatchPlayerView>();
  for (const p of list) {
    const k = `${p.entrantId}|${p.userId ?? p.botId ?? p.name.toLowerCase()}`;
    const x = out.get(k);
    if (!x) {
      const { run: _run, ...rest } = p;
      out.set(k, { ...rest, weapons: { ...p.weapons } });
      continue;
    }
    for (const key of SUM_KEYS)
      x[key] = key === 'bestSpree' ? Math.max(x[key], p[key]) : x[key] + p[key];
    x.firstBlood ||= p.firstBlood;
    for (const [w, n] of Object.entries(p.weapons)) x.weapons[w] = (x.weapons[w] ?? 0) + n;
  }
  return [...out.values()];
}
