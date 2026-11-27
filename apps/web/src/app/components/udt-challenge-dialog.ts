import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { Coin } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { formatNeuro, NeuroPipe } from '../core/neuro';
import type {
  ChallengeHardness,
  ChallengeMode,
  UdtChallenge,
  UdtChallengeBody,
  UdtChallengeOpponents,
  UdtChallengeRules,
  UdtChallenges,
  UdtChallengeSlots,
  UdtRivalry,
} from '../core/types';
import { Segment, type Choice } from './choice';

/** Who is challenged: a manager's team or an open challenge. */
type Target = { kind: 'team'; userId: string } | { kind: 'open'; scope: 'all' | 'tier' };

const HARDNESS: ChallengeHardness[] = ['normal', 'hard', 'nightmare'];

/** "9:58" from milliseconds. */
const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * The challenge dialog (decision 337, preview "Herausfordern"): opponent, format, start, stake
 * and a message in one form, the summary beside it. Also the counter offer (the challenger is
 * fixed, the answered challenge's values filled in).
 */
@Component({
  selector: 'udt-challenge-dialog',
  imports: [FormsModule, TPipe, NeuroPipe, Coin, Segment],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dlg class="chd" aria-labelledby="chd-title" (close)="closed.emit()">
      <header>
        <h2 id="chd-title" class="disp">
          {{
            (rematchOf()
              ? 'udt.ch.dlg.rematchTitle'
              : counterOf()
                ? 'udt.ch.dlg.counterTitle'
                : 'udt.ch.dlg.title'
            ) | t
          }}
        </h2>
        <button type="button" class="x" [attr.aria-label]="'toast.close' | t" (click)="close()">
          ×
        </button>
      </header>
      <div class="body">
        <div class="main">
          <section>
            <h3><span class="num">1</span>{{ 'udt.ch.dlg.opponent' | t }}</h3>
            @if (fixedName()) {
              <p>
                <b>{{ fixedName() }}</b>
                <span class="muted small"
                  >· {{ (rematchOf() ? 'udt.ch.dlg.rematchTo' : 'udt.ch.dlg.counterTo') | t }}</span
                >
              </p>
            } @else {
              <div class="opps">
                @for (o of opps()?.teams ?? []; track o.userId) {
                  <button
                    type="button"
                    class="opp"
                    [attr.aria-pressed]="isTeam(o.userId)"
                    [disabled]="!!why(o)"
                    (click)="pickTeam(o.userId)"
                  >
                    <b
                      >{{ o.tag }} {{ o.name }}
                      @if (o.ai) {
                        <span class="ai">{{ 'udt.ch.ai' | t }}</span>
                      }
                    </b>
                    <span class="meta">{{
                      'udt.ch.dlg.strength' | t: { n: num(o.strength) }
                    }}</span>
                    @if (why(o); as w) {
                      <span class="why">{{ w }}</span>
                    }
                  </button>
                }
                <button
                  type="button"
                  class="opp"
                  [attr.aria-pressed]="isOpen('all')"
                  (click)="target.set({ kind: 'open', scope: 'all' }); rivalry.set(null)"
                >
                  <b>{{ 'udt.ch.dlg.openAll' | t }}</b>
                  <span class="meta">{{ 'udt.ch.dlg.openAllHint' | t }}</span>
                </button>
                @if (tier() !== null) {
                  <button
                    type="button"
                    class="opp"
                    [attr.aria-pressed]="isOpen('tier')"
                    (click)="target.set({ kind: 'open', scope: 'tier' }); rivalry.set(null)"
                  >
                    <b>{{ 'udt.ch.dlg.openTier' | t }}</b>
                    <span class="meta">{{ 'udt.ch.dlg.openTierHint' | t }}</span>
                  </button>
                }
              </div>
            }
          </section>

          @if (rematchOf()) {
            <p class="muted">{{ 'udt.ch.dlg.rematchSame' | t }}</p>
          }
          <section [hidden]="!!rematchOf()">
            <h3><span class="num">2</span>{{ 'udt.ch.dlg.format' | t }}</h3>
            <div class="fmt">
              @if (modes().length > 1) {
                <na-segment
                  [options]="modes()"
                  [value]="mode()"
                  (valueChange)="setMode($event)"
                  label="udt.ch.dlg.mode"
                />
              }
              @if (mode() === 'dm') {
                <na-segment
                  [options]="sizes()"
                  [value]="teamSize()"
                  (valueChange)="setSize($event)"
                  label="udt.ch.dlg.size"
                />
                <na-segment
                  [options]="bests()"
                  [value]="bestOf()"
                  (valueChange)="setBestOf($event)"
                  label="udt.ch.dlg.bestOf"
                />
              } @else {
                <span class="chip">5v5 · Bo1</span>
              }
              <label class="map">
                <span class="muted small">{{ 'udt.ch.dlg.map' | t }}</span>
                <select [ngModel]="map()" (ngModelChange)="map.set($event)">
                  <option [ngValue]="null">{{ 'udt.ch.dlg.vote' | t }}</option>
                  @for (m of maps(); track m) {
                    <option [ngValue]="m">{{ m }}</option>
                  }
                </select>
              </label>
            </div>
            @if (mode() === 'mh') {
              <div class="hard">
                @for (h of hardnessOpen(); track h) {
                  <button
                    type="button"
                    class="hd"
                    [attr.aria-pressed]="hardness() === h"
                    (click)="hardness.set(h)"
                  >
                    <b>{{ 'udt.ch.hard.' + h | t }}</b>
                    <span>{{ 'udt.ch.hardD.' + h | t }}</span>
                    <span>{{ record(h) }}</span>
                  </button>
                }
              </div>
              <p class="muted small">
                {{ 'udt.ch.dlg.mhNote' | t: { bonus: rules().mh.recordBonus } }}
              </p>
            }
          </section>

          <section>
            <h3><span class="num">3</span>{{ 'udt.ch.dlg.when' | t }}</h3>
            <div class="days">
              @for (d of slots()?.days ?? []; track d.date; let i = $index) {
                <button
                  type="button"
                  class="day"
                  [attr.aria-pressed]="dayIndex() === i"
                  (click)="pickDay(i)"
                >
                  <b>{{ i18n.whenDay(d.date, 'weekdayShort') }}</b>
                  <span>{{ i18n.whenDay(d.date, 'dayMonth') }}</span>
                  <span>{{ 'udt.ch.dlg.free' | t: { n: d.free } }}</span>
                </button>
              } @empty {
                <p class="muted small">{{ 'udt.ch.dlg.noDays' | t }}</p>
              }
            </div>
            @if (day(); as d) {
              <div class="times">
                @for (s of d.starts; track s.at) {
                  <button
                    type="button"
                    class="t"
                    [class.mine]="s.state === 'mine'"
                    [attr.aria-pressed]="at() === s.at"
                    [disabled]="s.state !== 'free'"
                    [title]="'udt.ch.slot.' + s.state | t"
                    (click)="at.set(s.at)"
                  >
                    {{ s.time }}
                  </button>
                }
              </div>
              <p class="muted small">
                {{ 'udt.ch.dlg.slotHint' | t: { min: slots()!.minutes, lock: slots()!.lockMin } }}
              </p>
            }
          </section>

          <section [hidden]="!!rematchOf()">
            <h3><span class="num">4</span>{{ 'udt.ch.dlg.stake' | t }}</h3>
            <div class="stake">
              <div class="step">
                <button type="button" aria-label="−100" (click)="bump(-100)">−</button>
                <input
                  type="number"
                  inputmode="numeric"
                  step="10"
                  min="0"
                  [max]="rules().stakeCap"
                  [attr.aria-label]="'udt.ch.dlg.stake' | t"
                  [ngModel]="stake()"
                  (ngModelChange)="stake.set(+$event || 0)"
                />
                <button type="button" aria-label="+100" (click)="bump(100)">+</button>
              </div>
              <div class="quick">
                @for (q of quick(); track q) {
                  <button type="button" (click)="stake.set(q)">
                    {{ q ? (q | neuro) : ('udt.ch.friendly' | t) }}
                  </button>
                }
              </div>
            </div>
            <div class="calc">
              <span>{{ 'udt.ch.dlg.pot' | t }}</span
              ><b>{{ pot().pot | neuro }}</b>
              <span>{{ 'udt.ch.dlg.fee' | t: { pct: feePct() } }}</span
              ><b>−{{ pot().fee | neuro }}</b> <span>{{ 'udt.ch.dlg.prize' | t }}</span
              ><b>{{ pot().prize | neuro }}</b>
            </div>
            @if (stakeError(); as e) {
              <p class="lack">{{ e }}</p>
            }
          </section>

          <section [hidden]="!!rematchOf()">
            <h3><span class="num">5</span>{{ 'udt.ch.dlg.message' | t }}</h3>
            <input
              type="text"
              maxlength="120"
              class="msg"
              [placeholder]="'udt.ch.dlg.messageHint' | t"
              [ngModel]="message()"
              (ngModelChange)="message.set($event)"
            />
          </section>
        </div>

        <aside>
          <h3>{{ 'udt.ch.dlg.summary' | t }}</h3>
          <dl class="sum">
            <dt>{{ 'udt.ch.dlg.opponent' | t }}</dt>
            <dd>{{ targetName() || '–' }}</dd>
            <dt>{{ 'udt.ch.dlg.format' | t }}</dt>
            <dd>{{ formatText() }}</dd>
            <dt>{{ 'udt.ch.dlg.when' | t }}</dt>
            <dd>{{ at() ? i18n.when(at(), 'dayTime') : '–' }}</dd>
            @if (rivalry(); as r) {
              <dt>{{ 'udt.ch.dlg.h2h' | t }}</dt>
              <dd>
                {{
                  'peek.rivalry'
                    | t
                      : {
                          cw: r.challenges.won,
                          cl: r.challenges.lost,
                          lw: r.league.won,
                          ll: r.league.lost,
                        }
                }}
                @if (r.rival) {
                  · <span class="riv">{{ 'udt.ch.rival' | t }}</span>
                }
              </dd>
            }
            <dt>{{ 'udt.ch.dlg.stake' | t }}</dt>
            <dd>{{ stake() ? (stake() | neuro) : ('udt.ch.friendly' | t) }}</dd>
          </dl>
          <p class="note small">
            {{ 'udt.ch.dlg.rules' | t: { h: rules().expiryHours, lock: rules().lockMin } }}
          </p>
          <button
            type="button"
            class="primary send"
            [disabled]="!ready() || busy()"
            (click)="send()"
          >
            {{
              (rematchOf()
                ? 'udt.ch.dlg.sendRematch'
                : counterOf()
                  ? 'udt.ch.dlg.sendCounter'
                  : 'udt.ch.dlg.send'
              ) | t
            }}
          </button>
          @if (stake() && !rematchOf()) {
            <p class="held small">
              <na-coin [size]="13" /> {{ stake() | neuro }} {{ 'udt.ch.dlg.held' | t }}
            </p>
          }
        </aside>
      </div>
    </dialog>
  `,
  styles: `
    .chd {
      width: min(1040px, calc(100vw - 16px));
      max-height: min(94vh, 1100px);
      padding: 0;
      border: 1px solid var(--line);
      border-radius: var(--radius-lg);
      background: var(--panel);
      color: var(--text);
    }
    .chd::backdrop {
      background: rgba(4, 6, 10, 0.72);
    }
    header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 18px;
      border-bottom: 1px solid var(--border);
    }
    header h2 {
      flex: 1;
      margin: 0;
      font-size: var(--fs-2xl);
    }
    .x {
      background: none;
      border: 0;
      color: var(--muted);
      font-size: var(--fs-2xl);
    }
    .body {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 300px;
    }
    .main {
      padding: 14px 18px;
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 18px;
      border-right: 1px solid var(--border);
      min-width: 0;
    }
    section {
      min-width: 0;
    }
    h3 {
      margin: 0 0 8px;
      font-size: var(--fs-lg);
      display: flex;
      gap: 8px;
      align-items: baseline;
    }
    .num {
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      color: var(--chall);
    }
    .opps {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(150px, 100%), 1fr));
      gap: 8px;
    }
    .opp,
    .hd,
    .day {
      display: grid;
      justify-content: stretch;
      justify-items: start;
      align-content: start;
      gap: 2px;
      text-align: left;
      padding: 8px 12px;
      border-radius: var(--radius);
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text);
    }
    .opp[aria-pressed='true'],
    .hd[aria-pressed='true'],
    .day[aria-pressed='true'] {
      border-color: var(--chall);
      background: color-mix(in srgb, var(--chall) 14%, var(--panel-2));
    }
    .opp:disabled {
      opacity: 0.55;
    }
    .meta,
    .hd span,
    .day span {
      font-size: var(--fs-xs);
      color: var(--muted);
    }
    .why {
      font-size: var(--fs-xs);
      color: var(--danger);
    }
    .ai {
      font-size: var(--fs-2xs);
      padding: 1px 5px;
      border-radius: var(--radius-xs);
      background: var(--panel-3);
      color: var(--text-2);
    }
    .fmt,
    .stake {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 16px;
      align-items: center;
    }
    .map {
      display: grid;
      gap: 2px;
    }
    .hard {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px;
      margin-top: 10px;
    }
    .days {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 4px;
    }
    .day {
      flex: none;
      min-width: 76px;
      justify-items: center;
    }
    .times {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
      gap: 6px;
      margin: 10px 0 6px;
    }
    .t {
      min-height: 40px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text);
      font-family: var(--font-mono);
    }
    .t[aria-pressed='true'] {
      background: var(--chall);
      border-color: var(--chall);
      color: var(--chall-ink);
    }
    .t:disabled {
      color: var(--muted);
      background: repeating-linear-gradient(135deg, transparent 0 6px, var(--border) 6px 12px);
    }
    .t.mine:disabled {
      color: var(--hot);
    }
    .step {
      display: inline-flex;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      overflow: hidden;
    }
    .step button {
      width: 42px;
      border: 0;
      background: var(--panel-2);
      color: var(--text);
      font-size: var(--fs-xl);
    }
    .step input {
      width: 110px;
      border: 0;
      border-radius: 0;
      text-align: center;
      font-family: var(--font-mono);
    }
    .quick {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .quick button {
      border-radius: var(--radius-pill);
      padding: 4px 12px;
    }
    .calc {
      margin-top: 10px;
      display: grid;
      grid-template-columns: auto auto;
      justify-content: start;
      gap: 2px 18px;
    }
    .calc span {
      color: var(--muted);
    }
    .calc b {
      font-family: var(--font-mono);
      text-align: right;
    }
    .msg {
      width: 100%;
    }
    aside {
      padding: 14px 18px;
      display: grid;
      gap: 12px;
      align-content: start;
      align-self: start;
      position: sticky;
      top: 0;
    }
    aside h3 {
      font-size: var(--fs-lg);
    }
    .sum {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 6px 12px;
      margin: 0;
    }
    .sum dt {
      color: var(--muted);
    }
    .sum dd {
      margin: 0;
      text-align: right;
      font-weight: 600;
    }
    .riv {
      color: var(--hot-text);
    }
    .note {
      background: var(--panel-2);
      border-radius: var(--radius-sm);
      padding: 8px 12px;
      margin: 0;
    }
    .send {
      min-height: 44px;
    }
    .held {
      margin: -4px 0 0;
      text-align: center;
      color: var(--neuro);
    }
    @media (max-width: 860px) {
      .body {
        grid-template-columns: minmax(0, 1fr);
      }
      .main {
        border-right: 0;
        border-bottom: 1px solid var(--border);
      }
      aside {
        position: static;
      }
    }
  `,
})
export class UdtChallengeDialog {
  private readonly api = inject(Api);
  protected readonly i18n = inject(I18n);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  readonly rules = input.required<UdtChallengeRules>();
  readonly spendable = input(0);
  readonly tier = input<number | null>(null);
  /** The dialog was closed (sent or not). */
  readonly closed = output<void>();
  /** A challenge or counter offer went out: the list as the server sends it back. */
  readonly sent = output<UdtChallenges>();

  protected readonly counterOf = signal<UdtChallenge | null>(null);
  /** A rematch of a played challenge: only the start is new (decision 335). */
  protected readonly rematchOf = signal<UdtChallenge | null>(null);
  protected readonly target = signal<Target | null>(null);
  protected readonly mode = signal<ChallengeMode>('dm');
  protected readonly teamSize = signal(5);
  protected readonly bestOf = signal(1);
  protected readonly map = signal<string | null>(null);
  protected readonly hardness = signal<ChallengeHardness>('normal');
  protected readonly stake = signal(0);
  protected readonly message = signal('');
  protected readonly at = signal<string | null>(null);
  protected readonly dayIndex = signal(0);
  protected readonly opps = signal<UdtChallengeOpponents | null>(null);
  protected readonly slots = signal<UdtChallengeSlots | null>(null);
  protected readonly busy = signal(false);
  /** The two managers against each other (decision 338). */
  protected readonly rivalry = signal<UdtRivalry | null>(null);

  protected readonly modes = computed((): Choice<ChallengeMode>[] =>
    this.rules().modes.map((m) => ({ value: m, label: `udt.ch.mode.${m}` })),
  );
  protected readonly sizes = computed((): Choice<number>[] =>
    this.rules().teamSizes.map((n) => ({ value: n, text: n === 1 ? '1v1' : `${n}v${n}` })),
  );
  protected readonly bests = computed((): Choice<number>[] =>
    this.rules().bestOf.map((n) => ({ value: n, text: `Bo${n}` })),
  );
  protected readonly maps = computed(() => this.rules().maps[this.mode()] ?? []);
  protected readonly hardnessOpen = computed(() =>
    HARDNESS.filter((h) => this.rules().mh.hardness.includes(h)),
  );
  protected readonly day = computed(() => this.slots()?.days[this.dayIndex()] ?? null);
  protected readonly feePct = computed(() =>
    this.mode() === 'mh' ? this.rules().mh.feePct : this.rules().feePct,
  );
  protected readonly pot = computed(() => {
    const pot = 2 * this.stake();
    const fee = Math.min(pot, Math.round((pot * this.feePct()) / 1000) * 10);
    return { pot, fee, prize: pot - fee };
  });
  protected readonly quick = computed(() => {
    const cap = this.rules().stakeCap;
    return [0, 100, 250, 500, 1000, cap].filter((q, i, a) => q <= cap && a.indexOf(q) === i);
  });
  protected readonly stakeError = computed(() => {
    const s = this.stake();
    const r = this.rules();
    if (s % 10) return this.i18n.t('udt.ch.dlg.step');
    if (s && s < r.minStake) return this.i18n.t('udt.ch.dlg.min', { min: r.minStake });
    if (s > r.stakeCap) return this.i18n.t('udt.ch.dlg.cap', { cap: r.stakeCap });
    if (s > this.spendable())
      return this.i18n.t('common.lack', {
        n: formatNeuro(s - this.spendable(), this.i18n.lang()),
      });
    return null;
  });
  /** The other side when it is fixed (counter offer: the challenger; rematch: the other team). */
  private readonly fixed = computed(() => {
    const c = this.counterOf();
    if (c) return c.from;
    const r = this.rematchOf();
    if (!r) return null;
    return r.mine ? r.to : r.from;
  });
  protected readonly fixedName = computed(() => {
    const f = this.fixed();
    return f ? `${f.tag} ${f.name}` : '';
  });
  protected readonly targetName = computed(() => {
    if (this.fixed()) return this.fixedName();
    const t = this.target();
    if (!t) return '';
    if (t.kind === 'open')
      return this.i18n.t(t.scope === 'all' ? 'udt.ch.dlg.openAll' : 'udt.ch.dlg.openTier');
    const o = this.opps()?.teams.find((x) => x.userId === t.userId);
    return o ? `${o.tag} ${o.name}` : '';
  });
  protected readonly formatText = computed(() =>
    this.mode() === 'mh'
      ? `Monster Hunt · ${this.i18n.t(`udt.ch.hard.${this.hardness()}`)}`
      : `${this.teamSize()}v${this.teamSize()} · Bo${this.bestOf()}`,
  );
  protected readonly ready = computed(
    () =>
      (!!this.fixed() || !!this.target()) &&
      !!this.at() &&
      (!!this.rematchOf() || !this.stakeError()),
  );

  /** Opens the dialog: a new challenge (to a team, or free) or a counter offer. */
  open(
    o: { to?: string | null; counter?: UdtChallenge | null; rematch?: UdtChallenge | null } = {},
  ): void {
    const c = o.counter ?? o.rematch ?? null;
    this.counterOf.set(o.counter ?? null);
    this.rematchOf.set(o.rematch ?? null);
    this.target.set(o.to ? { kind: 'team', userId: o.to } : null);
    this.mode.set(c?.mode ?? 'dm');
    this.teamSize.set(c?.teamSize ?? Math.max(...this.rules().teamSizes));
    this.bestOf.set(c?.bestOf ?? Math.min(...this.rules().bestOf));
    this.map.set(c?.map ?? null);
    this.hardness.set(c?.hardness ?? 'normal');
    this.stake.set(c?.stake ?? 0);
    this.message.set('');
    this.at.set(null);
    this.dayIndex.set(0);
    this.dlg().nativeElement.showModal();
    void this.loadRivalry(o.to ?? this.fixed()?.userId ?? null);
    if (c) void this.loadSlots();
    else void this.firstSize(o.to ?? null).then(() => this.loadSlots());
  }

  /**
   * A new challenge starts at the biggest team size the own team (and a team picked) can field,
   * so a challenge from a team page does not open with a format that team cannot play.
   */
  private async firstSize(to: string | null) {
    const sizes = [...this.rules().teamSizes].sort((a, b) => b - a);
    for (const n of sizes) {
      try {
        const o = await this.api.udtChallengeOpponents('dm', n);
        const team = to ? o.teams.find((x) => x.userId === to) : null;
        if (((o.me?.full ?? false) && (!to || team?.full)) || n === sizes.at(-1)) {
          this.teamSize.set(n);
          this.opps.set(o);
          if (team && this.why(team)) this.target.set(null);
          return;
        }
      } catch {
        return;
      }
    }
  }

  close(): void {
    this.dlg().nativeElement.close();
  }

  protected pickTeam(id: string) {
    this.target.set({ kind: 'team', userId: id });
    void this.loadRivalry(id);
    void this.loadSlots();
  }

  private async loadRivalry(id: string | null) {
    this.rivalry.set(null);
    if (!id) return;
    try {
      const r = await this.api.udtRivalry(id);
      if (this.opponentId() === id) this.rivalry.set(r);
    } catch {
      // without the line
    }
  }

  protected isTeam(id: string) {
    const t = this.target();
    return t?.kind === 'team' && t.userId === id;
  }

  protected isOpen(scope: 'all' | 'tier') {
    const t = this.target();
    return t?.kind === 'open' && t.scope === scope;
  }

  /** Why a team cannot be challenged in this format (null: it can). */
  protected why(o: UdtChallengeOpponents['teams'][number]): string | null {
    if (o.pairLeft === 0) return this.i18n.t('udt.ch.dlg.whyPair');
    if (this.mode() === 'mh' && o.mh < 5) return this.i18n.t('udt.ch.dlg.whyMh', { n: o.mh });
    if (!o.full) return this.i18n.t('udt.ch.dlg.whyLineup', { n: this.teamSize() });
    return null;
  }

  /** A strength in the language's number format. */
  protected num(n: number): string {
    return new Intl.NumberFormat(this.i18n.locale(), { maximumFractionDigits: 1 }).format(n);
  }

  protected record(h: ChallengeHardness): string {
    const map = this.map();
    const r = this.rules().mh.records.find(
      (x) => x.hardness === h && (!map || x.map.toLowerCase() === map.toLowerCase()),
    );
    return r
      ? this.i18n.t('udt.ch.dlg.record', { t: clock(r.finalMs), team: r.team })
      : this.i18n.t('udt.ch.dlg.noRecord');
  }

  protected setMode(m: ChallengeMode) {
    this.mode.set(m);
    this.map.set(null);
    if (m === 'mh') {
      this.teamSize.set(5);
      this.bestOf.set(1);
    }
    void this.loadOpps();
    void this.loadSlots();
  }

  protected setSize(n: number) {
    this.teamSize.set(n);
    void this.loadOpps();
  }

  protected setBestOf(n: number) {
    this.bestOf.set(n);
    void this.loadSlots();
  }

  protected pickDay(i: number) {
    this.dayIndex.set(i);
    this.at.set(null);
  }

  protected bump(d: number) {
    const v = Math.max(0, Math.min(this.rules().stakeCap, this.stake() + d));
    this.stake.set(v && v < this.rules().minStake ? (d > 0 ? this.rules().minStake : 0) : v);
  }

  private opponentId(): string | null {
    const f = this.fixed();
    if (f) return f.userId;
    const t = this.target();
    return t?.kind === 'team' ? t.userId : null;
  }

  private async loadOpps() {
    if (this.fixed()) return;
    try {
      const o = await this.api.udtChallengeOpponents(this.mode(), this.teamSize());
      this.opps.set(o);
      // A team picked that cannot play this format any more: pick again.
      const t = this.target();
      const picked = t?.kind === 'team' ? o.teams.find((x) => x.userId === t.userId) : null;
      if (picked && this.why(picked)) this.target.set(null);
    } catch {
      this.opps.set(null);
    }
  }

  private async loadSlots() {
    try {
      const s = await this.api.udtChallengeSlots({
        mode: this.mode(),
        bestOf: this.mode() === 'mh' ? 1 : this.bestOf(),
        opponent: this.opponentId(),
      });
      this.slots.set(s);
      const first = s.days.findIndex((d) => d.free > 0);
      this.dayIndex.set(Math.max(0, first));
      if (!s.days.some((d) => d.starts.some((x) => x.at === this.at() && x.state === 'free')))
        this.at.set(null);
    } catch {
      this.slots.set(null);
    }
  }

  protected async send() {
    const at = this.at();
    if (!at) return;
    const t = this.target();
    const body: UdtChallengeBody = {
      to: this.counterOf()?.from.userId ?? (t?.kind === 'team' ? t.userId : null),
      ...(t?.kind === 'open' && !this.counterOf() ? { open: t.scope } : {}),
      mode: this.mode(),
      teamSize: this.mode() === 'mh' ? 5 : this.teamSize(),
      bestOf: this.mode() === 'mh' ? 1 : this.bestOf(),
      map: this.map(),
      ...(this.mode() === 'mh' ? { hardness: this.hardness() } : {}),
      stake: this.stake(),
      at,
      ...(this.message().trim() ? { message: this.message().trim() } : {}),
    };
    this.busy.set(true);
    try {
      const c = this.counterOf();
      const re = this.rematchOf();
      const r = re
        ? await this.api.udtChallengeRematch(re.id, at)
        : c
          ? await this.api.udtChallengeCounter(c.id, body)
          : await this.api.udtChallenge(body);
      this.sent.emit(r);
      this.close();
    } catch {
      // the Api shows the error; the slots may have changed
      void this.loadSlots();
    } finally {
      this.busy.set(false);
    }
  }
}
