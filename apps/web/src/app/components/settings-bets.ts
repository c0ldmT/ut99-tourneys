import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { TPipe } from '../core/i18n';
import { SETTINGS_STYLES, type SettingsForm } from './settings-shared';
import { ShopSettings } from './shop-settings';

/** Settings tab "Bets & shop": the betting rules of new seasons and the Neuro shop. */
@Component({
  selector: 'app-settings-bets',
  imports: [FormsModule, TPipe, ShopSettings],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="card" data-form="betting" (ngSubmit)="saveBetting()">
      <h2>{{ 'bets.settings' | t }}</h2>
      <p class="muted small">{{ 'bets.settingsHint' | t }}</p>
      <div class="row gap">
        <label
          >{{ 'bets.startBalance' | t }}
          <input
            type="number"
            name="startBalance"
            min="10"
            step="10"
            class="narrow"
            [(ngModel)]="startBalance"
          />
        </label>
        <label
          >{{ 'bets.floor' | t }}
          <input type="number" name="floor" min="0" step="10" class="narrow" [(ngModel)]="floor" />
        </label>
      </div>
      <div class="row gap">
        <label
          >{{ 'bets.windowSec' | t }}
          <input
            type="number"
            name="windowSec"
            min="0"
            max="600"
            step="5"
            class="narrow"
            [(ngModel)]="windowSec"
          />
        </label>
      </div>
      <p class="muted small">{{ 'bets.windowSecHint' | t }}</p>
      <label class="row"
        ><input type="checkbox" name="betsDiscord" [(ngModel)]="betsDiscord" />
        {{ 'bets.discordLabel' | t }}</label
      >
      <label class="row"
        ><input type="checkbox" name="botsBet" [(ngModel)]="botsBet" />
        {{ 'bets.botsBetLabel' | t }}</label
      >
      <div class="row gap">
        <label
          >{{ 'bets.botsPerMatch' | t }}
          <input
            type="number"
            name="botsPerMatch"
            min="0"
            max="50"
            class="narrow"
            [(ngModel)]="botsPerMatch"
            [disabled]="!botsBet"
          />
        </label>
      </div>
      <div class="row">
        <button type="submit" class="primary" [disabled]="busy()">{{ 'common.save' | t }}</button>
      </div>
    </form>

    <app-shop-settings (saved)="saved.emit('shop')" />
  `,
  styles: [SETTINGS_STYLES],
})
export class SettingsBets {
  private readonly api = inject(Api);
  private readonly cdr = inject(ChangeDetectorRef);
  /** A form was saved (the page drops its "unsaved" mark). */
  readonly saved = output<SettingsForm>();
  protected readonly busy = signal(false);
  protected startBalance = 1000;
  protected floor = 100;
  protected botsBet = true;
  protected windowSec = 20;
  protected betsDiscord = true;
  protected botsPerMatch = 6;

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      const s = await this.api.settings();
      this.startBalance = s.betting.startBalance;
      this.floor = s.betting.floor;
      this.botsBet = s.betting.botsBet;
      this.botsPerMatch = s.betting.botsPerMatch;
      this.windowSec = s.betting.windowSec;
      this.betsDiscord = s.betting.discord;
      // Plain fields (ngModel): without zone.js the view must be told about them.
      this.cdr.markForCheck();
    } catch {
      // the toast shows the error
    }
  }

  protected async saveBetting() {
    this.busy.set(true);
    try {
      const s = await this.api.setBettingSettings({
        startBalance: Math.round(Number(this.startBalance)),
        floor: Math.round(Number(this.floor)),
        botsBet: this.botsBet,
        botsPerMatch: Math.round(Number(this.botsPerMatch)),
        windowSec: Math.round(Number(this.windowSec)),
        discord: this.betsDiscord,
      });
      this.startBalance = s.betting.startBalance;
      this.floor = s.betting.floor;
      this.saved.emit('betting');
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
