import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { Icon } from '../core/brand';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { copyText } from '../core/clipboard';
import { I18n, TPipe } from '../core/i18n';
import type { InvitePreview, TeamView, TournamentDetail } from '../core/types';

const MAX_SUBS = 2;

/** "https://…/t/cup?join=abc" or "abc" -> "abc". */
export function inviteCodeFrom(text: string): string {
  const trimmed = text.trim();
  const m = /[?&]join=([A-Za-z0-9]+)/.exec(trimmed);
  return m ? (m[1] as string) : trimmed;
}

/**
 * Team registration before the bracket is seeded: create or join a team (invite link), register
 * without a team, captain tools (lineup, captaincy, members) and the admin's team building.
 */
@Component({
  selector: 'app-team-panel',
  imports: [FormsModule, TPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let t = tournament();
    <h2>{{ 'team.title' | t }}</h2>
    <p class="muted small">
      {{
        'team.summary'
          | t
            : {
                teams: t.teams.length,
                size: t.settings.size,
                k: t.settings.teamSize,
                subs: maxSubs,
              }
      }}
    </p>

    @if (invite(); as inv) {
      <div class="invite">
        <div>
          <b>{{ 'team.inviteTitle' | t: { name: teamLabel(inv.name, inv.tag) } }}</b>
          <div class="muted small">{{ memberNames(inv) }}</div>
        </div>
        @if (t.me.teamId === inv.teamId) {
          <span class="muted small">{{ 'team.alreadyIn' | t }}</span>
        } @else if (t.me.teamId) {
          <span class="muted small">{{ 'team.leaveFirst' | t }}</span>
        } @else if (t.registrationOpen) {
          <button class="primary" [disabled]="busy()" (click)="join(joinCode()!)">
            {{ 'team.joinThis' | t }}
          </button>
        }
      </div>
    }

    <!-- My status -->
    <div class="stack mine">
      @if (myTeam(); as team) {
        <p>{{ 'team.youAreIn' | t: { name: team.name } }}</p>
        @if (team.inviteCode) {
          <label>{{ 'team.inviteLink' | t }}</label>
          <div class="row">
            <input
              #invite
              class="grow"
              readonly
              [value]="inviteLink(team)"
              (focus)="$any($event.target).select()"
            />
            <button
              class="icon"
              (click)="copy(inviteLink(team), invite)"
              [title]="copyLabel() | t"
              [attr.aria-label]="copyLabel() | t"
            >
              <na-icon [name]="copyLabel() === 'common.copied' ? 'check' : 'copy'" />
            </button>
          </div>
        }
        <div class="row">
          <button [disabled]="busy()" (click)="leave(team)">{{ 'team.leave' | t }}</button>
          <button [disabled]="busy()" (click)="act(api.unregister(t.id))">
            {{ 'tp.withdraw' | t }}
          </button>
        </div>
      } @else if (t.registrationOpen || t.me.registered) {
        @if (t.me.registered) {
          <p>{{ 'team.youAreSolo' | t }}</p>
        }
        @if (t.registrationOpen) {
          <form class="row" (ngSubmit)="create()">
            <input
              name="teamName"
              class="grow"
              [(ngModel)]="newName"
              maxlength="20"
              [placeholder]="'team.namePlaceholder' | t"
            />
            <input
              name="teamTag"
              class="tag"
              [(ngModel)]="newTag"
              maxlength="6"
              [placeholder]="'team.tagPlaceholder' | t"
            />
            <button class="primary" type="submit" [disabled]="busy() || !newName.trim()">
              {{ 'team.create' | t }}
            </button>
          </form>
          <form class="row" (ngSubmit)="join(inviteCodeFrom(code))">
            <input
              name="code"
              class="grow"
              [(ngModel)]="code"
              [placeholder]="'team.codePlaceholder' | t"
            />
            <button type="submit" [disabled]="busy() || !code.trim()">{{ 'team.join' | t }}</button>
          </form>
        }
        <div class="row">
          @if (!t.me.registered && t.registrationOpen) {
            <button [disabled]="busy()" (click)="act(api.register(t.id))">
              {{ 'team.registerSolo' | t }}
            </button>
            <span class="muted small">{{ 'team.soloHint' | t }}</span>
          } @else if (t.me.registered) {
            <button [disabled]="busy()" (click)="act(api.unregister(t.id))">
              {{ 'tp.withdraw' | t }}
            </button>
          }
        </div>
      } @else {
        <p class="muted">{{ 'tp.registrationClosed' | t }}</p>
      }
    </div>

    <!-- All teams -->
    <div class="teams">
      @for (team of t.teams; track team.id) {
        @let manage = canManage(team);
        <div class="team" [class.mine]="team.id === t.me.teamId">
          <div class="spread">
            <b>{{ teamLabel(team.name, team.tag) }}</b>
            <span class="muted small">{{ count(team) }}</span>
          </div>
          <ul>
            @for (m of team.members; track m.userId) {
              <li>
                <span class="who">
                  @if (m.userId === team.captainId) {
                    <span [title]="'team.captain' | t">★</span>
                  }
                  {{ m.displayName }}
                  @if (m.sub) {
                    <span class="badge">{{ 'team.sub' | t }}</span>
                  }
                </span>
                @if (manage) {
                  <span class="tools">
                    <button
                      class="link small"
                      [disabled]="busy()"
                      (click)="toggleSub(team, m.userId)"
                    >
                      {{ (m.sub ? 'team.makeStarter' : 'team.makeSub') | t }}
                    </button>
                    @if (m.userId !== team.captainId) {
                      <button
                        class="link small"
                        [disabled]="busy()"
                        [title]="'team.makeCaptain' | t"
                        (click)="act(api.updateTeam(t.id, team.id, { captainId: m.userId }))"
                      >
                        ★
                      </button>
                      <button
                        class="link small"
                        [disabled]="busy()"
                        [title]="'team.remove' | t"
                        (click)="act(api.removeMember(t.id, team.id, m.userId))"
                      >
                        ✕
                      </button>
                    }
                  </span>
                }
              </li>
            }
          </ul>
          @if (manage) {
            <div class="row small">
              <button class="link" [disabled]="busy()" (click)="rename(team)">
                {{ 'team.rename' | t }}
              </button>
              <button class="link" [disabled]="busy()" (click)="act(api.newInvite(t.id, team.id))">
                {{ 'team.newLink' | t }}
              </button>
              <button class="link" [disabled]="busy()" (click)="remove(team)">
                {{ 'team.delete' | t }}
              </button>
            </div>
          }
        </div>
      }
    </div>

    @if (solos().length) {
      <h3>{{ 'team.solos' | t: { n: solos().length } }}</h3>
      <ul class="solos">
        @for (r of solos(); track r.userId) {
          <li>
            {{ r.displayName }}
            @if (isAdmin()) {
              <select
                class="move"
                [ngModel]="null"
                (ngModelChange)="move(r.userId, $event)"
                [disabled]="busy()"
              >
                <option [ngValue]="null">{{ 'team.moveTo' | t }}</option>
                @for (team of t.teams; track team.id) {
                  <option [ngValue]="team.id">{{ team.name }}</option>
                }
              </select>
              <button
                class="icon"
                (click)="act(api.kick(t.id, r.userId))"
                [title]="'tp.kick' | t"
                [attr.aria-label]="('tp.kick' | t) + ' ' + r.displayName"
              >
                <na-icon name="close" [size]="15" />
              </button>
            }
          </li>
        }
      </ul>
      @if (isAdmin()) {
        <div class="row">
          <button [disabled]="busy()" (click)="act(api.buildTeams(t.id))">
            {{ 'team.build' | t }}
          </button>
          <span class="muted small">{{ 'team.buildHint' | t }}</span>
        </div>
      }
    }
  `,
  styles: `
    .invite {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      border: 1px solid var(--accent);
      border-radius: 8px;
      padding: 10px 12px;
      margin: 8px 0 14px;
    }
    .mine {
      margin-bottom: 14px;
    }
    .grow {
      flex: 1;
      min-width: 160px;
      width: auto;
    }
    .tag {
      width: 90px;
    }
    .teams {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
      gap: 10px;
    }
    .team {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
    }
    .team.mine {
      border-color: var(--accent);
      background: var(--me-bg);
    }
    .team ul {
      list-style: none;
      padding: 0;
      margin: 8px 0;
    }
    .team li {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      padding: 2px 0;
    }
    .tools {
      display: inline-flex;
      gap: 8px;
    }
    .badge {
      margin-left: 4px;
    }
    h3 {
      margin: 16px 0 6px;
      font-size: 1rem;
    }
    .invite button {
      white-space: nowrap;
    }
    .solos {
      columns: 2 220px;
      padding-left: 18px;
    }
    .move {
      width: auto;
      padding: 2px 6px;
      margin-left: 6px;
      font-size: 0.8rem;
    }
  `,
})
export class TeamPanel {
  readonly tournament = input.required<TournamentDetail>();
  readonly isAdmin = input(false);
  readonly myUserId = input<string | null>(null);
  /** Invite code from the link (?join=…). */
  readonly joinCode = input<string | null>(null);
  readonly changed = output<void>();

  protected readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  protected readonly maxSubs = MAX_SUBS;
  protected readonly inviteCodeFrom = inviteCodeFrom;

  protected readonly busy = signal(false);
  protected readonly copied = signal<'' | 'ok' | 'manual'>('');
  protected readonly invite = signal<InvitePreview | null>(null);
  protected newName = '';
  protected newTag = '';
  protected code = '';

  protected readonly myTeam = computed(() => {
    const t = this.tournament();
    return t.teams.find((x) => x.id === t.me.teamId) ?? null;
  });
  protected readonly solos = computed(() =>
    this.tournament().registrations.filter((r) => r.teamId === null),
  );

  constructor() {
    effect(() => {
      const code = this.joinCode();
      // Only the code starts a preview, not every update of the tournament.
      const id = untracked(() => this.tournament().id);
      if (!code) {
        this.invite.set(null);
        return;
      }
      this.api.invitePreview(id, code).then(
        (p) => this.invite.set(p),
        () => this.invite.set(null), // the Api shows the error as a toast
      );
    });
  }

  protected canManage(team: TeamView): boolean {
    return this.isAdmin() || team.captainId === this.myUserId();
  }

  protected teamLabel(name: string, tag: string | null): string {
    return tag ? `${tag} ${name}` : name;
  }

  protected memberNames(inv: InvitePreview): string {
    return inv.members.map((m) => m.displayName).join(', ');
  }

  protected count(team: TeamView): string {
    const k = this.tournament().settings.teamSize;
    const starters = team.members.filter((m) => !m.sub).length;
    const subs = team.members.length - starters;
    return this.i18n.t('team.count', { n: starters, k, subs });
  }

  protected inviteLink(team: TeamView): string {
    return `${location.origin}/t/${this.tournament().id}?join=${team.inviteCode}`;
  }

  protected readonly copyLabel = computed(() =>
    this.copied() === 'ok'
      ? 'common.copied'
      : this.copied() === 'manual'
        ? 'common.copyManual'
        : 'common.copy',
  );

  protected async copy(text: string, input: HTMLInputElement) {
    const ok = await copyText(text);
    if (!ok) input.select();
    this.copied.set(ok ? 'ok' : 'manual');
    setTimeout(() => this.copied.set(''), ok ? 1500 : 5000);
  }

  /** Runs an action; true when it worked (the Api toasts errors and successes). */
  protected async act(p: Promise<unknown>): Promise<boolean> {
    this.busy.set(true);
    try {
      await p;
      this.changed.emit();
      return true;
    } catch {
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected async create() {
    const name = this.newName.trim();
    if (!name) return;
    if (await this.act(this.api.createTeam(this.tournament().id, name, this.newTag.trim() || null)))
      this.newName = this.newTag = '';
  }

  protected async join(code: string) {
    if (!code) return;
    if (await this.act(this.api.joinTeam(this.tournament().id, code))) this.code = '';
  }

  protected leave(team: TeamView) {
    const me = this.myUserId();
    if (me) void this.act(this.api.removeMember(this.tournament().id, team.id, me));
  }

  protected toggleSub(team: TeamView, userId: string) {
    const starters = team.members.filter((m) => !m.sub).map((m) => m.userId);
    const next = starters.includes(userId)
      ? starters.filter((u) => u !== userId)
      : [...starters, userId];
    void this.act(this.api.setLineup(this.tournament().id, team.id, next));
  }

  protected rename(team: TeamView) {
    const name = prompt(this.i18n.t('team.renamePrompt'), team.name);
    if (!name?.trim()) return;
    const tag = prompt(this.i18n.t('team.tagPrompt'), team.tag ?? '');
    void this.act(
      this.api.updateTeam(this.tournament().id, team.id, {
        name: name.trim(),
        ...(tag === null ? {} : { tag: tag.trim() || null }),
      }),
    );
  }

  protected remove(team: TeamView) {
    if (!confirm(this.i18n.t('team.confirmDelete', { name: team.name }))) return;
    void this.act(this.api.deleteTeam(this.tournament().id, team.id));
  }

  protected move(userId: string, teamId: string | null) {
    if (!teamId) return;
    const team = this.tournament().teams.find((t) => t.id === teamId);
    const starters = team?.members.filter((m) => !m.sub).length ?? 0;
    const sub = starters >= this.tournament().settings.teamSize;
    void this.act(this.api.moveMember(this.tournament().id, userId, teamId, sub));
  }
}
