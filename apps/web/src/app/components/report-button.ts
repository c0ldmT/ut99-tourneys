import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { Icon } from '../core/brand';
import { TPipe } from '../core/i18n';
import type { ModKind } from '../core/types';

/** Reasons a player picks (the moderators see the text). */
const REASONS = ['insult', 'hate', 'sexual', 'spam', 'other'] as const;

/**
 * "Report" (decision 283): a small flag button next to a name, a team, a bot or a message; it
 * opens a dialog with a reason and an optional note, and the text goes into the moderators'
 * queue.
 */
@Component({
  selector: 'na-report',
  imports: [FormsModule, TPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="icon rp"
      [title]="'mod.report.title' | t"
      [attr.aria-label]="'mod.report.aria' | t: { what: what()[0]?.label ?? '' }"
      (click)="$event.stopPropagation(); $event.preventDefault(); open()"
    >
      <na-icon name="flag" [size]="15" />
    </button>
    <dialog #dlg class="rpd" aria-labelledby="rp-title" (close)="busy.set(false)">
      <form method="dialog" (submit)="$event.preventDefault(); send()">
        <h2 id="rp-title" class="disp">{{ 'mod.report.title' | t }}</h2>
        @if (what().length > 1) {
          <fieldset>
            @for (w of what(); track $index; let i = $index) {
              <label class="opt"
                ><input type="radio" name="what" [value]="i" [(ngModel)]="pick" />
                {{ w.label }}</label
              >
            }
          </fieldset>
        } @else {
          <p class="muted small">{{ 'mod.report.text' | t: { what: what()[0]?.label ?? '' } }}</p>
        }
        <fieldset>
          @for (r of reasons; track r) {
            <label class="opt"
              ><input type="radio" name="reason" [value]="r" [(ngModel)]="reason" />
              {{ 'mod.reason.' + r | t }}</label
            >
          }
        </fieldset>
        <textarea
          name="note"
          rows="3"
          maxlength="200"
          [(ngModel)]="note"
          [placeholder]="'mod.report.note' | t"
        ></textarea>
        <div class="row">
          <button type="button" (click)="close()">{{ 'common.cancel' | t }}</button>
          <button type="submit" class="primary" [disabled]="busy()">
            {{ 'mod.report.send' | t }}
          </button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .rp {
      opacity: 0.55;
      vertical-align: middle;
    }
    .rp:hover,
    .rp:focus-visible {
      opacity: 1;
      color: var(--danger, #ff6b6b);
    }
    /* The button often sits in a heading: the dialog does not take its look. */
    .rpd {
      font: 400 15.5px/1.5 var(--font);
      text-transform: none;
      letter-spacing: normal;
      font-style: normal;
      width: min(420px, calc(100vw - 24px));
      padding: 20px 22px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      color: var(--text);
      text-align: left;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    }
    .rpd::backdrop {
      background: rgba(4, 6, 10, 0.72);
    }
    h2 {
      margin: 0 0 6px;
      color: var(--accent);
    }
    fieldset {
      border: 0;
      padding: 0;
      margin: 12px 0;
      display: grid;
      gap: 6px;
    }
    .opt {
      display: flex;
      gap: 8px;
      align-items: center;
      font-weight: 500;
    }
    textarea {
      width: 100%;
    }
    .row {
      margin-top: 12px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  `,
})
export class ReportButton {
  private readonly api = inject(Api);
  readonly kind = input<ModKind | null>(null);
  readonly ref = input('');
  /** What is reported, for the dialog ("the name Xan"). */
  readonly label = input('');
  /** Several things to choose from (a bot: its name, its chat lines, its team). */
  readonly options = input<{ kind: ModKind; ref: string; label: string }[]>([]);
  protected readonly what = computed(() =>
    this.options().length
      ? this.options()
      : this.kind()
        ? [{ kind: this.kind()!, ref: this.ref(), label: this.label() }]
        : [],
  );
  protected pick = 0;
  protected readonly reasons = REASONS;
  protected reason: (typeof REASONS)[number] = 'insult';
  protected note = '';
  protected readonly busy = signal(false);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  protected open() {
    this.reason = 'insult';
    this.note = '';
    this.pick = 0;
    this.dlg()?.nativeElement.showModal();
  }

  protected close() {
    this.dlg()?.nativeElement.close();
  }

  protected async send() {
    this.busy.set(true);
    try {
      const note = this.note.trim();
      const w = this.what()[Number(this.pick)] ?? this.what()[0];
      if (!w) return;
      await this.api.report(w.kind, w.ref, note ? `${this.reason}: ${note}` : this.reason);
      this.close();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
