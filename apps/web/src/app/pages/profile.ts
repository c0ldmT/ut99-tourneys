import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Confirm } from '../components/confirm-dialog';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { copyText } from '../core/clipboard';
import { I18n, TPipe } from '../core/i18n';
import type { Lang } from '../core/i18n-dict';
import { Avatar, NameTag } from '../core/looks';

/** Language names in their own language (a German speaker on an English page finds "Deutsch"). */
const NATIVE: Readonly<Record<string, string>> = { de: 'Deutsch', en: 'English' };

/**
 * The account (decision 310): who you are on the site and the game server, in one column. The
 * identity strip shows the name as others see it (title, colour, frame from the wardrobe); below
 * are the in-game name, the join token, and language and Discord messages.
 */
@Component({
  selector: 'app-profile',
  imports: [FormsModule, RouterLink, TPipe, Avatar, NameTag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'profile.title' | t }}</h1>
    @if (auth.me(); as me) {
      <div class="acct">
        <section class="card who" [attr.aria-label]="'profile.who' | t">
          <na-avatar [name]="me.displayName" [id]="me.id" [src]="me.avatar" [size]="56" />
          <div class="whotext">
            <span class="whoname"
              ><na-name [name]="me.displayName" [id]="me.id" [withTitle]="true" [badgeSize]="18"
            /></span>
            <span class="muted small">
              {{
                me.discordAccount
                  ? ('profile.viaDiscord' | t: { name: me.username })
                  : ('profile.viaDev' | t)
              }}
              @if (me.isAdmin) {
                · {{ 'profile.roleAdmin' | t }}
              } @else if (me.isModerator) {
                · {{ 'profile.roleMod' | t }}
              }
            </span>
          </div>
          <div class="wholinks">
            <a class="btn" routerLink="/stats/p/u:{{ me.id }}">{{ 'nav.myStats' | t }}</a>
            <a class="btn" routerLink="/shop" [queryParams]="{ tab: 'wardrobe' }">{{
              'shop.tab.wardrobe' | t
            }}</a>
          </div>
        </section>

        <form class="card" (ngSubmit)="save()">
          <h2>
            <label for="acct-name">{{ 'profile.name' | t }}</label>
          </h2>
          <p class="muted small">{{ 'profile.nameHint' | t }}</p>
          <div class="inline">
            <input
              id="acct-name"
              name="dn"
              [(ngModel)]="name"
              maxlength="20"
              autocomplete="nickname"
              [disabled]="banned()"
            />
            <button
              class="primary"
              type="submit"
              [disabled]="busy() || banned() || !name.trim() || name === me.displayName"
            >
              {{ 'common.save' | t }}
            </button>
          </div>
          @if (banned()) {
            <p class="lack small">
              {{ 'mod.textBanned' | t: { d: i18n.when(me.textBanUntil!, 'date') } }}
            </p>
          }
        </form>

        <section class="card">
          <h2>{{ 'profile.token' | t }}</h2>
          <p class="muted small">{{ 'profile.tokenHint' | t }}</p>
          <div class="inline">
            <code class="token" [class.hidden]="!shown()">{{
              shown() ? me.joinToken : '••••••••••••••••'
            }}</code>
            <button type="button" (click)="shown.set(!shown())">
              {{ (shown() ? 'common.hide' : 'common.show') | t }}
            </button>
            <button type="button" (click)="copy(me.joinToken)">
              {{ (copied() ? 'common.copied' : 'common.copy') | t }}
            </button>
          </div>
          <div class="danger-row">
            <span class="muted small">{{ 'profile.rotateHint' | t }}</span>
            <button type="button" class="danger" (click)="rotate()" [disabled]="busy()">
              {{ 'profile.rotate' | t }}
            </button>
          </div>
        </section>

        <section class="card">
          <h2>{{ 'profile.prefs' | t }}</h2>
          <div class="optrows">
            <div class="optrow pref">
              <span class="ot"
                ><b id="acct-lang">{{ 'nav.language' | t }}</b
                ><span class="muted small">{{ 'profile.langHint' | t }}</span></span
              >
              <div class="seg" role="radiogroup" aria-labelledby="acct-lang">
                @for (l of i18n.languages; track l) {
                  <button
                    type="button"
                    role="radio"
                    [attr.aria-checked]="i18n.lang() === l"
                    [class.on]="i18n.lang() === l"
                    [attr.lang]="l"
                    (click)="i18n.set(l)"
                  >
                    {{ native(l) }}
                  </button>
                }
              </div>
            </div>
            @if (auth.config().notify?.directMessages) {
              <label class="switch optrow"
                ><span class="ot"
                  ><b>{{ 'profile.notifyDm' | t }}</b
                  ><span class="muted small">{{
                    (me.discordAccount ? 'profile.notifyDmHint' : 'profile.notifyNoDiscord') | t
                  }}</span></span
                ><input
                  type="checkbox"
                  [checked]="me.notifyDm !== false"
                  [disabled]="busy() || !me.discordAccount"
                  (change)="setDm($any($event.target).checked)" /><span class="tr"></span
              ></label>
            }
          </div>
        </section>

        <p class="out">
          <button type="button" class="link" (click)="logout()">{{ 'nav.logout' | t }}</button>
        </p>
      </div>
    }
  `,
  styles: `
    .acct {
      max-width: 760px;
      display: grid;
      gap: 16px;
    }
    .acct > .card {
      margin: 0;
    }
    .who {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .whotext {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
      flex: 1 1 180px;
    }
    .whoname {
      font-size: var(--fs-xl);
      font-weight: 700;
    }
    .wholinks {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    h2 label {
      cursor: default;
      font: inherit;
      color: inherit;
      margin: 0;
    }
    .inline {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .inline input {
      flex: 1;
      min-width: 180px;
      max-width: 360px;
    }
    .token {
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      background: var(--panel-2);
      border: 1px solid var(--line);
      font-size: var(--fs-md);
      letter-spacing: 0.04em;
      user-select: all;
    }
    .token.hidden {
      color: var(--faint);
      user-select: none;
    }
    .danger-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }
    .optrows {
      margin: 0;
    }
    .optrow.pref {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      padding: 10px 0;
    }
    .out {
      margin: 0;
    }
    @media (max-width: 600px) {
      .wholinks {
        width: 100%;
      }
      .wholinks .btn {
        flex: 1;
        text-align: center;
      }
      .token {
        flex: 1 1 100%;
      }
    }
  `,
})
export class ProfilePage {
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  private readonly api = inject(Api);
  private readonly confirm = inject(Confirm);
  private readonly router = inject(Router);
  protected name = this.auth.me()?.displayName ?? '';
  protected readonly busy = signal(false);
  protected readonly shown = signal(false);
  protected readonly copied = signal(false);

  /** A moderator blocked name and text changes until then. */
  protected banned(): boolean {
    const until = this.auth.me()?.textBanUntil;
    return !!until && Date.parse(until) > Date.now();
  }

  protected native(l: Lang): string {
    return NATIVE[l] ?? l.toUpperCase();
  }

  protected async save() {
    await this.act(async () => {
      const me = await this.api.updateMe(this.name.trim());
      this.auth.me.set(me);
      this.name = me.displayName;
    });
  }

  protected async setDm(on: boolean) {
    await this.act(async () => {
      this.auth.me.set(await this.api.setNotifyDm(on));
    });
  }

  protected async copy(token: string) {
    if (!(await copyText(token))) {
      this.shown.set(true);
      return;
    }
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }

  /** A new token makes the old one useless (also in connect commands already copied): ask. */
  protected async rotate() {
    const ok = await this.confirm.ask(this.i18n.t('profile.rotateConfirm'), {
      danger: true,
      ok: 'profile.rotate',
    });
    if (!ok) return;
    await this.act(async () => {
      this.auth.me.set(await this.api.rotateToken());
      this.shown.set(true);
    });
  }

  protected async logout() {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }

  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    try {
      await fn();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
