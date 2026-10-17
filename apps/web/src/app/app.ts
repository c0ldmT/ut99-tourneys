import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from './core/auth';
import { I18n, TPipe } from './core/i18n';
import type { Lang } from './core/i18n-dict';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header>
      <div class="bar">
        <a routerLink="/" class="brand">{{ auth.config().siteName }}</a>
        @if (auth.me(); as me) {
          <nav>
            <a
              routerLink="/"
              routerLinkActive="active"
              [routerLinkActiveOptions]="{ exact: true }"
              >{{ 'nav.tournaments' | t }}</a
            >
            <a routerLink="/stats" routerLinkActive="active">{{ 'nav.stats' | t }}</a>
            @if (me.isAdmin) {
              <a routerLink="/new" routerLinkActive="active">{{ 'nav.new' | t }}</a>
              <a routerLink="/admin/agents" routerLinkActive="active">{{ 'nav.agents' | t }}</a>
              <a routerLink="/admin/users" routerLinkActive="active">{{ 'nav.users' | t }}</a>
              <a routerLink="/admin/settings" routerLinkActive="active">{{ 'nav.settings' | t }}</a>
            }
          </nav>
        }
        <span class="grow"></span>
        <select class="lang" (change)="setLang($event)" aria-label="Language">
          @for (l of i18n.languages; track l) {
            <option [value]="l" [selected]="l === i18n.lang()">{{ l.toUpperCase() }}</option>
          }
        </select>
        @if (auth.me(); as me) {
          <a routerLink="/profile" class="user">
            @if (me.avatar) {
              <img [src]="me.avatar" alt="" />
            }
            {{ me.displayName }}
          </a>
          <button class="link" (click)="logout()">{{ 'nav.logout' | t }}</button>
        }
      </div>
    </header>
    <main class="container">
      <router-outlet />
    </main>
  `,
  styles: `
    header {
      background: var(--panel);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .bar {
      max-width: 1200px;
      margin: 0 auto;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      font-weight: 800;
      color: var(--text);
      letter-spacing: 0.02em;
    }
    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
    }
    nav a {
      color: var(--muted);
    }
    nav a.active {
      color: var(--text);
    }
    .grow {
      flex: 1;
    }
    .lang {
      width: auto;
      padding: 4px 6px;
    }
    .user {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--text);
    }
    .user img {
      width: 24px;
      height: 24px;
      border-radius: 50%;
    }
  `,
})
export class App {
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  private readonly router = inject(Router);

  constructor() {
    void this.auth.ready();
    effect(() => {
      document.title = this.auth.config().siteName;
    });
  }

  protected setLang(ev: Event) {
    this.i18n.set((ev.target as HTMLSelectElement).value as Lang);
  }

  protected async logout() {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
