import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Api, errorText } from '../core/api';
import { Auth } from '../core/auth';
import { TPipe } from '../core/i18n';
import type { PublicUser } from '../core/types';

@Component({
  selector: 'app-users',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'users.title' | t }}</h1>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    <div class="card">
      <table>
        <thead>
          <tr>
            <th>{{ 'users.name' | t }}</th>
            <th>Discord</th>
            <th>{{ 'users.admin' | t }}</th>
          </tr>
        </thead>
        <tbody>
          @for (u of users(); track u.id) {
            <tr>
              <td>{{ u.displayName }}</td>
              <td class="muted">{{ u.username }}</td>
              <td>
                <input
                  type="checkbox"
                  [checked]="u.isAdmin"
                  [disabled]="u.id === auth.me()?.id"
                  (change)="toggle(u, $event)"
                />
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class UsersPage {
  protected readonly auth = inject(Auth);
  private readonly api = inject(Api);
  protected readonly users = signal<PublicUser[]>([]);
  protected readonly error = signal('');

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      this.users.set(await this.api.users());
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  protected async toggle(u: PublicUser, ev: Event) {
    const on = (ev.target as HTMLInputElement).checked;
    try {
      await this.api.setAdmin(u.id, on);
      await this.load();
    } catch (e) {
      this.error.set(errorText(e));
    }
  }
}
