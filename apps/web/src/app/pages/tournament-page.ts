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
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { BracketView } from '../bracket/bracket-view';
import { SeedingEditor } from '../components/seeding-editor';
import { TeamPanel } from '../components/team-panel';
import { TeamRoster } from '../components/team-roster';
import { Api, errorText } from '../core/api';
import { copyText, selectText } from '../core/clipboard';
import { isLocalAddress, joinUrl, linuxStartCommand } from '../core/connect';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { TournamentStream } from '../core/stream';
import { finalMs, isRace, raceTime, type RunView } from '../core/race';
import type { TournamentDetail, TournamentEventView } from '../core/types';

const ACTIVE = ['checkIn', 'running', 'paused'];

@Component({
  selector: 'app-tournament-page',
  imports: [FormsModule, RouterLink, TPipe, BracketView, SeedingEditor, TeamPanel, TeamRoster],
  providers: [TournamentStream],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (t(); as t) {
      <div class="spread head">
        <div>
          <h1>
            {{ t.name }} <span class="badge" [class]="t.phase">{{ 'phase.' + t.phase | t }}</span>
          </h1>
          <div class="muted small">
            {{ 'format.' + t.settings.format | t }} ·
            @if (race()) {
              {{ 'race.mode' | t }} ·
            }
            @if (teamMode()) {
              {{ 'team.mode' | t: { k: t.settings.teamSize } }} · {{ t.settings.size }}
              {{ 'list.teams' | t }} ·
            } @else {
              {{ t.settings.size }} {{ 'list.slots' | t }} ·
            }
            {{ 'tp.bestOf' | t: { n: t.settings.bestOf.default } }}
            @if (t.settings.bestOf.grandFinal) {
              · {{ 'tp.gfBestOf' | t: { n: t.settings.bestOf.grandFinal } }}
            }
            · {{ rulesText(t) }}
            @if (t.scheduledAt) {
              · {{ i18n.date(t.scheduledAt) }}
            }
          </div>
        </div>
        @if (isAdmin()) {
          <div class="muted small">
            <span class="dot" [class.on]="t.agent.online"></span> {{ t.agentId }}
          </div>
        }
      </div>

      @if (t.phase === 'paused' && t.projection?.pausedReason) {
        <p class="notice">{{ 'tp.paused' | t: { reason: t.projection!.pausedReason! } }}</p>
      }
      @if (t.phase === 'aborted') {
        <p class="error">{{ 'tp.aborted' | t: { reason: t.projection?.abortedReason ?? '' } }}</p>
      }
      @if (champion(); as c) {
        <div class="card champion">🏆 {{ 'tp.champion' | t: { name: c } }}</div>
      }

      @if (teamMode() && t.phase === 'draft') {
        <div class="card">
          <app-team-panel
            [tournament]="t"
            [isAdmin]="isAdmin()"
            [myUserId]="auth.me()?.id ?? null"
            [joinCode]="join() ?? null"
            (changed)="reload()"
          />
        </div>
      }

      <div class="grid two">
        <!-- Taking part -->
        @if (
          t.phase !== 'finished' && t.phase !== 'aborted' && !(teamMode() && t.phase === 'draft')
        ) {
          <div class="card">
            @if (t.phase === 'draft') {
              <h2>{{ 'tp.registration' | t }}</h2>
              <p class="muted small">
                {{ 'tp.registered' | t: { n: t.registrations.length, size: t.settings.size } }}
              </p>
              @if (t.me.registered) {
                <p>{{ 'tp.youAreIn' | t }}</p>
                <button (click)="act(api.unregister(t.id))" [disabled]="busy()">
                  {{ 'tp.withdraw' | t }}
                </button>
              } @else if (t.registrationOpen && t.registrations.length < t.settings.size) {
                <button class="primary" (click)="act(api.register(t.id))" [disabled]="busy()">
                  {{ 'tp.register' | t }}
                </button>
              } @else {
                <p class="muted">{{ 'tp.registrationClosed' | t }}</p>
              }
            } @else {
              <h2>{{ 'tp.join' | t }}</h2>
              @if (t.me.hasAccess) {
                @if (t.connectAddress) {
                  @if (localAddress(t)) {
                    <p class="error small">
                      {{ 'tp.localAddress' | t: { addr: t.connectAddress } }}
                    </p>
                  }
                  <p class="muted small">{{ 'tp.connectHint' | t }}</p>
                  <div class="connect">
                    <code #cmd>{{ connectCommand(t) }}</code>
                    <button (click)="copy('cmd', connectCommand(t), cmd)">
                      {{ copyLabel('cmd') | t }}
                    </button>
                  </div>
                  @if (longToken()) {
                    <p class="muted small">
                      {{ 'tp.longToken' | t }} <a routerLink="/profile">{{ 'tp.toProfile' | t }}</a>
                    </p>
                  }
                  <details class="linux">
                    <summary>{{ 'tp.linuxTitle' | t }}</summary>
                    <p class="muted small">{{ 'tp.linuxHint' | t }}</p>
                    <label class="small"
                      >{{ 'tp.linuxDir' | t }}
                      <input
                        class="mono"
                        [value]="utDir()"
                        (input)="setUtDir($any($event.target).value)"
                        placeholder="~/Games/UT99/System"
                    /></label>
                    <div class="connect">
                      <code #lin>{{ linuxCommand(t) }}</code>
                      <button (click)="copy('linux', linuxCommand(t), lin)">
                        {{ copyLabel('linux') | t }}
                      </button>
                    </div>
                    <p class="muted small">{{ 'tp.linuxNote' | t }}</p>
                  </details>
                  <p class="muted small">
                    {{ (t.me.entrantId ? 'tp.asPlayer' : 'tp.asSpectator') | t }}
                  </p>
                } @else {
                  <p class="muted">{{ 'tp.noAddress' | t }}</p>
                }
                @if (t.me.watching) {
                  <button class="link small" (click)="act(api.unwatch(t.id))">
                    {{ 'tp.unwatch' | t }}
                  </button>
                }
              } @else {
                <p class="muted small">{{ 'tp.watchHint' | t }}</p>
                <button class="primary" (click)="act(api.watch(t.id))" [disabled]="busy()">
                  {{ 'tp.watch' | t }}
                </button>
              }
            }
          </div>
        }

        <!-- Live -->
        @if (current(); as cm) {
          <div class="card live">
            <h2>
              {{ 'tp.now' | t }} · {{ cm.matchId }}
              @if (bestOfCurrent() > 1) {
                <span class="muted small"
                  >({{ 'tp.game' | t: { n: cm.game, of: bestOfCurrent() } }})</span
                >
              }
            </h2>
            @if (race()) {
              <div class="versus">
                @for (id of cm.entrants; track id; let i = $index) {
                  @if (i === 1) {
                    <div class="vs">vs</div>
                  }
                  <div class="side">
                    <div class="name">
                      {{ name(id) }}
                      @if (runnerNow() === id) {
                        <span class="badge running">{{ 'race.running' | t }}</span>
                      }
                    </div>
                    <div class="score">{{ raceScore(id) }}</div>
                    <div class="muted small">{{ raceDetail(id) }}</div>
                  </div>
                }
              </div>
            } @else {
              <div class="versus">
                <div class="side">
                  <div class="name">{{ name(cm.entrants[0]) }}</div>
                  <div class="score">{{ liveScore(cm.entrants[0]) }}</div>
                </div>
                <div class="vs">vs</div>
                <div class="side">
                  <div class="name">{{ name(cm.entrants[1]) }}</div>
                  <div class="score">{{ liveScore(cm.entrants[1]) }}</div>
                </div>
              </div>
            }
            <p class="small">
              @if (liveNow(); as l) {
                <b>{{ 'live.' + l.phase | t }}</b>
                @if (l.map || cm.map) {
                  · {{ l.map || cm.map }}
                }
                @if (race() && runnerNow(); as r) {
                  · {{ 'race.runOf' | t: { n: (cm.runs?.length ?? 0) + 1, team: name(r) } }}
                }
                @if (secondsLeft() !== null) {
                  · {{ 'tp.secondsLeft' | t: { s: secondsLeft()! } }}
                }
              } @else {
                {{ (cm.map ? 'tp.mapSelected' : 'tp.called') | t: { map: cm.map ?? '' } }}
              }
            </p>
          </div>
        } @else if (t.phase === 'checkIn') {
          <div class="card">
            <h2>{{ 'tp.checkIn' | t }}</h2>
            @if (teamMode()) {
              <p class="small">
                {{
                  'tp.checkedInTeams'
                    | t: { n: t.projection?.checkedIn?.length ?? 0, total: humans().length }
                }}
              </p>
            } @else {
              <p class="small">
                {{
                  'tp.checkedIn'
                    | t: { n: t.projection?.checkedIn?.length ?? 0, total: humans().length }
                }}
              </p>
            }
            <ul class="small">
              @for (h of humans(); track h.id) {
                <li>
                  {{ h.displayName }}
                  @if (t.projection?.checkedIn?.includes(h.id)) {
                    ✓
                  }
                </li>
              }
            </ul>
          </div>
        }
      </div>

      @if (t.projection?.bracket; as b) {
        <div class="card">
          <app-bracket
            [bracket]="b"
            [entrants]="t.projection!.entrants"
            [games]="t.projection!.games"
            [currentMatchId]="t.projection!.currentMatch?.matchId"
            [live]="liveNow()"
            [myEntrantId]="t.me.entrantId"
            [race]="race()"
          />
        </div>
        @if (race() && raceRows().length) {
          <div class="card">
            <h2>{{ 'race.results' | t }}</h2>
            <p class="muted small">{{ 'race.resultsHint' | t: { s: penaltySec() } }}</p>
            <div class="scroll">
              <table class="races">
                <thead>
                  <tr>
                    <th>{{ 'race.match' | t }}</th>
                    <th>{{ 'race.map' | t }}</th>
                    <th>{{ 'tp.team' | t }}</th>
                    <th class="num">{{ 'race.raw' | t }}</th>
                    <th class="num">{{ 'race.deaths' | t }}</th>
                    <th class="num">{{ 'race.penalty' | t }}</th>
                    <th class="num">{{ 'race.total' | t }}</th>
                    <th class="num">{{ 'race.points' | t }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of raceRows(); track $index) {
                    <tr [class.win]="row.won" [class.first]="row.first">
                      <td>
                        @if (row.first) {
                          {{ row.matchId }} G{{ row.game }}
                        }
                      </td>
                      <td>
                        @if (row.first) {
                          {{ row.map }}
                        }
                      </td>
                      <td>
                        {{ name(row.run.entrantId) }}
                        @if (row.won) {
                          🏁
                        }
                      </td>
                      <td class="num">{{ raceTime(row.run.timeMs) }}</td>
                      <td class="num">{{ row.run.deaths }}</td>
                      <td class="num">+{{ raceTime(row.run.penaltyMs) }}</td>
                      <td class="num">
                        <b>{{
                          row.run.finished
                            ? raceTime(finalMs(row.run))
                            : ((row.run.forfeit ? 'race.forfeit' : 'race.dnf') | t)
                        }}</b>
                      </td>
                      <td class="num">{{ row.run.points }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
        <div class="card">
          <h2>{{ 'tp.standings' | t }}</h2>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{{ (teamMode() ? 'tp.team' : 'tp.player') | t }}</th>
                <th>{{ 'tp.wins' | t }}</th>
                <th>{{ 'tp.losses' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (s of b.standings; track s.entrantId) {
                <tr [class.me]="s.entrantId === t.me.entrantId">
                  <td>{{ s.placement ?? '–' }}</td>
                  <td>
                    {{ name(s.entrantId) }}
                    @if (isBot(s.entrantId)) {
                      <span class="muted small"> BOT</span>
                    }
                  </td>
                  <td>{{ s.wins }}</td>
                  <td>{{ s.losses }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }

      @if (teamMode() && t.projection) {
        <div class="card">
          <app-team-roster
            [tournament]="t"
            [isAdmin]="isAdmin()"
            [myUserId]="auth.me()?.id ?? null"
            (changed)="reload()"
          />
        </div>
      }

      @if (t.phase === 'draft' && !teamMode()) {
        <div class="card">
          <h2>{{ 'tp.players' | t }} ({{ t.registrations.length }})</h2>
          @if (!t.registrations.length) {
            <p class="muted">{{ 'tp.noPlayers' | t }}</p>
          }
          <ul class="players">
            @for (r of t.registrations; track r.userId) {
              <li>
                {{ r.displayName }}
                @if (isAdmin()) {
                  <button class="link small" (click)="act(api.kick(t.id, r.userId))">✕</button>
                }
              </li>
            }
          </ul>
        </div>
      }

      @if (isAdmin()) {
        <div class="card admin">
          <h2>{{ 'admin.title' | t }}</h2>
          <div class="tabs">
            <button [class.active]="tab() === 'control'" (click)="tab.set('control')">
              {{ 'admin.control' | t }}
            </button>
            @if (t.phase === 'draft' || t.phase === 'seeded') {
              <button [class.active]="tab() === 'seeding'" (click)="tab.set('seeding')">
                {{ 'admin.seeding' | t }}
              </button>
            }
            <button [class.active]="tab() === 'events'" (click)="openEvents()">
              {{ 'admin.events' | t }}
            </button>
          </div>

          @if (tab() === 'control') {
            <div class="stack">
              <div class="row">
                <a class="btn" [routerLink]="['/t', t.id, 'edit']">{{ 'admin.edit' | t }}</a>
                @if (t.phase === 'draft') {
                  <button
                    (click)="
                      act(api.updateTournament(t.id, { registrationOpen: !t.registrationOpen }))
                    "
                  >
                    {{
                      (t.registrationOpen ? 'admin.closeRegistration' : 'admin.openRegistration')
                        | t
                    }}
                  </button>
                }
                @if (!isActive()) {
                  <button class="danger" (click)="remove()">{{ 'common.delete' | t }}</button>
                }
              </div>
              @if (t.phase === 'draft' || t.phase === 'seeded') {
                <div class="row">
                  <button
                    (click)="act(api.seed(t.id, { mode: 'auto', humanOrder: 'random' }))"
                    [disabled]="busy() || !t.registrations.length"
                  >
                    {{ 'admin.seedRandom' | t }}
                  </button>
                  <button
                    (click)="act(api.seed(t.id, { mode: 'auto', humanOrder: 'seeded' }))"
                    [disabled]="busy() || !t.registrations.length"
                  >
                    {{ 'admin.seedOrder' | t }}
                  </button>
                  @if (t.phase === 'seeded') {
                    <button (click)="act(api.reset(t.id))" [disabled]="busy()">
                      {{ 'admin.reset' | t }}
                    </button>
                  }
                </div>
              }
              @if (t.phase === 'seeded') {
                <div class="row">
                  <button
                    class="primary"
                    (click)="act(api.run(t.id))"
                    [disabled]="busy() || !t.agent.online"
                  >
                    {{ 'admin.run' | t }}
                  </button>
                  @if (!t.agent.online) {
                    <span class="muted small">{{
                      'admin.agentOffline' | t: { id: t.agentId }
                    }}</span>
                  }
                </div>
                <p class="muted small">
                  {{ 'admin.runHint' | t: { min: t.settings.checkInWindowMin } }}
                </p>
              }
              @if (isActive()) {
                <div class="row">
                  @if (t.phase === 'checkIn') {
                    <button
                      class="primary"
                      (click)="command({ kind: 'forceStart' })"
                      [disabled]="busy()"
                    >
                      {{ 'admin.forceStart' | t }}
                    </button>
                  }
                  @if (t.phase === 'paused') {
                    <button
                      class="primary"
                      (click)="command({ kind: 'resume' })"
                      [disabled]="busy()"
                    >
                      {{ 'admin.resume' | t }}
                    </button>
                  } @else {
                    <button (click)="pause()" [disabled]="busy()">{{ 'admin.pause' | t }}</button>
                  }
                  @if (current()?.map && t.phase === 'running') {
                    <button (click)="restart()" [disabled]="busy()">
                      {{ (race() ? 'admin.restartRun' : 'admin.restartGame') | t }}
                    </button>
                  }
                  @if (race() && current()?.map && t.phase === 'running') {
                    <button (click)="forfeitRun()" [disabled]="busy()">
                      {{ 'admin.forfeitRun' | t }}
                    </button>
                  }
                  <button class="danger" (click)="abort()" [disabled]="busy()">
                    {{ 'admin.abort' | t }}
                  </button>
                </div>
                @if (t.phase === 'running' || t.phase === 'paused') {
                  <div class="override">
                    <b>{{ 'admin.override' | t }}</b>
                    <p class="muted small">{{ 'admin.overrideHint' | t }}</p>
                    <div class="row">
                      <select
                        name="ovm"
                        [ngModel]="overrideMatch()"
                        (ngModelChange)="overrideMatch.set($event)"
                      >
                        <option value="">{{ 'admin.overridePick' | t }}</option>
                        @for (m of decidable(); track m.id) {
                          <option [value]="m.id">{{ m.label }}</option>
                        }
                      </select>
                      @if (decidableMatch(); as m) {
                        @for (e of m.entrants; track e) {
                          <button (click)="overrideWinner(m.id, e)" [disabled]="busy()">
                            {{ 'admin.overrideWins' | t: { name: name(e) } }}
                          </button>
                        }
                      }
                    </div>
                  </div>
                }
                <form class="row" (ngSubmit)="announce()">
                  <input
                    name="msg"
                    [(ngModel)]="message"
                    maxlength="200"
                    [placeholder]="'admin.announcePlaceholder' | t"
                  />
                  <button type="submit" [disabled]="busy() || !message.trim()">
                    {{ 'admin.announce' | t }}
                  </button>
                </form>
              }
              <p class="muted small">{{ 'admin.watchers' | t: { n: t.watchers } }}</p>
            </div>
          }
          @if (tab() === 'seeding') {
            <app-seeding-editor
              [tournament]="t"
              [busy]="busy()"
              (saveManual)="act(api.seed(t.id, { mode: 'manual', slots: $event }))"
            />
          }
          @if (tab() === 'events') {
            <div class="events">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{{ 'admin.time' | t }}</th>
                    <th>{{ 'admin.type' | t }}</th>
                    <th>{{ 'admin.actor' | t }}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (e of events(); track e.seq) {
                    <tr>
                      <td>{{ e.seq }}</td>
                      <td class="small">{{ i18n.date(e.at) }}</td>
                      <td>{{ e.type }}</td>
                      <td class="small muted">
                        {{ e.actor.kind }}
                        @if (e.actor.id) {
                          : {{ e.actor.id }}
                        }
                      </td>
                      <td class="small mono">{{ eventSummary(e) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @if (actionError()) {
            <p class="error">{{ actionError() }}</p>
          }
        </div>
      } @else if (actionError()) {
        <p class="error">{{ actionError() }}</p>
      }
    } @else if (!error()) {
      <p class="muted">{{ 'common.loading' | t }}</p>
    }
  `,
  styles: `
    .head {
      margin-bottom: 12px;
    }
    .head h1 .badge {
      vertical-align: middle;
      margin-left: 8px;
    }
    .champion {
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--accent);
    }
    .connect {
      display: flex;
      gap: 8px;
      align-items: center;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px 10px;
      margin: 8px 0;
      overflow-x: auto;
    }
    .connect code {
      flex: 1;
      white-space: nowrap;
    }
    .linux {
      margin: 8px 0;
    }
    .linux summary {
      cursor: pointer;
    }
    .linux input {
      width: 100%;
      margin-top: 4px;
    }
    .versus {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      text-align: center;
      margin: 8px 0;
    }
    .versus .name {
      font-weight: 700;
    }
    .versus .score {
      font-size: 2rem;
      font-weight: 800;
      font-variant-numeric: tabular-nums;
      color: var(--accent);
    }
    .vs {
      color: var(--muted);
      padding: 0 12px;
    }
    .live {
      border-color: var(--live);
    }
    .badge.running {
      background: var(--live);
      color: #000;
      margin-left: 6px;
      font-size: 0.7rem;
    }
    .scroll {
      overflow-x: auto;
    }
    table.races td.num,
    table.races th.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    table.races tr.first td {
      border-top: 1px solid var(--border);
    }
    table.races tr.win td {
      color: var(--accent);
    }
    .players {
      columns: 3 180px;
      padding-left: 18px;
    }
    tr.me td {
      background: var(--me-bg);
    }
    .events {
      max-height: 420px;
      overflow: auto;
    }
    .admin .row input {
      max-width: 420px;
    }
    .override {
      border-top: 1px solid var(--border);
      padding-top: 8px;
    }
    .override select {
      max-width: 420px;
    }
  `,
})
export class TournamentPage {
  readonly id = input.required<string>();
  /** Invite code of a team (link "?join=…"). */
  readonly join = input<string | undefined>(undefined);
  protected readonly api = inject(Api);
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  private readonly stream = inject(TournamentStream);
  private readonly router = inject(Router);

  protected readonly t = signal<TournamentDetail | null>(null);
  protected readonly error = signal('');
  protected readonly actionError = signal('');
  protected readonly busy = signal(false);
  protected readonly copied = signal<{ which: string; state: '' | 'ok' | 'manual' }>({
    which: '',
    state: '',
  });
  protected readonly tab = signal<'control' | 'seeding' | 'events'>('control');
  protected readonly events = signal<TournamentEventView[]>([]);
  protected message = '';
  private readonly now = signal(Date.now());

  protected readonly isAdmin = computed(() => !!this.auth.me()?.isAdmin);
  protected readonly isActive = computed(() => ACTIVE.includes(this.t()?.phase ?? ''));
  protected readonly current = computed(() => this.t()?.projection?.currentMatch ?? null);
  protected readonly liveNow = computed(() => {
    const l = this.stream.live() ?? this.t()?.live ?? null;
    return l && l.matchId === this.current()?.matchId ? l : null;
  });
  protected readonly secondsLeft = computed(() => {
    const d = this.liveNow()?.deadline;
    return d ? Math.max(0, Math.round((d - this.now()) / 1000)) : null;
  });
  protected readonly bestOfCurrent = computed(() => {
    const cm = this.current();
    return cm ? (this.t()?.projection?.bracket?.byId[cm.matchId]?.bestOf ?? 1) : 1;
  });
  protected readonly teamMode = computed(() => (this.t()?.settings.teamSize ?? 1) > 1);
  /** Monster Hunt time race. */
  protected readonly race = computed(() => isRace(this.t()?.settings));
  protected readonly penaltySec = computed(
    () => ((this.t()?.settings.game.rules as { penaltySec?: number }).penaltySec ?? 5) as number,
  );
  protected readonly raceTime = raceTime;
  protected readonly finalMs = finalMs;
  /** The team running right now (live telemetry, else the projection). */
  protected readonly runnerNow = computed(() => {
    const cm = this.current();
    if (!cm || !this.race()) return null;
    return this.liveNow()?.race?.runner ?? cm.runner ?? null;
  });
  /** Every finished run, grouped by game (newest game first), current game included. */
  protected readonly raceRows = computed(() => {
    const p = this.t()?.projection;
    if (!p) return [];
    type Row = {
      matchId: string;
      game: number;
      map: string;
      run: RunView;
      won: boolean;
      first: boolean;
    };
    const groups: Row[][] = [];
    for (const [matchId, games] of Object.entries(p.games)) {
      for (const g of games) {
        if (!g.runs?.length) continue;
        groups.push(
          g.runs.map((run, i) => ({
            matchId,
            game: g.game,
            map: g.map,
            run,
            won: run.entrantId === g.winnerId,
            first: i === 0,
          })),
        );
      }
    }
    const cm = p.currentMatch;
    if (cm?.runs?.length) {
      groups.push(
        cm.runs.map((run, i) => ({
          matchId: cm.matchId,
          game: cm.game,
          map: cm.map ?? run.map,
          run,
          won: false,
          first: i === 0,
        })),
      );
    }
    return groups.reverse().flat();
  });
  /** Entrants with people: players in 1v1, teams with members in team tournaments. */
  protected readonly humans = computed(() =>
    Object.values(this.t()?.projection?.entrants ?? {}).filter(
      (e) => e.kind === 'human' || (e.kind === 'team' && e.members.length > 0),
    ),
  );
  protected readonly champion = computed(() => {
    const p = this.t()?.projection;
    return p?.championId ? (p.entrants[p.championId]?.displayName ?? null) : null;
  });

  /** Admin: match picked in "set result". */
  protected readonly overrideMatch = signal('');
  /** Matches an organizer can decide: both entrants known, not void (current, coming, played). */
  protected readonly decidable = computed(() => {
    const b = this.t()?.projection?.bracket;
    if (!b) return [];
    const cm = this.current()?.matchId;
    return b.matches
      .filter(
        (m) => m.entrants[0] && m.entrants[1] && (m.status === 'ready' || m.status === 'completed'),
      )
      .map((m) => {
        const state =
          m.id === cm
            ? this.i18n.t('admin.matchNow')
            : m.status === 'completed'
              ? this.i18n.t('admin.matchWon', { name: this.name(m.winnerId) })
              : this.i18n.t('admin.matchOpen');
        return {
          id: m.id,
          entrants: [m.entrants[0], m.entrants[1]] as string[],
          label: `${m.id}: ${this.name(m.entrants[0])} vs ${this.name(m.entrants[1])} (${state})`,
        };
      });
  });
  protected readonly decidableMatch = computed(
    () => this.decidable().find((m) => m.id === this.overrideMatch()) ?? null,
  );

  private loading = false;
  private again = false;

  constructor() {
    effect(() => {
      const id = this.id();
      void this.load(id);
      this.stream.open(id, () => void this.load(id));
    });
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Coalesces bursts of change notifications into sequential reloads. */
  private async load(id: string) {
    if (this.loading) {
      this.again = true;
      return;
    }
    this.loading = true;
    try {
      do {
        this.again = false;
        this.t.set(await this.api.tournament(id));
        this.error.set('');
        if (this.tab() === 'events') this.events.set(await this.api.events(id));
      } while (this.again);
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.loading = false;
    }
  }

  protected name(id: string | null | undefined): string {
    if (!id) return this.i18n.t('bracket.tbd');
    return this.t()?.projection?.entrants[id]?.displayName ?? id;
  }

  protected isBot(id: string): boolean {
    const e = this.t()?.projection?.entrants[id];
    return e?.kind === 'bot' || (e?.kind === 'team' && e.members.length === 0);
  }

  protected reload() {
    void this.load(this.id());
  }

  private memberName(entrantId: string, userId: string): string {
    const e = this.t()?.projection?.entrants[entrantId];
    return (
      (e?.kind === 'team' && e.members.find((m) => m.userId === userId)?.displayName) || userId
    );
  }

  protected liveScore(id: string): string {
    const s = this.liveNow()?.scores?.[id];
    return s === undefined ? '–' : String(s);
  }

  /** Monster Hunt: final time of a finished run, the running time, or a dash. */
  protected raceScore(id: string): string {
    const cm = this.current();
    const done = cm?.runs?.find((r) => r.entrantId === id);
    if (done)
      return done.finished
        ? raceTime(finalMs(done), false)
        : this.i18n.t(done.forfeit ? 'race.forfeit' : 'race.dnf');
    const r = this.liveNow()?.race;
    if (r && r.runner === id) return raceTime(r.timeMs + r.penaltyMs, false);
    return '–';
  }

  protected raceDetail(id: string): string {
    const cm = this.current();
    const done = cm?.runs?.find((r) => r.entrantId === id);
    const r = this.liveNow()?.race;
    const run = done ?? (r && r.runner === id ? r : undefined);
    if (!run) return '';
    return this.i18n.t('race.detail', {
      raw: raceTime(run.timeMs),
      d: run.deaths,
      pen: raceTime(run.penaltyMs),
    });
  }

  protected rulesText(t: TournamentDetail): string {
    const r = t.settings.game.rules as {
      fragLimit?: number;
      timeLimitMin?: number;
      smartStockBots?: boolean;
      penaltySec?: number;
      monsterSkill?: number;
      lives?: number;
    };
    if (isRace(t.settings)) {
      const text = this.i18n.t('race.rules', {
        min: r.timeLimitMin ?? 20,
        s: r.penaltySec ?? 5,
        skill: r.monsterSkill ?? 5,
      });
      return r.lives ? `${text} / ${this.i18n.t('race.lives', { n: r.lives })}` : text;
    }
    const text = this.i18n.t('tp.rules', { frags: r.fragLimit ?? 20, min: r.timeLimitMin ?? 10 });
    return r.smartStockBots ? `${text} · SmartStockBots` : text;
  }

  protected connectCommand(t: TournamentDetail): string {
    return `open ${joinUrl(t.connectAddress ?? '', this.auth.me()?.joinToken ?? '')}`;
  }

  protected linuxCommand(t: TournamentDetail): string {
    return linuxStartCommand(this.utDir(), t.connectAddress ?? '', this.auth.me()?.joinToken ?? '');
  }

  protected localAddress(t: TournamentDetail): boolean {
    return isLocalAddress(t.connectAddress);
  }

  /** Tokens from before the short join codes are hard to type in the UT console. */
  protected readonly longToken = computed(() => (this.auth.me()?.joinToken.length ?? 0) > 12);

  /** The player's UT folder for the Linux start command, remembered in this browser only. */
  protected readonly utDir = signal(readUtDir());

  protected setUtDir(dir: string) {
    this.utDir.set(dir);
    try {
      localStorage.setItem(UT_DIR_KEY, dir);
    } catch {
      // storage blocked: the folder is only kept until the page is left
    }
  }

  protected copyLabel(which: string): string {
    const c = this.copied();
    if (c.which !== which || !c.state) return 'common.copy';
    return c.state === 'ok' ? 'common.copied' : 'common.copyManual';
  }

  protected async copy(which: string, text: string, el: Element) {
    const ok = await copyText(text);
    if (!ok) selectText(el);
    this.copied.set({ which, state: ok ? 'ok' : 'manual' });
    setTimeout(() => this.copied.set({ which: '', state: '' }), ok ? 1500 : 5000);
  }

  protected async act(p: Promise<unknown>) {
    this.busy.set(true);
    this.actionError.set('');
    try {
      await p;
      await this.load(this.id());
    } catch (e) {
      this.actionError.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected command(body: Record<string, unknown>) {
    return this.act(this.api.command(this.id(), body));
  }

  protected pause() {
    const reason = prompt(this.i18n.t('admin.pauseReason'), this.i18n.t('admin.pauseDefault'));
    if (reason) void this.command({ kind: 'pause', reason });
  }

  /** Monster Hunt: the running team gives up its run (bots stuck); the other team runs next. */
  protected forfeitRun() {
    const cm = this.current();
    const runner = this.runnerNow() ?? cm?.runOrder?.[cm.runs?.length ?? 0];
    if (!cm || !runner) return;
    if (
      confirm(
        this.i18n.t('admin.forfeitRunConfirm', { team: this.name(runner), match: cm.matchId }),
      )
    )
      void this.command({ kind: 'forfeitRun' });
  }

  protected restart() {
    const cm = this.current();
    if (!cm) return;
    const key = this.race() ? 'admin.restartRunConfirm' : 'admin.restartGameConfirm';
    if (confirm(this.i18n.t(key, { match: cm.matchId, map: cm.map ?? '' })))
      void this.command({ kind: 'restart' });
  }

  protected overrideWinner(matchId: string, winnerId: string) {
    const m = this.t()?.projection?.bracket?.byId[matchId];
    const key =
      m?.status === 'completed'
        ? 'admin.overrideConfirmPlayed'
        : matchId === this.current()?.matchId
          ? 'admin.overrideConfirmNow'
          : 'admin.overrideConfirm';
    if (!confirm(this.i18n.t(key, { match: matchId, name: this.name(winnerId) }))) return;
    this.overrideMatch.set('');
    void this.act(this.api.override(this.id(), matchId, winnerId));
  }

  protected abort() {
    const reason = prompt(this.i18n.t('admin.abortReason'));
    if (reason) void this.command({ kind: 'abort', reason });
  }

  protected announce() {
    const message = this.message.trim();
    if (!message) return;
    this.message = '';
    void this.command({ kind: 'announce', message });
  }

  protected async remove() {
    if (!confirm(this.i18n.t('admin.confirmDelete', { name: this.t()?.name ?? '' }))) return;
    try {
      await this.api.deleteTournament(this.id());
      await this.router.navigateByUrl('/');
    } catch (e) {
      this.actionError.set(errorText(e));
    }
  }

  protected async openEvents() {
    this.tab.set('events');
    try {
      this.events.set(await this.api.events(this.id()));
    } catch (e) {
      this.actionError.set(errorText(e));
    }
  }

  protected eventSummary(e: TournamentEventView): string {
    const d = e.data;
    switch (e.type) {
      case 'match.result': {
        const r = d['result'] as { matchId: string; winnerId: string; outcome: string };
        const how = r.outcome === 'override' ? this.i18n.t('admin.byOrganizer') : r.outcome;
        return `${r.matchId}: ${this.name(r.winnerId)} (${how})`;
      }
      case 'match.gameFinished':
        return `${d['matchId']} G${d['game']} ${d['map']}: ${this.name(d['winnerId'] as string)}`;
      case 'match.runFinished': {
        const run = d as unknown as RunView;
        const time = run.finished
          ? `${raceTime(run.timeMs)} + ${raceTime(run.penaltyMs)} = ${raceTime(finalMs(run))}`
          : `${this.i18n.t(run.forfeit ? 'race.forfeit' : 'race.dnf')} (${run.points})`;
        return `${d['matchId']} G${d['game']} ${this.name(run.entrantId)}: ${time}`;
      }
      case 'match.mapSelected':
        return `${d['matchId']} G${d['game']}: ${d['map']} (${d['method']})`;
      case 'match.playerStats': {
        const players = d['players'] as { name: string; kills: number; monsters: number }[];
        const run = d['run'] ? ` R${d['run']}` : '';
        const top = players
          .map((p) => `${p.name} ${p.monsters ? `${p.monsters}M` : p.kills}`)
          .join(', ');
        return `${d['matchId']} G${d['game']}${run}: ${top}`;
      }
      case 'match.called':
        return `${d['matchId']}: ${(d['entrants'] as string[]).map((x) => this.name(x)).join(' vs ')}`;
      case 'entrant.checkedIn':
        return d['userId']
          ? `${this.name(d['entrantId'] as string)}: ${this.memberName(d['entrantId'] as string, d['userId'] as string)}`
          : this.name(d['entrantId'] as string);
      case 'match.started': {
        const lineups = d['lineups'] as Record<string, { name: string }[]> | undefined;
        const who = lineups
          ? Object.entries(lineups)
              .map(([id, l]) => `${this.name(id)}: ${l.map((x) => x.name).join(', ')}`)
              .join(' | ')
          : '';
        const runner = d['runner'] ? ` ▶ ${this.name(d['runner'] as string)}` : '';
        return `${d['matchId']} G${d['game']}${runner}${who ? ` – ${who}` : ''}`;
      }
      case 'team.lineupSet':
        return `${this.name(d['entrantId'] as string)}: ${(d['starters'] as string[])
          .map((u) => this.memberName(d['entrantId'] as string, u))
          .join(', ')}`;
      case 'entrant.replaced':
        return `${this.name(d['entrantId'] as string)} → bot`;
      case 'tournament.paused':
      case 'tournament.aborted':
        return String(d['reason'] ?? '');
      default:
        return '';
    }
  }
}

const UT_DIR_KEY = 'tourney.utDir';

function readUtDir(): string {
  try {
    return localStorage.getItem(UT_DIR_KEY) ?? '';
  } catch {
    return '';
  }
}
