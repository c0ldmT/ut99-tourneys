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

/** Settings tab "Bots & live": the bot AI (skill curve) and the live data of games. */
@Component({
  selector: 'app-settings-bots',
  imports: [FormsModule, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="card" data-form="botAi" (ngSubmit)="saveBotAi()">
      <h2>{{ 'botAi.title' | t }}</h2>
      <p class="muted small">{{ 'botAi.hint' | t }}</p>
      <label
        >{{ 'botAi.level' | t }}
        <select name="botAiLevel" [(ngModel)]="botAiLevel">
          <option [ngValue]="2">{{ 'botAi.level2' | t }}</option>
          <option [ngValue]="1">{{ 'botAi.level1' | t }}</option>
          <option [ngValue]="0">{{ 'botAi.level0' | t }}</option>
        </select>
      </label>
      <p class="muted small">{{ 'botAi.modHint' | t }}</p>
      <label class="row"
        ><input type="checkbox" name="botSkillCurve" [(ngModel)]="botSkillCurve" />
        {{ 'botAi.skillCurve' | t }}</label
      >
      <p class="muted small">{{ 'botAi.skillCurveHint' | t }}</p>
      <div class="row">
        <button type="submit" class="primary" [disabled]="busy()">{{ 'common.save' | t }}</button>
      </div>
    </form>

    <form class="card" data-form="live" (ngSubmit)="saveLive()">
      <h2>{{ 'liveSet.title' | t }}</h2>
      <p class="muted small">{{ 'liveSet.hint' | t }}</p>
      <label
        >{{ 'liveSet.delay' | t }}
        <span class="row"
          ><input
            type="number"
            name="liveDelay"
            min="0"
            max="120"
            class="narrow"
            [(ngModel)]="liveDelay"
          />
          s</span
        >
      </label>
      <p class="muted small">{{ 'liveSet.delayHint' | t }}</p>
      <label
        >{{ 'liveSet.days' | t }}
        <span class="row"
          ><input
            type="number"
            name="replayDays"
            min="0"
            max="3650"
            class="narrow"
            [(ngModel)]="replayDays"
          />
          {{ 'liveSet.daysUnit' | t }}</span
        >
      </label>
      <p class="muted small">{{ 'liveSet.daysHint' | t }}</p>
      <div class="row">
        <button type="submit" class="primary" [disabled]="busy()">{{ 'common.save' | t }}</button>
      </div>
    </form>
  `,
  styles: [SETTINGS_STYLES],
})
export class SettingsBots {
  private readonly api = inject(Api);
  private readonly cdr = inject(ChangeDetectorRef);
  /** A form was saved (the page drops its "unsaved" mark). */
  readonly saved = output<SettingsForm>();
  protected readonly busy = signal(false);
  protected botAiLevel = 2;
  protected botSkillCurve = true;
  protected liveDelay = 20;
  protected replayDays = 60;

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      const s = await this.api.settings();
      this.botAiLevel = s.botAi?.level ?? 2;
      this.botSkillCurve = s.botAi?.skillCurve ?? true;
      this.liveDelay = s.live?.delaySec ?? 20;
      this.replayDays = s.live?.replayDays ?? 60;
      // Plain fields (ngModel): without zone.js the view must be told about them.
      this.cdr.markForCheck();
    } catch {
      // the toast shows the error
    }
  }

  protected async saveBotAi() {
    this.busy.set(true);
    try {
      const s = await this.api.setBotAiSettings({
        level: Number(this.botAiLevel),
        skillCurve: !!this.botSkillCurve,
      });
      this.botAiLevel = s.botAi.level;
      this.botSkillCurve = s.botAi.skillCurve;
      this.saved.emit('botAi');
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveLive() {
    this.busy.set(true);
    try {
      const s = await this.api.setLiveSettings({
        delaySec: Number(this.liveDelay),
        replayDays: Number(this.replayDays),
      });
      this.liveDelay = s.live.delaySec;
      this.replayDays = s.live.replayDays;
      this.saved.emit('live');
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
