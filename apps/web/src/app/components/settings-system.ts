import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';

/** Settings tab "System": resetting the website (danger zone). */
@Component({
  selector: 'app-settings-system',
  imports: [FormsModule, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card danger-zone">
      <h2>⚠ {{ 'reset.title' | t }}</h2>
      <p>{{ 'reset.what' | t }}</p>
      <p class="muted small">{{ 'reset.keeps' | t }}</p>
      @if (resetDone(); as r) {
        <p class="notice">{{ 'reset.done' | t: { t: r.tournaments, s: r.seasons } }}</p>
      }
      @if (!resetOpen()) {
        <button class="danger" (click)="openReset()">{{ 'reset.open' | t }}</button>
      } @else {
        <div class="reset-box">
          <p class="warn">
            <b>{{ 'reset.warning' | t }}</b>
          </p>
          <label class="row"
            ><input type="checkbox" name="resetOk" [(ngModel)]="resetUnderstood" />
            {{ 'reset.understood' | t }}</label
          >
          <label
            >{{ 'reset.typeWord' | t: { word: resetWord } }}
            <input
              name="resetWord"
              class="word"
              autocomplete="off"
              [(ngModel)]="resetTyped"
              [placeholder]="resetWord"
            />
          </label>
          <div class="row">
            <button
              class="danger solid"
              [disabled]="busy() || !resetUnderstood || resetTyped !== resetWord"
              (click)="reset()"
            >
              {{ 'reset.confirm' | t }}
            </button>
            <button (click)="resetOpen.set(false)">{{ 'common.cancel' | t }}</button>
          </div>
        </div>
      }
    </section>
  `,
  styles: `
    .card {
      max-width: 820px;
    }
    .danger-zone {
      border: 2px solid var(--danger);
      background: rgba(248, 81, 73, 0.05);
    }
    .danger-zone h2 {
      color: var(--danger);
    }
    .reset-box {
      border-top: 1px solid rgba(248, 81, 73, 0.4);
      padding-top: 12px;
    }
    .warn {
      color: var(--danger);
    }
    input.word {
      max-width: 200px;
      display: block;
      margin-top: 4px;
      font-family: ui-monospace, monospace;
    }
    button.danger.solid:not(:disabled) {
      background: var(--danger);
      color: #fff;
      font-weight: 700;
    }
  `,
})
export class SettingsSystem {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  protected readonly busy = signal(false);
  /** Website reset: opened, ticked and the word typed before the button works. */
  protected readonly resetWord = 'RESET';
  protected readonly resetOpen = signal(false);
  protected readonly resetDone = signal<{ tournaments: number; seasons: number } | null>(null);
  protected resetUnderstood = false;
  protected resetTyped = '';

  protected openReset() {
    this.resetUnderstood = false;
    this.resetTyped = '';
    this.resetDone.set(null);
    this.resetOpen.set(true);
  }

  protected async reset() {
    if (!this.resetUnderstood || this.resetTyped !== this.resetWord) return;
    if (!confirm(this.i18n.t('reset.lastChance'))) return;
    this.busy.set(true);
    try {
      this.resetDone.set(await this.api.resetAll(this.resetTyped));
      this.resetOpen.set(false);
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
