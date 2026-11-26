import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Api } from '../core/api';
import { Auth } from '../core/auth';
import { Icon } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { searchPages } from '../core/search-pages';
import type { SearchResult } from '../core/types';
import { SKILL_NAMES } from '../core/skill-names';

type Kind = 'bot' | 'team' | 'player' | 'tournament' | 'page';

interface Hit {
  kind: Kind;
  /** i18n key of the group heading. */
  group: string;
  label: string;
  sub: string;
  link: string;
}

/** Remembered per browser: the last opened hits (shown while the field is empty). */
const RECENT = 'tourney.search.recent';
const RECENT_MAX = 5;
const PAGES_MAX = 5;
/** Waits this long after typing before asking the server (ms). */
const DEBOUNCE = 150;
const MARK: Readonly<Record<Kind, string>> = {
  bot: 'B',
  team: 'T',
  player: 'S',
  tournament: 'C',
  page: '›',
};

/**
 * The quick search (decision 313): a button in the header and Ctrl+K / ⌘K everywhere. Bots,
 * teams, players and tournaments come from `GET /search`, pages (with the administration for
 * admins) from the app itself; arrow keys pick, Enter opens, Esc closes. With an empty field it
 * lists what was opened last.
 */
@Component({
  selector: 'na-search',
  imports: [TPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="btn icon searchbtn"
      [title]="('search.open' | t) + ' (' + kbd + ')'"
      [attr.aria-label]="'search.open' | t"
      aria-haspopup="dialog"
      (click)="open()"
    >
      <na-icon name="search" [size]="18" /><span class="searchlabel">{{ 'search.open' | t }}</span
      ><kbd class="searchkbd">{{ kbd }}</kbd>
    </button>
    <dialog
      #dlg
      class="qs"
      [attr.aria-label]="'search.open' | t"
      (close)="closed()"
      (click)="backdrop($event)"
    >
      <div class="qs-box">
        <input
          #field
          class="qs-in"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="qs-list"
          [attr.aria-expanded]="hits().length > 0"
          [attr.aria-activedescendant]="hits().length ? 'qs-opt-' + active() : null"
          [placeholder]="'search.placeholder' | t"
          [value]="query()"
          (input)="type($any($event.target).value)"
          (keydown)="key($event)"
          autocomplete="off"
          spellcheck="false"
        />
        <div class="qs-list" id="qs-list" role="listbox" [attr.aria-label]="'search.open' | t">
          @for (h of hits(); track h.link + h.label; let i = $index) {
            @if (i === 0 || hits()[i - 1]!.group !== h.group) {
              <div class="qs-grp" role="presentation">{{ h.group | t }}</div>
            }
            <div
              class="qs-it"
              role="option"
              [id]="'qs-opt-' + i"
              [class.on]="i === active()"
              [attr.aria-selected]="i === active()"
              (mousemove)="active.set(i)"
              (click)="go(h)"
            >
              <span class="qs-mark" [attr.data-kind]="h.kind" aria-hidden="true">{{
                mark[h.kind]
              }}</span>
              <span class="qs-tx"
                ><b>{{ h.label }}</b>
                @if (h.sub) {
                  <span>{{ h.sub }}</span>
                }
              </span>
            </div>
          } @empty {
            <p class="qs-empty">
              {{
                query().trim() ? ('search.none' | t: { q: query().trim() }) : ('search.hint' | t)
              }}
            </p>
          }
        </div>
        <div class="qs-foot" aria-hidden="true">
          <span><kbd>↑</kbd> <kbd>↓</kbd> {{ 'search.keys.pick' | t }}</span>
          <span><kbd>Enter</kbd> {{ 'search.keys.open' | t }}</span>
          <span><kbd>Esc</kbd> {{ 'search.keys.close' | t }}</span>
        </div>
      </div>
    </dialog>
  `,
  styles: `
    :host {
      display: contents;
    }
    .searchbtn {
      color: var(--text-2);
    }
    .searchlabel,
    .searchkbd {
      display: none;
    }
    kbd {
      font: 500 var(--fs-2xs) var(--font-mono);
      border: 1px solid var(--line);
      border-radius: var(--radius-xs);
      padding: 1px 5px;
      color: var(--text-2);
    }
    @media (min-width: 1240px) {
      .searchbtn {
        width: auto;
        gap: 8px;
        padding: 0 10px;
        border: 1px solid var(--line);
        background: var(--panel);
        min-width: 170px;
        justify-content: flex-start;
      }
      .searchlabel {
        display: inline;
        color: var(--muted);
      }
      .searchkbd {
        display: inline;
        margin-left: auto;
      }
    }
    .qs {
      width: min(620px, calc(100vw - 24px));
      max-height: none;
      margin: 10vh auto auto;
      padding: 0;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--panel);
      color: var(--text);
      box-shadow: 0 30px 90px rgb(0 0 0 / 0.65);
    }
    .qs::backdrop {
      background: rgb(5 6 10 / 0.75);
      backdrop-filter: blur(3px);
    }
    .qs-in {
      width: 100%;
      border: 0;
      border-bottom: 1px solid var(--border);
      border-radius: 0;
      background: transparent;
      font-size: var(--fs-base);
      padding: 16px 18px;
      outline: none;
    }
    .qs-list {
      max-height: min(52vh, 460px);
      overflow: auto;
      padding: 6px;
    }
    .qs-grp {
      color: var(--muted);
      font-size: var(--fs-xs);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 10px 12px 4px;
    }
    .qs-it {
      display: flex;
      gap: 12px;
      align-items: center;
      padding: 8px 12px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .qs-it.on {
      background: var(--panel-3);
    }
    .qs-mark {
      width: 28px;
      height: 28px;
      flex: none;
      border-radius: var(--radius-sm);
      display: grid;
      place-items: center;
      font-size: var(--fs-xs);
      font-weight: 800;
      background: var(--panel-2);
      color: var(--text-2);
    }
    .qs-mark[data-kind='bot'] {
      color: var(--udt);
    }
    .qs-mark[data-kind='team'] {
      color: var(--hot);
    }
    .qs-mark[data-kind='player'] {
      color: var(--accent);
    }
    .qs-mark[data-kind='tournament'] {
      color: var(--live);
    }
    .qs-tx {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .qs-tx b,
    .qs-tx span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .qs-tx span {
      color: var(--muted);
      font-size: var(--fs-sm);
    }
    .qs-empty {
      margin: 0;
      padding: 18px 12px;
      color: var(--muted);
    }
    .qs-foot {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      border-top: 1px solid var(--border);
      padding: 10px 16px;
      color: var(--muted);
      font-size: var(--fs-sm);
    }
    @media (max-width: 600px) {
      .qs {
        margin-top: 12px;
      }
      .qs-foot {
        display: none;
      }
    }
  `,
})
export class QuickSearch {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly i18n = inject(I18n);
  private readonly router = inject(Router);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  protected readonly mark = MARK;
  protected readonly kbd = /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘K'
    : this.i18n.t('search.kbd');
  protected readonly query = signal('');
  protected readonly active = signal(0);
  private readonly result = signal<SearchResult | null>(null);
  private readonly recent = signal<Hit[]>(readRecent());
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** Pages whose name contains the query (in the language shown). */
  private readonly pages = computed((): Hit[] => {
    const q = this.query().trim().toLowerCase();
    const me = this.auth.me();
    if (!q || !me) return [];
    const cfg = this.auth.config();
    return searchPages({
      meId: me.id,
      admin: me.isAdmin,
      moderator: !!me.isModerator,
      udt: !!cfg.udt,
      league: !!cfg.udtLeague,
    })
      .map((p) => ({
        kind: 'page' as const,
        group: 'search.group.pages',
        label: this.i18n.t(p.label),
        sub: this.i18n.t(p.group),
        link: p.link,
      }))
      .filter((p) => p.label.toLowerCase().includes(q))
      .slice(0, PAGES_MAX);
  });

  protected readonly hits = computed((): Hit[] => {
    if (!this.query().trim())
      return this.recent().map((h) => ({ ...h, group: 'search.group.recent' }));
    const r = this.result();
    const t = (k: string, p?: Record<string, string | number>) => this.i18n.t(k, p);
    const out: Hit[] = [];
    for (const b of r?.bots ?? [])
      out.push({
        kind: 'bot',
        group: 'search.group.bots',
        label: b.name,
        sub: [SKILL_NAMES[b.skill] ?? '', b.team ?? ''].filter(Boolean).join(' · '),
        link: r!.udt ? `/udt/bot/${b.id}` : `/stats/p/b:${b.id.toLowerCase()}`,
      });
    for (const x of r?.teams ?? [])
      out.push({
        kind: 'team',
        group: 'search.group.teams',
        label: x.name,
        sub: [x.tag, x.manager ? t('search.manager', { name: x.manager }) : '']
          .filter(Boolean)
          .join(' · '),
        link: `/udt/squads/${x.userId}`,
      });
    for (const p of r?.players ?? [])
      out.push({
        kind: 'player',
        group: 'search.group.players',
        label: p.name,
        sub: p.key ? t('search.tournaments', { n: p.tournaments }) : t('search.userAdmin'),
        link: p.key ? `/stats/p/${p.key}` : '/admin/users',
      });
    for (const x of r?.tournaments ?? [])
      out.push({
        kind: 'tournament',
        group: 'search.group.tournaments',
        label: x.name,
        sub: `${t('phase.' + x.phase)} · ${this.i18n.when(x.at, 'date')}`,
        link: `/t/${x.id}`,
      });
    return [...out, ...this.pages()];
  });

  constructor() {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k' && this.auth.me()) {
        e.preventDefault();
        this.open();
      }
    };
    document.addEventListener('keydown', onKey);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(this.timer);
    });
  }

  open() {
    const d = this.dlg().nativeElement;
    if (d.open) return this.field().nativeElement.select();
    this.recent.set(readRecent());
    this.query.set('');
    this.result.set(null);
    this.active.set(0);
    d.showModal();
    this.field().nativeElement.focus();
  }

  protected type(v: string) {
    this.query.set(v);
    this.active.set(0);
    clearTimeout(this.timer);
    const q = v.trim();
    if (!q) return this.result.set(null);
    const n = ++this.seq;
    this.timer = setTimeout(async () => {
      try {
        const r = await this.api.search(q);
        if (n === this.seq) this.result.set(r);
      } catch {
        if (n === this.seq) this.result.set(null);
      }
    }, DEBOUNCE);
  }

  protected key(e: KeyboardEvent) {
    const n = this.hits().length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!n) return;
      this.active.set((this.active() + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
      queueMicrotask(() =>
        document.getElementById(`qs-opt-${this.active()}`)?.scrollIntoView({ block: 'nearest' }),
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const h = this.hits()[this.active()];
      if (h) this.go(h);
    }
  }

  protected go(h: Hit) {
    const keep = { ...h, group: '' };
    const list = [keep, ...readRecent().filter((x) => x.link !== h.link)].slice(0, RECENT_MAX);
    try {
      localStorage.setItem(RECENT, JSON.stringify(list));
    } catch {
      // storage unavailable
    }
    this.dlg().nativeElement.close();
    void this.router.navigateByUrl(h.link);
  }

  /** A click on the backdrop (outside the box) closes. */
  protected backdrop(e: MouseEvent) {
    if (e.target === this.dlg().nativeElement) this.dlg().nativeElement.close();
  }

  protected closed() {
    clearTimeout(this.timer);
    this.seq++;
  }
}

function readRecent(): Hit[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) ?? '[]') as unknown;
    return Array.isArray(v)
      ? v.filter((h): h is Hit => !!h && typeof h.link === 'string' && typeof h.label === 'string')
      : [];
  } catch {
    return [];
  }
}
