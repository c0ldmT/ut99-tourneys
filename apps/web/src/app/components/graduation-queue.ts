import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import type { UdtYearbookEntry } from '../core/types';
import { Confirm } from './confirm-dialog';
import { EmptyState } from './empty-state';

/**
 * Bots nominated for the library (decision 333), in the moderation as their own tab: approve
 * (optionally renamed) once the bot's season is over, before that with the day it becomes
 * possible; reject with a question. Nominations stay over the season's end until an admin decides.
 */
@Component({
  selector: 'na-grad-queue',
  imports: [FormsModule, TPipe, EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="muted small">{{ 'udt.yearbook.nominationsText' | t }} {{ 'mod.grads.keep' | t }}</p>
    @for (n of list(); track n.botId) {
      <article class="card gq" [class.ready]="n.approvable">
        <div class="gq-who">
          <b>{{ n.name }}</b>
          @if (n.honours) {
            <span class="udt-mark star">{{ 'udt.yearbook.honours' | t }}</span>
          }
          <span class="muted small"
            >Season {{ n.season }} · {{ n.tag }} {{ n.team }} · {{ n.breeder }} ·
            {{ 'udt.level' | t }} {{ n.level }} · {{ n.games }} {{ 'udt.academy.games' | t }}</span
          >
        </div>
        @if (n.approvable) {
          <div class="gq-act">
            <input
              type="text"
              maxlength="20"
              [name]="'r' + n.botId"
              [placeholder]="'udt.yearbook.rename' | t"
              [attr.aria-label]="'udt.yearbook.rename' | t"
              [ngModel]="renames()[n.botId] ?? ''"
              (ngModelChange)="setRename(n.botId, $event)"
            />
            <button type="button" [disabled]="busy()" (click)="reject(n)">
              {{ 'mod.grads.reject' | t }}
            </button>
            <button type="button" class="primary" [disabled]="busy()" (click)="approve(n)">
              {{ 'udt.yearbook.approve' | t }}
            </button>
          </div>
        } @else {
          <div class="gq-act">
            <span class="badge seeded">{{
              n.from ? ('mod.grads.from' | t: { d: day(n.from) }) : ('udt.yearbook.afterSeason' | t)
            }}</span>
            <button type="button" [disabled]="busy()" (click)="reject(n)">
              {{ 'mod.grads.reject' | t }}
            </button>
          </div>
        }
      </article>
    } @empty {
      <na-empty [text]="'mod.grads.empty' | t" />
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .gq {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 16px;
      margin-top: 10px;
    }
    .gq.ready {
      border-color: var(--accent-dim);
    }
    .gq-who {
      flex: 1 1 280px;
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 4px 10px;
    }
    .gq-act {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }
    .gq-act input {
      width: 190px;
      max-width: 100%;
    }
  `,
})
export class GraduationQueue {
  private readonly api = inject(Api);
  private readonly confirm = inject(Confirm);
  private readonly i18n = inject(I18n);
  /** The list changed (approved, rejected): the counters follow. */
  readonly changed = output<number>();
  protected readonly list = signal<UdtYearbookEntry[]>([]);
  protected readonly busy = signal(false);
  protected readonly renames = signal<Record<string, string>>({});
  /** Approvable now (the tab's badge). */
  readonly approvable = computed(() => this.list().filter((n) => n.approvable).length);

  constructor() {
    void this.load();
  }

  async load() {
    try {
      this.set(await this.api.udtNominations());
    } catch {
      // the toast shows the error
    }
  }

  protected day(d: string): string {
    return this.i18n.whenDay(d, 'dayMonth');
  }

  protected setRename(id: string, v: string) {
    this.renames.update((r) => ({ ...r, [id]: v }));
  }

  protected async approve(n: UdtYearbookEntry) {
    const name = (this.renames()[n.botId] ?? '').trim();
    await this.act(() => this.api.udtApprove(n.botId, name || undefined));
  }

  protected async reject(n: UdtYearbookEntry) {
    const ok = await this.confirm.ask(this.i18n.t('mod.grads.rejectConfirm', { name: n.name }), {
      danger: true,
      ok: this.i18n.t('mod.grads.reject'),
    });
    if (ok) await this.act(() => this.api.udtReject(n.botId));
  }

  private set(list: UdtYearbookEntry[]) {
    this.list.set(list);
    this.changed.emit(list.filter((n) => n.approvable).length);
  }

  private async act(fn: () => Promise<UdtYearbookEntry[]>) {
    this.busy.set(true);
    try {
      this.set(await fn());
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
