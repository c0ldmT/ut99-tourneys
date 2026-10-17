import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { TPipe } from '../core/i18n';

/** Website settings (admins): the ratings for now; seasons come with the statistics milestone. */
@Component({
  selector: 'app-settings',
  imports: [TPipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'settings.title' | t }}</h1>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    <form class="card" (ngSubmit)="save()">
      <h2>{{ 'settings.rating' | t }}</h2>
      <p class="muted small">{{ 'settings.ratingHint' | t }}</p>
      <label class="row"
        ><input
          type="checkbox"
          name="botGames"
          [ngModel]="botGames()"
          (ngModelChange)="botGames.set($event)"
        />
        {{ 'settings.botGames' | t }}</label
      >
      <p class="muted small">{{ 'settings.botGamesHint' | t }}</p>
      <label
        >{{ 'settings.levelPoints' | t }}
        <input
          type="number"
          name="levelPoints"
          min="0"
          max="300"
          step="10"
          [ngModel]="levelPoints()"
          (ngModelChange)="levelPoints.set($event)"
        />
      </label>
      <p class="muted small">{{ 'settings.levelPointsHint' | t }}</p>
      <div class="row">
        <button type="submit" class="primary" [disabled]="busy()">{{ 'common.save' | t }}</button>
        @if (saved()) {
          <span class="muted small">{{ 'settings.saved' | t }}</span>
        }
      </div>
    </form>
  `,
  styles: `
    form {
      max-width: 640px;
    }
    input[type='number'] {
      width: 120px;
      display: block;
      margin-top: 4px;
    }
  `,
})
export class SettingsPage {
  private readonly api = inject(Api);
  protected readonly botGames = signal(true);
  protected readonly levelPoints = signal(100);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal('');

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      const s = await this.api.settings();
      this.botGames.set(s.rating.botGames);
      this.levelPoints.set(s.rating.levelPoints);
      this.saved.set(false);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  protected async save() {
    this.busy.set(true);
    this.error.set('');
    try {
      const s = await this.api.setRatingSettings({
        botGames: this.botGames(),
        levelPoints: Math.round(Number(this.levelPoints())),
      });
      this.botGames.set(s.rating.botGames);
      this.levelPoints.set(s.rating.levelPoints);
      this.saved.set(true);
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }
}
