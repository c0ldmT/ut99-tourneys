import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { TPipe } from '../core/i18n';

@Component({
  selector: 'app-login',
  imports: [FormsModule, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card login">
      <h1>{{ auth.config().siteName }}</h1>
      <p class="muted">{{ 'login.intro' | t }}</p>
      @if (error()) {
        <p class="error">{{ 'login.error.' + error() | t }}</p>
      }
      @if (auth.config().discordLogin) {
        <a class="btn primary discord" [href]="discordUrl()">{{ 'login.discord' | t }}</a>
      } @else if (!auth.config().devLogin) {
        <p class="notice">{{ 'login.notConfigured' | t }}</p>
      }
      @if (auth.config().devLogin) {
        <form class="dev" (ngSubmit)="devLogin()">
          <h3>{{ 'login.dev' | t }}</h3>
          <p class="muted small">{{ 'login.devHint' | t }}</p>
          <div class="field">
            <label for="n">{{ 'login.name' | t }}</label>
            <input id="n" name="name" [(ngModel)]="name" required minlength="2" maxlength="32" />
          </div>
          <label class="row"
            ><input type="checkbox" name="admin" [(ngModel)]="admin" />
            {{ 'login.asAdmin' | t }}</label
          >
          <button class="primary" type="submit" [disabled]="busy() || name.trim().length < 2">
            {{ 'login.enter' | t }}
          </button>
        </form>
      }
    </div>
  `,
  styles: `
    .login {
      max-width: 440px;
      margin: 48px auto;
    }
    .discord {
      width: 100%;
      justify-content: center;
      padding: 10px;
      margin: 8px 0 4px;
    }
    .dev {
      margin-top: 24px;
      border-top: 1px solid var(--border);
      padding-top: 16px;
    }
    .dev button {
      margin-top: 12px;
    }
  `,
})
export class LoginPage {
  protected readonly auth = inject(Auth);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  /** Query parameters (component input binding). */
  readonly next = input<string>('/');
  readonly errorParam = input<string | undefined>(undefined, { alias: 'error' });

  protected name = '';
  protected admin = false;
  protected readonly busy = signal(false);

  protected error = () => {
    const e = this.errorParam();
    return e ? (['state', 'guild', 'discord', 'access_denied'].includes(e) ? e : 'discord') : '';
  };

  protected discordUrl = () => `/api/auth/discord?next=${encodeURIComponent(this.safeNext())}`;

  private safeNext(): string {
    const n = this.next() || '/';
    return n.startsWith('/') && !n.startsWith('//') ? n : '/';
  }

  constructor() {
    void this.auth.ready().then(() => {
      if (this.auth.me()) void this.router.navigateByUrl(this.safeNext());
    });
  }

  protected async devLogin() {
    this.busy.set(true);
    try {
      this.auth.me.set(await this.api.devLogin(this.name.trim(), this.admin));
      await this.router.navigateByUrl(this.safeNext());
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
