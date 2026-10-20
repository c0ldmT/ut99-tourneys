import { ChangeDetectionStrategy, Component, type ElementRef, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TPipe } from '../core/i18n';

/** Remembered per browser: the help opened once by itself. */
const SEEN = 'tourney.udtHelpSeen';

/** The ways to new bots, each with the page that does it. */
const WAYS = [
  { key: 'market', link: '/udt/market' },
  { key: 'academy', link: '/udt/academy' },
  { key: 'packs', link: '/udt/packs' },
  { key: 'trades', link: '/udt/trades' },
] as const;

/**
 * "How the Dream Team works": a dialog for new managers (team, the four ways to new bots,
 * lineup, tournaments, Neuro). The Dream Team navigation has its button; it opens by itself the
 * first time a browser shows the Dream Team.
 */
@Component({
  selector: 'udt-help',
  imports: [RouterLink, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="help" aria-labelledby="udt-help-title" (close)="closed()">
      <div class="head">
        <h2 id="udt-help-title" class="disp">{{ 'udt.help.title' | t }}</h2>
        <button type="button" class="x" [attr.aria-label]="'toast.close' | t" (click)="close()">
          ×
        </button>
      </div>
      <div class="body">
        <p class="lead">{{ 'udt.help.intro' | t }}</p>
        <ol class="steps">
          <li>
            <h3>{{ 'udt.help.team.title' | t }}</h3>
            <p>{{ 'udt.help.team.text' | t }}</p>
          </li>
          <li class="key">
            <h3>{{ 'udt.help.bots.title' | t }}</h3>
            <p>{{ 'udt.help.bots.text' | t }}</p>
            <ul class="ways">
              @for (w of ways; track w.key) {
                <li>
                  <a [routerLink]="w.link" (click)="close()"
                    ><b>{{ 'udt.help.way.' + w.key + '.title' | t }}</b></a
                  >
                  <span>{{ 'udt.help.way.' + w.key + '.text' | t }}</span>
                </li>
              }
            </ul>
            <p class="muted small">{{ 'udt.help.bots.roster' | t }}</p>
          </li>
          <li>
            <h3>{{ 'udt.help.lineup.title' | t }}</h3>
            <p>{{ 'udt.help.lineup.text' | t }}</p>
          </li>
          <li>
            <h3>{{ 'udt.help.events.title' | t }}</h3>
            <p>{{ 'udt.help.events.text' | t }}</p>
          </li>
          <li>
            <h3>{{ 'udt.help.neuro.title' | t }}</h3>
            <p>{{ 'udt.help.neuro.text' | t }}</p>
          </li>
        </ol>
      </div>
      <div class="foot">
        <button type="button" class="primary" (click)="close()">
          {{ 'udt.help.go' | t }}
        </button>
      </div>
    </dialog>
  `,
  styles: `
    .help {
      width: min(680px, calc(100vw - 24px));
      max-height: min(86vh, 900px);
      padding: 0;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      color: var(--text);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    }
    .help[open] {
      display: flex;
      flex-direction: column;
    }
    .help::backdrop {
      background: rgba(4, 6, 10, 0.72);
      backdrop-filter: blur(2px);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 20px 10px;
      border-bottom: 1px solid var(--border);
    }
    .head h2 {
      margin: 0;
      color: var(--udt, var(--accent));
    }
    .x {
      background: none;
      border: none;
      color: var(--muted);
      font-size: 1.6rem;
      line-height: 1;
      cursor: pointer;
    }
    .x:hover {
      color: var(--text);
    }
    .body {
      overflow-y: auto;
      padding: 14px 20px;
    }
    .lead {
      margin-top: 0;
      color: var(--text-2);
    }
    .steps {
      margin: 0;
      padding-left: 1.4em;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .steps > li::marker {
      font-weight: 800;
      color: var(--udt, var(--accent));
    }
    .steps h3 {
      margin: 0 0 4px;
      font-size: 1.05rem;
    }
    .steps p {
      margin: 0;
    }
    .key {
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
    }
    .ways {
      list-style: none;
      margin: 8px 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    .ways li {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-left: 10px;
      border-left: 3px solid var(--udt, var(--accent));
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      padding: 12px 20px 16px;
      border-top: 1px solid var(--border);
    }
  `,
})
export class UdtHelp {
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly ways = WAYS;

  open(): void {
    const d = this.dlg().nativeElement;
    if (!d.open) d.showModal();
  }

  close(): void {
    this.dlg().nativeElement.close();
  }

  /** Opens once per browser by itself (the first Dream Team page a manager sees). */
  openFirstTime(): void {
    try {
      if (localStorage.getItem(SEEN)) return;
    } catch {
      return; // no storage: only the button opens it
    }
    this.open();
  }

  protected closed(): void {
    try {
      localStorage.setItem(SEEN, '1');
    } catch {
      // storage unavailable
    }
  }
}
