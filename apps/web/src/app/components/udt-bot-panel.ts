import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  type ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { cannotDevelop, DEFAULT_ECONOMY, DEVELOP_COST } from '@tourney/udt';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import { NeuroPipe } from '../core/neuro';
import type { UdtRosterBot, UdtTraitOnBot } from '../core/types';
import { rosterCard, SCRAP, staminaColor, UdtCard, xpStep, type CardBot } from '../core/udt';
import { lookBody, lookFromBot, UdtBotLook, type LookDraft, type UdtLooks } from './udt-bot-look';
import { UdtPotential } from './udt-potential';
import { UdtRename } from './udt-rename';

type Stat = 'accuracy' | 'alertness' | 'strafing' | 'skill';
const STATS: readonly Stat[] = ['accuracy', 'alertness', 'strafing', 'skill'];
const SHORT: Readonly<Record<Stat, string>> = {
  accuracy: 'ACC',
  alertness: 'ALT',
  strafing: 'STR',
  skill: 'Skill',
};

/**
 * A roster bot's details on My team (a dialog): the card, level and experience, the development
 * points of own bots with a preview of each step, the traits on it, rest with Neuro, the one free
 * renaming, look and lines, selling a bought bot. Every action reloads the page (`changed`).
 */
@Component({
  selector: 'udt-bot-panel',
  imports: [
    FormsModule,
    RouterLink,
    TPipe,
    NeuroPipe,
    UdtCard,
    UdtBotLook,
    UdtRename,
    UdtPotential,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="panel" aria-labelledby="udt-panel-title" (close)="closed.emit()">
      @if (bot(); as b) {
        <div class="head">
          <h2 id="udt-panel-title" class="disp">{{ b.gameName }}</h2>
          <button type="button" class="x" [attr.aria-label]="'toast.close' | t" (click)="close()">
            ×
          </button>
        </div>
        <div class="body">
          <div class="left">
            <udt-card [bot]="card(b)" />
            <span class="muted small">
              @if (b.starter) {
                {{ 'udt.starter' | t }}
              } @else if (b.own) {
                {{ 'udt.academy.origin.' + b.own.origin | t }}
              } @else {
                {{ 'udt.paid' | t }} {{ b.price | neuro }}
              }
            </span>
            <a class="small" [routerLink]="['/udt/bot', b.botId]" (click)="close()">{{
              'udt.bot.statsLink' | t
            }}</a>
          </div>
          <div class="right">
            <section>
              <h3>{{ 'udt.level' | t }} {{ b.level }}</h3>
              @if (xp(); as x) {
                <div class="udt-bar xp big"><i [style.width.%]="x.pct"></i></div>
                <p class="muted small">
                  {{
                    'udt.points.xpLine'
                      | t: { xp: x.in, need: x.need, left: x.need - x.in, lv: b.level + 1 }
                  }}
                </p>
              }
            </section>

            @if (b.own; as own) {
              <section class="dev" [class.has]="own.points > 0">
                <div class="row between">
                  <h3>{{ 'udt.academy.points' | t }}</h3>
                  <span class="pts" [class.zero]="own.points === 0">{{ own.points }}</span>
                </div>
                <udt-potential [skill]="b.skill" [potential]="own.potential" />
                <p class="muted small">{{ 'udt.points.explain' | t }}</p>
                <div class="steps">
                  @for (s of stats; track s) {
                    @let why = whyNot(b, s);
                    <button
                      type="button"
                      class="step"
                      [class.capped]="why === 'potential'"
                      [disabled]="busy() || why !== null"
                      [title]="why ? ('udt.points.why.' + why | t) : ''"
                      (click)="develop(b, s)"
                    >
                      <b>{{ 'udt.academy.dev.' + s | t }}</b>
                      @if (why === 'potential') {
                        <span class="small">{{ 'udt.points.skillMax' | t }}</span>
                      } @else {
                        <span class="mono small">{{ preview(b, s) }}</span>
                        <span class="cost">{{ 'udt.points.cost' | t: { n: cost[s] } }}</span>
                      }
                    </button>
                  }
                </div>
              </section>
            } @else {
              <p class="muted small">{{ 'udt.points.bought' | t }}</p>
            }

            <section>
              <h3>
                {{ 'udt.traits.title' | t }}
                <span class="muted small">{{ b.udtTraits.length }} / {{ b.slots }}</span>
              </h3>
              <div class="udt-traits">
                @for (tr of b.udtTraits; track tr.id) {
                  <span class="udt-trait r-{{ tr.rarity }}" [title]="'udt.traitE.' + tr.code | t"
                    >{{ 'udt.trait.' + tr.code | t }}
                    <button
                      type="button"
                      class="tx"
                      [attr.aria-label]="'udt.traits.remove' | t"
                      [disabled]="busy()"
                      (click)="unassign(tr)"
                    >
                      ×
                    </button></span
                  >
                } @empty {
                  <span class="muted small">{{ 'udt.points.noTraits' | t }}</span>
                }
              </div>
            </section>

            <section>
              <h3>{{ 'udt.stamina' | t }} {{ b.stamina }}</h3>
              <div class="udt-bar">
                <i [style.width.%]="b.stamina" [style.background]="color(b.stamina)"></i>
              </div>
              @if (b.stamina < 100) {
                <label class="restslider"
                  ><span>{{ 'udt.rest.points' | t }}</span>
                  <input
                    type="range"
                    name="rest"
                    min="1"
                    [max]="100 - b.stamina"
                    step="1"
                    [ngModel]="restPoints()"
                    (ngModelChange)="restPoints.set(+$event)"
                  />
                  <span class="mono">+{{ restPoints() }}</span>
                </label>
                <button
                  type="button"
                  [disabled]="
                    busy() || (spendable() !== null && restPoints() * restPrice > spendable()!)
                  "
                  (click)="rest(b)"
                >
                  {{ 'udt.rest.buy' | t }} · {{ restPoints() * restPrice | neuro }}
                </button>
              }
            </section>

            @if (b.own) {
              <section>
                @if (b.own.canRename) {
                  <udt-rename [botId]="b.botId" [name]="b.name" (renamed)="changed.emit()" />
                } @else {
                  <p class="muted small">{{ 'udt.points.renamed' | t }}</p>
                }
                @if (look(); as ld) {
                  <app-udt-bot-look [draft]="ld" [looks]="looks()" />
                  <span class="row">
                    <button type="button" class="primary" [disabled]="busy()" (click)="saveLook(b)">
                      {{ 'common.save' | t }}
                    </button>
                    <button type="button" (click)="look.set(null)">
                      {{ 'common.cancel' | t }}
                    </button>
                  </span>
                } @else {
                  <button type="button" [disabled]="busy()" (click)="openLook(b)">
                    {{ 'udt.look.button' | t }}
                  </button>
                }
              </section>
            } @else if (!b.starter) {
              <section>
                <button type="button" class="danger" [disabled]="busy()" (click)="sell(b)">
                  {{ 'udt.sell' | t }} · {{ sellPrice(b) | neuro }}
                </button>
              </section>
            }
          </div>
        </div>
      }
    </dialog>
  `,
  styles: `
    .panel {
      width: min(820px, calc(100vw - 16px));
      max-height: min(92vh, 1000px);
      padding: 0;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      color: var(--text);
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
    }
    .panel::backdrop {
      background: rgba(4, 6, 10, 0.72);
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 18px 8px;
      border-bottom: 1px solid var(--border);
    }
    .head h2 {
      margin: 0;
      font-size: 1.6rem;
    }
    .x {
      background: none;
      border: none;
      color: var(--muted);
      font-size: 1.6rem;
      cursor: pointer;
    }
    .body {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      padding: 16px 18px 20px;
    }
    .left {
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      margin: 0 auto;
    }
    .right {
      flex: 1 1 340px;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    h3 {
      margin: 0;
      font-size: 1rem;
    }
    .between {
      justify-content: space-between;
      align-items: center;
    }
    .udt-bar.xp.big {
      height: 8px;
    }
    .dev {
      padding: 12px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
      background: var(--panel-2);
    }
    .dev.has {
      border-color: rgba(245, 184, 61, 0.6);
      box-shadow: 0 0 0 3px rgba(245, 184, 61, 0.1);
    }
    .pts {
      min-width: 40px;
      height: 40px;
      padding: 0 10px;
      border-radius: 999px;
      display: grid;
      place-items: center;
      font-weight: 800;
      font-size: 1.3rem;
      color: #2a1a00;
      background: linear-gradient(135deg, #ffe08a, #f5b83d 60%, #d98e1c);
    }
    .pts.zero {
      color: var(--muted);
      background: var(--panel-3);
    }
    .steps {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
    }
    .step {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      padding: 8px 10px;
      text-align: left;
    }
    .step .cost {
      font-size: 0.72rem;
      color: var(--neuro-text);
    }
    .step.capped {
      border-style: dashed;
    }
    .tx {
      min-height: 0;
      height: 16px;
      padding: 0 2px;
      border: 0;
      background: transparent;
      color: inherit;
      line-height: 1;
    }
    .restslider {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .restslider input {
      flex: 1;
    }
  `,
})
export class UdtBotPanel {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  /** The bot shown; null: closed. */
  readonly bot = input<UdtRosterBot | null>(null);
  readonly tag = input<string | undefined>(undefined);
  readonly spendable = input<number | null>(null);
  readonly looks = input<UdtLooks | null>(null);
  readonly changed = output<void>();
  readonly closed = output<void>();

  protected readonly busy = signal(false);
  protected readonly restPoints = signal(1);
  protected readonly look = signal<LookDraft | null>(null);
  protected readonly stats = STATS;
  protected readonly cost = DEVELOP_COST;
  protected readonly restPrice = DEFAULT_ECONOMY.restPrice;
  protected readonly xp = computed(() => {
    const b = this.bot();
    return b ? xpStep(b.xp, b.level) : null;
  });
  private shownId: string | null = null;

  constructor() {
    effect(() => {
      const b = this.bot();
      const d = this.dlg().nativeElement;
      const max = b ? Math.max(1, 100 - b.stamina) : 1;
      if (b && b.botId !== this.shownId) {
        this.look.set(null);
        this.restPoints.set(max);
      } else if (b && untracked(this.restPoints) > max) this.restPoints.set(max);
      this.shownId = b?.botId ?? null;
      if (b && !d.open) d.showModal();
      if (!b && d.open) d.close();
    });
  }

  close() {
    this.dlg().nativeElement.close();
  }

  protected card(b: UdtRosterBot): CardBot {
    return rosterCard(b, this.tag());
  }

  protected color(s: number) {
    return staminaColor(s);
  }

  /**
   * Why a step is not possible; the exact potential shows from level 5 (until then the top). A
   * reached potential comes first (also without points), so the skill step says why it is closed.
   */
  protected whyNot(b: UdtRosterBot, s: Stat): 'points' | 'potential' | 'max' | null {
    if (!b.own) return 'points';
    if (s === 'skill' && Math.round(b.skill) >= b.own.potential[1]) return 'potential';
    return cannotDevelop(
      s,
      { skill: b.skill, potential: b.own.potential[1], values: b.traits },
      b.own.points,
    );
  }

  /** The value now and after the step: "50 → 55" (skill "4 → 5"). */
  protected preview(b: UdtRosterBot, s: Stat): string {
    if (s === 'skill') return `${Math.round(b.skill)} → ${Math.round(b.skill) + 1}`;
    const now = Math.round(((b.traits[s] ?? 0) + 1) * 50);
    return `${SHORT[s]} ${now} → ${Math.min(100, now + 5)}`;
  }

  protected sellPrice(b: UdtRosterBot) {
    return Math.round((b.value * DEFAULT_ECONOMY.sellBack) / 10) * 10;
  }

  protected async develop(b: UdtRosterBot, s: Stat) {
    await this.act(() => this.api.udtDevelop(b.botId, s));
  }

  protected async rest(b: UdtRosterBot) {
    await this.act(() => this.api.udtRest(b.botId, this.restPoints()));
  }

  protected async unassign(t: UdtTraitOnBot) {
    const name = this.i18n.t(`udt.trait.${t.code}`);
    if (!confirm(this.i18n.t('udt.traits.removeConfirm', { name, n: SCRAP[t.rarity] }))) return;
    await this.act(() => this.api.udtUnassign(t.id));
  }

  protected async openLook(b: UdtRosterBot) {
    this.busy.set(true);
    try {
      this.look.set(lookFromBot(await this.api.botProfile(b.botId)));
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveLook(b: UdtRosterBot) {
    const d = this.look();
    if (!d) return;
    await this.act(async () => {
      await this.api.udtEditBot(b.botId, lookBody(d));
      this.look.set(null);
    });
  }

  protected async sell(b: UdtRosterBot) {
    if (!confirm(this.i18n.t('udt.sellConfirm', { name: b.name }))) return;
    await this.act(async () => {
      await this.api.udtSell(b.botId);
      this.close();
    });
  }

  private async act(fn: () => Promise<unknown>) {
    this.busy.set(true);
    try {
      await fn();
      this.changed.emit();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
