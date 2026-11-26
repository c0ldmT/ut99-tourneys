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
import { FormsModule } from '@angular/forms';
import { TPipe } from '../core/i18n';

export interface ConfirmOptions {
  /** Destructive (delete, end, abort): the confirm button in red. */
  danger?: boolean;
  /** Label of the confirm button (an i18n key); default "Confirm". */
  ok?: string;
}

export interface PromptOptions extends ConfirmOptions {
  /** The text in the field at the start. */
  value?: string;
  maxLength?: number;
}

interface Question extends ConfirmOptions {
  kind: 'confirm' | 'prompt' | 'tell';
  text: string;
  value?: string;
  maxLength?: number;
  answer: (ok: boolean, value?: string) => void;
}

/**
 * Asks before something that cannot be undone or costs Neuro (decision 299), instead of the
 * browser's own dialog: `if (!(await this.confirm.ask(text, { danger: true }))) return;`.
 * `prompt` asks for a short text (null: cancelled), `tell` only informs (OK). One question at a
 * time; a new one answers the open one with "no".
 */
@Injectable({ providedIn: 'root' })
export class Confirm {
  readonly question = signal<Question | null>(null);

  ask(text: string, options: ConfirmOptions = {}): Promise<boolean> {
    return this.open<boolean>({ ...options, kind: 'confirm', text }, (ok) => ok);
  }

  prompt(text: string, options: PromptOptions = {}): Promise<string | null> {
    return this.open<string | null>({ ...options, kind: 'prompt', text }, (ok, value) =>
      ok ? (value ?? '') : null,
    );
  }

  tell(text: string): Promise<void> {
    return this.open<void>({ kind: 'tell', text, ok: 'notice.ok' }, () => undefined);
  }

  private open<T>(
    q: Omit<Question, 'answer'>,
    result: (ok: boolean, value?: string) => T,
  ): Promise<T> {
    this.question()?.answer(false);
    return new Promise((resolve) => {
      const full: Question = {
        ...q,
        answer: (ok, value) => {
          if (this.question() === full) this.question.set(null);
          resolve(result(ok, value));
        },
      };
      this.question.set(full);
    });
  }
}

/** The dialog of `Confirm` (once, in the app shell). */
@Component({
  selector: 'na-confirm',
  imports: [FormsModule, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="cf" aria-describedby="cf-text" (close)="answer(false)">
      @if (confirm.question(); as q) {
        <form (submit)="$event.preventDefault(); answer(true)">
          <p id="cf-text">{{ q.text }}</p>
          @if (q.kind === 'prompt') {
            <input
              name="cf-value"
              class="val"
              aria-labelledby="cf-text"
              [maxlength]="q.maxLength ?? 200"
              [(ngModel)]="value"
            />
          }
          <div class="foot">
            @if (q.kind !== 'tell') {
              <button type="button" (click)="answer(false)">{{ 'common.cancel' | t }}</button>
            }
            <button type="submit" [class.primary]="!q.danger" [class.danger]="!!q.danger">
              {{ q.ok ?? 'confirm.ok' | t }}
            </button>
          </div>
        </form>
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
    .val {
      width: 100%;
      margin: -6px 0 18px;
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
  protected value = '';

  constructor() {
    effect(() => {
      const d = this.dlg().nativeElement;
      const q = this.confirm.question();
      if (q) {
        this.value = q.value ?? '';
        if (!d.open) d.showModal();
        // A text field gets the focus; destructive: Enter does not delete by accident, the focus
        // starts on Cancel.
        queueMicrotask(() => {
          const field = d.querySelector<HTMLInputElement>('input.val');
          if (field) return field.select();
          d.querySelector<HTMLButtonElement>(
            `.foot button:${q.danger ? 'first' : 'last'}-child`,
          )?.focus();
        });
      } else if (d.open) d.close();
    });
  }

  protected answer(ok: boolean) {
    this.confirm.question()?.answer(ok, this.value);
  }
}
