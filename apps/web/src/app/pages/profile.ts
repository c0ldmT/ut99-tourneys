import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { Auth } from '../core/auth';
import { TPipe } from '../core/i18n';

@Component({
  selector: 'app-profile',
  imports: [FormsModule, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'profile.title' | t }}</h1>
    @if (auth.me(); as me) {
      <div class="grid two">
        <form class="card" (ngSubmit)="save()">
          <h2>{{ 'profile.name' | t }}</h2>
          <p class="muted small">{{ 'profile.nameHint' | t }}</p>
          <div class="field">
            <input name="dn" [(ngModel)]="name" maxlength="20" />
          </div>
          <button class="primary" type="submit" [disabled]="busy() || name === me.displayName">
            {{ 'common.save' | t }}
          </button>
          @if (msg()) {
            <p class="notice">{{ msg() | t }}</p>
          }
          @if (err()) {
            <p class="error">{{ err() }}</p>
          }
        </form>
        <div class="card">
          <h2>{{ 'profile.token' | t }}</h2>
          <p class="muted small">{{ 'profile.tokenHint' | t }}</p>
          <p>
            <code>{{ shown() ? me.joinToken : '••••••••••••••••••••••••' }}</code>
          </p>
          <div class="row">
            <button (click)="shown.set(!shown())">
              {{ (shown() ? 'common.hide' : 'common.show') | t }}
            </button>
            <button class="danger" (click)="rotate()" [disabled]="busy()">
              {{ 'profile.rotate' | t }}
            </button>
          </div>
          <p class="muted small">{{ 'profile.rotateHint' | t }}</p>
        </div>
      </div>
      @if (auth.config().notify?.directMessages) {
        <div class="card">
          <h2>{{ 'profile.notify' | t }}</h2>
          <label class="row"
            ><input
              type="checkbox"
              [checked]="me.notifyDm !== false"
              [disabled]="busy() || !me.discordAccount"
              (change)="setDm($any($event.target).checked)"
            />
            {{ 'profile.notifyDm' | t }}</label
          >
          <p class="muted small">
            {{ (me.discordAccount ? 'profile.notifyDmHint' : 'profile.notifyNoDiscord') | t }}
          </p>
        </div>
      }
      <p class="muted small">Discord: {{ me.username }}</p>
    }
  `,
})
export class ProfilePage {
  protected readonly auth = inject(Auth);
  private readonly api = inject(Api);
  protected name = this.auth.me()?.displayName ?? '';
  protected readonly busy = signal(false);
  protected readonly shown = signal(false);
  protected readonly msg = signal('');
  protected readonly err = signal('');

  protected async save() {
    await this.act(async () => {
      const me = await this.api.updateMe(this.name);
      this.auth.me.set(me);
      this.name = me.displayName;
      return 'profile.saved';
    });
  }

  protected async setDm(on: boolean) {
    await this.act(async () => {
      this.auth.me.set(await this.api.setNotifyDm(on));
      return 'profile.saved';
    });
  }

  protected async rotate() {
    await this.act(async () => {
      this.auth.me.set(await this.api.rotateToken());
      this.shown.set(true);
      return 'profile.rotated';
    });
  }

  private async act(fn: () => Promise<string>) {
    this.busy.set(true);
    this.msg.set('');
    this.err.set('');
    try {
      const key = await fn();
      this.msg.set(key);
    } catch (e) {
      this.err.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }
}
