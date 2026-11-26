import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { NameTag } from '../core/looks';
import { RouterLink } from '@angular/router';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { NeuroPipe } from '../core/neuro';
import type { BetMatchView } from '../core/types';

/**
 * The bets of one match in two columns, one per side (like Salty Bet): pool and odds on top,
 * the bets below, biggest first, with the result after the match.
 */
@Component({
  selector: 'app-bet-columns',
  imports: [TPipe, RouterLink, NeuroPipe, NameTag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.scroll]': 'scroll()' },
  template: `
    <div class="sides2">
      @for (e of match().entrants; track e; let side = $index) {
        <div class="col" [class.b]="side === 1" [class.won]="match().winnerId === e">
          <div class="top">
            <div class="head">
              <span class="nm">{{ name(e) }}</span>
              <span class="sum mono">
                {{ match().pools?.[e]?.amount ?? 0 | neuro }}
                @if (match().odds?.[e]; as o) {
                  · ×{{ oddsText(o) }}
                }
              </span>
            </div>
            <div class="bar"><span [style.width.%]="share(e)"></span></div>
          </div>
          @for (x of sideBets(e); track x.id; let i = $index) {
            <div
              class="bet"
              [class.me]="!x.bot && x.id === meId()"
              [class.extra]="!!phoneCap() && i >= phoneCap()"
            >
              <span class="amt mono">{{ x.amount | neuro }}</span>
              <span class="who">
                @if (x.bot) {
                  <a [routerLink]="['/bots', x.id]">{{ x.name }}</a>
                  <span class="badge bot">BOT</span>
                } @else {
                  <a [routerLink]="['/stats/p', 'u:' + x.id]"
                    ><na-name [name]="x.name" [id]="x.id"
                  /></a>
                }
              </span>
              <span class="res mono" [class]="x.status">
                @switch (x.status) {
                  @case ('won') {
                    +{{ x.payout - x.amount | neuro }}
                  }
                  @case ('lost') {
                    −{{ x.amount | neuro }}
                  }
                  @case ('refunded') {
                    {{ 'bets.status.refunded' | t }}
                  }
                }
              </span>
            </div>
          } @empty {
            <div class="muted small none">{{ 'bets.noSideBets' | t }}</div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    /* Inside a box of fixed height (live row, decision 322): the bets scroll, each side's name,
       pool and odds stay on top. */
    :host(.scroll) {
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
    }
    :host(.scroll) .top {
      position: sticky;
      top: 0;
      z-index: 1;
      margin: -10px -12px 0;
      padding: 10px 12px 0;
      border-radius: var(--radius) var(--radius) 0 0;
      box-shadow: inset 0 3px 0 var(--side-a);
      background:
        linear-gradient(
          180deg,
          color-mix(in srgb, var(--side-a) 6%, transparent),
          color-mix(in srgb, var(--side-a) 3%, transparent)
        ),
        var(--panel);
    }
    :host(.scroll) .col.b .top {
      box-shadow: inset 0 3px 0 var(--side-b);
      background:
        linear-gradient(
          180deg,
          color-mix(in srgb, var(--side-b) 6%, transparent),
          color-mix(in srgb, var(--side-b) 3%, transparent)
        ),
        var(--panel);
    }
    /* Phones: the first bets of each side (the page offers all of them). */
    @media (max-width: 640px) {
      .bet.extra {
        display: none;
      }
    }
    .bar {
      height: 8px;
      background: var(--panel-2);
      border-radius: var(--radius-xs);
      overflow: hidden;
    }
    .bar span {
      display: block;
      height: 100%;
      background: var(--accent);
    }
    .sides2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-top: 6px;
      font-size: var(--fs-md);
    }
    .col {
      min-width: 0;
      box-shadow: inset 0 3px 0 var(--side-a);
      border: 1px solid var(--border);
      background:
        linear-gradient(
          180deg,
          color-mix(in srgb, var(--side-a) 6%, transparent),
          transparent 120px
        ),
        var(--panel);
      border-radius: var(--radius);
      padding: 10px 12px;
    }
    .col.b {
      box-shadow: inset 0 3px 0 var(--side-b);
      background:
        linear-gradient(
          180deg,
          color-mix(in srgb, var(--side-b) 6%, transparent),
          transparent 120px
        ),
        var(--panel);
    }
    .col.won {
      border-color: color-mix(in srgb, var(--live) 55%, transparent);
    }
    .col .head {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      align-items: baseline;
      flex-wrap: wrap;
      font-weight: 600;
    }
    .col.won .head .nm {
      color: var(--live);
    }
    .col .sum {
      font-weight: 700;
      font-size: var(--fs-sm);
      color: var(--neuro-text);
      white-space: nowrap;
    }
    .col .bar {
      margin: 4px 0 6px;
    }
    .col .bar span {
      background: var(--side-a);
    }
    .col.b .bar span {
      background: var(--side-b);
    }
    .bet {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 6px;
      align-items: baseline;
      padding: 5px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }
    .bet.me {
      background: var(--me-bg);
    }
    .bet .amt {
      color: var(--neuro-text);
      white-space: nowrap;
      font-size: var(--fs-sm);
    }
    .bet .who {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .bet .res {
      font-size: var(--fs-sm);
      white-space: nowrap;
    }
    .res.won {
      color: var(--live);
    }
    .res.lost {
      color: var(--danger);
    }
    .res.refunded {
      color: var(--muted);
    }
    .none {
      padding: 2px 0;
    }
    .badge {
      margin-left: 4px;
      font-size: var(--fs-2xs);
      padding: 0 5px;
      height: 17px;
    }
    .nm {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class BetColumns {
  private readonly auth = inject(Auth);
  private readonly i18n = inject(I18n);
  readonly match = input.required<BetMatchView>();
  /** Entrant id -> name. */
  readonly names = input<Record<string, string>>({});
  /** Scrolls in a box of fixed height, the heads of the sides stay on top. */
  readonly scroll = input(false, { transform: booleanAttribute });
  /** Phones: the bets shown per side (0 = all). */
  readonly phoneCap = input(0);
  protected readonly meId = computed(() => this.auth.me()?.id ?? null);

  protected name(e: string): string {
    return this.names()[e] || e;
  }

  protected sideBets(e: string) {
    return this.match().bets.filter((b) => b.pick === e);
  }

  protected total(): number {
    return Object.values(this.match().pools ?? {}).reduce((s, p) => s + p.amount, 0);
  }

  protected share(e: string): number {
    const t = this.total();
    return t ? Math.round(((this.match().pools?.[e]?.amount ?? 0) / t) * 100) : 0;
  }

  /** Odds with two decimals in the language's format (×1,31 / ×1.31). */
  protected oddsText(o: number): string {
    return o.toLocaleString(this.i18n.locale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
}
