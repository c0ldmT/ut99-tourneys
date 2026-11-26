import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import type { PatchNote } from '../core/types';

/** What a guest saw last (a logged-in user's state is on the server). */
const GUEST_KEY = 'tourney.patchSeen';

function guestSeen(): number | null {
  try {
    const v = localStorage.getItem(GUEST_KEY);
    return v === null ? null : Number(v) || 0;
  } catch {
    return null;
  }
}

function setGuestSeen(id: number): void {
  try {
    localStorage.setItem(GUEST_KEY, String(id));
  } catch {
    // private window: the modal may come again
  }
}

/**
 * Patch notes (decision 243): after an update the notes the visitor has not seen yet show once
 * in a modal (closing marks them seen: for a user on the server, for a guest in the browser; a
 * first visit starts at the latest); the footer opens all of them again.
 */
@Component({
  selector: 'na-patch-notes',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="pn" aria-labelledby="pn-title" (close)="closed()">
      @if (mode(); as m) {
        <header>
          <h2 id="pn-title" class="disp">
            {{ (m === 'new' ? 'patch.newTitle' : 'patch.title') | t }}
          </h2>
          @if (m === 'new') {
            <p class="muted small">{{ 'patch.newText' | t }}</p>
          }
        </header>
        <div class="list">
          @for (n of shown(); track n.id) {
            <section>
              <h3>{{ text(n).title }}</h3>
              <p class="muted small meta">
                {{ i18n.day(n.date) }}
                @if (n.mod) {
                  · {{ 'patch.mod' | t: { v: n.mod } }}
                }
              </p>
              <ul>
                @for (it of text(n).items; track $index) {
                  <li>{{ it }}</li>
                }
              </ul>
            </section>
          } @empty {
            <p class="muted">{{ (notes() ? 'patch.none' : 'patch.loading') | t }}</p>
          }
        </div>
        <div class="foot">
          @if (m === 'new' && hasOlder()) {
            <button type="button" class="link" (click)="mode.set('all')">
              {{ 'patch.older' | t }}
            </button>
          }
          <button type="button" class="primary" (click)="close()">{{ 'patch.ok' | t }}</button>
        </div>
      }
    </dialog>
  `,
  styles: `
    .pn {
      width: min(620px, calc(100vw - 24px));
      max-height: min(80vh, 760px);
      padding: 0;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      color: var(--text);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    }
    .pn[open] {
      display: flex;
      flex-direction: column;
    }
    .pn::backdrop {
      background: rgba(4, 6, 10, 0.72);
      backdrop-filter: blur(2px);
    }
    header {
      padding: 20px 22px 8px;
    }
    h2 {
      margin: 0;
      color: var(--accent);
    }
    header p {
      margin: 6px 0 0;
    }
    .list {
      overflow-y: auto;
      padding: 4px 22px 8px;
    }
    section + section {
      border-top: 1px solid var(--line);
      margin-top: 14px;
      padding-top: 12px;
    }
    h3 {
      margin: 8px 0 2px;
      font-size: var(--fs-base);
    }
    .meta {
      margin: 0 0 6px;
    }
    ul {
      margin: 0;
      padding-left: 20px;
    }
    li + li {
      margin-top: 4px;
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 12px;
      padding: 12px 22px 18px;
      border-top: 1px solid var(--line);
      flex-wrap: wrap;
    }
  `,
})
export class PatchNotes {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');

  /** 'new': the unseen notes after an update; 'all': every note (footer). */
  protected readonly mode = signal<'new' | 'all' | null>(null);
  protected readonly notes = signal<readonly PatchNote[] | null>(null);
  /** The last note seen when the update modal opened. */
  private readonly seenAt = signal(0);
  /** The automatic check ran for this visitor ('guest' or the user id). */
  private checked: string | null = null;
  /** Site config and user loaded (before that a user would look like a guest). */
  private readonly ready = signal(false);

  protected readonly shown = computed(() => {
    const all = this.notes() ?? [];
    return this.mode() === 'new' ? all.filter((n) => n.id > this.seenAt()) : all;
  });
  protected readonly hasOlder = computed(() =>
    (this.notes() ?? []).some((n) => n.id <= this.seenAt()),
  );

  constructor() {
    void this.auth.ready().then(() => this.ready.set(true));
    // Once per visitor (and again after a login) once the site config and the user are loaded.
    effect(() => {
      const latest = this.auth.config().patchLatest;
      const me = this.auth.me();
      if (!this.ready() || !latest) return;
      const who = me ? me.id : 'guest';
      if (this.checked === who) return;
      untracked(() => this.check(who, latest, me?.patchSeen));
    });
    effect(() => {
      const d = this.dlg()?.nativeElement;
      if (!d) return;
      if (this.mode() && !d.open) d.showModal();
      else if (!this.mode() && d.open) d.close();
    });
  }

  /** From the footer: all notes. */
  openAll(): void {
    this.mode.set('all');
    void this.load();
  }

  protected text(n: PatchNote) {
    return this.i18n.lang() === 'de' ? n.de : n.en;
  }

  protected close(): void {
    this.dlg()?.nativeElement.close();
  }

  /** Closed by the button or Escape: the update modal is seen. */
  protected closed(): void {
    this.mode.set(null);
    // Seen also when the footer showed all notes before the update modal came.
    const latest = this.latest();
    if (this.seenAt() >= latest) return;
    this.seenAt.set(latest);
    if (this.auth.me()) {
      const me = this.auth.me()!;
      this.auth.me.set({ ...me, patchSeen: latest });
      this.api.seePatch(latest).catch(() => {
        // shown again after the next login: harmless
      });
    } else setGuestSeen(latest);
  }

  private latest(): number {
    return this.auth.config().patchLatest ?? 0;
  }

  private check(who: string, latest: number, userSeen: number | undefined): void {
    let seen: number;
    if (who === 'guest') {
      const g = guestSeen();
      if (g === null) {
        // First visit: nothing to catch up on.
        setGuestSeen(latest);
        this.checked = who;
        this.seenAt.set(latest);
        return;
      }
      seen = g;
    } else seen = userSeen ?? latest;
    this.checked = who;
    this.seenAt.set(seen);
    if (seen >= latest) return;
    void this.load().then(() => {
      // Only with something to show (a note of a newer server may still be missing here).
      if ((this.notes() ?? []).some((n) => n.id > seen)) this.mode.update((m) => m ?? 'new');
    });
  }

  private async load(): Promise<void> {
    if (this.notes()) return;
    try {
      this.notes.set((await this.api.patchNotes()).notes);
    } catch {
      this.notes.set([]);
    }
  }
}
