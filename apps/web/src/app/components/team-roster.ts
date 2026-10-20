import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Api } from '../core/api';
import { RouterLink } from '@angular/router';
import { TPipe } from '../core/i18n';
import type { Entrant, TournamentDetail } from '../core/types';

type Team = Extract<Entrant, { kind: 'team' }>;

/**
 * Team line-ups once the bracket is seeded. Captains (and admins) pick the starters; the change
 * applies from the next game. During check-in a tick marks members who are on the server.
 */
@Component({
  selector: 'app-team-roster',
  imports: [TPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>{{ 'roster.title' | t }}</h2>
    <div class="teams">
      @for (team of teams(); track team.id) {
        @let edit = editing() === team.id;
        <div class="team" [class.mine]="team.id === tournament().me.entrantId">
          <div class="spread">
            <b>{{ team.tag ? team.tag + ' ' : '' }}{{ team.displayName }}</b>
            @if (canEdit(team) && !edit && open()) {
              <button class="link small" (click)="startEdit(team)">
                {{ 'roster.edit' | t }}
              </button>
            }
          </div>
          <ul>
            @for (m of team.members; track m.userId) {
              <li>
                @if (edit) {
                  <label class="pick">
                    <input
                      type="checkbox"
                      [checked]="picked().includes(m.userId)"
                      (change)="toggle(m.userId)"
                    />
                    {{ m.displayName }}
                  </label>
                } @else {
                  <span>
                    @if (m.userId === team.captainUserId) {
                      <span [title]="'team.captain' | t">★</span>
                    }
                    {{ m.displayName }}
                    @if (m.sub) {
                      <span class="badge">{{ 'team.sub' | t }}</span>
                    }
                  </span>
                }
                @if (checkIn() && checkedIn().has(m.userId)) {
                  <span class="ok" [title]="'roster.onServer' | t">✓</span>
                }
              </li>
            }
            @for (b of team.bots; track b.name) {
              <li class="muted">
                <span class="nmb">
                  @if (b.id) {
                    <a [routerLink]="['/bots', b.id]">{{ b.name }}</a>
                  } @else {
                    <span>{{ b.name }}</span>
                  }
                  <span class="badge bot">BOT</span>
                </span>
              </li>
            }
          </ul>
          @if (edit) {
            <p class="muted small">
              {{ 'roster.pick' | t: { n: picked().length, k: tournament().settings.teamSize } }}
            </p>
            <div class="row">
              <button
                class="primary"
                [disabled]="busy() || picked().length > tournament().settings.teamSize"
                (click)="save(team)"
              >
                {{ 'common.save' | t }}
              </button>
              <button (click)="editing.set(null)">{{ 'common.cancel' | t }}</button>
            </div>
          }
        </div>
      }
    </div>
    <p class="muted small">{{ 'roster.hint' | t }}</p>
  `,
  styles: `
    .teams {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
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
    ul {
      list-style: none;
      padding: 0;
      margin: 8px 0 0;
    }
    li {
      display: flex;
      justify-content: space-between;
      padding: 2px 0;
    }
    .pick {
      display: flex;
      gap: 6px;
      align-items: center;
      color: var(--text);
      font-size: 1rem;
      margin: 0;
    }
    .nmb {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .ok {
      color: var(--accent);
    }
  `,
})
export class TeamRoster {
  readonly tournament = input.required<TournamentDetail>();
  readonly isAdmin = input(false);
  readonly myUserId = input<string | null>(null);
  readonly changed = output<void>();

  private readonly api = inject(Api);
  protected readonly editing = signal<string | null>(null);
  protected readonly picked = signal<string[]>([]);
  protected readonly busy = signal(false);

  protected readonly teams = computed(() => {
    const p = this.tournament().projection;
    if (!p) return [];
    const order = p.bracketDefinition?.slots ?? Object.keys(p.entrants);
    return order.map((id) => p.entrants[id]).filter((e): e is Team => e?.kind === 'team');
  });
  protected readonly checkIn = computed(() => this.tournament().phase === 'checkIn');
  protected readonly checkedIn = computed(
    () => new Set(this.tournament().projection?.checkedInUsers ?? []),
  );
  protected readonly open = computed(
    () => !['finished', 'aborted'].includes(this.tournament().phase),
  );

  protected canEdit(team: Team): boolean {
    return team.members.length > 0 && (this.isAdmin() || team.captainUserId === this.myUserId());
  }

  protected startEdit(team: Team) {
    this.picked.set(team.members.filter((m) => !m.sub).map((m) => m.userId));
    this.editing.set(team.id);
  }

  protected toggle(userId: string) {
    const p = this.picked();
    this.picked.set(p.includes(userId) ? p.filter((u) => u !== userId) : [...p, userId]);
  }

  protected async save(team: Team) {
    this.busy.set(true);
    try {
      await this.api.setLineup(this.tournament().id, team.id, this.picked());
      this.editing.set(null);
      this.changed.emit();
    } catch {
      // the Api shows the error as a toast
    } finally {
      this.busy.set(false);
    }
  }
}
