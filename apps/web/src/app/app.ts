import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Avatar, NameTag } from './core/looks';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Api } from './core/api';
import { NeuroPipe } from './core/neuro';
import { Coin, Icon, Logo, Wordmark } from './core/brand';
import { version } from '../../../../package.json';
import { Auth } from './core/auth';
import { I18n, TPipe } from './core/i18n';
import type { Lang } from './core/i18n-dict';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TPipe,
    NeuroPipe,
    Logo,
    Wordmark,
    Coin,
    Avatar,
    NameTag,
    Icon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header>
      <div class="bar">
        <a routerLink="/" class="brand" (click)="menu.set(false)">
          <na-logo [size]="30" />
          <na-wordmark [name]="auth.config().siteName" />
        </a>
        @if (auth.me(); as me) {
          <nav [class.open]="menu()" (click)="menu.set(false)">
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
              <a routerLink="/admin/bots" routerLinkActive="active">{{ 'nav.bots' | t }}</a>
              <a routerLink="/admin/users" routerLinkActive="active">{{ 'nav.users' | t }}</a>
              <a routerLink="/admin/settings" routerLinkActive="active">{{ 'nav.settings' | t }}</a>
            }
            <div class="nav-foot">
              <select class="lang" (change)="setLang($event)" aria-label="Language">
                @for (l of i18n.languages; track l) {
                  <option [value]="l" [selected]="l === i18n.lang()">{{ l.toUpperCase() }}</option>
                }
              </select>
              <button class="link" (click)="logout()">{{ 'nav.logout' | t }}</button>
            </div>
          </nav>
        }
        <span class="grow"></span>
        @if (auth.me(); as me) {
          @if (neuro() !== null) {
            <a
              routerLink="/stats/p/u:{{ me.id }}"
              class="neuro wallet"
              [title]="'bets.balance' | t"
              (click)="menu.set(false)"
              ><na-coin [size]="18" />{{ neuro()! | neuro: false }}</a
            >
          }
          <a
            routerLink="/shop"
            routerLinkActive="on"
            class="btn icon shopbtn"
            [title]="'shop.title' | t"
            [attr.aria-label]="'shop.title' | t"
            (click)="menu.set(false)"
            ><na-icon name="shop" [size]="19"
          /></a>
          <a routerLink="/profile" class="user" (click)="menu.set(false)">
            <na-avatar [name]="me.displayName" [id]="me.id" [src]="me.avatar" [size]="28" />
            <span class="uname"><na-name [name]="me.displayName" [id]="me.id" /></span>
          </a>
          <div class="desk">
            <select class="lang" (change)="setLang($event)" aria-label="Language">
              @for (l of i18n.languages; track l) {
                <option [value]="l" [selected]="l === i18n.lang()">{{ l.toUpperCase() }}</option>
              }
            </select>
            <button
              class="icon"
              (click)="logout()"
              [title]="'nav.logout' | t"
              [attr.aria-label]="'nav.logout' | t"
            >
              <na-icon name="logout" />
            </button>
          </div>
          <button
            class="burger"
            type="button"
            [attr.aria-expanded]="menu()"
            [attr.aria-label]="'nav.menu' | t"
            (click)="menu.set(!menu())"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              @if (menu()) {
                <path
                  d="M6 6l12 12M18 6 6 18"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              } @else {
                <path
                  d="M4 7h16M4 12h16M4 17h16"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              }
            </svg>
          </button>
        } @else {
          <select class="lang" (change)="setLang($event)" aria-label="Language">
            @for (l of i18n.languages; track l) {
              <option [value]="l" [selected]="l === i18n.lang()">{{ l.toUpperCase() }}</option>
            }
          </select>
        }
      </div>
    </header>
    <main class="container">
      <router-outlet />
    </main>
    <footer>
      <div class="foot">
        <span class="fbrand"
          ><na-logo [size]="18" /> <na-wordmark [name]="auth.config().siteName"
        /></span>
        <span class="muted small">{{ 'footer.line' | t }} · v{{ version }}</span>
      </div>
    </footer>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
    main {
      flex: 1;
      width: 100%;
    }
    header {
      background: rgba(11, 13, 19, 0.92);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 20;
    }
    .bar {
      max-width: 1240px;
      margin: 0 auto;
      padding: 0 20px;
      min-height: 64px;
      display: flex;
      align-items: center;
      gap: 18px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-size: 1.4rem;
      color: var(--text);
      flex: none;
    }
    .brand:hover {
      color: var(--text);
    }
    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 2px;
    }
    nav a {
      color: var(--text-2);
      font-weight: 500;
      padding: 8px 9px;
      border-radius: 6px;
      white-space: nowrap;
    }
    nav a:hover {
      color: var(--text);
      background: var(--panel-2);
    }
    nav a.active {
      color: var(--text);
      background: var(--panel-2);
      box-shadow: inset 0 -2px 0 var(--accent);
    }
    .nav-foot {
      display: none;
    }
    .grow {
      flex: 1;
    }
    .lang {
      width: auto;
      min-height: 32px;
      padding: 3px 6px;
    }
    .desk {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .wallet {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.95rem;
    }
    .wallet:hover {
      color: var(--neuro);
    }
    .shopbtn {
      margin-left: -6px;
    }
    .shopbtn:hover,
    .shopbtn.on {
      color: var(--neuro);
    }
    .user {
      display: inline-flex;
      align-items: center;
      white-space: nowrap;
      gap: 8px;
      color: var(--text);
      font-weight: 600;
    }
    .user img {
      width: 26px;
      height: 26px;
      border-radius: 50%;
    }
    .burger {
      display: none;
      background: none;
      border: 0;
      width: 44px;
      height: 44px;
      padding: 0;
      color: var(--text);
    }
    footer {
      border-top: 1px solid var(--border);
      background: var(--bg-2);
    }
    .foot {
      max-width: 1240px;
      margin: 0 auto;
      padding: 18px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    .fbrand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 1rem;
    }
    @media (max-width: 1080px) {
      .bar {
        gap: 12px;
        padding: 0 8px 0 16px;
        min-height: 56px;
      }
      .brand {
        font-size: 1.2rem;
      }
      .burger {
        display: inline-flex;
      }
      .desk,
      .uname {
        display: none;
      }
      nav {
        display: none;
        position: absolute;
        left: 0;
        right: 0;
        top: 100%;
        flex-direction: column;
        gap: 0;
        padding: 8px 12px 14px;
        background: var(--bg-2);
        border-bottom: 1px solid var(--border);
        box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
      }
      nav.open {
        display: flex;
      }
      nav a {
        padding: 12px 10px;
        font-size: 1.05rem;
      }
      nav a.active {
        box-shadow: inset 3px 0 0 var(--accent);
      }
      .nav-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-top: 1px solid var(--border);
        margin-top: 8px;
        padding: 12px 10px 0;
      }
    }
  `,
})
export class App {
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  private readonly router = inject(Router);

  private readonly api = inject(Api);
  /** The own Neuro of the running (or last) season, next to the name; null: none. */
  protected readonly neuro = signal<number | null>(null);
  /** Mobile menu open. */
  protected readonly menu = signal(false);
  /** Platform version (root package.json). */
  protected readonly version = version;

  constructor() {
    void this.auth.ready();
    // Kept current: on every page change and every 30 s.
    effect(() => {
      if (this.auth.me()) void this.loadNeuro();
      else this.neuro.set(null);
    });
    const sub = this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) void this.loadNeuro();
    });
    const timer = setInterval(() => void this.loadNeuro(), 30_000);
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      clearInterval(timer);
    });
  }

  private async loadNeuro() {
    const me = this.auth.me();
    if (!me) return;
    try {
      const b = await this.api.userBets(me.id);
      this.neuro.set(b.wallet ? b.wallet.balance : null);
    } catch {
      this.neuro.set(null);
    }
  }

  protected setLang(ev: Event) {
    this.i18n.set((ev.target as HTMLSelectElement).value as Lang);
  }

  protected async logout() {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
