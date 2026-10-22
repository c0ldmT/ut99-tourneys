import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { NameTag } from '../core/looks';
import { I18n, TPipe } from '../core/i18n';
import { feedSec, meters, mmss } from '../core/live';
import type { KillFeedEntry } from '../core/types';

/** UT's spree messages by kills in a row. */
const SPREES: Record<number, string> = {
  5: 'Killing Spree',
  10: 'Rampage',
  15: 'Dominating',
  20: 'Unstoppable',
  25: 'Godlike',
};
const MULTIS: Record<number, string> = {
  2: 'Double Kill',
  3: 'Multi Kill',
  4: 'Ultra Kill',
};

export type FeedKind = 'kill' | 'item' | 'thought' | 'chat';
export type FeedRow = Omit<KillFeedEntry, 'tournamentId' | 'matchId' | 'game'>;

/** A part of the feed: a game, or a run of a Monster Hunt game. */
export interface FeedSection {
  key: string;
  /** Heading (translated); none: no heading. */
  title?: string;
  sub?: string;
  side?: 'a' | 'b' | null;
  /** Oldest first. */
  entries: readonly FeedRow[];
  /** Open at first; a section with a heading can be opened and closed. */
  open: boolean;
}

/** Entries shown per section at most (a stored feed can be long). */
const SHOW_MAX = 300;
const KINDS: FeedKind[] = ['kill', 'item', 'thought', 'chat'];

export const feedKind = (e: FeedRow): FeedKind =>
  e.kind ?? (e.chat !== undefined ? 'chat' : 'kill');

/**
 * Feed of a game: kills (newest on top, killer and victim in their side's colour, weapon,
 * headshots, first blood, sprees and multi kills like UT announces them, health left and
 * distance), the website bots' chat lines, items taken and what the bots are up to. Filters by
 * kind; Monster Hunt shows a section per run.
 */
