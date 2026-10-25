import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import type { UdtKeeperBot, UdtKeepers } from '../core/types';
import { SKILL_NAMES, UdtCard, type CardBot } from '../core/udt';

/**
 * Keeper choice at the season's end (league plan L-E7, design "Mein Team · Keeper"): the own
 * bots as cards, tap to keep up to two, the skill they will have next season, then save.
 */
@Component({
  selector: 'app-udt-keepers',
  imports: [TPipe, UdtCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (view(); as k) {
      @if (k.open && k.bots.length) {
        <section class="card udt-keep" aria-labelledby="udt-keep-h">
          <div class="kh">
            <div>
              <div class="kpi" style="color: var(--udt)">{{ deadline() }}</div>
              <h2 id="udt-keep-h">{{ 'udt.keep.title' | t }}</h2>
              <p class="muted">{{ 'udt.keep.intro' | t: { n: k.max } }}</p>
            </div>
            <div class="count">
              <b>{{ picked().length }} / {{ k.max }}</b>
              <span class="muted small">{{ 'udt.keep.chosen' | t }}</span>
            </div>
          </div>
          <div class="kbots">
            @for (b of k.bots; track b.botId) {
              @let on = picked().includes(b.botId);
              @let off = !b.ok || (full() && !on);
              <div class="kb">
                <button
                  type="button"
                  class="kpick"
                  [class.on]="on"
                  [disabled]="off"
                  [attr.aria-pressed]="on"
                  [attr.aria-describedby]="'udt-keep-n-' + b.botId"
                  [attr.aria-label]="
                    b.ok
                      ? ((on ? 'udt.keep.ariaOn' : 'udt.keep.ariaOff') | t: { name: b.name })
                      : b.name + ': ' + note(b)
                  "
                  (click)="toggle(b)"
                >
                  <udt-card
                    [bot]="card(b, k.tag)"
                    [small]="small"
                    [dim]="off && !on"
                    [note]="note(b)"
                    [badge]="on ? ('udt.keep.badge' | t) : null"
                  />
                </button>
                <div class="next" [class.on]="on" [id]="'udt-keep-n-' + b.botId">
                  @if (!b.ok) {
                    {{ 'udt.keep.notOk' | t }}
                  } @else {
                    {{
                      (on ? 'udt.keep.nextOn' : 'udt.keep.next')
                        | t
                          : {
                              s: (k.season ?? 0) + 1,
                              skill: b.nextSkill,
                              name: skillName(b.nextSkill),
                            }
                    }}
                  }
                </div>
              </div>
            }
          </div>
          <div class="kfoot">
            <ul class="muted">
              <li>{{ 'udt.keep.rule1' | t: { n: k.skillLoss ?? 1 } }}</li>
              <li>{{ 'udt.keep.rule2' | t }}</li>
              <li>{{ 'udt.keep.rule3' | t }}</li>
            </ul>
            <button type="button" class="primary" [disabled]="busy() || !dirty()" (click)="save()">
              {{ 'udt.keep.save' | t }}
            </button>
          </div>
        </section>
      }
    }
  `,
  styles: `
    .udt-keep {
      border-color: var(--udt);
      box-shadow: 0 0 0 4px rgba(178, 107, 255, 0.1);
    }
    .kh {
      display: flex;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
    }
    .kh h2 {
      margin: 4px 0 0;
    }
    .kh p {
      margin: 6px 0 0;
      max-width: 720px;
    }
    .count {
      margin-left: auto;
      text-align: right;
      display: flex;
      flex-direction: column;
    }
    .count b {
      font-family: var(--font-display);
      font-size: 1.9rem;
    }
    .kbots {
      display: flex;
      flex-wrap: wrap;
      gap: 22px 18px;
      margin-top: 24px;
    }
    .kb {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      width: 180px;
    }
    .kpick {
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      border-radius: 18px;
      cursor: pointer;
    }
    .kpick:disabled {
      cursor: default;
      opacity: 1;
    }
    .kpick.on {
      outline: 3px solid var(--accent);
      outline-offset: 4px;
    }
    .next {
      font-size: 0.82rem;
      font-weight: 700;
      text-align: center;
      color: var(--muted);
    }
    .next.on {
      color: var(--accent);
    }
    .kfoot {
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      align-items: center;
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
    }
    .kfoot ul {
      margin: 0;
      padding-left: 18px;
      flex: 1 1 420px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    @media (max-width: 520px) {
      .kbots {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 22px 12px;
        justify-items: center;
      }
      .kb {
        width: auto;
      }
      .count {
        margin-left: 0;
        width: 100%;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        border-radius: 10px;
        background: var(--panel);
        border: 1px solid var(--line);
      }
      .kfoot button {
        width: 100%;
      }
    }
  `,
})
export class UdtKeepersPanel {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  /** The choice was saved. */
  readonly changed = output<void>();
  protected readonly view = signal<UdtKeepers | null>(null);
  protected readonly picked = signal<string[]>([]);
  protected readonly busy = signal(false);
  /** Small cards on narrow screens (two per row, design "Handy · Keeper wählen"). */
  protected readonly small = typeof window !== 'undefined' && window.innerWidth <= 520;
  protected readonly full = computed(() => this.picked().length >= (this.view()?.max ?? 0));
  protected readonly dirty = computed(() => {
    const saved = [...(this.view()?.chosen ?? [])].sort().join();
    return [...this.picked()].sort().join() !== saved;
  });
  /** "Season end · until Sunday 23:59" (between seasons: until the next season starts). */
  protected readonly deadline = computed(() => {
    const k = this.view();
    if (!k?.until) return this.i18n.t('udt.keep.untilNext');
    const [y, m, d] = k.until.split('-').map(Number) as [number, number, number];
    const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(
      this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB',
      { weekday: 'long', timeZone: 'UTC' },
    );
    return this.i18n.t('udt.keep.until', { day });
  });

  constructor() {
    void this.load();
  }

  async load() {
    try {
      const k = await this.api.udtKeepers();
      this.view.set(k);
      this.picked.set([...k.chosen]);
    } catch {
      this.view.set(null);
    }
  }

  protected toggle(b: UdtKeeperBot) {
    const cur = this.picked();
    if (cur.includes(b.botId)) this.picked.set(cur.filter((x) => x !== b.botId));
    else if (b.ok && !this.full()) this.picked.set([...cur, b.botId]);
  }

  protected async save() {
    this.busy.set(true);
    try {
      const k = await this.api.udtSetKeepers(this.picked());
      this.view.set(k);
      this.picked.set([...k.chosen]);
      this.changed.emit();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }

  protected card(b: UdtKeeperBot, tag?: string): CardBot {
    return {
      name: b.name,
      skill: b.skill,
      rarity: b.rarity,
      traits: b.traits,
      level: b.level,
      ...(tag ? { tag } : {}),
      ...(b.potential ? { potential: b.potential } : {}),
    };
  }

  protected note(b: UdtKeeperBot): string {
    if (b.why) return this.i18n.t(`udt.keep.why.${b.why}`);
    return b.origin ? this.i18n.t(`udt.academy.origin.${b.origin}`) : '';
  }

  protected skillName(s: number) {
    return SKILL_NAMES[Math.max(0, Math.min(7, Math.round(s)))];
  }
}
