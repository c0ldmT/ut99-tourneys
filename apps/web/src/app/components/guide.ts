import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  Injectable,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { GUIDES, type GuideDef, type GuideId } from '../core/guides';
import { TPipe } from '../core/i18n';

const SEEN = 'tourney.guide.';

/** The guides on the page shown, so a section can be opened from anywhere (`open(page, id)`). */
@Injectable({ providedIn: 'root' })
export class Guides {
  private readonly shown = new Map<string, Guide>();

  register(page: string, g: Guide): () => void {
    this.shown.set(page, g);
    return () => {
      if (this.shown.get(page) === g) this.shown.delete(page);
    };
  }

  /** Opens the guide of `page` (at `section`); false when the page has none. */
  open(page: GuideId, section?: string): boolean {
    const g = this.shown.get(page);
    g?.open(section);
    return !!g;
  }
}

/**
 * "How it works" of a page (decisions 327–329): a pill button in the page head – violet in the
 * Dream Team, cyan elsewhere, only "?" on phones – with a dot until it was opened once in this
 * browser, and the dialog: one sentence, fact chips, 3–5 steps, sections to unfold. `params`
 * fill the numbers of the texts; `[button]="false"` leaves the opening to the page (the hub).
 */
@Component({
  selector: 'na-guide',
  imports: [RouterLink, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (button()) {
      <button
        type="button"
        class="gbtn"
        [class.dt]="def().area === 'udt'"
        aria-haspopup="dialog"
        [attr.aria-label]="'guide.button' | t"
        (click)="open()"
      >
        <span class="q" aria-hidden="true">?</span><span class="gl">{{ 'guide.button' | t }}</span>
        @if (fresh()) {
          <span class="gdot" [title]="'guide.new' | t"></span>
        }
      </button>
    }
    <dialog
      #dlg
      class="gdlg"
      [class.dt]="def().area === 'udt'"
      [attr.aria-labelledby]="'guide-' + page()"
    >
      <header>
        <h2 [id]="'guide-' + page()">{{ def().title | t: params() }}</h2>
        <button type="button" class="x" [attr.aria-label]="'toast.close' | t" (click)="close()">
          ×
        </button>
      </header>
      <div class="gb">
        <p class="lead">{{ def().lead | t: params() }}</p>
        <ul class="facts" [attr.aria-label]="'guide.facts' | t">
          @for (f of def().facts; track f) {
            <li>{{ f | t: params() }}</li>
          }
        </ul>
        <ol class="steps">
          @for (s of def().steps; track s.title) {
            <li>
              <b>{{ s.title | t: params() }}</b>
              <span
                >{{ s.text | t: params() }}
                @if (s.link) {
                  <a [routerLink]="s.link" (click)="close()">{{ 'guide.go' | t }} →</a>
                }
              </span>
            </li>
          }
        </ol>
        @for (m of def().more ?? []; track m.id) {
          <details [id]="'guide-' + page() + '-' + m.id" [open]="section() === m.id">
            <summary>{{ m.title | t: params() }}</summary>
            @for (x of m.paras; track x.key) {
              @if (!x.needs || params()[x.needs]) {
                <p>
                  @if (x.title) {
                    <b>{{ x.title | t: params() }}</b>
                  }
                  {{ x.key | t: params() }}
                </p>
              }
            }
          </details>
        }
      </div>
      <footer>
        <button type="button" class="primary" (click)="close()">{{ 'guide.ok' | t }}</button>
      </footer>
    </dialog>
  `,
  styles: `
    :host {
      display: contents;
    }
    .gbtn {
      --hc: var(--accent);
      position: relative;
      flex: none;
      align-self: flex-end;
      /* Last in the page head, at its right end. */
      order: 5;
      margin-left: auto;
      gap: 9px;
      min-height: 40px;
      padding: 5px 16px 5px 6px;
      border-color: var(--hc);
      border-radius: var(--radius-pill);
      background: color-mix(in srgb, var(--hc) 12%, var(--panel));
      font-weight: 700;
    }
    .gbtn.dt,
    .gdlg.dt {
      --hc: var(--udt);
    }
    .q {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--hc);
      color: var(--bg);
      font-weight: 800;
    }
    .gdot {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--hot);
      box-shadow: 0 0 0 2px var(--bg);
    }
    @media (max-width: 640px) {
      .gbtn {
        padding: 5px;
      }
      .gl {
        display: none;
      }
    }
    .gdlg {
      --hc: var(--accent);
      width: min(660px, calc(100vw - 24px));
      max-height: min(86vh, 900px);
      padding: 0;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      color: var(--text);
    }
    .gdlg[open] {
      display: flex;
      flex-direction: column;
    }
    .gdlg::backdrop {
      background: color-mix(in srgb, var(--bg) 80%, transparent);
      backdrop-filter: blur(3px);
    }
    header,
    footer {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 18px;
    }
    header {
      border-bottom: 1px solid var(--border);
    }
    footer {
      justify-content: flex-end;
      border-top: 1px solid var(--border);
    }
    h2 {
      margin: 0;
      color: var(--hc);
    }
    .x {
      margin-left: auto;
      width: 44px;
      min-height: 44px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--muted);
      font-size: var(--fs-2xl);
    }
    .gb {
      overflow-y: auto;
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .lead,
    details p {
      margin: 0;
      color: var(--text-2);
    }
    .facts {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .facts li {
      padding: 3px 10px;
      border-radius: var(--radius-pill);
      background: var(--panel-2);
      font-size: var(--fs-sm);
    }
    .steps {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0;
      list-style: none;
      counter-reset: s;
    }
    .steps li {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      gap: 2px 10px;
      counter-increment: s;
    }
    .steps li::before {
      content: counter(s);
      grid-row: span 2;
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: color-mix(in srgb, var(--hc) 25%, transparent);
      color: var(--hc);
      font-weight: 800;
    }
    .steps span {
      color: var(--text-2);
    }
    details {
      border-top: 1px solid var(--border);
      padding-top: 10px;
    }
    details p {
      margin-top: 6px;
      font-size: var(--fs-md);
    }
    summary {
      cursor: pointer;
      color: var(--accent);
      font-weight: 600;
    }
  `,
})
export class Guide {
  readonly page = input.required<GuideId>();
  /** Numbers of the texts ({fee}, {n}, …). */
  readonly params = input<Record<string, string | number>>({});
  /** Without the button: the page opens it (the hub's centre). */
  readonly button = input(true);
  protected readonly def = computed((): GuideDef => GUIDES[this.page()]);
  /** Not opened yet in this browser: the dot. */
  protected readonly fresh = signal(false);
  /** The section opened by `open(section)`. */
  protected readonly section = signal<string | null>(null);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  constructor() {
    const guides = inject(Guides);
    let off: (() => void) | null = null;
    queueMicrotask(() => {
      off = guides.register(this.page(), this);
      this.fresh.set(!seen(this.page()));
    });
    inject(DestroyRef).onDestroy(() => off?.());
  }

  open(section?: string): void {
    this.section.set(section ?? null);
    const d = this.dlg().nativeElement;
    if (!d.open) d.showModal();
    try {
      localStorage.setItem(SEEN + this.page(), '1');
    } catch {
      // storage unavailable
    }
    this.fresh.set(false);
    if (section)
      setTimeout(() =>
        d
          .querySelector(`#guide-${this.page()}-${section}`)
          ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      );
  }

  close(): void {
    this.dlg().nativeElement.close();
  }
}

function seen(page: string): boolean {
  try {
    return localStorage.getItem(SEEN + page) === '1';
  } catch {
    return true;
  }
}
