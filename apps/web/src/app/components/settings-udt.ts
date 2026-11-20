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
import { I18n, TPipe } from '../core/i18n';
import type { FeedbackAdmin, UdtSettings } from '../core/types';
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
        <button type="button" [disabled]="busy()" (click)="report('skill')">
          {{ 'trait.report.skill' | t }}
        </button>
        <button type="button" [disabled]="busy()" (click)="report('maps')">
          {{ 'trait.report.maps' | t }}
        </button>
      </div>
    </section>
    <section class="card">
      <h2>{{ 'fb.admin.title' | t }}</h2>
      <p class="muted small">{{ 'fb.admin.hint' | t }}</p>
      @if (fb(); as f) {
        <p>
          @if (f.open) {
            {{ 'fb.admin.open' | t: { n: f.season ?? '', at: i18n.date(f.openedAt) } }}
          } @else if (f.openedAt) {
            {{ 'fb.admin.closed' | t: { n: f.season ?? '' } }}
          } @else {
            {{ 'fb.admin.none' | t: { n: f.season ?? '–' } }}
          }
          <br /><span class="muted small">{{
            'fb.admin.counts' | t: { a: f.answers, m: f.managers, n: f.notes }
          }}</span>
        </p>
        <div class="row gap">
          <button
            type="button"
            [class.primary]="!f.open"
            [disabled]="busy() || f.season === null"
            (click)="survey(!f.open)"
          >
            {{ (f.open ? 'fb.admin.closeBtn' : 'fb.admin.openBtn') | t }}
          </button>
          <button type="button" [disabled]="busy()" (click)="feedbackCsv('survey')">
            {{ 'fb.admin.surveyCsv' | t }}
          </button>
          <button type="button" [disabled]="busy()" (click)="feedbackCsv('notes')">
            {{ 'fb.admin.notesCsv' | t }}
          </button>
        </div>
      }
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

  /** Season survey and feedback (decision 245). */
  protected readonly fb = signal<FeedbackAdmin | null>(null);
  protected readonly i18n = inject(I18n);

  constructor() {
    void this.load();
    this.api
      .feedbackAdmin()
      .then((f) => this.fb.set(f))
      .catch(() => {
        // the toast shows the error
      });
  }

  protected async survey(open: boolean) {
    this.busy.set(true);
    try {
      this.fb.set(await this.api.setSurvey(open));
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }

  /** Survey answers or messages as CSV (no names: managers are numbered). */
  protected async feedbackCsv(what: 'survey' | 'notes') {
    this.busy.set(true);
    try {
      const x = await this.api.feedbackExport(this.fb()?.season ?? undefined);
      const rows: Record<string, unknown>[] =
        what === 'survey'
          ? x.survey.map((r) => ({
              manager: r.manager,
              createdAt: r.createdAt,
              updatedAt: r.updatedAt,
              ...Object.fromEntries(x.questions.map((q) => [q, r.answers[q] ?? ''])),
              ...Object.fromEntries(x.texts.map((k) => [k, r.texts[k] ?? ''])),
            }))
          : x.notes.map((n) => ({ ...n, season: n.season ?? '' }));
      download(
        csv(rows),
        what === 'survey' ? `survey-season-${x.season ?? 0}.csv` : 'feedback-messages.csv',
        'text/csv',
      );
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Downloads the trait report of a season: rows as CSV (for a review) or everything as JSON;
   * mod 0.19.0 (decision 257): the bots' measures per skill and the suicides per map as CSV.
   */
  protected async report(format: 'csv' | 'json' | 'skill' | 'maps') {
    this.busy.set(true);
    try {
      const r = await this.api.udtTraitReport(this.reportSeason ?? undefined);
      const rows =
        format === 'skill'
          ? (r.measures?.bySkill ?? [])
          : format === 'maps'
            ? (r.measures?.byMap ?? [])
            : r.rows;
      const name =
        format === 'skill'
          ? 'measures-skill'
          : format === 'maps'
            ? 'suicides-maps'
            : 'trait-report';
      download(
        format === 'json'
          ? JSON.stringify(r, null, 2)
          : csv(rows, rows.length ? undefined : ['season']),
        `${name}-season-${r.season}.${format === 'json' ? 'json' : 'csv'}`,
        format === 'json' ? 'application/json' : 'text/csv',
      );
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

/** CSV for spreadsheets: quoted fields, no formulas, a BOM for umlauts in Excel. */
function csv(rows: readonly Record<string, unknown>[], columns?: string[]): string {
  const cell = (v: unknown) => {
    const s = String(v ?? '').replace(/[\r\n]+/g, ' ');
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const head = columns ?? Object.keys(rows[0] ?? {});
  return (
    '\uFEFF' +
    [head.map(cell).join(';'), ...rows.map((x) => head.map((k) => cell(x[k])).join(';'))].join(
      '\r\n',
    )
  );
}

function download(body: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
