import { ChangeDetectionStrategy, Component, inject, Injectable, signal } from '@angular/core';
import { TPipe } from './i18n';

export type ToastKind = 'error' | 'success' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
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

  show(kind: ToastKind, text: string): void {
    if (!text) return;
    const same = this.list().find((t) => t.kind === kind && t.text === text);
    if (same) {
      this.arm(same.id, kind);
      return;
    }
    const t: Toast = { id: this.next++, kind, text };
    const all = [...this.list(), t];
    for (const old of all.slice(0, Math.max(0, all.length - MAX))) this.clear(old.id);
    this.list.set(all.slice(-MAX));
    this.arm(t.id, kind);
  }

  error(text: string): void {
    this.show('error', text);
  }

  success(text: string): void {
    this.show('success', text);
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

/** The toast stack (once, in the app shell). */
@Component({
  selector: 'app-toasts',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack" aria-live="polite" aria-relevant="additions">
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
      right: 16px;
      bottom: 16px;
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
}