@Component({
  selector: 'app-kill-feed',
  imports: [TPipe, NameTag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card feed">
      <div class="lc-head">
        <h3>{{ title() | t }}</h3>
        @if (live()) {
          <span class="live small"><span class="dot on"></span> {{ 'match.live' | t }}</span>
        }
        @if (chips().length > 1) {
          <div class="chips" role="group" [attr.aria-label]="'feed.filter' | t">
            @for (c of chips(); track c.kind) {
              <button
                type="button"
                class="chip"
                [class.on]="c.on"
                [attr.aria-pressed]="c.on"
                (click)="toggle(c.kind)"
              >
                {{ 'feed.f.' + c.kind | t }} <span class="muted">{{ c.n }}</span>
              </button>
            }
          </div>
        }
      </div>
      @for (s of view(); track s.key) {
        <div class="sec">
          @if (s.title) {
            <button type="button" class="shead" [attr.aria-expanded]="s.open" (click)="flip(s.key)">
              <span class="nm" [class]="s.side ?? ''">{{ s.title }}</span>
              @if (s.sub) {
                <span class="muted small">{{ s.sub }}</span>
              }
              <span class="car muted small">{{ (s.open ? 'feed.close' : 'feed.open') | t }}</span>
            </button>
          }
          @if (s.open) {
            @if (!s.rows.length) {
              <p class="muted small">{{ (s.total ? 'feed.filtered' : 'feed.empty') | t }}</p>
            }
            <ol aria-live="polite">
              @for (r of s.rows; track r.e) {
                <li [class.big]="r.badges.length > 0" [class]="r.kind">
                  <span class="t mono muted">{{ r.time }}</span>
                  <span class="line">
                    @switch (r.kind) {
                      @case ('chat') {
                        <span class="nm" [class]="r.kSide"><na-name [name]="r.e.killer" /></span>
                        <q class="say">{{ r.e.chat }}</q>
                      }
                      @case ('item') {
                        <span class="nm" [class]="r.kSide"><na-name [name]="r.e.killer" /></span>
                        <span class="muted">{{ 'feed.takes' | t }}</span>
                        <span class="itm" [class]="r.e.item ?? ''">{{
                          'live.itemName.' + r.e.item | t
                        }}</span>
                      }
                      @case ('thought') {
                        <span class="nm" [class]="r.kSide"><na-name [name]="r.e.killer" /></span>
                        <span class="th"
                          >→ {{ 'feed.st.' + r.e.thought?.state | t }}
                          @if (r.e.thought?.target) {
                            · {{ r.e.thought?.target }}
                          }
                        </span>
                      }
                      @default {
                        @if (r.e.suicide) {
                          <span class="nm" [class]="r.vSide"><na-name [name]="r.e.victim" /></span>
                          <span class="muted">{{ 'feed.suicide' | t }}</span>
                        } @else {
                          <span class="nm" [class]="r.kSide"
                            ><na-name [name]="r.e.killer || r.e.weapon"
                          /></span>
                          @if (r.e.killer) {
                            <span class="wp">{{ r.e.weapon }}</span>
                          }
                          <span class="nm" [class]="r.vSide"><na-name [name]="r.e.victim" /></span>
                        }
                      }
                    }
                  </span>
                  <span class="tags">
                    @if (r.e.headshot) {
                      <span class="tag hs" [title]="'feed.headshot' | t">HS</span>
                    }
                    @if (r.e.amp) {
                      <span class="tag amp">Amp</span>
                    }
                    @for (b of r.badges; track b) {
                      <span class="tag" [class.fb]="b === 'First Blood'">{{ b }}</span>
                    }
                    @if (r.e.teamKill) {
                      <span class="tag tk">{{ 'feed.teamKill' | t }}</span>
                    }
                  </span>
                  @if (r.detail) {
                    <span class="det small muted">{{ r.detail }}</span>
                  }
                </li>
              }
            </ol>
            @if (s.more) {
              <p class="muted small">{{ 'feed.more' | t: { n: s.more } }}</p>
            }
          }
        </div>
      }
    </div>
  `,
  styles: `
    .feed {
      padding-bottom: 8px;
    }
    .live {
      color: var(--live);
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-right: auto;
    }
    .chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .chip {
      font: 600 0.8rem var(--font);
      color: var(--muted);
      background: transparent;
      border: 1px solid var(--line);
      border-radius: 999px;
      min-height: 32px;
      padding: 0 12px;
      cursor: pointer;
    }
    .chip.on {
      color: var(--text);
      border-color: rgba(34, 211, 238, 0.55);
      background: rgba(34, 211, 238, 0.1);
    }
    .sec + .sec {
      border-top: 1px solid var(--border);
    }
    .shead {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      background: none;
      border: 0;
      color: var(--text);
      font: 700 0.95rem var(--font);
      padding: 10px 2px;
      min-height: 44px;
      text-align: left;
      cursor: pointer;
    }
    .car {
      margin-left: auto;
    }
    ol {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: 440px;
      overflow-y: auto;
    }
    li {
      display: grid;
      grid-template-columns: 50px minmax(0, 1fr) auto;
      gap: 2px 10px;
      align-items: center;
      padding: 7px 4px;
      border-top: 1px solid var(--border);
      animation: in 0.35s ease-out;
    }
    li:first-child {
      border-top: 0;
    }
    li.big {
      background: linear-gradient(90deg, rgba(240, 70, 140, 0.08), transparent 70%);
    }
    li.thought {
      background: rgba(122, 169, 255, 0.04);
    }
    @keyframes in {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
    }
    .t {
      font-size: 0.78rem;
    }
    .line {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
    }
    .nm {
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .nm.a {
      color: var(--side-a);
    }
    .nm.b {
      color: var(--side-b);
    }
    .nm.none {
      color: var(--text-2);
    }
    .say {
      color: var(--text-2);
      font-style: italic;
      overflow: hidden;
      text-overflow: ellipsis;
      quotes: '“' '”';
    }
    .th {
      color: #a9c3ff;
      font-style: italic;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .itm {
      font-family: var(--font-display);
      font-weight: 800;
      font-style: italic;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .itm.amp {
      color: var(--hot-text);
    }
    .itm.belt {
      color: var(--neuro-text);
    }
    .itm.armor {
      color: var(--info);
    }
    .itm.keg {
      color: var(--live);
    }
    .wp {
      flex: none;
      font-size: 0.75rem;
      color: var(--text-2);
      border: 1px solid var(--line);
      border-radius: 4px;
      padding: 0 6px;
      line-height: 18px;
    }
    .tags {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .tag {
      font-family: var(--font-display);
      font-weight: 700;
      font-style: italic;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 0.8rem;
      color: var(--hot-text);
    }
    .tag.fb {
      color: var(--danger);
    }
    .tag.hs {
      color: var(--neuro-text);
      font-style: normal;
    }
    .tag.amp {
      color: #ffd6f0;
    }
    .tag.tk {
      color: var(--muted);
    }
    .det {
      grid-column: 2 / -1;
      font-size: 0.75rem;
    }
    @media (max-width: 640px) {
      li {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .t {
        display: none;
      }
      .det {
        grid-column: 1 / -1;
      }
    }
  `,
})
export class KillFeed {
  private readonly i18n = inject(I18n);
  readonly sections = input.required<readonly FeedSection[]>();
  /** Entrant id of side A (red); side B is blue. */
  readonly sideA = input.required<string>();
  readonly title = input('feed.title');
  readonly live = input(false);

  /** Bot thoughts shown at first (the viewer can switch every kind on and off). */
  readonly thoughts = input(true);
  protected readonly shown = linkedSignal<boolean, Record<FeedKind, boolean>>({
    source: this.thoughts,
    computation: (thought, prev) => ({
      ...(prev?.value ?? { kill: true, item: true, chat: true }),
      thought,
    }),
  });
  /** Sections opened or closed by the viewer (differs from their default). */
  private readonly flipped = signal<ReadonlySet<string>>(new Set());

  protected readonly chips = computed(() => {
    const n: Record<FeedKind, number> = { kill: 0, item: 0, thought: 0, chat: 0 };
    for (const s of this.sections()) for (const e of s.entries) n[feedKind(e)]++;
    const on = this.shown();
    return KINDS.filter((k) => n[k] > 0).map((kind) => ({ kind, n: n[kind], on: on[kind] }));
  });

  protected readonly view = computed(() => {
    const on = this.shown();
    const flipped = this.flipped();
    return this.sections().map((s) => {
      const firstAt = s.entries[0]?.at ?? 0;
      const all = s.entries.filter((e) => on[feedKind(e)]);
      const rows = all
        .slice(-SHOW_MAX)
        .reverse()
        .map((e, i) => this.row(e, firstAt, `${e.at}-${all.length - i}`));
      return {
        key: s.key,
        title: s.title,
        sub: s.sub,
        side: s.side,
        open: !s.title || flipped.has(s.key) !== s.open,
        rows,
        total: s.entries.length,
        more: Math.max(0, all.length - SHOW_MAX),
      };
    });
  });

  protected toggle(kind: FeedKind): void {
    this.shown.update((s) => ({ ...s, [kind]: !s[kind] }));
  }

  protected flip(key: string): void {
    this.flipped.update((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  private row(e: FeedRow, firstAt: number, key: string) {
    const side = (s: string | null) =>
      s === null ? 'nm none' : s === this.sideA() ? 'nm a' : 'nm b';
    const kind = feedKind(e);
    const badges: string[] = [];
    let detail = '';
    if (kind === 'kill') {
      if (e.firstBlood) badges.push('First Blood');
      if (SPREES[e.spree]) badges.push(SPREES[e.spree]!);
      if (e.multi >= 5) badges.push('Monster Kill');
      else if (MULTIS[e.multi]) badges.push(MULTIS[e.multi]!);
      if (e.killerHealth !== undefined && e.distance !== undefined && !e.suicide)
        detail = this.i18n.t('feed.detail', { hp: e.killerHealth, m: meters(e.distance) });
    }
    return {
      key,
      kind,
      e,
      kSide: side(e.killerSide),
      vSide: side(e.victimSide),
      badges,
      detail,
      time: mmss(feedSec(e, firstAt)),
    };
  }
}
