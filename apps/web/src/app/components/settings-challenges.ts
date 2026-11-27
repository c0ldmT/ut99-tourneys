import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { leagueClashDays, stakeCap } from '@tourney/udt';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import { formatNeuro } from '../core/neuro';
import type { ChallengeAdmin, ChallengeSettings } from '../core/types';
import { type Choice, Segment } from './choice';
import { SETTINGS_STYLES, type SettingsForm } from './settings-shared';

type Hardness = ChallengeSettings['mh']['hardness'][number];

/** A weekday row of the timeline: the league evening, the window, their overlap (in %). */
interface DayRow {
  day: number;
  name: string;
  league: { left: number; width: number } | null;
  window: { left: number; width: number } | null;
  clash: { left: number; width: number } | null;
  state: 'off' | 'clash' | 'ok';
  /** Bo1 starts of the day (servers × window ÷ 15 minutes). */
  cap: number;
}

const SIZES = [1, 3, 5] as const;
const HARDNESS: Hardness[] = ['normal', 'hard', 'nightmare'];
const SLOT_MIN = 15;

const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Settings tab "Challenges" (decision 339): the window (weekdays, from-to, servers) drawn per
 * weekday against the league evening, the formats, stakes and limits, the Monster Hunt showcase
 * and the AI managers. A window that runs into the league evening shows red and cannot be saved
 * (the API refuses it too).
 */
