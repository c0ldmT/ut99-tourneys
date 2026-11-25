import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { TPipe } from '../core/i18n';
import type { PublicUser } from '../core/types';

@Component({
  selector: 'app-users',
  imports: [TPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'users.title' | t }}</h1>
    <div class="card">
      <table>
        <thead>
          <tr>
            <th>{{ 'users.name' | t }}</th>
            <th>Discord</th>
            <th>{{ 'users.admin' | t }}</th>
            <th>{{ 'users.moderator' | t }}</th>
            <th>{{ 'users.status' | t }}</th>
          </tr>
        </thead>
        <tbody>
          @for (u of users(); track u.id) {
            <tr>
              <td>
                <a
                  [routerLink]="u.id === auth.me()?.id ? ['/profile'] : ['/stats/p', 'u:' + u.id]"
                  >{{ u.displayName }}</a
                >
              </td>
              <td class="muted">{{ u.username }}</td>
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
