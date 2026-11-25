import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import type { PublicUser } from '../core/types';

@Component({
  selector: 'app-users',
  imports: [TPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'users.title' | t }}</h1>
    <p class="muted small">
      {{ 'users.inactiveHint' | t: { n: inactive().length, days: INACTIVE_DAYS } }}
    </p>
    <div class="card scroll">
      <table>
        <thead>
          <tr>
            <th>
              <button type="button" class="link sort" (click)="sort.set('name')">
                {{ 'users.name' | t }}{{ sort() === 'name' ? ' ▾' : '' }}
              </button>
            </th>
            <th>Discord</th>
            <th>
              <button type="button" class="link sort" (click)="sort.set('seen')">
                {{ 'users.lastSeen' | t }}{{ sort() === 'seen' ? ' ▴' : '' }}
              </button>
            </th>
            <th>{{ 'users.lastLogin' | t }}</th>
            <th>{{ 'users.admin' | t }}</th>
            <th>{{ 'users.moderator' | t }}</th>
            <th>{{ 'users.status' | t }}</th>
          </tr>
        </thead>
        <tbody>
          @for (u of sorted(); track u.id) {
            <tr [class.idle]="isInactive(u)">
              <td>
                <a
                  [routerLink]="u.id === auth.me()?.id ? ['/profile'] : ['/stats/p', 'u:' + u.id]"
                  >{{ u.displayName }}</a
                >
              </td>
              <td class="muted">{{ u.username }}</td>
              @if (u.ai) {
                <!-- Dream Team AI managers never log in (decision 292). -->
                <td colspan="2">
                  <span class="chip" [title]="'users.aiHint' | t">{{ 'users.ai' | t }}</span>
                </td>
              } @else {
                <td class="nowrap" [title]="u.lastSeenAt ? i18n.date(u.lastSeenAt) : ''">
                  {{ ago(u.lastSeenAt) }}
                  @if (isInactive(u)) {
                    <span class="chip">{{ 'users.inactive' | t }}</span>
                  }
                </td>
                <td class="muted small nowrap">
                  {{ u.lastLoginAt ? i18n.date(u.lastLoginAt, { dateOnly: true }) : '–' }}
                </td>
              }
              <td>
                <input
                  type="checkbox"
                  [checked]="u.isAdmin"
                  [disabled]="u.id === auth.me()?.id"
                  (change)="toggle(u, $event)"
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  [checked]="u.isModerator || u.isAdmin"
                  [disabled]="u.isAdmin"
                  [attr.aria-label]="'users.moderator' | t"
                  (change)="toggleMod(u, $event)"
                />
              </td>
              <td class="small">
                @if (u.warnings) {
                  {{ 'mod.warnings' | t: { n: u.warnings } }}
                }
                @if (active(u.textBanUntil)) {
                  <span class="bad">{{ 'mod.textBanned' | t: { d: day(u.textBanUntil!) } }}</span>
                }
                @if (active(u.bannedUntil)) {
                  <span class="bad">{{ 'mod.banned' | t: { d: day(u.bannedUntil!) } }}</span>
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .scroll {
      overflow-x: auto;
    }
    .sort {
      font: inherit;
      color: inherit;
      padding: 0;
      min-height: 0;
    }
    .nowrap {
      white-space: nowrap;
    }
    tr.idle td:first-child a {
      opacity: 0.65;
    }
    td[colspan] .chip {
      margin-left: 0;
    }
    .chip {
      margin-left: 6px;
      padding: 0 7px;
      border-radius: 999px;
      border: 1px solid var(--border);
      font-size: 0.72rem;
      color: var(--text-2);
    }
    .bad {
      color: #ff8a8a;
      margin-left: 6px;
    }
  `,
})
export class UsersPage {
  protected readonly auth = inject(Auth);
  private readonly api = inject(Api);
  protected readonly users = signal<PublicUser[]>([]);
  protected readonly i18n = inject(I18n);
  /** Inactive: no request for this many days (decision 290). */
  protected readonly INACTIVE_DAYS = 30;
  protected readonly sort = signal<'name' | 'seen'>('seen');
  /** Longest inactive first (AI managers last), or by name. */
  protected readonly sorted = computed(() => {
    const list = [...this.users()];
    if (this.sort() === 'name') return list;
    const at = (u: PublicUser) => (u.lastSeenAt ? Date.parse(u.lastSeenAt) : 0);
    return list.sort((a, b) => Number(!!a.ai) - Number(!!b.ai) || at(a) - at(b));
  });
  protected readonly inactive = computed(() => this.users().filter((u) => this.isInactive(u)));

  protected isInactive(u: PublicUser): boolean {
    if (u.ai) return false;
    return !u.lastSeenAt || Date.now() - Date.parse(u.lastSeenAt) > this.INACTIVE_DAYS * 86_400_000;
  }

  /** "today", "yesterday", "12 days ago". */
  protected ago(iso: string | null | undefined): string {
    if (!iso) return '–';
    const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
    if (days <= 0) return this.i18n.t('users.today');
    if (days === 1) return this.i18n.t('users.yesterday');
    return this.i18n.t('users.daysAgo', { n: days });
  }

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      this.users.set(await this.api.users());
    } catch {
      // the Api shows the error as a toast
    }
  }

  protected async toggleMod(u: PublicUser, ev: Event) {
    const on = (ev.target as HTMLInputElement).checked;
    try {
      await this.api.setModerator(u.id, on);
      await this.load();
    } catch {
      // the Api shows the error as a toast
    }
  }

  protected active(until: string | null | undefined): boolean {
    return !!until && Date.parse(until) > Date.now();
  }

  protected day(iso: string): string {
    return iso.startsWith('9999') ? '∞' : iso.slice(0, 10);
  }

  protected async toggle(u: PublicUser, ev: Event) {
    const on = (ev.target as HTMLInputElement).checked;
    try {
      await this.api.setAdmin(u.id, on);
      await this.load();
    } catch {
      // the Api shows the error as a toast
    }
  }
}