@Component({
  selector: 'app-settings-challenges',
  imports: [FormsModule, TPipe, Segment],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (f) {
      <form data-form="challenge" class="chs" (ngSubmit)="save()">
        <section class="card">
          <h2>{{ 'chs.window' | t }}</h2>
          <p class="muted small">{{ 'chs.windowHint' | t }}</p>
          <label class="switch"
            ><input type="checkbox" name="chOn" [(ngModel)]="f.enabled" /><span class="tr"></span
            >{{ 'chs.enabled' | t }}</label
          >
          <div class="lgs-days" role="group" [attr.aria-label]="'chs.days' | t">
            <span class="kpi">{{ 'chs.days' | t }}</span>
            @for (d of weekdays(); track $index) {
              <button
                type="button"
                class="lgs-day"
                [attr.aria-pressed]="f.days.includes($index)"
                (click)="toggleDay($index); touch($event)"
              >
                {{ d }}
              </button>
            }
          </div>
          <div class="row gap">
            <label
              >{{ 'chs.from' | t }}
              <input type="time" name="chFrom" step="900" [(ngModel)]="f.from" class="narrow" />
            </label>
            <label
              >{{ 'chs.to' | t }}
              <input type="time" name="chTo" step="900" [(ngModel)]="f.to" class="narrow" />
            </label>
            <div>
              <span class="lbl" id="chs-servers">{{ 'chs.servers' | t }}</span>
              <na-segment
                [options]="serverOptions()"
                [value]="f.servers"
                (valueChange)="f.servers = $event; bump()"
                labelledby="chs-servers"
              />
            </div>
          </div>
          @if (admin(); as a) {
            <p class="muted small">{{ 'chs.pool' | t: { n: a.pool } }}</p>
          }

          <h3 id="chs-week">{{ 'chs.week' | t }}</h3>
          <div class="tl" role="table" aria-labelledby="chs-week">
            <div class="axis" aria-hidden="true">
              <span></span>
              <div class="ticks">
                @for (h of ticks(); track h.at) {
                  <span [style.left.%]="h.at">{{ h.label }}</span>
                }
              </div>
              <span></span>
            </div>
            @for (r of rows(); track r.day) {
              <div class="tlr" role="row" [class.clash]="r.state === 'clash'">
                <b role="rowheader">{{ r.name }}</b>
                <div class="track" role="cell">
                  @if (r.league; as l) {
                    <span
                      class="lg"
                      [style.left.%]="l.left"
                      [style.width.%]="l.width"
                      [title]="'chs.legend.league' | t: leagueParams()"
                    ></span>
                  }
                  @if (r.window; as w) {
                    <span class="cw" [style.left.%]="w.left" [style.width.%]="w.width"></span>
                  }
                  @if (r.clash; as c) {
                    <span class="ov" [style.left.%]="c.left" [style.width.%]="c.width"></span>
                  }
                </div>
                <span
                  role="cell"
                  class="mono cap"
                  [class.bad]="r.state === 'clash'"
                  [class.muted]="r.state === 'off'"
                  [title]="'chs.capTitle' | t"
                  >{{
                    r.state === 'clash'
                      ? ('chs.clashCell' | t)
                      : r.state === 'off'
                        ? ('chs.offCell' | t)
                        : ('chs.cap' | t: { n: r.cap })
                  }}</span
                >
              </div>
            }
          </div>
          <div class="legend small">
            @if (league()?.enabled) {
              <span class="k klg">{{ 'chs.legend.league' | t: leagueParams() }}</span>
            }
            <span class="k kcw">{{ 'chs.legend.window' | t }}</span>
            <span class="k kov">{{ 'chs.legend.clash' | t }}</span>
          </div>
          @if (problem(); as p) {
            <p class="warn" role="alert">{{ p.key | t: p.params }}</p>
          } @else if (!league()?.enabled) {
            <p class="muted small">{{ 'chs.leagueOff' | t }}</p>
          } @else {
            <p class="muted small">{{ 'chs.clear' | t }}</p>
          }
        </section>

        <section class="card">
          <h2>{{ 'chs.formats' | t }}</h2>
          <div class="opts" role="group" [attr.aria-label]="'chs.modes' | t">
            <span class="kpi">{{ 'chs.modes' | t }}</span>
            @for (m of modes; track m) {
              <button
                type="button"
                class="lgs-day wide"
                [attr.aria-pressed]="f.modes.includes(m)"
                (click)="f.modes = toggle(f.modes, m); touch($event)"
              >
                {{ 'udt.ch.mode.' + m | t }}
              </button>
            }
          </div>
          <div class="opts" role="group" [attr.aria-label]="'chs.sizes' | t">
            <span class="kpi">{{ 'chs.sizes' | t }}</span>
            @for (k of sizes; track k) {
              <button
                type="button"
                class="lgs-day"
                [attr.aria-pressed]="f.teamSizes.includes(k)"
                (click)="f.teamSizes = toggle(f.teamSizes, k); touch($event)"
              >
                {{ k }}v{{ k }}
              </button>
            }
          </div>
          <div class="opts" role="group" [attr.aria-label]="'chs.bestOf' | t">
            <span class="kpi">{{ 'chs.bestOf' | t }}</span>
            @for (n of sizes; track n) {
              <button
                type="button"
                class="lgs-day"
                [attr.aria-pressed]="f.bestOf.includes(n)"
                (click)="f.bestOf = toggle(f.bestOf, n); touch($event)"
              >
                Bo{{ n }}
              </button>
            }
          </div>
          <div class="row gap">
            <label
              >{{ 'chs.stakeMax' | t }}
              <input
                type="number"
                name="chStake"
                min="0"
                step="100"
                [(ngModel)]="f.stakeMax"
                class="narrow"
              />
              <small class="muted">{{ 'chs.indexed' | t: { n: indexed(f.stakeMax) } }}</small>
            </label>
            <label
              >{{ 'chs.fee' | t }}
              <input
                type="number"
                name="chFee"
                min="0"
                max="50"
                [(ngModel)]="f.feePct"
                class="narrow"
              />
            </label>
            <label
              >{{ 'chs.pair' | t }}
              <input
                type="number"
                name="chPair"
                min="0"
                max="50"
                [(ngModel)]="f.pairPerWeek"
                class="narrow"
              />
              <small class="muted">{{ 'chs.pairHint' | t }}</small>
            </label>
          </div>
          <div class="row gap">
            <label
              >{{ 'chs.perDay' | t }}
              <input
                type="number"
                name="chPerDay"
                min="1"
                max="10"
                [(ngModel)]="f.perDay"
                class="narrow"
              />
            </label>
            <label
              >{{ 'chs.maxOpen' | t }}
              <input
                type="number"
                name="chMaxOpen"
                min="1"
                max="20"
                [(ngModel)]="f.maxOpen"
                class="narrow"
              />
            </label>
            <label
              >{{ 'chs.expiry' | t }}
              <input
                type="number"
                name="chExpiry"
                min="1"
                max="336"
                [(ngModel)]="f.expiryHours"
                class="narrow"
              />
              <small class="muted">{{ 'chs.expiryHint' | t }}</small>
            </label>
          </div>
          <div class="row gap">
            <label
              >{{ 'chs.lock' | t }}
              <input
                type="number"
                name="chLock"
                min="15"
                max="240"
                step="15"
                [(ngModel)]="f.lockMin"
                class="narrow"
              />
              <small class="muted">{{ 'chs.lockHint' | t }}</small>
            </label>
            <label
              >{{ 'chs.betBots' | t }}
              <input
                type="number"
                name="chBetBots"
                min="0"
                max="50"
                [(ngModel)]="f.betBots"
                class="narrow"
              />
            </label>
          </div>
          <label class="switch"
            ><input type="checkbox" name="chAi" [(ngModel)]="f.ai" /><span class="tr"></span
            >{{ 'chs.ai' | t }}</label
          >
        </section>

        <section class="card">
          <h2>
            {{ 'chs.mh' | t }} <span class="mhbadge">{{ 'udt.ch.showcase' | t }}</span>
          </h2>
          <p class="muted small">{{ 'chs.mhHint' | t }}</p>
          <div class="row gap">
            <label
              >{{ 'chs.mhFee' | t }}
              <input
                type="number"
                name="chMhFee"
                min="0"
                max="50"
                [(ngModel)]="f.mh.feePct"
                class="narrow"
              />
            </label>
            <label
              >{{ 'chs.mhBonus' | t }}
              <input
                type="number"
                name="chMhBonus"
                min="0"
                step="50"
                [(ngModel)]="f.mh.recordBonus"
                class="narrow"
              />
              <small class="muted">{{ 'chs.indexed' | t: { n: indexed(f.mh.recordBonus) } }}</small>
            </label>
          </div>
          <div class="opts" role="group" [attr.aria-label]="'chs.hardness' | t">
            <span class="kpi">{{ 'chs.hardness' | t }}</span>
            @for (h of hardness; track h) {
              <button
                type="button"
                class="lgs-day wide"
                [attr.aria-pressed]="f.mh.hardness.includes(h)"
                (click)="f.mh.hardness = toggle(f.mh.hardness, h); touch($event)"
              >
                {{ 'udt.ch.hard.' + h | t }}
              </button>
            }
          </div>
        </section>

        <div class="card save">
          @if (problem(); as p) {
            <p class="warn">{{ p.key | t: p.params }}</p>
          }
          @if (admin(); as a) {
            @if (a.booked) {
              <p class="muted small">{{ 'chs.booked' | t: { n: a.booked } }}</p>
            }
          }
          <div class="row">
            <button type="submit" class="primary" [disabled]="busy() || !!problem()">
              {{ 'common.save' | t }}
            </button>
          </div>
        </div>
      </form>
    }
  `,
  styles: [
    SETTINGS_STYLES,
    `
      /* Hints under some fields: the fields line up at the top. */
      .row.gap {
        align-items: flex-start;
      }
      .row.gap + .row.gap,
      .row.gap + label.switch {
        margin-top: 14px;
      }
      .lbl {
        display: block;
        margin-bottom: 4px;
        font-size: var(--fs-sm);
        font-weight: 600;
        color: var(--text-2);
      }
      .opts {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        margin: 10px 0;
      }
      .opts .kpi {
        min-width: 110px;
      }
      .lgs-day.wide {
        padding: 0 14px;
      }
      small {
        display: block;
        margin-top: 4px;
        max-width: 200px;
      }
      .tl {
        display: grid;
        gap: 6px;
        margin-top: 8px;
      }
      .axis,
      .tlr {
        display: grid;
        grid-template-columns: 36px minmax(0, 1fr) 92px;
        gap: 10px;
        align-items: center;
      }
      .ticks {
        position: relative;
        height: 16px;
        font-size: var(--fs-xs);
        color: var(--muted);
      }
      .ticks span {
        position: absolute;
        transform: translateX(-50%);
      }
      .ticks span:first-child {
        transform: none;
      }
      .ticks span:last-child {
        transform: translateX(-100%);
      }
      .track {
        position: relative;
        height: 22px;
        border-radius: var(--radius-sm);
        background: var(--panel-2);
        border: 1px solid var(--line);
        overflow: hidden;
      }
      .track span {
        position: absolute;
        top: 0;
        bottom: 0;
      }
      .lg,
      .k.klg::before {
        background: repeating-linear-gradient(
          135deg,
          color-mix(in srgb, var(--hot) 55%, transparent) 0 4px,
          color-mix(in srgb, var(--hot) 18%, transparent) 4px 8px
        );
      }
      .cw,
      .k.kcw::before {
        background: color-mix(in srgb, var(--accent) 55%, transparent);
      }
      .ov,
      .k.kov::before {
        background: var(--danger-strong);
      }
      .tlr.clash b {
        color: var(--danger);
      }
      .cap {
        font-size: var(--fs-sm);
        text-align: right;
      }
      .cap.bad {
        color: var(--danger);
        font-weight: 700;
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 16px;
        margin-top: 10px;
        color: var(--muted);
      }
      .k::before {
        content: '';
        display: inline-block;
        width: 14px;
        height: 10px;
        margin-right: 6px;
        border-radius: var(--radius-xs);
        vertical-align: -1px;
      }
      .warn {
        color: var(--danger);
        font-weight: 600;
        margin: 10px 0 0;
      }
      .mhbadge {
        display: inline-block;
        margin-left: 6px;
        padding: 1px 7px;
        border-radius: var(--radius-pill);
        font-size: var(--fs-xs);
        letter-spacing: 0.06em;
        vertical-align: 3px;
        background: var(--chall);
        color: var(--chall-ink);
      }
      .save .warn {
        margin: 0 0 10px;
      }
      @media (max-width: 520px) {
        .axis,
        .tlr {
          grid-template-columns: 30px minmax(0, 1fr) 70px;
          gap: 6px;
        }
        .opts .kpi {
          min-width: 100%;
        }
      }
    `,
  ],
})
export class SettingsChallenges {
  private readonly api = inject(Api);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly i18n = inject(I18n);
  /** A form was saved (the page drops its "unsaved" mark). */
  readonly saved = output<SettingsForm>();
  protected readonly busy = signal(false);
  protected readonly admin = signal<ChallengeAdmin | null>(null);
  protected f: ChallengeSettings | null = null;
  /** Bumped when a button changes the form (the page marks the tab as unsaved). */
  protected readonly rev = signal(0);
  protected readonly modes = ['dm', 'mh'] as const;
  protected readonly sizes = SIZES;
  protected readonly hardness = HARDNESS;

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      const [s, a] = await Promise.all([this.api.settings(), this.api.udtChallengeAdmin()]);
      this.f = clone(s.udt.challenge);
      this.admin.set(a);
      this.cdr.markForCheck();
    } catch {
      // the toast shows the error
    }
  }

  protected weekdays(): string[] {
    // 2024-01-01 was a Monday.
    return Array.from({ length: 7 }, (_, i) =>
      this.i18n.whenDay(`2024-01-0${1 + i}`, 'weekdayShort'),
    );
  }

  protected league() {
    return this.admin()?.league ?? null;
  }

  protected leagueParams() {
    const l = this.league();
    return { time: l?.time ?? '', min: l?.minutes ?? 0 };
  }

  /** 1 … the pool (at least 4 choices); more than the pool only if saved so. */
  protected serverOptions(): Choice<number>[] {
    const pool = this.admin()?.pool ?? 0;
    const cur = this.f?.servers ?? 1;
    const n = Math.min(8, Math.max(4, pool, cur));
    return Array.from({ length: n }, (_, i) => ({
      value: i + 1,
      text: String(i + 1),
      disabled: i + 1 > Math.max(1, pool) && i + 1 !== cur,
      title: i + 1 > pool ? 'chs.morePool' : undefined,
    }));
  }

  protected toggleDay(d: number) {
    if (!this.f) return;
    this.f.days = this.toggle(this.f.days, d).sort((a, b) => a - b);
  }

  /** Adds or removes a choice; the last one stays. */
  protected toggle<T>(list: T[], v: T): T[] {
    if (!list.includes(v)) return [...list, v];
    return list.length > 1 ? list.filter((x) => x !== v) : list;
  }

  /** A button changed the form: the page marks the tab as unsaved. */
  protected touch(e: Event) {
    this.bump();
    e.target?.dispatchEvent(new Event('change', { bubbles: true }));
  }

  protected bump() {
    this.rev.update((n) => n + 1);
  }

  /** A value at the season's index (× index^0.2), as the managers see it. */
  protected indexed(base: number): string {
    return formatNeuro(
      stakeCap(Math.max(0, Number(base) || 0), this.admin()?.index ?? 1),
      this.i18n.lang(),
    );
  }

  /** The axis: from the earlier of 16:00 and the window to the later of 24:00 and the league. */
  private range(): { lo: number; hi: number } {
    const f = this.f;
    const l = this.league();
    let lo = 16 * 60;
    let hi = 24 * 60;
    if (f) {
      lo = Math.min(lo, Math.floor(minutesOf(f.from) / 120) * 120);
      hi = Math.max(hi, Math.ceil(minutesOf(f.to) / 60) * 60);
    }
    if (l?.enabled) hi = Math.max(hi, Math.ceil((minutesOf(l.time) + l.minutes) / 60) * 60);
    return { lo, hi: Math.min(hi, 30 * 60) };
  }

  protected ticks(): { at: number; label: string }[] {
    const { lo, hi } = this.range();
    const out: { at: number; label: string }[] = [];
    for (let m = lo; m <= hi; m += 120)
      out.push({ at: ((m - lo) / (hi - lo)) * 100, label: String((m / 60) % 24) });
    return out;
  }

  protected rows(): DayRow[] {
    const f = this.f;
    if (!f) return [];
    const { lo, hi } = this.range();
    const pct = (m: number) => ((Math.min(hi, Math.max(lo, m)) - lo) / (hi - lo)) * 100;
    const bar = (a: number, b: number) => (b > a ? { left: pct(a), width: pct(b) - pct(a) } : null);
    const l = this.league();
    const from = minutesOf(f.from);
    const to = minutesOf(f.to);
    const lgFrom = l ? minutesOf(l.time) : 0;
    const lgTo = l ? lgFrom + l.minutes : 0;
    const clashes = this.clashDays();
    const names = this.weekdays();
    return names.map((name, day) => {
      const lg = !!l?.enabled && l.days.includes(day);
      const on = f.enabled && f.days.includes(day);
      const clash = on && clashes.includes(day);
      return {
        day,
        name,
        league: lg ? bar(lgFrom, lgTo) : null,
        window: on ? bar(from, to) : null,
        clash: clash ? bar(Math.max(from, lgFrom), Math.min(to, lgTo)) : null,
        state: clash ? 'clash' : on ? 'ok' : 'off',
        cap: on ? Math.floor(Math.max(0, to - from) / SLOT_MIN) * f.servers : 0,
      };
    });
  }

  private clashDays(): number[] {
    const f = this.f;
    const l = this.league();
    if (!f || !l || !f.enabled) return [];
    return leagueClashDays(
      { days: f.days, from: f.from, to: f.to },
      { enabled: l.enabled, slotDays: l.days, slotTime: l.time },
      l.minutes,
    );
  }

  /** Why the window cannot be saved (null: it can). */
  protected problem(): { key: string; params?: Record<string, string> } | null {
    const f = this.f;
    if (!f) return null;
    if (!f.from || !f.to || minutesOf(f.from) >= minutesOf(f.to)) return { key: 'chs.order' };
    const days = this.clashDays();
    if (!days.length) return null;
    const names = this.weekdays();
    return {
      key: 'chs.clash',
      params: { time: this.league()?.time ?? '', days: days.map((d) => names[d]).join(', ') },
    };
  }

  protected async save() {
    const f = this.f;
    if (!f || this.problem()) return;
    this.busy.set(true);
    const int = (v: unknown, lo: number, hi: number) =>
      Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
    try {
      const s = await this.api.setUdtSettings({
        challenge: {
          ...f,
          servers: int(f.servers, 1, 8),
          stakeMax: int(f.stakeMax, 0, 1_000_000),
          feePct: int(f.feePct, 0, 50),
          pairPerWeek: int(f.pairPerWeek, 0, 50),
          perDay: int(f.perDay, 1, 10),
          maxOpen: int(f.maxOpen, 1, 20),
          expiryHours: int(f.expiryHours, 1, 336),
          lockMin: int(f.lockMin, 15, 240),
          betBots: int(f.betBots, 0, 50),
          mh: {
            ...f.mh,
            feePct: int(f.mh.feePct, 0, 50),
            recordBonus: int(f.mh.recordBonus, 0, 100_000),
          },
        },
      });
      this.f = clone(s.udt.challenge);
      this.admin.set(await this.api.udtChallengeAdmin());
      this.saved.emit('challenge');
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
      this.cdr.markForCheck();
    }
  }
}

function clone(c: ChallengeSettings): ChallengeSettings {
  return {
    ...c,
    days: [...c.days],
    modes: [...c.modes],
    teamSizes: [...c.teamSizes],
    bestOf: [...c.bestOf],
    mh: { ...c.mh, hardness: [...c.mh.hardness] },
  };
}
