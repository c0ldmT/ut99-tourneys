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
import { Auth } from '../core/auth';
import { TPipe } from '../core/i18n';
import type { UdtSettings } from '../core/types';
import { SETTINGS_STYLES, type SettingsForm } from './settings-shared';

/** Settings tab "Dream Team": the module switch, market, starter, trading and AI managers. */
@Component({
  selector: 'app-settings-udt',
  imports: [FormsModule, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="card" data-form="udt" (ngSubmit)="saveUdt()">
      <h2>{{ 'udt.settings.title' | t }}</h2>
      <p class="muted small">{{ 'udt.settings.hint' | t }}</p>
      <label class="switch"
        ><input type="checkbox" name="udtOn" [(ngModel)]="udtOn" /><span class="tr"></span
        >{{ 'udt.settings.enabled' | t }}</label
      >
      <div class="row gap">
        <label
          >{{ 'udt.settings.marketTime' | t }}
          <input type="time" name="udtTime" [(ngModel)]="udtTime" class="narrow" />
        </label>
        <label
          >{{ 'udt.settings.offers' | t }}
          <input
            type="number"
            name="udtOffers"
            min="1"
            max="40"
            [(ngModel)]="udtOffers"
            class="narrow"
          />
        </label>
        <label
          >{{ 'udt.settings.budget' | t }}
          <input
            type="number"
            name="udtBudget"
            min="100"
            step="100"
            [(ngModel)]="udtBudget"
            class="narrow"
          />
        </label>
        <label
          >{{ 'udt.settings.extra' | t }}
          <input
            type="number"
            name="udtExtra"
            min="0"
            step="50"
            [(ngModel)]="udtExtra"
            class="narrow"
          />
        </label>
      </div>
      <h3>{{ 'udt.settings.trade' | t }}</h3>
      <label class="switch"
        ><input type="checkbox" name="tradeOn" [(ngModel)]="trade.tradeEnabled" /><span
          class="tr"
        ></span
        >{{ 'udt.settings.tradeOn' | t }}</label
      >
      <div class="row gap">
        <label
          >{{ 'udt.settings.tradeFee' | t }}
          <input
            type="number"
            name="tradeFee"
            min="0"
            max="50"
            [(ngModel)]="trade.tradeFeePct"
            class="narrow"
          />
        </label>
        <label
          >{{ 'udt.settings.tradeBalance' | t }}
          <input
            type="number"
            name="tradeBalance"
            min="0"
            max="100"
            [(ngModel)]="trade.tradeBalancePct"
            class="narrow"
          />
        </label>
        <label
          >{{ 'udt.settings.tradeLock' | t }}
          <input
            type="number"
            name="tradeLock"
            min="0"
            max="30"
            [(ngModel)]="trade.tradeLockDays"
            class="narrow"
          />
        </label>
        <label
          >{{ 'udt.settings.tradeExpiry' | t }}
          <input
            type="number"
            name="tradeExpiry"
            min="1"
            max="336"
            [(ngModel)]="trade.tradeExpiryHours"
            class="narrow"
          />
        </label>
        <label
          >{{ 'udt.settings.tradePair' | t }}
          <input
            type="number"
            name="tradePair"
            min="0"
            max="50"
            [(ngModel)]="trade.tradePairPerWeek"
            class="narrow"
          />
        </label>
      </div>
      <p class="muted small">{{ 'udt.settings.tradeHint' | t }}</p>
      <h3>{{ 'udt.settings.ai' | t }}</h3>
      <label class="switch"
        ><input type="checkbox" name="aiOn" [(ngModel)]="ai.aiEnabled" /><span class="tr"></span
        >{{ 'udt.settings.aiOn' | t }}</label
      >
      <div class="row gap">
        <label
          >{{ 'udt.settings.aiCount' | t }}
          <input
            type="number"
            name="aiCount"
            min="0"
            max="8"
            [(ngModel)]="ai.aiCount"
            class="narrow"
          />
        </label>
        <label
          >{{ 'udt.settings.aiStrength' | t }}
          <select name="aiStrength" [(ngModel)]="ai.aiStrength">
            @for (s of aiStrengths; track s) {
              <option [ngValue]="s">{{ 'udt.settings.aiStrength.' + s | t }}</option>
            }
          </select>
        </label>
      </div>
      <p class="muted small">{{ 'udt.settings.aiHint' | t }}</p>
      <div class="row">
        <button type="submit" class="primary" [disabled]="busy()">{{ 'common.save' | t }}</button>
      </div>
    </form>
    <section class="card">
      <h2>{{ 'trait.report.title' | t }}</h2>
      <p class="muted small">{{ 'trait.report.hint' | t }}</p>
      <div class="row gap">
        <label
          >{{ 'trait.report.season' | t }}
          <input
            type="number"
            min="1"
            name="trSeason"
            [(ngModel)]="reportSeason"
            [placeholder]="'trait.report.current' | t"
            class="narrow"
          />
        </label>
        <button type="button" [disabled]="busy()" (click)="report('csv')">
          {{ 'trait.report.csv' | t }}
        </button>
        <button type="button" [disabled]="busy()" (click)="report('json')">
          {{ 'trait.report.json' | t }}
        </button>
      </div>
    </section>
  `,
  styles: [SETTINGS_STYLES],
})
export class SettingsUdt {
  private readonly api = inject(Api);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly auth = inject(Auth);
  /** A form was saved (the page drops its "unsaved" mark). */
  readonly saved = output<SettingsForm>();
  protected readonly busy = signal(false);
  protected udtOn = false;
  protected ai = pickAi({});
  protected readonly aiStrengths = ['calm', 'normal', 'ambitious'] as const;
  protected trade = pickTrade({});
  protected udtTime = '04:00';
  protected udtOffers = 8;
  protected udtBudget = 1500;
  protected udtExtra = 50;
  /** Trait report (decision 237): empty = the running season. */
  protected reportSeason: number | null = null;

  constructor() {
    void this.load();
  }

  /** Downloads the trait report of a season: rows as CSV (for a review) or everything as JSON. */
  protected async report(format: 'csv' | 'json') {
    this.busy.set(true);
    try {
      const r = await this.api.udtTraitReport(this.reportSeason ?? undefined);
      // CSV for spreadsheets: quoted fields, no formulas, a BOM for umlauts in Excel.
      const cell = (v: unknown) => {
        const s = String(v).replace(/[\r\n]+/g, ' ');
        return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
      };
      const body =
        format === 'json'
          ? JSON.stringify(r, null, 2)
          : '\uFEFF' +
            [
              Object.keys(r.rows[0] ?? { season: 0 })
                .map(cell)
                .join(';'),
              ...r.rows.map((x) => Object.values(x).map(cell).join(';')),
            ].join('\r\n');
      const url = URL.createObjectURL(
        new Blob([body], { type: format === 'json' ? 'application/json' : 'text/csv' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `trait-report-season-${r.season}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }

  private async load() {
    try {
      const s = await this.api.settings();
      if (!s.udt) return;
      this.udtOn = s.udt.enabled;
      this.udtTime = s.udt.marketTime;
      this.udtOffers = s.udt.offersPerDay;
      this.udtBudget = s.udt.starterBudget;
      this.udtExtra = s.udt.starterExtra ?? 50;
      this.trade = pickTrade(s.udt);
      this.ai = pickAi(s.udt);
      // Plain fields (ngModel): without zone.js the view must be told about them.
      this.cdr.markForCheck();
    } catch {
      // the toast shows the error
    }
  }

  protected async saveUdt() {
    this.busy.set(true);
    try {
      const s = await this.api.setUdtSettings({
        enabled: this.udtOn,
        marketTime: this.udtTime,
        offersPerDay: Math.round(Number(this.udtOffers)),
        starterBudget: Math.round(Number(this.udtBudget)),
        starterExtra: Math.max(0, Math.round(Number(this.udtExtra))),
        ...Object.fromEntries(
          Object.entries(this.trade).map(([k, v]) => [
            k,
            typeof v === 'boolean' ? v : Math.round(Number(v)),
          ]),
        ),
        aiEnabled: this.ai.aiEnabled,
        aiCount: Math.max(0, Math.min(8, Math.round(Number(this.ai.aiCount) || 0))),
        aiStrength: this.ai.aiStrength,
      });
      this.trade = pickTrade(s.udt);
      this.ai = pickAi(s.udt);
      this.udtOn = s.udt.enabled;
      // The menu shows the Dream Team at once.
      this.auth.config.update((c) => ({ ...c, udt: s.udt.enabled }));
      this.saved.emit('udt');
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}

/** The trade fields of the Dream Team settings. */
function pickTrade(u: Partial<UdtSettings>) {
  return {
    tradeEnabled: u.tradeEnabled ?? true,
    tradeFeePct: u.tradeFeePct ?? 5,
    tradeBalancePct: u.tradeBalancePct ?? 50,
    tradeLockDays: u.tradeLockDays ?? 3,
    tradeExpiryHours: u.tradeExpiryHours ?? 48,
    tradePairPerWeek: u.tradePairPerWeek ?? 2,
  };
}

/** The AI manager fields of the Dream Team settings. */
function pickAi(u: Partial<UdtSettings>) {
  return {
    aiEnabled: u.aiEnabled ?? false,
    aiCount: u.aiCount ?? 4,
    aiStrength: u.aiStrength ?? ('normal' as UdtSettings['aiStrength']),
  };
}
