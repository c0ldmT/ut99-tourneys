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
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { TournamentStream } from '../core/stream';
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
                  <p class="muted small">{{ 'tp.connectHint' | t }}</p>
                  <div class="connect">
                    <code>{{ connectCommand(t) }}</code>
                    <button (click)="copy(connectCommand(t))">
                      {{ copied() ? ('common.copied' | t) : ('common.copy' | t) }}
                    </button>
                  </div>
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
            <p class="small">
              @if (liveNow(); as l) {
                <b>{{ 'live.' + l.phase | t }}</b>
                @if (l.map || cm.map) {
                  · {{ l.map || cm.map }}
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
          />
        </div>
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
                  <button class="danger" (click)="abort()" [disabled]="busy()">
                    {{ 'admin.abort' | t }}
                  </button>
                </div>
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
  protected readonly copied = signal(false);
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

  protected rulesText(t: TournamentDetail): string {
    const r = t.settings.game.rules as {
      fragLimit?: number;
      timeLimitMin?: number;
      smartStockBots?: boolean;
    };
    const text = this.i18n.t('tp.rules', { frags: r.fragLimit ?? 20, min: r.timeLimitMin ?? 10 });
    return r.smartStockBots ? `${text} · SmartStockBots` : text;
  }

  protected connectCommand(t: TournamentDetail): string {
    return `open ${t.connectAddress}?tk=${this.auth.me()?.joinToken ?? ''}`;
  }

  protected copy(text: string) {
    void navigator.clipboard?.writeText(text).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    });
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
        return `${r.matchId}: ${this.name(r.winnerId)} (${r.outcome})`;
      }
      case 'match.gameFinished':
        return `${d['matchId']} G${d['game']} ${d['map']}: ${this.name(d['winnerId'] as string)}`;
      case 'match.mapSelected':
        return `${d['matchId']} G${d['game']}: ${d['map']} (${d['method']})`;
      case 'match.called':
        return `${d['matchId']}: ${(d['entrants'] as string[]).map((x) => this.name(x)).join(' vs ')}`;
      case 'entrant.checkedIn':
        return d['userId']
          ? `${this.name(d['entrantId'] as string)}: ${this.memberName(d['entrantId'] as string, d['userId'] as string)}`
          : this.name(d['entrantId'] as string);
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
