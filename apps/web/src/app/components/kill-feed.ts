import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { NameTag } from '../core/looks';
import { I18n, TPipe } from '../core/i18n';
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

/**
 * Live kill feed of the game in progress: newest on top, killer and victim in their side's
 * colour, weapon, headshots, first blood, sprees and multi kills like UT announces them; the
 * website bots' chat lines in between.
 */
@Component({
  selector: 'app-kill-feed',
  imports: [TPipe, NameTag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card feed">
      <div class="head">
        <h3>{{ 'feed.title' | t }}</h3>
        <span class="live small"><span class="dot on"></span> {{ 'match.live' | t }}</span>
      </div>
      @if (!rows().length) {
        <p class="muted small">{{ 'feed.empty' | t }}</p>
      }
      <ol aria-live="polite">
        @for (r of rows(); track r.key) {
          <li [class.big]="r.badges.length > 0" [class.chat]="r.e.chat !== undefined">
            <span class="t mono muted">{{ r.time }}</span>
            <span class="line">
              @if (r.e.chat !== undefined) {
                <span class="nm" [class]="r.kSide"><na-name [name]="r.e.killer" /></span>
                <q class="say">{{ r.e.chat }}</q>
              } @else if (r.e.suicide) {
                <span class="nm" [class]="r.vSide"><na-name [name]="r.e.victim" /></span>
                <span class="muted">{{ 'feed.suicide' | t }}</span>
              } @else {
                <span class="nm" [class]="r.kSide"><na-name [name]="r.e.killer" /></span>
                <span class="wp">{{ r.e.weapon }}</span>
                <span class="nm" [class]="r.vSide"><na-name [name]="r.e.victim" /></span>
              }
            </span>
            <span class="tags">
              @if (r.e.headshot) {
                <span class="tag hs" [title]="'feed.headshot' | t">HS</span>
              }
              @for (b of r.badges; track b) {
                <span class="tag" [class.fb]="b === 'First Blood'">{{ b }}</span>
              }
              @if (r.e.teamKill) {
                <span class="tag tk">{{ 'feed.teamKill' | t }}</span>
              }
            </span>
          </li>
        }
      </ol>
    </div>
  `,
  styles: `
    .feed {
      padding-bottom: 8px;
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .head h3 {
      margin: 0;
      font-family: var(--font-display);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-size: 1.15rem;
    }
    .live {
      color: var(--live);
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    ol {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: 420px;
      overflow-y: auto;
    }
    li {
      display: grid;
      grid-template-columns: 54px minmax(0, 1fr) auto;
      gap: 10px;
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
    @keyframes in {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
    }
    .t {
      font-size: 0.78rem;
    }
    li.chat .say {
      color: var(--text-2);
      font-style: italic;
      overflow-wrap: anywhere;
    }
    li.chat .say::before {
      content: '“';
    }
    li.chat .say::after {
      content: '”';
    }
    li.chat {
      quotes: none;
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
    .tag.tk {
      color: var(--muted);
    }
    @media (max-width: 640px) {
      li {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .t {
        display: none;
      }
    }
  `,
})
export class KillFeed {
  private readonly i18n = inject(I18n);
  /** Kills, oldest first. */
  readonly entries = input.required<KillFeedEntry[]>();
  /** Entrant id of side A (red); side B is blue. */
  readonly sideA = input.required<string>();

  protected readonly rows = computed(() => {
    const list = this.entries();
    const start = list[0]?.at ?? 0;
    const side = (s: string | null) => (s === null ? 'none' : s === this.sideA() ? 'a' : 'b');
    return [...list].reverse().map((e, i) => {
      const badges: string[] = [];
      if (e.firstBlood) badges.push('First Blood');
      if (SPREES[e.spree]) badges.push(SPREES[e.spree]!);
      if (e.multi >= 5) badges.push('Monster Kill');
      else if (MULTIS[e.multi]) badges.push(MULTIS[e.multi]!);
      const sec = Math.max(0, Math.round((e.at - start) / 1000));
      return {
        key: `${e.at}-${list.length - i}`,
        e,
        kSide: side(e.killerSide),
        vSide: side(e.victimSide),
        badges,
        time: `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`,
      };
    });
  });

  protected t(k: string) {
    return this.i18n.t(k);
  }
}
