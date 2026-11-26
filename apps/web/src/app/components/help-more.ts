import { ChangeDetectionStrategy, Component, input, type OnInit, signal } from '@angular/core';
import { TPipe } from '../core/i18n';

const KEY = 'tourney.help.';

/**
 * Rules on demand (decision 305): the explanation of a page or section folded under one link,
 * "How it works" by default. Closed until opened; it stays open on the next visit once a player
 * opened it (per `id`, in this browser). `<na-help id="trades">…</na-help>`.
 */
@Component({
  selector: 'na-help',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="help" [open]="open()" (toggle)="toggled($event)">
      <summary>{{ label() || 'help.how' | t }}</summary>
      <div class="body"><ng-content /></div>
    </details>
  `,
  styles: `
    :host {
      display: block;
    }
    details.help {
      margin-top: 8px;
    }
    .body {
      margin-top: 6px;
      max-width: 80ch;
      color: var(--muted);
      font-size: var(--fs-sm);
      line-height: 1.5;
    }
    .body ::ng-deep p {
      margin: 0 0 6px;
    }
  `,
})
export class HelpMore implements OnInit {
  /** Remembers the state under this name (one per page or section). */
  readonly id = input.required<string>();
  /** i18n key of the link; default "How it works". */
  readonly label = input('');
  protected readonly open = signal(false);

  ngOnInit(): void {
    try {
      this.open.set(localStorage.getItem(KEY + this.id()) === '1');
    } catch {
      // storage unavailable
    }
  }

  protected toggled(e: Event): void {
    const now = (e.target as HTMLDetailsElement).open;
    this.open.set(now);
    try {
      if (now) localStorage.setItem(KEY + this.id(), '1');
      else localStorage.removeItem(KEY + this.id());
    } catch {
      // storage unavailable
    }
  }
}
