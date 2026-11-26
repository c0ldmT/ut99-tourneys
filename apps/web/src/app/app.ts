import { QuickSearch } from './components/quick-search';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Avatar, NameTag } from './core/looks';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
  Scroll,
} from '@angular/router';
import { Api } from './core/api';
import { ViewportScroller } from '@angular/common';
import { NeuroPipe, NeuroStore } from './core/neuro';
import { Coin, Icon, Logo, UdtMark, Wordmark } from './core/brand';
import { version } from '../../../../package.json';
import { Auth } from './core/auth';
import { I18n, TPipe } from './core/i18n';
import type { Lang } from './core/i18n-dict';
import { ToastHost } from './core/toast';
import { Loading } from './core/loading';
import { ActivityBar } from './components/activity-bar';
import { ServerActivity } from './core/activity';
import { Loader } from './components/loader';
import { NoticeModal } from './components/notice-modal';
import { ConfirmDialog } from './components/confirm-dialog';
import { PeekCard } from './components/peek-card';
import { PatchNotes } from './components/patch-notes';
import { Feedback } from './components/feedback';

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    TPipe,
    NeuroPipe,
    Logo,
    UdtMark,
    Wordmark,
    Coin,
    Avatar,
    NameTag,
    Icon,
    ToastHost,
    Loader,
    ActivityBar,
    NoticeModal,
    ConfirmDialog,
    PeekCard,
    PatchNotes,
    Feedback,
    QuickSearch,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="site">
      <div class="bar">
        <a
          routerLink="/"
          class="brand"
          [attr.aria-label]="auth.config().siteName"
          (click)="menu.set(false)"
        >
          <na-logo [size]="30" />
          <na-wordmark [name]="auth.config().siteName" />
        </a>
        @if (auth.me(); as me) {
          <nav [class.open]="menu()" (click)="menu.set(false)">
            @if (auth.config().udt) {
              <a
                routerLink="/udt"
                routerLinkActive="active"
                class="udt"
                [title]="'udt.title' | t"
                [attr.aria-label]="'udt.title' | t"
                ><na-udt-mark [size]="28" /><span class="udt-label">{{ 'udt.title' | t }}</span></a
              >
              <span class="udt-sep" aria-hidden="true"></span>
            }
            <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }"
              >{{ 'nav.tournaments' | t }}
              @if (activity.live() > 0) {
                <span class="navlive" [title]="'nav.liveCount' | t: { n: activity.live() }"
                  ><span class="dot on"></span>{{ activity.live() }}</span
                >
              }
            </a>
            <a routerLink="/calendar" routerLinkActive="active">{{ 'nav.calendar' | t }}</a>
            <a routerLink="/stats" routerLinkActive="active">{{ 'nav.stats' | t }}</a>
            <!-- Administration in one menu (decision 285): the bar keeps its line. -->
            @if (me.isAdmin) {
              <div class="navmore" [class.open]="adminOpen()" (click)="$event.stopPropagation()">
                <button
                  type="button"
                  class="navbtn"
                  [class.active]="adminActive()"
                  aria-haspopup="true"
                  [attr.aria-expanded]="adminOpen()"
                  (click)="adminOpen.set(!adminOpen()); userOpen.set(false)"
                >
                  {{ 'nav.admin' | t }}
                  @if (modOpen() > 0) {
                    <span class="navbadge" [title]="'nav.modOpen' | t: { n: modOpen() }">{{
                      modOpen()
                    }}</span>
                  }
                  <svg class="chev" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                <div class="menu" (click)="closeMenus()">
                  <!-- Only in the burger menu: the group's name (decision 306). -->
                  <div class="mhead kpi">{{ 'nav.admin' | t }}</div>
                  <a routerLink="/moderation" routerLinkActive="active"
                    >{{ 'nav.moderation' | t }}
                    @if (modOpen() > 0) {
                      <span class="navbadge">{{ modOpen() }}</span>
                    }
                  </a>
                  <a routerLink="/admin/agents" routerLinkActive="active">{{ 'nav.agents' | t }}</a>
                  <a routerLink="/admin/series" routerLinkActive="active">{{
                    'series.title' | t
                  }}</a>
                  <a routerLink="/admin/bots" routerLinkActive="active">{{ 'nav.bots' | t }}</a>
                  <a routerLink="/admin/users" routerLinkActive="active">{{ 'nav.users' | t }}</a>
                  <a routerLink="/admin/settings" routerLinkActive="active">{{
                    'nav.settings' | t
                  }}</a>
                </div>
              </div>
            } @else if (me.isModerator) {
              <a routerLink="/moderation" routerLinkActive="active"
                >{{ 'nav.moderation' | t }}
                @if (modOpen() > 0) {
                  <span class="navbadge">{{ modOpen() }}</span>
                }
              </a>
            }
            <div class="nav-foot">
              <a routerLink="/profile" class="footlink">{{ 'nav.profile' | t }}</a>
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
          <!-- Quick search, also Ctrl+K (decision 313). -->
          <na-search />
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
            ><na-icon name="shop" [size]="19" /><span class="shoplabel">{{
              'shop.title' | t
            }}</span></a
          >
          <!-- Profile, language and logout behind the avatar (decision 285). -->
          <div class="usermenu" [class.open]="userOpen()" (click)="$event.stopPropagation()">
            <button
              type="button"
              class="user"
              aria-haspopup="true"
              [attr.aria-expanded]="userOpen()"
              [attr.aria-label]="'nav.account' | t"
              (click)="userOpen.set(!userOpen()); adminOpen.set(false); menu.set(false)"
            >
              <na-avatar [name]="me.displayName" [id]="me.id" [src]="me.avatar" [size]="28" />
              <span class="uname"><na-name [name]="me.displayName" [id]="me.id" /></span>
              <svg class="chev" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <div class="menu right">
              <a routerLink="/profile" (click)="closeMenus()">{{ 'nav.profile' | t }}</a>
              <a routerLink="/stats/p/u:{{ me.id }}" (click)="closeMenus()">{{
                'nav.myStats' | t
              }}</a>
              <label class="langrow"
                >{{ 'nav.language' | t }}
                <select class="lang" (change)="setLang($event)" aria-label="Language">
                  @for (l of i18n.languages; track l) {
                    <option [value]="l" [selected]="l === i18n.lang()">
                      {{ l.toUpperCase() }}
                    </option>
                  }
                </select>
              </label>
              <button type="button" class="mi" (click)="closeMenus(); logout()">
                <na-icon name="logout" [size]="15" /> {{ 'nav.logout' | t }}
              </button>
            </div>
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
      <div class="progress" [class.on]="loading.bar()" aria-hidden="true"><span></span></div>
      @if (auth.me()) {
        <na-activity />
      }
    </header>
    <main class="container">
      @if (loading.spinner()) {
        <na-loader animate.leave="leaving" />
      }
      <router-outlet #outlet (activate)="entered()" />
    </main>
    <footer>
      <div class="foot">
        <span class="fbrand"
          ><na-logo [size]="18" /> <na-wordmark [name]="auth.config().siteName"
        /></span>
        <span class="muted small"
          >{{ 'footer.line' | t }} · v{{ version }} ·
          <button type="button" class="link fpatch" (click)="patchNotes.openAll()">
            {{ 'patch.footer' | t }}
          </button>
          @if (auth.me()) {
            ·
            <button type="button" class="link fpatch" (click)="feedback.openNote()">
              {{ 'fb.footer' | t }}
            </button>
          }
        </span>
      </div>
    </footer>
    <app-toasts />
    @if (auth.me()) {
      <na-notice-modal />
      <na-confirm />
      <!-- Hover cards for bot and team links (decision 318). -->
      @defer (on idle) {
        <na-peek />
      }
    }
    <na-patch-notes #patchNotes />
    <na-feedback #feedback />
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
      position: relative;
    }
    /* Calls after a page loaded (filters, tabs, actions): a thin running line under the bar. */
    .progress {
      position: absolute;
      left: 0;
      right: 0;
      bottom: -1px;
      height: 2px;
      overflow: hidden;
      opacity: 0;
      transition: opacity 0.2s ease;
      pointer-events: none;
    }
    .progress.on {
      opacity: 1;
    }
    .progress span {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 40%;
      background: linear-gradient(90deg, transparent, var(--accent), var(--udt), transparent);
      box-shadow: 0 0 8px var(--accent);
    }
    .progress.on span {
      animation: run 1.1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }
    @keyframes run {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(260%);
      }
    }
    header {
      background: color-mix(in srgb, var(--bg-2) 92%, transparent);
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
      gap: 14px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-size: var(--fs-xl);
      color: var(--text);
      flex: none;
    }
    .brand:hover {
      color: var(--text);
    }
    nav {
      display: flex;
      flex-wrap: nowrap;
      gap: 2px;
      min-width: 0;
    }
    nav a {
      color: var(--text-2);
      font-weight: 500;
      font-size: var(--fs-md);
      padding: 8px 7px;
      border-radius: var(--radius-sm);
      white-space: nowrap;
    }
    .navlive {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 6px;
      font-size: var(--fs-xs);
      font-weight: 700;
      color: var(--live);
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
    nav {
      align-items: center;
    }
    nav a.udt {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px 4px 6px;
    }
    nav a.udt:hover {
      background: color-mix(in srgb, var(--udt) 14%, transparent);
    }
    nav a.udt.active {
      background: color-mix(in srgb, var(--udt) 18%, transparent);
      box-shadow: inset 0 -2px 0 var(--udt);
    }
    .udt-label {
      color: var(--udt);
      font-weight: 600;
    }
    .udt-sep {
      width: 1px;
      height: 22px;
      margin: 0 6px 0 4px;
      background: var(--border);
    }
    .nav-foot {
      display: none;
    }
    /* Dropdowns (decision 285): administration in the bar, account behind the avatar. */
    .navmore,
    .usermenu {
      position: relative;
    }
    .navbtn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: 0;
      min-height: 0;
      color: var(--text-2);
      font-weight: 500;
      font-size: var(--fs-md);
      padding: 8px 7px;
      border-radius: var(--radius-sm);
      white-space: nowrap;
    }
    .navbtn:hover,
    .navmore.open .navbtn {
      color: var(--text);
      background: var(--panel-2);
    }
    .navbtn.active {
      color: var(--text);
      box-shadow: inset 0 -2px 0 var(--accent);
    }
    .chev {
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
      transition: transform 0.15s ease;
    }
    .open > button .chev {
      transform: rotate(180deg);
    }
    .menu {
      display: none;
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      min-width: 200px;
      padding: 6px;
      flex-direction: column;
      gap: 2px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.55);
      z-index: 30;
    }
    .menu.right {
      left: auto;
      right: 0;
    }
    .open > .menu {
      display: flex;
    }
    .menu a,
    .menu .mi {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      color: var(--text-2);
      font-weight: 500;
      white-space: nowrap;
      background: none;
      border: 0;
      min-height: 0;
      text-align: left;
      justify-content: flex-start;
      width: 100%;
      font-size: var(--fs-md);
    }
    .menu a:hover,
    .menu .mi:hover,
    .menu a.active {
      color: var(--text);
      background: var(--panel-2);
      box-shadow: none;
    }
    .langrow {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 6px 10px;
      color: var(--text-2);
      font-weight: 500;
    }
    .navbadge {
      margin-left: auto;
      padding: 0 6px;
      border-radius: var(--radius-pill);
      background: var(--danger, #ff6b6b);
      color: #fff;
      font-size: var(--fs-xs);
      font-weight: 700;
      line-height: 1.5;
    }
    .grow {
      flex: 1;
    }
    .lang {
      width: auto;
      min-height: 32px;
      padding: 3px 6px;
    }
    .wallet {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: var(--fs-md);
    }
    .wallet:hover {
      color: var(--neuro);
    }
    .shopbtn {
      margin-left: -6px;
    }
    /* Wide screens: the shop with its name (decision 306); narrower ones keep the icon. */
    .shoplabel {
      display: none;
    }
    @media (min-width: 1240px) {
      .shopbtn {
        width: auto;
        gap: 6px;
        padding: 0 10px;
      }
      .shoplabel {
        display: inline;
        font-weight: 600;
      }
    }
    .mhead {
      display: none;
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
      background: none;
      border: 0;
      min-height: 0;
      padding: 4px 6px;
      border-radius: var(--radius-sm);
    }
    .user:hover,
    .usermenu.open .user {
      background: var(--panel-2);
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
    .fpatch {
      font-size: inherit;
    }
    .fbrand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: var(--fs-base);
    }
    @media (max-width: 1080px) {
      .bar {
        gap: 12px;
        padding: 0 8px 0 16px;
        min-height: 56px;
      }
      .brand {
        font-size: var(--fs-lg);
      }
      .burger {
        display: inline-flex;
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
        font-size: var(--fs-base);
      }
      nav a.active {
        box-shadow: inset 3px 0 0 var(--accent);
      }
      nav {
        align-items: stretch;
      }
      nav a.udt {
        padding: 8px 10px;
      }
      nav a.udt.active {
        box-shadow: inset 3px 0 0 var(--udt);
      }
      .udt-sep {
        display: none;
      }
      /* In the burger menu the administration is a plain list. */
      .navmore .navbtn {
        display: none;
      }
      .navmore .menu {
        display: flex;
        position: static;
        box-shadow: none;
        border: 0;
        border-top: 1px solid var(--border);
        border-radius: 0;
        margin-top: 6px;
        padding: 6px 0 0;
        background: none;
      }
      .navmore .menu a {
        padding: 12px 10px;
        font-size: var(--fs-base);
      }
      .navmore .mhead {
        display: block;
        padding: 6px 10px 2px;
      }
      .footlink {
        padding: 0;
        margin-right: auto;
      }
      .uname,
      .user .chev {
        display: none;
      }
      .nav-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        border-top: 1px solid var(--border);
        margin-top: 8px;
        padding: 12px 10px 0;
      }
    }
    /* Phones: the bar holds logo, search, wallet, shop, avatar and burger in one line.
       The wordmark gives way, and no button shrinks below its size (decision 314). */
    @media (max-width: 520px) {
      .bar {
        gap: 6px;
        padding: 0 4px 0 12px;
      }
      .brand na-wordmark {
        display: none;
      }
      .wallet,
      .shopbtn,
      .user,
      .burger {
        flex: none;
      }
      .shopbtn {
        margin-left: 0;
      }
    }
  `,
})
export class App {
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  private readonly router = inject(Router);

  /** The own Neuro of the running (or last) season, next to the name; null: none. */
  protected readonly neuro = inject(NeuroStore).balance;
  /** Mobile menu open. */
  protected readonly menu = signal(false);
  /** The administration and account dropdowns (decision 285). */
  protected readonly adminOpen = signal(false);
  protected readonly userOpen = signal(false);
  /** Open items of the moderation queue (moderators and admins). */
  protected readonly modOpen = signal(0);
  private readonly url = signal('');
  /** An administration page is shown (the dropdown's button is marked). */
  protected readonly adminActive = computed(
    () => this.url().startsWith('/admin') || this.url().startsWith('/moderation'),
  );
  private readonly api = inject(Api);

  protected closeMenus() {
    this.adminOpen.set(false);
    this.userOpen.set(false);
    this.menu.set(false);
  }

  @HostListener('document:click')
  @HostListener('document:keydown.escape')
  protected outside() {
    this.adminOpen.set(false);
    this.userOpen.set(false);
  }

  /** The moderation counter: after login, on every page change and every two minutes. */
  private watchModeration() {
    const load = () => {
      const me = this.auth.me();
      if (!me || !(me.isAdmin || me.isModerator)) return this.modOpen.set(0);
      this.api.modCount().then(
        (r) => this.modOpen.set(r.open),
        () => undefined,
      );
    };
    const sub = this.router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) {
        this.url.set(e.urlAfterRedirects);
        load();
      }
    });
    const timer = setInterval(load, 120_000);
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      clearInterval(timer);
    });
    effect(() => {
      if (this.auth.me()) untracked(load);
    });
  }
  /** Platform version (root package.json). */
  protected readonly version = version;

  /** Page loads and calls: the loader, the thin bar, the content fading in. */
  protected readonly loading = inject(Loading);
  /** Running tournaments for the counter next to "Tournaments" (decision 282). */
  protected readonly activity = inject(ServerActivity);
  private readonly outlet = viewChild.required('outlet', { read: ElementRef });
  /** The page component in place, hidden until its loading is done. */
  private page: Element | null = null;

  constructor() {
    this.loading.watch(this.router);
    this.scrolling();
    this.watchModeration();
    void this.auth.ready();
    // The page shows (rising and fading in) once its loading is done.
    effect(() => {
      if (this.loading.hidden() || !this.page) return;
      const el = this.page;
      if (!el.classList.contains('page-enter')) return;
      el.classList.remove('page-enter');
      (el as HTMLElement).inert = false;
      el.removeAttribute('aria-busy');
      // The blocks rise one after another; later content (a tab, a list) just appears.
      el.classList.add('page-in');
      setTimeout(() => el.classList.remove('page-in'), 1200);
    });
  }

  /**
   * A new page starts at the top; back and forward return to the old place once the page's
   * data is there (the router restores before, when the page is still short). A change of the
   * query only keeps the place.
   */
  private scrolling() {
    if (typeof history !== 'undefined') history.scrollRestoration = 'manual';
    const scroller = inject(ViewportScroller);
    const back = signal<[number, number] | null>(null);
    // A link to a part of a page (#inventory): there once the page is shown.
    const anchor = signal<string | null>(null);
    let atAnchor = false;
    const sub = this.router.events.subscribe((e) => {
      if (!(e instanceof Scroll)) return;
      const was = atAnchor;
      atAnchor = !!e.anchor;
      if (e.anchor && !e.position) {
        // Another page starts at the top (if the part is missing, it stays there).
        if (this.loading.pageChanged) scroller.scrollToPosition([0, 0]);
        anchor.set(e.anchor);
        return;
      }
      // From a part of the page back to the page itself (#inventory → packs): the top.
      if (!this.loading.pageChanged) {
        if (was && !e.position) scroller.scrollToPosition([0, 0]);
        return;
      }
      if (e.position) back.set(e.position);
      else {
        back.set(null);
        scroller.scrollToPosition([0, 0]);
      }
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
    effect(() => {
      const p = back();
      if (!p || this.loading.hidden()) return;
      back.set(null);
      scroller.scrollToPosition(p);
    });
    effect(() => {
      const a = anchor();
      if (!a || this.loading.hidden()) return;
      anchor.set(null);
      // After the page's content is in place.
      requestAnimationFrame(() =>
        document.getElementById(a)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    });
  }

  /** A new page component is in place: hidden until its loading is done. */
  protected entered() {
    const el = (this.outlet().nativeElement as Element).nextElementSibling;
    if (!el) return;
    this.page = el;
    el.classList.add('page');
    // Hidden content can be neither seen nor reached (keyboard, screen readers).
    if (this.loading.hidden()) {
      el.classList.add('page-enter');
      (el as HTMLElement).inert = true;
      el.setAttribute('aria-busy', 'true');
    }
    this.loading.activated();
  }

  protected setLang(ev: Event) {
    this.i18n.set((ev.target as HTMLSelectElement).value as Lang);
  }

  protected async logout() {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
