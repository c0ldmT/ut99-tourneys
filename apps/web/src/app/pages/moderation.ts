import { type Choice, Tabs } from '../components/choice';
import { EmptyState } from '../components/empty-state';
import { Confirm } from '../components/confirm-dialog';
import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import type { ModItem, ModLogEntry, ModSettings } from '../core/types';

type Tab = 'open' | 'done' | 'lists' | 'log';

/**
 * Moderation (decision 283): the queue of flagged and reported texts with reset and sanctions,
 * decided items, the word lists with the check of all texts, and the log. Moderators and admins.
 */
@Component({
  selector: 'app-moderation',
  imports: [Tabs, EmptyState, FormsModule, TPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="spread">
      <h1>{{ 'mod.title' | t }}</h1>
      <button (click)="load()">{{ 'common.refresh' | t }}</button>
    </div>
    <p class="muted">{{ 'mod.intro' | t }}</p>
    <na-tabs
      [options]="tabOptions()"
      [value]="tab()"
      (valueChange)="go($event)"
      label="mod.title"
    />

    @if (tab() === 'open' || tab() === 'done') {
      @for (it of items(); track it.id) {
        <article class="card item" [class.rep]="it.reports > 0">
          <div class="head">
            <span class="chip">{{ 'mod.kind.' + it.kind | t }}</span>
            <span class="chip src {{ it.source }}">{{ 'mod.source.' + it.source | t }}</span>
            @if (it.term) {
              <span class="chip term" [title]="'mod.termHint' | t">{{ it.term }}</span>
            }
            @if (it.reports) {
              <span class="chip hot">{{ 'mod.reports' | t: { n: it.reports } }}</span>
            }
            <span class="muted small when">{{ i18n.date(it.createdAt) }}</span>
          </div>
          <p class="text">{{ it.text }}</p>
          @if (it.current !== null && it.current !== it.text) {
            <p class="small muted">{{ 'mod.now' | t }}: {{ it.current }}</p>
          }
          @for (r of it.reasons; track $index) {
            <p class="small reason">
              <b>{{ r.by }}</b
              >: {{ reasonText(r.reason) }}
            </p>
          }
          @if (it.author; as a) {
            <p class="small author">
              {{ 'mod.author' | t }}:
              <a [routerLink]="['/stats/p', 'u:' + a.id]">{{ a.displayName }}</a>
              @if (a.warnings) {
                · {{ 'mod.warnings' | t: { n: a.warnings } }}
              }
              @if (active(a.textBanUntil)) {
                · <span class="bad">{{ 'mod.textBanned' | t: { d: day(a.textBanUntil!) } }}</span>
              }
              @if (active(a.bannedUntil)) {
                · <span class="bad">{{ 'mod.banned' | t: { d: day(a.bannedUntil!) } }}</span>
              }
            </p>
          }
          @if (editing()?.id === it.id) {
            @let e = editing()!;
            <form class="editf" (ngSubmit)="saveEdit()">
              @if (e.lines) {
                @for (l of e.lines; track $index; let i = $index) {
                  <input
                    [name]="'line' + i"
                    maxlength="120"
                    [(ngModel)]="e.lines[i]"
                    [placeholder]="'mod.lineEmpty' | t"
                  />
                }
              } @else if (e.name !== undefined) {
                <label
                  >{{ 'mod.f.tag' | t }}
                  <input name="tag" maxlength="20" [(ngModel)]="e.tag" />
                </label>
                <label
                  >{{ 'mod.f.name' | t }}
                  <input name="name" maxlength="40" [(ngModel)]="e.name" />
                </label>
              } @else {
                <input name="text" maxlength="200" [(ngModel)]="e.text" />
              }
              <div class="acts">
                <button type="submit" class="primary" [disabled]="busy()">
                  {{ 'common.save' | t }}
                </button>
                <button type="button" (click)="editing.set(null)">{{ 'common.cancel' | t }}</button>
              </div>
            </form>
          }
          @if (it.status === 'open') {
            <div class="acts">
              <button type="button" (click)="decide(it, 'ok')" [disabled]="busy()">
                {{ 'mod.ok' | t }}
              </button>
              <button
                type="button"
                class="danger"
                (click)="decide(it, 'reset')"
                [disabled]="busy() || it.current === null"
              >
                {{ 'mod.reset' | t }}
              </button>
              @if (auth.me()?.isAdmin && it.fields) {
                <button type="button" (click)="startEdit(it)" [disabled]="busy()">
                  {{ 'mod.edit' | t }}
                </button>
              }
              @if (it.author; as a) {
                @if (!a.moderator || auth.me()?.isAdmin) {
                  <span class="sep"></span>
                  <button type="button" (click)="sanction(a.id, 'warn')" [disabled]="busy()">
                    {{ 'mod.warn' | t }}
                  </button>
                  <select [(ngModel)]="textDays" [attr.aria-label]="'mod.days' | t">
                    @for (d of [1, 3, 7, 30]; track d) {
                      <option [ngValue]="d">{{ 'mod.daysN' | t: { n: d } }}</option>
                    }
                  </select>
                  <button type="button" (click)="sanction(a.id, 'text-ban')" [disabled]="busy()">
                    {{ 'mod.textBan' | t }}
                  </button>
                  <select [(ngModel)]="banDays" [attr.aria-label]="'mod.days' | t">
                    @for (d of [1, 7, 30, 0]; track d) {
                      <option [ngValue]="d">
                        {{ d ? ('mod.daysN' | t: { n: d }) : ('mod.forever' | t) }}
                      </option>
                    }
                  </select>
                  <button
                    type="button"
                    class="danger"
                    (click)="sanction(a.id, 'ban')"
                    [disabled]="busy()"
                  >
                    {{ 'mod.ban' | t }}
                  </button>
                  @if (active(a.textBanUntil) || active(a.bannedUntil)) {
                    <button type="button" (click)="sanction(a.id, 'unban')" [disabled]="busy()">
                      {{ 'mod.unban' | t }}
                    </button>
                  }
                }
              }
            </div>
          } @else {
            <p class="small muted">
              {{ 'mod.decided.' + it.status | t }} · {{ it.decidedBy }} ·
              {{ it.decidedAt ? i18n.date(it.decidedAt) : '' }}
            </p>
          }
        </article>
      } @empty {
        <na-empty class="card" [text]="'mod.empty.' + tab() | t" />
      }
    }

    @if (tab() === 'lists') {
      @if (lists(); as l) {
        <form class="card" (ngSubmit)="saveLists()">
          <label class="switch optrow"
            ><span class="ot"
              ><b>{{ 'mod.builtin' | t }}</b
              ><span class="muted small">{{
                'mod.builtinHint' | t: { b: l.builtinBlock, f: l.builtinFlag }
              }}</span></span
            ><input type="checkbox" name="builtin" [(ngModel)]="builtin" /><span class="tr"></span
          ></label>
          <p class="muted small">{{ 'mod.syntax' | t }}</p>
          <div class="lists">
            <label
              >{{ 'mod.list.block' | t }}
              <textarea name="block" rows="10" [(ngModel)]="block"></textarea>
            </label>
            <label
              >{{ 'mod.list.flag' | t }}
              <textarea name="flag" rows="10" [(ngModel)]="flag"></textarea>
            </label>
            <label
              >{{ 'mod.list.allow' | t }}
              <textarea name="allow" rows="10" [(ngModel)]="allow"></textarea>
            </label>
          </div>
          <div class="acts">
            <button type="submit" class="primary" [disabled]="busy()">
              {{ 'common.save' | t }}
            </button>
            <button type="button" (click)="scan()" [disabled]="busy()">
              {{ 'mod.scan' | t }}
            </button>
            @if (scanned(); as s) {
              <span class="small muted">{{ 'mod.scanned' | t: s }}</span>
            }
          </div>
        </form>
      }
    }

    @if (tab() === 'log') {
      <div class="card">
        <table>
          <tbody>
            @for (e of log(); track e.id) {
              <tr>
                <td class="muted small nowrap">{{ i18n.date(e.at) }}</td>
                <td>{{ e.by ?? '–' }}</td>
                <td>
                  <b>{{ 'mod.action.' + e.action | t }}</b>
                  @if (e.kind) {
                    · {{ 'mod.kind.' + e.kind | t }}
                  }
                  @if (e.target) {
                    · {{ e.target }}
                  }
                </td>
                <td class="muted small">{{ detail(e) }}</td>
              </tr>
            } @empty {
              <tr>
                <td class="muted">{{ 'mod.empty.log' | t }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: `
    .tabs {
      margin-top: 10px;
    }
    .item.rep {
      border-color: rgba(255, 107, 107, 0.45);
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .when {
      margin-left: auto;
    }
    .chip {
      padding: 1px 8px;
      border-radius: var(--radius-pill);
      border: 1px solid var(--border);
      font-size: var(--fs-xs);
      font-weight: 600;
    }
    .chip.hot,
    .chip.src.report {
      color: #ff8a8a;
      border-color: rgba(255, 107, 107, 0.5);
    }
    .chip.term {
      font-family: var(--font-mono, monospace);
    }
    .text {
      margin: 10px 0 6px;
      font-size: var(--fs-lg);
      font-weight: 700;
      word-break: break-word;
    }
    .reason,
    .author {
      margin: 2px 0;
    }
    .bad {
      color: #ff8a8a;
    }
    .acts {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-top: 10px;
    }
    .editf {
      display: grid;
      gap: 8px;
      margin-top: 10px;
    }
    .editf label {
      display: grid;
      gap: 4px;
      font-weight: 600;
    }
    .acts select {
      width: auto;
    }
    .sep {
      width: 1px;
      height: 24px;
      background: var(--border);
    }
    .lists {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
      gap: 12px;
    }
    .lists label {
      display: grid;
      gap: 6px;
      font-weight: 600;
    }
    .lists textarea {
      font-family: var(--font-mono, monospace);
    }
    .nowrap {
      white-space: nowrap;
    }
  `,
})
export class ModerationPage {
  private readonly confirm = inject(Confirm);
  protected readonly i18n = inject(I18n);
  protected readonly auth = inject(Auth);
  private readonly api = inject(Api);
  protected readonly tabs: Tab[] = ['open', 'done', 'lists', 'log'];
  protected readonly tab = signal<Tab>('open');
  protected readonly items = signal<ModItem[]>([]);
  protected readonly openCount = signal(0);
  protected readonly tabOptions = computed<Choice<Tab>[]>(() =>
    this.tabs.map((t) => ({
      value: t,
      label: 'mod.tab.' + t,
      badge: t === 'open' ? this.openCount() : null,
    })),
  );
  protected readonly lists = signal<ModSettings | null>(null);
  protected readonly log = signal<ModLogEntry[]>([]);
  protected readonly busy = signal(false);
  /** The item an admin edits by hand (decision 287): a copy of its fields. */
  protected readonly editing = signal<{
    id: string;
    text?: string;
    name?: string;
    tag?: string;
    lines?: string[];
  } | null>(null);

  protected startEdit(it: ModItem) {
    const f = it.fields ?? {};
    this.editing.set({ id: it.id, ...f, ...(f.lines ? { lines: [...f.lines] } : {}) });
  }

  protected saveEdit() {
    const e = this.editing();
    if (!e) return;
    const { id, ...fields } = e;
    return this.act(async () => {
      await this.api.modEdit(id, fields);
      this.editing.set(null);
    });
  }
  protected readonly scanned = signal<{ checked: number; queued: number } | null>(null);
  protected textDays = 7;
  protected banDays = 7;
  protected builtin = true;
  protected block = '';
  protected flag = '';
  protected allow = '';

  constructor() {
    void this.load();
  }

  protected go(t: Tab) {
    this.tab.set(t);
    void this.load();
  }

  protected async load() {
    try {
      const t = this.tab();
      if (t === 'open' || t === 'done') {
        const items = await this.api.modQueue(t);
        this.items.set(items);
        if (t === 'open') this.openCount.set(items.length);
      } else if (t === 'lists') {
        const l = await this.api.modSettings();
        this.fill(l);
      } else this.log.set(await this.api.modLog());
      if (t !== 'open') this.openCount.set((await this.api.modCount()).open);
    } catch {
      // the toast shows the error
    }
  }

  private fill(l: ModSettings) {
    this.builtin = l.builtin;
    this.block = l.block.join('\n');
    this.flag = l.flag.join('\n');
    this.allow = l.allow.join('\n');
    this.lists.set(l);
  }

  private async act(fn: () => Promise<unknown>) {
    this.busy.set(true);
    try {
      await fn();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
      await this.load();
    }
  }

  protected decide(it: ModItem, action: 'ok' | 'reset') {
    return this.act(() => this.api.modDecide(it.id, action));
  }

  protected async sanction(userId: string, action: 'warn' | 'text-ban' | 'ban' | 'unban') {
    const reason =
      action === 'unban'
        ? ''
        : await this.confirm.prompt(this.i18n.t('mod.reasonPrompt'), {
            danger: action !== 'warn',
          });
    if (reason === null) return;
    const days = action === 'text-ban' ? this.textDays : action === 'ban' ? this.banDays : 0;
    return this.act(() => this.api.modSanction(userId, action, days, reason));
  }

  protected saveLists() {
    const lines = (s: string) =>
      s
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
    return this.act(async () => {
      this.fill(
        await this.api.setModSettings({
          builtin: this.builtin,
          block: lines(this.block),
          flag: lines(this.flag),
          allow: lines(this.allow),
        }),
      );
    });
  }

  protected scan() {
    return this.act(async () => {
      this.scanned.set(await this.api.modScan());
    });
  }

  protected active(until: string | null): boolean {
    return !!until && Date.parse(until) > Date.now();
  }

  protected day(iso: string): string {
    return iso.startsWith('9999') ? this.i18n.t('mod.forever') : iso.slice(0, 10);
  }

  /** "insult: note" → "Insult: note". */
  protected reasonText(r: string): string {
    const [head, ...rest] = r.split(': ');
    const known = ['insult', 'hate', 'sexual', 'spam', 'other'].includes(head ?? '');
    const label = known ? this.i18n.t(`mod.reason.${head}`) : r;
    return known && rest.length ? `${label}: ${rest.join(': ')}` : label;
  }

  protected detail(e: ModLogEntry): string {
    const d = e.detail;
    if (typeof d['text'] === 'string') return `„${d['text']}“`;
    if (typeof d['reason'] === 'string' && d['reason']) return d['reason'];
    if (typeof d['checked'] === 'number') return `${d['checked']} / ${d['queued']}`;
    return '';
  }
}
