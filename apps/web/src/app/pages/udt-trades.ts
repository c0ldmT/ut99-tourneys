import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { Coin } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { NeuroPipe } from '../core/neuro';
import type {
  UdtPartner,
  UdtPartnerBot,
  UdtTrade,
  UdtTradeOffer,
  UdtTradePreview,
  UdtTrades,
} from '../core/types';
import { rosterCard, UdtCard, UdtNav, type CardBot } from '../core/udt';

/**
 * Dream Team trades between managers: offers waiting for the manager and its own, a builder
 * (bots of both rosters, Neuro one way, the balance and the fees before sending), the history.
 */
@Component({
  selector: 'app-udt-trades',
  imports: [FormsModule, TPipe, NeuroPipe, Coin, UdtCard, UdtNav],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    @if (data(); as d) {
      <div class="udt-head">
        <div>
          <h1 class="disp">{{ 'udt.trades.title' | t }}</h1>
          <p class="muted">
            {{
              'udt.trades.rules'
                | t
                  : {
                      fee: d.rules.feePct,
                      bal: d.rules.balancePct,
                      lock: d.rules.lockDays,
                      h: d.rules.expiryHours,
                    }
            }}
            @if (d.rules.pairPerWeek) {
              {{ 'udt.trades.pair' | t: { n: d.rules.pairPerWeek } }}
            }
          </p>
        </div>
      </div>

      @if (!d.enabled) {
        <p class="card muted">{{ 'udt.trades.off' | t }}</p>
      }

      <section class="card">
        <h2>{{ 'udt.trades.open' | t }} ({{ d.open.length }})</h2>
        @for (t of d.open; track t.id) {
          <div class="offer" [class.in]="t.incoming">
            <div class="who">
              <span class="udt-mark" [class.own]="t.incoming">{{
                (t.incoming ? 'udt.trades.incoming' : 'udt.trades.outgoing') | t
              }}</span>
              <b
                ><span class="tag">{{ other(t).tag }}</span> {{ other(t).team }}
                <span class="muted small">({{ other(t).manager }})</span></b
              >
              <span class="muted small grow"
                >{{ 'udt.trades.until' | t }} {{ when(t.expiresAt) }}</span
              >
            </div>
            <div class="sides">
              <div class="side">
                <div class="kpi">{{ 'udt.trades.youGet' | t }}</div>
                @for (b of youGet(t); track b.botId) {
                  <span class="chip"
                    >{{ b.name }} <span class="mono">{{ b.skill }}</span></span
                  >
                }
                @if (neuroIn(t)) {
                  <span class="neuro"><na-coin [size]="13" /> {{ neuroIn(t) | neuro: false }}</span>
                }
                <div class="muted small">{{ 'udt.trades.worth' | t }} {{ valueIn(t) | neuro }}</div>
              </div>
              <div class="arrow" aria-hidden="true">⇄</div>
              <div class="side">
                <div class="kpi">{{ 'udt.trades.youGive' | t }}</div>
                @for (b of youGive(t); track b.botId) {
                  <span class="chip"
                    >{{ b.name }} <span class="mono">{{ b.skill }}</span></span
                  >
                }
                @if (neuroOut(t)) {
                  <span class="neuro"
                    ><na-coin [size]="13" /> {{ neuroOut(t) | neuro: false }}</span
                  >
                }
                <div class="muted small">
                  {{ 'udt.trades.worth' | t }} {{ valueOut(t) | neuro }}
                </div>
              </div>
            </div>
            @if (t.message) {
              <p class="msg">“{{ t.message }}”</p>
            }
            <div class="row">
              <span class="muted small grow"
                >{{ 'udt.trades.yourFee' | t }} {{ (t.incoming ? t.feeTo : t.feeFrom) | neuro }}
                @if (!t.incoming) {
                  · {{ 'udt.trades.held' | t }}
                }
              </span>
              @if (t.incoming) {
                <button type="button" [disabled]="busy()" (click)="decline(t)">
                  {{ 'udt.trades.decline' | t }}
                </button>
                <button type="button" class="primary" [disabled]="busy()" (click)="accept(t)">
                  {{ 'udt.trades.accept' | t }}
                </button>
              } @else {
                <button type="button" [disabled]="busy()" (click)="withdraw(t)">
                  {{ 'udt.trades.withdraw' | t }}
                </button>
              }
            </div>
          </div>
        } @empty {
          <p class="muted small">{{ 'udt.trades.none' | t }}</p>
        }
      </section>

      @if (d.enabled && d.mine.length) {
        <section class="card">
          <h2>{{ 'udt.trades.new' | t }}</h2>
          @if (!partners().length) {
            <p class="muted small">{{ 'udt.trades.noPartners' | t }}</p>
          } @else {
            <div class="newoffer">
              <label
                >{{ 'udt.trades.partner' | t }}
                <select [ngModel]="partnerId()" (ngModelChange)="setPartner($event)" name="partner">
                  @for (p of partners(); track p.userId) {
                    <option [ngValue]="p.userId">
                      {{ p.tag }} {{ p.name }} ({{ p.ai ? ('udt.ai' | t) : p.manager }})
                    </option>
                  }
                </select>
              </label>
              <div class="builder">
                <div class="col">
                  <h3>{{ 'udt.trades.youGive' | t }}</h3>
                  <div class="pick">
                    @for (b of d.mine; track b.botId) {
                      <button
                        type="button"
                        class="pb"
                        [class.on]="give().includes(b.botId)"
                        [disabled]="!!b.blocked"
                        [attr.aria-pressed]="give().includes(b.botId)"
                        [title]="b.blocked ? blockedText(b) : ''"
                        (click)="toggle('give', b.botId)"
                      >
                        <udt-card
                          [bot]="card(b)"
                          [small]="true"
                          [dim]="!!b.blocked"
                          [note]="
                            b.blocked ? blockedText(b) : b.homemade ? ('udt.trades.own' | t) : null
                          "
                        />
                      </button>
                    }
                  </div>
                  @if (!tradable(d.mine)) {
                    <p class="muted small">
                      {{ 'udt.trades.noneTradable' | t: { lock: d.rules.lockDays } }}
                    </p>
                  }
                  <label
                    >{{ 'udt.trades.addNeuro' | t }}
                    <input
                      type="number"
                      min="0"
                      step="10"
                      name="giveNeuro"
                      class="mono"
                      [ngModel]="giveNeuro()"
                      (ngModelChange)="setNeuro('give', $event)"
                    />
                  </label>
                </div>
                <div class="col">
                  <h3>{{ 'udt.trades.youGet' | t }}</h3>
                  <div class="pick">
                    @for (b of partner()?.roster ?? []; track b.botId) {
                      <button
                        type="button"
                        class="pb"
                        [class.on]="take().includes(b.botId)"
                        [disabled]="!!b.blocked"
                        [attr.aria-pressed]="take().includes(b.botId)"
                        [title]="b.blocked ? blockedText(b) : ''"
                        (click)="toggle('take', b.botId)"
                      >
                        <udt-card
                          [bot]="card(b, partner()?.tag)"
                          [small]="true"
                          [dim]="!!b.blocked"
                          [note]="
                            b.blocked ? blockedText(b) : b.homemade ? ('udt.trades.own' | t) : null
                          "
                        />
                      </button>
                    }
                  </div>
                  <label
                    >{{ 'udt.trades.askNeuro' | t }}
                    <input
                      type="number"
                      min="0"
                      step="10"
                      name="takeNeuro"
                      class="mono"
                      [ngModel]="takeNeuro()"
                      (ngModelChange)="setNeuro('take', $event)"
                    />
                  </label>
                </div>
              </div>

              <div class="balance" [class.bad]="!!previewError()">
                <div class="bars">
                  <div class="bl">
                    <span class="kpi">{{ 'udt.trades.youGive' | t }}</span>
                    <span class="udt-bar"><i [style.width.%]="share('give')"></i></span>
                    <span class="mono">{{ giveValue() | neuro }}</span>
                  </div>
                  <div class="bl">
                    <span class="kpi">{{ 'udt.trades.youGet' | t }}</span>
                    <span class="udt-bar"><i [style.width.%]="share('take')"></i></span>
                    <span class="mono">{{ takeValue() | neuro }}</span>
                  </div>
                </div>
                @if (previewError()) {
                  <p class="small err">{{ previewError() }}</p>
                } @else if (preview(); as p) {
                  <p class="small muted">
                    {{ 'udt.trades.feeYou' | t: { pct: p.feePct } }} {{ p.feeFrom | neuro }} ·
                    {{ 'udt.trades.feeThem' | t }} {{ p.feeTo | neuro }}
                  </p>
                }
              </div>
              <label
                >{{ 'udt.trades.message' | t }}
                <input type="text" maxlength="200" name="msg" [(ngModel)]="message" />
              </label>
              <div class="row">
                <button
                  type="button"
                  class="primary"
                  [disabled]="busy() || !preview() || !!previewError()"
                  (click)="send()"
                >
                  {{ 'udt.trades.send' | t }}
                </button>
                <span class="muted small">{{ 'udt.trades.sendHint' | t }}</span>
              </div>
            </div>
          }
        </section>
      }

      <section class="card">
        <h2>{{ 'udt.trades.history' | t }}</h2>
        @for (t of d.done; track t.id) {
          <div class="hrow">
            <span class="udt-mark st-{{ t.status }}">{{ 'udt.trades.st.' + t.status | t }}</span>
            <span class="grow"
              ><span class="tag">{{ other(t).tag }}</span> {{ other(t).team }}:
              {{ names(youGive(t)) || '–' }}
              @if (neuroOut(t)) {
                + {{ neuroOut(t) | neuro }}
              }
              ⇄ {{ names(youGet(t)) || '–' }}
              @if (neuroIn(t)) {
                + {{ neuroIn(t) | neuro }}
              }
            </span>
            <span class="muted small">{{ when(t.decidedAt ?? t.createdAt) }}</span>
          </div>
        } @empty {
          <p class="muted small">{{ 'udt.trades.noHistory' | t }}</p>
        }
      </section>
    }
  `,
  styles: `
    .offer {
      border-top: 1px solid var(--border);
      padding: 14px 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .who {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .grow {
      flex: 1 1 160px;
      min-width: 0;
    }
    .tag {
      color: var(--hot-text);
    }
    .sides {
      display: flex;
      gap: 14px;
      align-items: stretch;
      flex-wrap: wrap;
    }
    .side {
      flex: 1 1 220px;
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      background: #0c0f16;
      border: 1px solid var(--border);
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .side .kpi {
      width: 100%;
    }
    .side .muted {
      width: 100%;
    }
    .arrow {
      align-self: center;
      font-size: 1.4rem;
      color: var(--udt);
    }
    .chip {
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--bg-2);
      border: 1px solid var(--line);
      font-size: 0.85rem;
    }
    .msg {
      margin: 0;
      font-style: italic;
      color: var(--text-2);
    }
    .newoffer {
      display: grid;
      gap: 16px;
    }
    .newoffer > label,
    .col > label {
      display: grid;
      gap: 6px;
    }
    .builder {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
    }
    .col {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 14px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: #0c0f16;
    }
    .col h3 {
      margin: 0;
    }
    .pick {
      flex: 1;
      display: flex;
      flex-wrap: wrap;
      align-content: flex-start;
      align-items: flex-start;
      gap: 10px;
    }
    .pb {
      position: relative;
      padding: 3px;
      min-height: 0;
      border-radius: 18px;
      border: 2px solid transparent;
      background: transparent;
      transition:
        transform 0.15s,
        border-color 0.15s;
    }
    .pb:hover:not(:disabled) {
      border-color: var(--line);
    }
    .pb.on {
      border-color: var(--udt);
      box-shadow: 0 0 0 4px rgba(178, 107, 255, 0.18);
      transform: translateY(-3px);
    }
    .pb.on::after {
      content: '✓';
      position: absolute;
      top: -8px;
      right: -8px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: var(--udt);
      color: #0b0614;
      font-weight: 800;
      font-size: 0.8rem;
    }
    .pb:disabled {
      cursor: not-allowed;
      opacity: 1;
    }
    .balance {
      padding: 12px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
    }
    .balance.bad {
      border-color: rgba(255, 122, 135, 0.45);
    }
    .bars {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .bl {
      display: grid;
      grid-template-columns: 110px 1fr 110px;
      gap: 10px;
      align-items: center;
    }
    .bl .mono {
      text-align: right;
    }
    .bl i {
      background: var(--udt);
    }
    .err {
      color: var(--danger);
    }
    .hrow {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-top: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .st-accepted {
      color: var(--live);
    }
    .st-declined,
    .st-void {
      color: #ff9aa4;
    }
    @media (max-width: 560px) {
      .bl {
        grid-template-columns: 80px 1fr 90px;
      }
    }
  `,
})
export class UdtTradesPage {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  protected readonly data = signal<UdtTrades | null>(null);
  protected readonly partners = signal<UdtPartner[]>([]);
  protected readonly busy = signal(false);
  protected readonly partnerId = signal<string | null>(null);
  protected readonly give = signal<string[]>([]);
  protected readonly take = signal<string[]>([]);
  protected readonly giveNeuro = signal(0);
  protected readonly takeNeuro = signal(0);
  protected readonly preview = signal<UdtTradePreview | null>(null);
  protected readonly previewError = signal('');
  protected message = '';
  private timer: ReturnType<typeof setTimeout> | undefined;

  protected readonly partner = computed(
    () => this.partners().find((p) => p.userId === this.partnerId()) ?? null,
  );
  /** Values as the page knows them (the preview has the API's numbers). */
  protected readonly giveValue = computed(
    () =>
      this.preview()?.giveValue ??
      (this.data()?.mine ?? [])
        .filter((b) => this.give().includes(b.botId))
        .reduce((n, b) => n + b.value, 0) + this.giveNeuro(),
  );
  protected readonly takeValue = computed(
    () =>
      this.preview()?.takeValue ??
      (this.partner()?.roster ?? [])
        .filter((b) => this.take().includes(b.botId))
        .reduce((n, b) => n + b.value, 0) + this.takeNeuro(),
  );

  constructor() {
    void this.load();
  }

  async load() {
    try {
      const [d, p] = await Promise.all([this.api.udtTrades(), this.api.udtPartners()]);
      this.data.set(d);
      this.partners.set(p);
      if (!p.some((x) => x.userId === this.partnerId())) this.setPartner(p[0]?.userId ?? null);
    } catch {
      // the toast shows the error
    }
  }

  protected other(t: UdtTrade) {
    return t.incoming ? t.from : t.to;
  }
  /** From the manager's side: what comes in and what goes out. */
  protected youGet(t: UdtTrade) {
    return t.incoming ? t.give : t.take;
  }
  protected youGive(t: UdtTrade) {
    return t.incoming ? t.take : t.give;
  }
  protected neuroIn(t: UdtTrade) {
    return t.incoming ? t.giveNeuro : t.takeNeuro;
  }
  protected neuroOut(t: UdtTrade) {
    return t.incoming ? t.takeNeuro : t.giveNeuro;
  }
  protected valueIn(t: UdtTrade) {
    return t.incoming ? t.giveValue : t.takeValue;
  }
  protected valueOut(t: UdtTrade) {
    return t.incoming ? t.takeValue : t.giveValue;
  }
  protected names(bots: { name: string }[]) {
    return bots.map((b) => b.name).join(', ');
  }
  protected when(iso: string) {
    return this.i18n.date(iso);
  }

  protected card(b: UdtPartnerBot, tag?: string): CardBot {
    // Own bots: the tag is the part of the game name in front of the bot's name.
    const own = b.gameName.endsWith(b.name) ? b.gameName.slice(0, -b.name.length) : '';
    return rosterCard(b, tag ?? own);
  }

  /** At least one bot of the list can be traded now. */
  protected tradable(list: readonly UdtPartnerBot[]): boolean {
    return list.some((b) => !b.blocked);
  }

  protected blockedText(b: UdtPartnerBot) {
    if (b.blocked === 'locked' && b.unlocksAt)
      return this.i18n.t('udt.trades.locked', { at: this.i18n.date(b.unlocksAt) });
    return this.i18n.t(`udt.trades.blocked.${b.blocked}`);
  }

  protected setPartner(id: string | null) {
    this.partnerId.set(id);
    this.take.set([]);
    this.takeNeuro.set(0);
    this.schedule();
  }

  protected toggle(side: 'give' | 'take', id: string) {
    const s = side === 'give' ? this.give : this.take;
    s.update((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
    this.schedule();
  }

  /** Neuro goes one way: entering it on one side clears the other. */
  protected setNeuro(side: 'give' | 'take', v: number) {
    const n = Math.max(0, Math.round(Number(v) || 0));
    (side === 'give' ? this.giveNeuro : this.takeNeuro).set(n);
    if (n > 0) (side === 'give' ? this.takeNeuro : this.giveNeuro).set(0);
    this.schedule();
  }

  private offer(): UdtTradeOffer | null {
    const to = this.partnerId();
    if (!to || this.give().length + this.take().length === 0) return null;
    return {
      to,
      give: this.give(),
      take: this.take(),
      giveNeuro: this.giveNeuro(),
      takeNeuro: this.takeNeuro(),
      ...(this.message.trim() ? { message: this.message.trim() } : {}),
    };
  }

  /** Asks the API for values, balance and fees shortly after the last change. */
  private schedule() {
    this.preview.set(null);
    this.previewError.set('');
    clearTimeout(this.timer);
    const o = this.offer();
    if (!o) return;
    this.timer = setTimeout(async () => {
      try {
        this.preview.set(await this.api.udtTradePreview(o));
      } catch (e) {
        this.previewError.set(errorText(e));
      }
    }, 250);
  }

  protected share(side: 'give' | 'take') {
    const g = this.giveValue();
    const t = this.takeValue();
    const max = Math.max(g, t, 1);
    return ((side === 'give' ? g : t) / max) * 100;
  }

  protected async send() {
    const o = this.offer();
    if (!o) return;
    await this.act(async () => {
      this.data.set(await this.api.udtPropose(o));
      this.give.set([]);
      this.take.set([]);
      this.giveNeuro.set(0);
      this.takeNeuro.set(0);
      this.message = '';
      this.preview.set(null);
    });
  }

  protected async accept(t: UdtTrade) {
    if (!confirm(this.i18n.t('udt.trades.acceptConfirm', { fee: t.feeTo }))) return;
    await this.act(async () => {
      this.data.set(await this.api.udtAccept(t.id));
      this.partners.set(await this.api.udtPartners());
    });
  }

  protected async decline(t: UdtTrade) {
    await this.act(async () => this.data.set(await this.api.udtDecline(t.id)));
  }

  protected async withdraw(t: UdtTrade) {
    await this.act(async () => this.data.set(await this.api.udtWithdrawTrade(t.id)));
  }

  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    try {
      await fn();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
