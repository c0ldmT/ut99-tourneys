import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injectable,
  signal,
  viewChild,
} from '@angular/core';
import { TPipe } from './i18n';

export type ToastKind = 'error' | 'success' | 'info';

/** A button in the toast (e.g. "Undo"); the toast closes after it ran. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  action?: ToastAction;
}

/** How long a toast stays (ms); errors longer, they may need reading. */
const STAY: Readonly<Record<ToastKind, number>> = { error: 8000, success: 3500, info: 5000 };
/** At most this many at once (the oldest goes). */
const MAX = 4;

/**
 * Short messages at the bottom of the screen: every API error (translated, see `Api`), the
 * success of every action, and hints. A text that is already shown is not shown twice.
 */
@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly list = signal<Toast[]>([]);
  private next = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(kind: ToastKind, text: string, action?: ToastAction): void {
    if (!text) return;
    const same = this.list().find((t) => t.kind === kind && t.text === text);
    if (same) {
      // The newest action counts (e.g. undo the last change).
      if (action) this.list.update((l) => l.map((t) => (t.id === same.id ? { ...t, action } : t)));
      this.arm(same.id, kind);
      return;
    }
    const t: Toast = { id: this.next++, kind, text, ...(action ? { action } : {}) };
    const all = [...this.list(), t];
    for (const old of all.slice(0, Math.max(0, all.length - MAX))) this.clear(old.id);
    this.list.set(all.slice(-MAX));
    this.arm(t.id, kind);
  }

  error(text: string): void {
    this.show('error', text);
  }

  success(text: string, action?: ToastAction): void {
    this.show('success', text, action);
  }

  info(text: string): void {
    this.show('info', text);
  }

  dismiss(id: number): void {
    this.clear(id);
    this.list.update((l) => l.filter((t) => t.id !== id));
  }

  private arm(id: number, kind: ToastKind) {
    this.clear(id);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), STAY[kind]),
    );
  }

  private clear(id: number) {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }
}

/** The topmost open modal dialog, if any. */
function topModal(): HTMLDialogElement | null {
  const open = Array.from(document.querySelectorAll('dialog')).filter((d) => {
    try {
      return d.open && d.matches(':modal');
    } catch {
      return false;
    }
  });
  return open.at(-1) ?? null;
}

/** The toast stack (once, in the app shell). */
@Component({
  selector: 'app-toasts',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #stack class="stack" popover="manual" aria-live="polite" aria-relevant="additions">
      @for (t of toasts.list(); track t.id) {
        <div class="toast {{ t.kind }}" [attr.role]="t.kind === 'error' ? 'alert' : 'status'">
          <span class="ico" aria-hidden="true">
            @switch (t.kind) {
              @case ('error') {
                !
              }
              @case ('success') {
                ✓
              }
              @default {
                i
              }
            }
          </span>
          <span class="txt">{{ t.text }}</span>
          @if (t.action; as a) {
            <button type="button" class="act" (click)="run(t)">{{ a.label }}</button>
          }
          <button
            type="button"
            class="x"
            [attr.aria-label]="'toast.close' | t"
            (click)="toasts.dismiss(t.id)"
          >
            ×
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .stack {
      position: fixed;
      z-index: 60;
      inset: auto 16px 16px auto;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      overflow: visible;
      color: inherit;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: min(420px, calc(100vw - 32px));
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 10px 10px 12px;
      border-radius: var(--radius-sm);
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-left-width: 4px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
      animation: in 0.18s ease-out;
    }
    .toast.error {
      border-color: rgba(255, 92, 108, 0.55);
      border-left-color: var(--danger-strong);
    }
    .toast.success {
      border-color: rgba(74, 222, 128, 0.45);
      border-left-color: var(--live);
    }
    .toast.info {
      border-color: rgba(34, 211, 238, 0.45);
      border-left-color: var(--accent);
    }
    .ico {
      flex: none;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      font-weight: 800;
      font-size: 0.8rem;
      color: var(--bg);
      margin-top: 1px;
    }
    .error .ico {
      background: var(--danger-strong);
    }
    .success .ico {
      background: var(--live);
    }
    .info .ico {
      background: var(--accent);
    }
    .txt {
      flex: 1;
      color: var(--text);
      overflow-wrap: anywhere;
    }
    .act {
      flex: none;
      min-height: 0;
      padding: 2px 10px;
      font-size: 0.85rem;
    }
    .x {
      flex: none;
      background: none;
      border: none;
      color: var(--muted);
      font-size: 1.2rem;
      line-height: 1;
      padding: 0 4px;
      cursor: pointer;
    }
    .x:hover {
      color: var(--text);
    }
    @keyframes in {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .toast {
        animation: none;
      }
    }
  `,
})
export class ToastHost {
  protected readonly toasts = inject(Toasts);
  private readonly stack = viewChild.required<ElementRef<HTMLElement>>('stack');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // A popover lies in the top layer: above an open dialog too. Shown again for every new
    // toast, so it lies above a dialog opened meanwhile.
    effect(() => {
      this.toasts.list();
      this.sync(true);
    });
    // Everything outside a modal dialog is inert, so while one is open the stack moves into it
    // (and back when it closes or goes away).
    if (typeof MutationObserver !== 'undefined') {
      const watch = new MutationObserver(() => this.sync(false));
      watch.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['open'],
      });
      inject(DestroyRef).onDestroy(() => watch.disconnect());
    }
  }

  private sync(again: boolean) {
    const el = this.stack().nativeElement;
    if (typeof el.showPopover !== 'function') return;
    const parent = topModal() ?? this.host.nativeElement;
    const move = el.parentElement !== parent;
    if (!move && !again) return;
    if (el.matches(':popover-open')) el.hidePopover();
    if (move) parent.appendChild(el);
    if (this.toasts.list().length) el.showPopover();
  }

  protected run(t: Toast) {
    this.toasts.dismiss(t.id);
    t.action?.run();
  }
}
