import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forYou, type ForYouItem } from '../core/for-you';
import { I18n, TPipe } from '../core/i18n';
import type { UdtHub } from '../core/types';
import { UDT_AREAS } from '../core/udt-areas';

/** Cards shown before "n more". */
const SHOWN = 3;
/** Remembered per browser and item: put off until this day (the hub's `today`). */
const LATER = 'tourney.fd.';

/**
 * "For you" on the Dream Team hub (decision 311): everything that needs the manager in one row
 * of cards, most urgent first - one sentence, one line of context, one button. "Later" hides a
 * card until the next day (this browser); an incomplete lineup before a game cannot be put off.
 */
@Component({
  selector: 'udt-for-you',
  imports: [RouterLink, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hub().team) {
      <section class="fy" aria-labelledby="fy-t">
        <div class="fy-head">
          <h2 id="fy-t">{{ 'udt.fd.title' | t }}</h2>
          @if (items().length) {
            <span class="fy-n">{{ items().length }}</span>
          }
        </div>
        @if (items().length) {
          <div class="fy-cards">
            @for (i of shown(); track i.id) {
              <article class="fy-card" [class.urgent]="i.urgent" [style.--ac]="color(i)">
                <span class="fy-what">{{ what(i) }}</span>
                <b class="fy-t">{{ title(i) }}</b>
                @if (sub(i); as s) {
                  <span class="fy-s">{{ s }}</span>
                }
                <div class="fy-row">
                  <a class="btn primary" [routerLink]="i.link">{{ i.action | t }}</a>
                  @if (!i.urgent) {
                    <button
                      type="button"
                      class="link fy-later"
                      [title]="'udt.fd.laterHint' | t"
                      (click)="later(i)"
                    >
                      {{ 'udt.fd.later' | t }}
                    </button>
                  }
                </div>
              </article>
            }
          </div>
          @if (items().length > shownMax) {
            <button type="button" class="link fy-more" (click)="all.set(!all())">
              {{
                all() ? ('udt.fd.less' | t) : ('udt.fd.more' | t: { n: items().length - shownMax })
              }}
            </button>
          }
        } @else {
          <p class="fy-none">{{ none() }}</p>
        }
      </section>
    }
  `,
  styles: `
    .fy {
      margin: 14px 0 6px;
    }
    .fy-head {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .fy-head h2 {
      margin: 0;
      font-size: var(--fs-lg);
    }
    .fy-n {
      background: var(--hot);
      color: var(--bg);
      font-weight: 700;
      font-size: var(--fs-xs);
      border-radius: var(--radius-pill);
      padding: 1px 8px;
    }
    .fy-cards {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .fy-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px 14px 14px 18px;
      overflow: hidden;
    }
    .fy-card::before {
      content: '';
      position: absolute;
      inset: 0 auto 0 0;
      width: 4px;
      background: var(--ac);
    }
    .fy-card.urgent {
      border-color: color-mix(in srgb, var(--hot) 45%, transparent);
      background: color-mix(in srgb, var(--hot) 7%, var(--panel));
    }
    .fy-what {
      color: var(--ac);
      font-size: var(--fs-xs);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .fy-t {
      line-height: 1.3;
    }
    .fy-s {
      color: var(--text-2);
      font-size: var(--fs-sm);
    }
    .fy-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: auto;
      padding-top: 6px;
    }
    .fy-later {
      margin-left: auto;
      color: var(--muted);
    }
    .fy-more {
      margin-top: 8px;
    }
    .fy-none {
      margin: 0;
      color: var(--muted);
      background: var(--panel);
      border: 1px dashed var(--line);
      border-radius: var(--radius);
      padding: 12px 14px;
    }
    @media (max-width: 900px) {
      .fy-cards {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class UdtForYou {
  private readonly i18n = inject(I18n);
  readonly hub = input.required<UdtHub>();
  protected readonly shownMax = SHOWN;
  protected readonly all = signal(false);
  /** Items put off in this session (the stored ones are read in `items`). */
  private readonly putOff = signal<ReadonlySet<string>>(new Set());

  protected readonly items = computed(() => {
    const h = this.hub();
    const off = this.putOff();
    return forYou(h).filter((i) => i.urgent || (!off.has(i.id) && stored(i.id) !== h.today));
  });
  protected readonly shown = computed(() =>
    this.all() ? this.items() : this.items().slice(0, SHOWN),
  );

  protected color(i: ForYouItem): string {
    if (i.urgent) return 'var(--hot)';
    return UDT_AREAS.find((a) => a.id === i.area)?.color ?? 'var(--accent)';
  }

  /** The card's top line: the area, or for an urgent lineup when the game is. */
  protected what(i: ForYouItem): string {
    if (i.urgent && i.sub) {
      const area = i.sub.key === 'udt.fd.lineupLeague' ? 'udt.area.league' : 'udt.area.cups';
      return `${this.i18n.t(area)} · ${this.i18n.when(String(i.sub.params['at']), 'relShort')}`;
    }
    return this.i18n.t(`udt.area.${i.area}`);
  }

  protected title(i: ForYouItem): string {
    const p: Record<string, string | number> = { ...i.params };
    if (typeof p['at'] === 'string') p['when'] = this.i18n.when(p['at'], 'relShort');
    return this.i18n.t(i.title, p);
  }

  protected sub(i: ForYouItem): string | null {
    const s = i.sub;
    if (!s) return null;
    const p: Record<string, string | number> = { ...s.params };
    if (typeof p['at'] === 'string') p['when'] = this.i18n.when(p['at'], 'relShort');
    if (s.key === 'udt.fd.lineupLeague') p['what'] = this.leagueWhat(p);
    return this.i18n.t(s.key, p);
  }

  /** Nothing to do: says so, with the next league game if there is one. */
  protected none(): string {
    const next = this.hub().league.next;
    if (!next) return this.i18n.t('udt.fd.none');
    return this.i18n.t('udt.fd.noneNext', {
      what: this.leagueWhat({ kind: next.kind, matchday: next.matchday ?? 0 }),
      opp: next.opponent,
      when: this.i18n.when(next.at, 'relShort'),
    });
  }

  protected later(i: ForYouItem) {
    try {
      localStorage.setItem(LATER + i.id, this.hub().today);
    } catch {
      // storage unavailable: hidden for this visit only
    }
    this.putOff.update((s) => new Set([...s, i.id]));
  }

  private leagueWhat(p: Record<string, string | number>): string {
    return p['kind'] === 'league'
      ? this.i18n.t('udt.hub.league.matchday', { n: p['matchday'] ?? 0 })
      : this.i18n.t(`league.kind.${p['kind']}`);
  }
}

function stored(id: string): string | null {
  try {
    return localStorage.getItem(LATER + id);
  } catch {
    return null;
  }
}
