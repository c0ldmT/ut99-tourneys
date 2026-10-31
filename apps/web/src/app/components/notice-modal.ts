import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { TPipe } from '../core/i18n';
import type { UserNotice } from '../core/types';

/** Kinds with a text; other kinds are marked seen without showing anything. */
const KNOWN = new Set(['blueprint-apology']);

/**
 * Messages the website shows once after login (e.g. the apology for blueprints a full inventory
 * scrapped, with the gift): one modal at a time, oldest first; closing marks it seen.
 */
@Component({
  selector: 'na-notice-modal',
  imports: [RouterLink, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="nm" aria-labelledby="nm-title" (close)="closed()">
      @if (current(); as n) {
        <h2 id="nm-title" class="disp">{{ 'notice.' + n.kind + '.title' | t }}</h2>
        <p>{{ 'notice.' + n.kind + '.text' | t }}</p>
        @if (n.kind === 'blueprint-apology') {
          <p class="gift">
            <span class="udt-trait r-legendary">{{ 'udt.bp.legendary' | t }}</span>
            <span class="muted small">{{ 'notice.blueprint-apology.gift' | t }}</span>
          </p>
        }
        <div class="foot">
          @if (n.kind === 'blueprint-apology') {
            <a class="btn" routerLink="/udt/academy" (click)="close()">{{
              'notice.blueprint-apology.go' | t
            }}</a>
          }
          <button type="button" class="primary" (click)="close()">{{ 'notice.ok' | t }}</button>
        </div>
      }
    </dialog>
  `,
  styles: `
    .nm {
      width: min(520px, calc(100vw - 24px));
      padding: 20px 22px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      color: var(--text);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    }
    .nm::backdrop {
      background: rgba(4, 6, 10, 0.72);
      backdrop-filter: blur(2px);
    }
    h2 {
      margin: 0 0 10px;
      color: var(--udt, var(--accent));
    }
    .gift {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
      flex-wrap: wrap;
    }
  `,
})
export class NoticeModal {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  /** Seen in this browser session (the server list only refreshes with the next /me). */
  private readonly done = signal<ReadonlySet<string>>(new Set());

  protected readonly current = computed<UserNotice | null>(
    () =>
      (this.auth.me()?.notices ?? []).find((n) => KNOWN.has(n.kind) && !this.done().has(n.id)) ??
      null,
  );

  constructor() {
    effect(() => {
      // Unknown kinds (a newer server): mark seen, nothing to show.
      for (const n of this.auth.me()?.notices ?? [])
        if (!KNOWN.has(n.kind) && !this.done().has(n.id)) this.markSeen(n.id);
    });
    effect(() => {
      const d = this.dlg()?.nativeElement;
      if (!d) return;
      if (this.current() && !d.open) d.showModal();
      else if (!this.current() && d.open) d.close();
    });
  }

  protected close(): void {
    this.dlg()?.nativeElement.close();
  }

  /** Closed by a button or Escape: seen. */
  protected closed(): void {
    const n = this.current();
    if (n) this.markSeen(n.id);
  }

  private markSeen(id: string): void {
    this.done.update((s) => new Set([...s, id]));
    this.api.seeNotice(id).catch(() => {
      // shown again after the next login: harmless
    });
  }
}
