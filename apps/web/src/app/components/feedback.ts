import { type Choice, Tabs } from './choice';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { TPipe } from '../core/i18n';
import type { SurveyView } from '../core/types';

/** "Later" for a season's survey, per browser tab (it asks again on the next visit). */
const LATER_KEY = 'tourney.surveyLater';

function laterFor(season: number): boolean {
  try {
    return sessionStorage.getItem(LATER_KEY) === String(season);
  } catch {
    return false;
  }
}

function setLater(season: number): void {
  try {
    sessionStorage.setItem(LATER_KEY, String(season));
  } catch {
    // private window: it may ask again
  }
}

/** Areas of a note (as the API knows them). */
const AREAS = ['dreamTeam', 'league', 'tournaments', 'bets', 'website', 'other'] as const;

/**
 * Feedback (decision 245): the season survey and notes. While a survey waits for the user
 * (`me.survey`) it opens once per visit - not on a visit that shows the patch notes - and
 * "Later" waits for the next visit; the footer link opens a note, with the survey as a second
 * tab while it is open for the user.
 */
@Component({
  selector: 'na-feedback',
  imports: [Tabs, TPipe, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="fb" aria-labelledby="fb-title" (close)="closed()">
      @if (mode(); as m) {
        <header>
          <h2 id="fb-title" class="disp">
            {{ (m === 'survey' ? 'fb.survey.title' : 'fb.note.title') | t: { n: season() } }}
          </h2>
          @if (canSurvey()) {
            <na-tabs
              [options]="modeTabs"
              [value]="m"
              (valueChange)="mode.set($event)"
              label="fb.tabs"
            />
          }
          <p class="muted small">
            {{ (m === 'survey' ? 'fb.survey.text' : 'fb.note.text') | t }}
          </p>
        </header>
        @if (m === 'survey' && view(); as v) {
          <div class="body">
            @for (q of v.questions; track q.id) {
              <fieldset>
                <legend>{{ 'fb.q.' + q.id | t }}</legend>
                <div class="seg">
                  @if (q.kind === 'scale') {
                    @for (n of scale; track n) {
                      <button
                        type="button"
                        [class.on]="answers()[q.id] === n"
                        [attr.aria-pressed]="answers()[q.id] === n"
                        (click)="pick(q.id, n)"
                      >
                        {{ n }}
                      </button>
                    }
                  } @else {
                    @for (o of q.options ?? []; track o) {
                      <button
                        type="button"
                        [class.on]="answers()[q.id] === o"
                        [attr.aria-pressed]="answers()[q.id] === o"
                        (click)="pick(q.id, o)"
                      >
                        {{ 'fb.o.' + q.id + '.' + o | t }}
                      </button>
                    }
                  }
                </div>
                @if (q.kind === 'scale') {
                  <span class="muted small">{{ 'fb.scale' | t }}</span>
                }
              </fieldset>
            }
            @for (k of v.texts; track k) {
              <label class="txt"
                >{{ 'fb.t.' + k | t }}
                <textarea
                  rows="2"
                  maxlength="2000"
                  [name]="'fb-' + k"
                  [ngModel]="texts()[k] ?? ''"
                  (ngModelChange)="setText(k, $event)"
                ></textarea>
              </label>
            }
          </div>
          <div class="foot">
            @if (v.answer) {
              <span class="muted small grow">{{ 'fb.survey.saved' | t }}</span>
            }
            <button type="button" class="link" (click)="later()">
              {{ (v.answer ? 'common.close' : 'fb.later') | t }}
            </button>
            <button type="button" class="primary" [disabled]="busy()" (click)="sendSurvey()">
              {{ (v.answer ? 'fb.survey.update' : 'fb.survey.send') | t }}
            </button>
          </div>
        } @else if (m === 'note') {
          <div class="body">
            <label
              >{{ 'fb.note.area' | t }}
              <select name="fb-area" [(ngModel)]="area">
                @for (a of areas; track a) {
                  <option [ngValue]="a">{{ 'fb.area.' + a | t }}</option>
                }
              </select>
            </label>
            <label class="txt"
              >{{ 'fb.note.label' | t }}
              <textarea
                rows="6"
                maxlength="2000"
                name="fb-note"
                [(ngModel)]="note"
                [placeholder]="'fb.note.placeholder' | t"
              ></textarea>
            </label>
          </div>
          <div class="foot">
            <button type="button" class="link" (click)="close()">{{ 'common.cancel' | t }}</button>
            <button
              type="button"
              class="primary"
              [disabled]="busy() || note.trim().length < 3"
              (click)="sendNote()"
            >
              {{ 'fb.note.send' | t }}
            </button>
          </div>
        }
      }
    </dialog>
  `,
  styles: `
    .fb {
      width: min(640px, calc(100vw - 24px));
      max-height: min(86vh, 820px);
      padding: 0;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      color: var(--text);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    }
    .fb[open] {
      display: flex;
      flex-direction: column;
    }
    .fb::backdrop {
      background: rgba(4, 6, 10, 0.72);
      backdrop-filter: blur(2px);
    }
    header {
      padding: 20px 22px 8px;
      display: grid;
      gap: 10px;
    }
    h2 {
      margin: 0;
      color: var(--accent);
    }
    header p {
      margin: 0;
    }
    .tabs {
      margin-bottom: 0;
    }
    .body {
      overflow-y: auto;
      padding: 4px 22px 12px;
      display: grid;
      gap: 14px;
    }
    fieldset {
      border: 0;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 6px;
      justify-items: start;
    }
    legend {
      padding: 0;
      margin-bottom: 6px;
      font-weight: 600;
    }
    .seg button {
      min-height: 32px;
      padding: 4px 12px;
    }
    label {
      display: grid;
      gap: 6px;
      font-weight: 600;
    }
    textarea {
      width: 100%;
      resize: vertical;
      font: inherit;
      font-weight: 400;
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 12px;
      padding: 12px 22px 18px;
      border-top: 1px solid var(--line);
      flex-wrap: wrap;
    }
    .grow {
      flex: 1;
    }
    @media (max-width: 480px) {
      header,
      .body,
      .foot {
        padding-left: 16px;
        padding-right: 16px;
      }
      .seg button {
        padding: 4px 9px;
        font-size: var(--fs-sm);
      }
    }
  `,
})
export class Feedback {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly mode = signal<'survey' | 'note' | null>(null);
  protected readonly modeTabs: Choice<'survey' | 'note'>[] = [
    { value: 'survey', label: 'fb.tab.survey' },
    { value: 'note', label: 'fb.tab.note' },
  ];
  protected readonly view = signal<SurveyView | null>(null);
  protected readonly answers = signal<Record<string, number | string>>({});
  protected readonly texts = signal<Record<string, string>>({});
  protected readonly busy = signal(false);
  protected readonly scale = [1, 2, 3, 4, 5];
  protected readonly areas = AREAS;
  protected area: (typeof AREAS)[number] = 'dreamTeam';
  protected note = '';
  /** The automatic check ran for this user. */
  private checked: string | null = null;
  private readonly ready = signal(false);

  protected readonly season = computed(() => this.view()?.season ?? '');
  protected readonly canSurvey = computed(() => {
    const v = this.view();
    return !!v && v.open && v.eligible;
  });

  constructor() {
    void this.auth.ready().then(() => this.ready.set(true));
    // Once per visit: a waiting survey opens, unless the patch notes show on this visit.
    effect(() => {
      const me = this.auth.me();
      if (!this.ready() || !me || this.checked === me.id) return;
      this.checked = me.id;
      const latest = this.auth.config().patchLatest ?? 0;
      const patchFirst = (me.patchSeen ?? latest) < latest;
      const s = me.survey;
      if (!s || patchFirst || laterFor(s.season)) return;
      untracked(() => void this.openSurvey());
    });
    effect(() => {
      const d = this.dlg()?.nativeElement;
      if (!d) return;
      if (this.mode() && !d.open) d.showModal();
      else if (!this.mode() && d.open) d.close();
    });
  }

  /** From the footer: a note (the survey as a tab while it is open for the user). */
  openNote(): void {
    this.mode.set('note');
    void this.load();
  }

  private async openSurvey(): Promise<void> {
    await this.load();
    if (this.canSurvey()) this.mode.set('survey');
  }

  private async load(): Promise<void> {
    try {
      const v = await this.api.feedbackSurvey();
      this.view.set(v);
      this.answers.set({ ...(v.answer?.answers ?? {}) });
      this.texts.set({ ...(v.answer?.texts ?? {}) });
    } catch {
      this.view.set(null);
    }
  }

  protected pick(id: string, value: number | string): void {
    this.answers.update((a) => {
      const next = { ...a };
      // Tapping the chosen answer again takes it back.
      if (next[id] === value) delete next[id];
      else next[id] = value;
      return next;
    });
  }

  protected setText(k: string, v: string): void {
    this.texts.update((t) => ({ ...t, [k]: v }));
  }

  protected later(): void {
    const s = this.view()?.season;
    if (typeof s === 'number' && !this.view()?.answer) setLater(s);
    this.close();
  }

  protected close(): void {
    this.dlg()?.nativeElement.close();
  }

  /** Closed by a button or Escape. */
  protected closed(): void {
    const s = this.view()?.season;
    if (this.mode() === 'survey' && typeof s === 'number' && !this.view()?.answer) setLater(s);
    this.mode.set(null);
  }

  protected async sendSurvey(): Promise<void> {
    this.busy.set(true);
    try {
      const v = await this.api.answerSurvey({ answers: this.answers(), texts: this.texts() });
      this.view.set(v);
      const me = this.auth.me();
      if (me) this.auth.me.set({ ...me, survey: null });
      this.close();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }

  protected async sendNote(): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.sendFeedback({ area: this.area, text: this.note.trim() });
      this.note = '';
      this.close();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
