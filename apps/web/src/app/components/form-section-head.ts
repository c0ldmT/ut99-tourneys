import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TPipe } from '../core/i18n';

/**
 * The head of a numbered section of a long form (the tournament form, decision 324): number and
 * title; in compact mode a button that opens the section and, while it is closed, shows its
 * settings in one line with "Change". `locked` adds a lock (settings fixed after the draw).
 */
@Component({
  selector: 'na-sec-head',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (compact()) {
      <button
        type="button"
        class="sh link"
        [class.lock]="locked()"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="controls() || null"
        (click)="toggle.emit()"
      >
        <span class="no">{{ n() }}</span
        ><span>{{ title() | t }}</span>
        @if (open()) {
          <span class="chg" aria-hidden="true">▾</span>
        } @else {
          <span class="line">{{ line() }}</span>
          <span class="chg">{{ 'form.change' | t }}</span>
        }
      </button>
    } @else {
      <h2 class="sh" [class.lock]="locked()">
        <span class="no">{{ n() }}</span
        >{{ title() | t }}
      </h2>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .sh {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-start;
      gap: 6px 10px;
      width: 100%;
      margin: 0 0 14px;
      font-family: var(--font-display);
      font-weight: 700;
      font-size: var(--fs-lg);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      text-align: left;
      color: var(--text);
    }
    button.sh[aria-expanded='false'] {
      margin-bottom: 0;
    }
    .lock::after {
      content: '🔒';
      font-size: var(--fs-sm);
    }
    .no {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: 1px solid var(--accent-dim);
      color: var(--accent);
      font-family: var(--font-mono);
      font-size: var(--fs-sm);
    }
    .line,
    .chg {
      font-family: var(--font);
      font-weight: 400;
      letter-spacing: 0;
      text-transform: none;
    }
    .line {
      flex: 1 1 220px;
      font-size: var(--fs-md);
      color: var(--muted);
    }
    .chg {
      margin-left: auto;
      font-size: var(--fs-sm);
      color: var(--accent);
    }
  `,
})
export class FormSectionHead {
  readonly n = input.required<number>();
  /** i18n key of the title. */
  readonly title = input.required<string>();
  /** The section's settings in one line (shown while closed). */
  readonly line = input('');
  readonly compact = input(false);
  readonly open = input(true);
  readonly locked = input(false);
  /** Id of the section's body. */
  readonly controls = input('');
  readonly toggle = output<void>();
}
