import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TPipe } from '../core/i18n';

/**
 * "Nothing here yet" with the next step (decision 302): a calm line in the middle and, where it
 * helps, one link that leads on (`link` + `action`, an i18n key). `<na-empty text="…" />`.
 */
@Component({
  selector: 'na-empty',
  imports: [RouterLink, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p>{{ text() }}</p>
    @if (link(); as l) {
      <a [routerLink]="l">{{ action() | t }} →</a>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 22px 16px;
      text-align: center;
      color: var(--muted);
    }
    p {
      margin: 0;
      max-width: 52ch;
    }
    a {
      font-weight: 600;
    }
  `,
})
export class EmptyState {
  readonly text = input.required<string>();
  /** Where the next step is (router link), with the label `action`. */
  readonly link = input<string | null>(null);
  readonly action = input('');
}
