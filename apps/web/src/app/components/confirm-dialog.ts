import {
  ChangeDetectionStrategy,
  Component,
  effect,
  type ElementRef,
  inject,
  Injectable,
  signal,
  viewChild,
} from '@angular/core';
import { TPipe } from '../core/i18n';

export interface ConfirmOptions {
  /** Destructive (delete, end, abort): the confirm button in red. */
  danger?: boolean;
  /** Label of the confirm button (an i18n key); default "Confirm". */
  ok?: string;
}

interface Question extends ConfirmOptions {
  text: string;
  answer: (ok: boolean) => void;
}

/**
 * Asks before something that cannot be undone or costs Neuro (decision 299), instead of the
 * browser's own dialog: `if (!(await this.confirm.ask(text, { danger: true }))) return;`.
 * One question at a time; a new one answers the open one with "no".
 */
@Injectable({ providedIn: 'root' })
export class Confirm {
  readonly question = signal<Question | null>(null);

  ask(text: string, options: ConfirmOptions = {}): Promise<boolean> {
    this.question()?.answer(false);
    return new Promise((resolve) => {
      const q: Question = {
        ...options,
        text,
        answer: (ok) => {
          if (this.question() === q) this.question.set(null);
          resolve(ok);
        },
      };
      this.question.set(q);
    });
  }
}

/** The dialog of `Confirm` (once, in the app shell). */
@Component({
  selector: 'na-confirm',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="cf" aria-describedby="cf-text" (close)="answer(false)">
      @if (confirm.question(); as q) {
        <p id="cf-text">{{ q.text }}</p>
        <div class="foot">
          <button type="button" (click)="answer(false)">{{ 'common.cancel' | t }}</button>
          <button
            type="button"
            [class.primary]="!q.danger"
            [class.danger]="!!q.danger"
            (click)="answer(true)"
          >
            {{ q.ok ?? 'confirm.ok' | t }}
          </button>
        </div>
      }
    </dialog>
  `,
  styles: `
    .cf {
      width: min(460px, calc(100vw - 24px));
      padding: 20px 22px 18px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      color: var(--text);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    }
    .cf::backdrop {
      background: rgba(4, 6, 10, 0.72);
      backdrop-filter: blur(2px);
    }
    p {
      margin: 0 0 18px;
      white-space: pre-line;
      line-height: 1.5;
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 8px;
    }
  `,
})
export class ConfirmDialog {
  protected readonly confirm = inject(Confirm);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    effect(() => {
      const d = this.dlg().nativeElement;
      const q = this.confirm.question();
      if (q) {
        if (!d.open) d.showModal();
        // Destructive: Enter does not delete by accident, the focus starts on Cancel.
        queueMicrotask(() =>
          d
            .querySelector<HTMLButtonElement>(`.foot button:${q.danger ? 'first' : 'last'}-child`)
            ?.focus(),
        );
      } else if (d.open) d.close();
    });
  }

  protected answer(ok: boolean) {
    this.confirm.question()?.answer(ok);
  }
}
