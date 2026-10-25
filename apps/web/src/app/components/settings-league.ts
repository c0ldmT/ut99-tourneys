import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  ElementRef,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { eveningsOf, matchdaysOf, PER_EVENING } from '@tourney/udt';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import { Toasts } from '../core/toast';
import type {
  AgentView,
  LeagueAdmin,
  LeagueAiGames,
  LeagueEstimate,
  LeagueLength,
  LeagueSettings,
  UdtSettings,
} from '../core/types';
import { formatList as list, parseList } from '../core/number-list';
import { SETTINGS_STYLES, type SettingsForm } from './settings-shared';

const LENGTHS: LeagueLength[] = ['short', 'medium', 'long'];
const AI_GAMES: LeagueAiGames[] = ['simulate', 'topGame', 'all'];
const SIZES = [8, 10, 12, 14, 16];
const START_DAYS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Settings tab "UDT Liga" (design "Einstellungen"): the league switch, tiers and clubs, the
 * league evenings and the length, AI games, the server and its rules, money and keepers; on the
 * side the test league (start in the running season, call it off).
 */
@Component({
  selector: 'app-settings-league',
  imports: [FormsModule, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="lgs">
      <form class="lgs-main" data-form="league" (ngSubmit)="save()">
        <section class="card">
          <div class="lgs-head">
            <h2>{{ 'settings.tab.league' | t }}</h2>
            <label class="switch"
              ><input type="checkbox" name="lgOn" [(ngModel)]="f.enabled" /><span class="tr"></span
              >{{ 'lgs.enabled' | t }}</label
            >
          </div>
          <div class="row gap">
            <label
              >{{ 'lgs.tiers' | t }}
              <select name="lgTiers" [(ngModel)]="f.tiers" (ngModelChange)="estimate()">
                @for (n of [1, 2, 3, 4]; track n) {
                  <option [ngValue]="n">{{ 'lgs.tiers.' + n | t }}</option>
                }
              </select>
            </label>
            <label
              >{{ 'lgs.size' | t }}
              <select name="lgSize" [(ngModel)]="f.size" (ngModelChange)="estimate()">
                @for (n of sizes; track n) {
                  <option [ngValue]="n">{{ 'lgs.sizeN' | t: { n, md: matchdays(n) } }}</option>
                }
              </select>
            </label>
            <label
              >{{ 'lgs.start' | t }}
              <select name="lgStart" [(ngModel)]="f.startDay">
                @for (n of startDays; track n) {
                  <option [ngValue]="n">{{ 'lgs.startN' | t: { n } }}</option>
                }
              </select>
            </label>
          </div>
          <label class="switch small lgs-keep"
            ><input type="checkbox" name="lgKeepTest" [(ngModel)]="f.keepTestTiers" /><span
              class="tr"
            ></span
            >{{ 'lgs.keepTestTiers' | t }}</label
          >
        </section>

        <section class="card">
          <h2>{{ 'lgs.when' | t }}</h2>
          <p class="muted small">{{ 'lgs.whenHint' | t }}</p>
          <div class="lgs-days" role="group" [attr.aria-label]="'lgs.days' | t">
            <span class="kpi">{{ 'lgs.days' | t }}</span>
            @for (d of weekdays(); track $index) {
              <button
                type="button"
                class="lgs-day"
                [attr.aria-pressed]="f.slotDays.includes($index)"
                (click)="toggleDay($index); touch($event)"
              >
                {{ d }}
              </button>
            }
            <label class="lgs-time"
              >{{ 'lgs.time' | t }}
              <input type="time" name="lgTime" [(ngModel)]="f.slotTime" />
            </label>
          </div>
          <div class="lgs-lengths" role="radiogroup" [attr.aria-label]="'lgs.length' | t">
            @for (l of lengths; track l) {
              <button
                type="button"
                role="radio"
                class="lgs-len"
                [attr.aria-checked]="f.length === l"
                [attr.tabindex]="f.length === l ? 0 : -1"
                (click)="f.length = l; estimate(); touch($event)"
                (keydown)="radioKey($event, 'length')"
              >
                <b>{{ 'lgs.length.' + l | t }}</b>
                <span class="small">{{ 'lgs.perEvening' | t: { n: perEvening(l) } }}</span>
                <span class="small muted">{{
                  'lgs.evenings' | t: { n: evenings(l), w: weeks(l) }
                }}</span>
              </button>
            }
          </div>
          <div class="lgs-ai">
            <span class="kpi">{{ 'lgs.aiGames' | t }}</span>
            <div class="pills" role="radiogroup" [attr.aria-label]="'lgs.aiGames' | t">
              @for (m of aiGames; track m) {
                <button
                  type="button"
                  role="radio"
                  [class.on]="f.aiGames === m"
                  [attr.aria-checked]="f.aiGames === m"
                  [attr.tabindex]="f.aiGames === m ? 0 : -1"
                  (click)="f.aiGames = m; estimate(); touch($event)"
                  (keydown)="radioKey($event, 'aiGames')"
                >
                  {{ 'lgs.aiGames.' + m | t }}
                </button>
              }
            </div>
          </div>
          @if (est(); as e) {
            <div class="lgs-est" aria-live="polite">
              <span class="small muted">{{
                'lgs.estHint'
                  | t: { m: e.managers, t: f.tiers, frags: f.fragLimit, min: f.timeLimitMin }
              }}</span>
              <b class="lgs-estv">{{ duration(e.minutes) }}</b>
              <span class="small">{{ 'lgs.estNote' | t: { n: e.realPerMatchday } }}</span>
            </div>
          }
        </section>

        <section class="card">
          <h2>{{ 'lgs.server' | t }}</h2>
          <div class="row gap">
            <label
              >{{ 'lgs.agent' | t }}
              <select name="lgServer" [(ngModel)]="server" (ngModelChange)="serverChanged()">
                <option value="">{{ 'lgs.agentAuto' | t }}</option>
                @for (o of serverOptions(); track o.value) {
                  <option [value]="o.value">{{ o.label }}</option>
                }
              </select>
            </label>
            <label
              >{{ 'lgs.fragLimit' | t }}
              <input
                type="number"
                class="narrow"
                name="lgFrags"
                min="5"
                max="200"
                [(ngModel)]="f.fragLimit"
              />
            </label>
            <label
              >{{ 'lgs.timeLimit' | t }}
              <input
                type="number"
                class="narrow"
                name="lgTimeLimit"
                min="5"
                max="60"
                [(ngModel)]="f.timeLimitMin"
              />
            </label>
            <label
              >{{ 'lgs.betBots' | t }}
              <input
                type="number"
                class="narrow"
                name="lgBetBots"
                min="0"
                max="50"
                [(ngModel)]="f.betBots"
              />
            </label>
          </div>
          <fieldset class="lgs-maps">
            <legend class="small">{{ 'lgs.maps' | t: { n: f.mapPool.length } }}</legend>
            @for (m of maps(); track m) {
              <label class="lgs-map small"
                ><input
                  type="checkbox"
                  [checked]="f.mapPool.includes(m)"
                  (change)="toggleMap(m)"
                />{{ m }}</label
              >
            } @empty {
              <p class="muted small">{{ 'lgs.mapsNone' | t }}</p>
            }
          </fieldset>
        </section>

        <section class="card">
          <h2>{{ 'lgs.money' | t }}</h2>
          <div class="lgs-grid">
            <label
              >{{ 'lgs.tableMoney' | t }}
              <input type="text" name="lgMoney" [(ngModel)]="t.tableMoney" />
            </label>
            <label
              >{{ 'lgs.tierMult' | t }}
              <input type="text" name="lgMult" [(ngModel)]="t.tierMult" />
            </label>
            <label
              >{{ 'lgs.keepers' | t }}
              <input type="text" name="lgKeep" [(ngModel)]="t.keepers" />
            </label>
            <label
              >{{ 'lgs.factors' | t }}
              <input type="text" name="lgFactors" [(ngModel)]="t.factors" />
            </label>
            <label
              >{{ 'lgs.cupBonus' | t }}
              <input type="text" name="lgCup" [(ngModel)]="t.cupBonus" />
            </label>
            <label
              >{{ 'lgs.joinUntil' | t }}
              <input
                type="number"
                class="narrow"
                name="lgJoin"
                min="0"
                max="30"
                [(ngModel)]="f.joinUntil"
              />
            </label>
          </div>
        </section>
        <div class="lgs-actions">
          <button type="button" (click)="discard()">{{ 'lgs.discard' | t }}</button>
          <button type="submit" class="primary" [disabled]="busy()">{{ 'lgs.save' | t }}</button>
        </div>
      </form>

      <aside class="lgs-side">
        <section class="card lgs-test">
          @if (admin(); as a) {
            @if (a.season !== null) {
              <div class="kpi lgs-kick">
                {{ 'lgs.seasonRuns' | t: { s: a.season, d: a.daysLeft ?? 0 } }}
              </div>
            }
            <h2>{{ 'lgs.test' | t }}</h2>
            @if (a.run; as r) {
              <p class="small">
                {{
                  (r.test ? 'lgs.testRuns' : 'lgs.leagueRuns')
                    | t
                      : {
                          s: r.season,
                          n: r.plan.evenings.length,
                          from: date(r.plan.evenings[0]?.day),
                        }
                }}
              </p>
              @if (r.test && r.status === 'running') {
                <button type="button" class="danger" [disabled]="busy()" (click)="abort()">
                  {{ 'lgs.testAbort' | t }}
                </button>
              }
            } @else {
              <p class="muted small">{{ 'lgs.testHint' | t }}</p>
              <button
                type="button"
                class="primary"
                [disabled]="a.season === null"
                (click)="openTest()"
              >
                {{ 'lgs.testOpen' | t }}
              </button>
            }
          }
        </section>
        <section class="card small muted">
          <div class="kpi">{{ 'lgs.notes' | t }}</div>
          <p>{{ 'lgs.notesText' | t }}</p>
        </section>
      </aside>
    </div>

    <dialog #dlg class="lgs-dlg" aria-labelledby="lgs-dlg-t">
      <h2 id="lgs-dlg-t">{{ 'lgs.testTitle' | t }}</h2>
      <label
        >{{ 'lgs.firstEvening' | t }}
        <select name="tlStart" [(ngModel)]="test.startDate">
          @for (d of startDates(); track d.value) {
            <option [value]="d.value">{{ d.label }}</option>
          }
        </select>
      </label>
      <label
        >{{ 'lgs.placement' | t }}
        <select name="tlPlace" [(ngModel)]="test.placement">
          @for (p of placements; track p) {
            <option [value]="p">{{ 'lgs.placement.' + p | t }}</option>
          }
        </select>
      </label>
      <label class="switch"
        ><input type="checkbox" name="tlMoney" [(ngModel)]="test.tableMoney" /><span
          class="tr"
        ></span
        >{{ 'lgs.payMoney' | t }}</label
      >
      @if (est(); as e) {
        <p class="lgs-plan small">
          <b>{{ 'lgs.plan' | t }}</b>
          {{
            'lgs.planText'
              | t
                : {
                    t: f.tiers,
                    n: f.size,
                    md: matchdays(f.size),
                    time: f.slotTime,
                    est: duration(e.minutes),
                  }
          }}
        </p>
      }
      <div class="lgs-actions">
        <button type="button" (click)="dlg.close()">
          {{ 'common.cancel' | t }}
        </button>
        <button type="button" class="primary" [disabled]="busy()" (click)="startTest()">
          {{ 'lgs.testStart' | t }}
        </button>
      </div>
    </dialog>
  `,
  styles: [
    SETTINGS_STYLES,
    `
      .lgs .card {
        max-width: none;
      }
    `,
  ],
})
export class SettingsLeague {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  private readonly cdr = inject(ChangeDetectorRef);
  readonly saved = output<SettingsForm>();
  protected readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  protected readonly busy = signal(false);
  protected readonly sizes = SIZES;
  protected readonly startDays = START_DAYS;
  protected readonly lengths = LENGTHS;
  protected readonly aiGames = AI_GAMES;
  protected readonly placements = ['cup', 'random', 'one'] as const;
  protected readonly admin = signal<LeagueAdmin | null>(null);
  protected readonly est = signal<LeagueEstimate | null>(null);
  private readonly agents = signal<AgentView[]>([]);
  /** The form (plain fields with ngModel: markForCheck after loading). */
  protected f: LeagueSettings = defaults();
  /** The list fields as text ("1200 · 700 · 400 · 200"). */
  protected t = { tableMoney: '', tierMult: '', keepers: '', factors: '', cupBonus: '' };
  /** "agentId/profileId" or "" (the server of the newest Dream Team tournament). */
  protected server = '';
  private readonly serverSig = signal('');
  protected test = {
    startDate: '',
    placement: 'cup' as 'cup' | 'random' | 'one',
    tableMoney: true,
  };
  private udt: UdtSettings | null = null;
  private readonly toasts = inject(Toasts);
  /** The saved league time (the test league's evenings). */
  private readonly slotTime = signal('18:00');

  protected readonly weekdays = computed(() => {
    const de = this.i18n.lang() === 'de';
    // 2024-01-01 was a Monday.
    return Array.from({ length: 7 }, (_, i) =>
      new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(de ? 'de-DE' : 'en-GB', {
        weekday: 'short',
        timeZone: 'UTC',
      }),
    );
  });

  protected readonly serverOptions = computed(() => {
    const out = this.agents().flatMap((a) =>
      a.profiles.map((p) => ({ value: `${a.id}/${p.id}`, label: `${a.name} · ${p.name}` })),
    );
    // A saved server that is gone (or not known yet) stays selectable.
    const saved = this.serverSig();
    if (saved && !out.some((o) => o.value === saved))
      out.push({ value: saved, label: saved.replace('/', ' · ') });
    return out;
  });

  /** Deathmatch maps of the chosen server (all servers' when none is chosen). */
  protected readonly maps = computed(() => {
    const [agentId, profileId] = this.serverSig().split('/');
    const all = this.agents()
      .filter((a) => !agentId || a.id === agentId)
      .flatMap((a) => a.profiles.filter((p) => !profileId || p.id === profileId))
      .flatMap((p) => p.inventory?.maps ?? [])
      .map((m) => m.id)
      .filter((m) => /^DM-/i.test(m));
    return [...new Set([...all, ...this.f.mapPool])].sort((a, b) => a.localeCompare(b));
  });

  constructor() {
    void this.load();
  }

  async load() {
    try {
      const [s, admin, agents] = await Promise.all([
        this.api.settings(),
        this.api.udtLeagueAdmin(),
        this.api.agents(),
      ]);
      this.udt = s.udt;
      this.agents.set(agents);
      this.admin.set(admin);
      this.fill(s.udt);
      await this.estimate();
    } catch {
      // the toast shows the error
    }
  }

  private fill(u: UdtSettings) {
    const de = this.i18n.lang() === 'de';
    this.f = {
      ...defaults(),
      ...u.league,
      slotDays: [...u.league.slotDays],
      mapPool: [...u.league.mapPool],
    };
    this.t = {
      tableMoney: list(u.league.tableMoney, de),
      tierMult: list(u.league.tierMult.slice(0, u.league.tiers), de),
      keepers: list([u.keepers.max, u.keepers.skillLoss], de),
      factors: list(u.league.factors.slice(0, u.league.tiers), de),
      cupBonus: list(u.cupBonus, de),
    };
    this.server =
      u.league.agentId && u.league.profileId ? `${u.league.agentId}/${u.league.profileId}` : '';
    this.serverSig.set(this.server);
    this.slotTime.set(u.league.slotTime);
    this.cdr.markForCheck();
  }

  protected date(day: string | undefined): string {
    if (!day) return '';
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(
      this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB',
      { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' },
    );
  }

  protected matchdays(n: number) {
    return matchdaysOf(n);
  }

  protected perEvening(l: LeagueLength) {
    return PER_EVENING[l];
  }

  protected evenings(l: LeagueLength) {
    return eveningsOf(this.f.size, PER_EVENING[l]);
  }

  protected weeks(l: LeagueLength): string {
    const w = Math.ceil((this.evenings(l) / Math.max(1, this.f.slotDays.length)) * 10) / 10;
    return this.i18n.lang() === 'de' ? String(w).replace('.', ',') : String(w);
  }

  protected duration(min: number): string {
    const h = Math.floor(min / 60);
    return h ? `~${h} h ${min % 60} min` : `~${min} min`;
  }

  protected toggleDay(d: number) {
    const has = this.f.slotDays.includes(d);
    if (has && this.f.slotDays.length === 1) return;
    this.f.slotDays = has
      ? this.f.slotDays.filter((x) => x !== d)
      : [...this.f.slotDays, d].sort((a, b) => a - b);
  }

  /** Buttons change the form too: the page marks it as not saved (it listens to change). */
  protected touch(e: Event) {
    e.target?.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Arrow keys move the choice of a radio group (one tab stop, ARIA radio pattern). */
  protected radioKey(e: KeyboardEvent, key: 'length' | 'aiGames') {
    const d =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!d) return;
    e.preventDefault();
    const list: readonly string[] = key === 'length' ? LENGTHS : AI_GAMES;
    const i = (list.indexOf(this.f[key]) + d + list.length) % list.length;
    if (key === 'length') this.f.length = LENGTHS[i]!;
    else this.f.aiGames = AI_GAMES[i]!;
    void this.estimate();
    this.touch(e);
    this.cdr.markForCheck();
    const radios = (e.target as HTMLElement).parentElement?.querySelectorAll<HTMLElement>(
      '[role="radio"]',
    );
    setTimeout(() => radios?.[i]?.focus());
  }

  /** Back to the saved settings (the tab is not marked as unsaved any more). */
  protected async discard() {
    await this.load();
    this.saved.emit('league');
  }

  protected toggleMap(m: string) {
    this.f.mapPool = this.f.mapPool.includes(m)
      ? this.f.mapPool.filter((x) => x !== m)
      : [...this.f.mapPool, m];
  }

  protected serverChanged() {
    this.serverSig.set(this.server);
  }

  async estimate() {
    try {
      this.est.set(
        await this.api.udtLeagueEstimate({
          tiers: this.f.tiers,
          size: this.f.size,
          length: this.f.length,
          aiGames: this.f.aiGames,
        }),
      );
    } catch {
      this.est.set(null);
    }
  }

  /** The test league's first evening: today, tomorrow (default) or the day after. */
  protected readonly startDates = computed(() => {
    const today = this.admin()?.today ?? new Date().toISOString().slice(0, 10);
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    const de = this.i18n.lang() === 'de';
    const slotTime = this.slotTime();
    return [0, 1, 2].map((i) => {
      const day = new Date(Date.UTC(y, m - 1, d + i));
      const name = day.toLocaleDateString(de ? 'de-DE' : 'en-GB', {
        weekday: 'short',
        timeZone: 'UTC',
      });
      return {
        value: day.toISOString().slice(0, 10),
        label: `${this.i18n.t(`lgs.day.${i}`)}, ${name} ${slotTime}`,
      };
    });
  });

  protected openTest() {
    this.test = { startDate: this.startDates()[1]!.value, placement: 'cup', tableMoney: true };
    this.cdr.markForCheck();
    this.dlg().nativeElement.showModal();
  }

  protected async startTest() {
    this.busy.set(true);
    try {
      this.admin.set(await this.api.udtLeagueTest({ ...this.test }));
      this.dlg().nativeElement.close();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }

  protected async abort() {
    if (!confirm(this.i18n.t('lgs.testAbortConfirm'))) return;
    this.busy.set(true);
    try {
      this.admin.set(await this.api.udtLeagueTestAbort());
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }

  protected async save() {
    if (!this.udt) return;
    const pad = (xs: number[], base: readonly number[]) =>
      base.map((b, i) => (Number.isFinite(xs[i]) ? xs[i]! : b));
    const [agentId, profileId] = this.server ? this.server.split('/') : [null, null];
    // The list fields: a part that is no number is refused (not saved as 0 or shifted).
    const de = this.i18n.lang() === 'de';
    const lists = {} as Record<keyof typeof this.t, number[]>;
    for (const k of Object.keys(this.t) as (keyof typeof this.t)[]) {
      const xs = parseList(this.t[k], de);
      if (!xs) {
        this.toasts.error(this.i18n.t('lgs.badList', { field: this.i18n.t(`lgs.${k}`) }));
        return;
      }
      lists[k] = xs;
    }
    const keep = lists.keepers;
    this.busy.set(true);
    try {
      const s = await this.api.setUdtSettings({
        league: {
          ...this.f,
          tiers: Number(this.f.tiers),
          size: Number(this.f.size),
          fragLimit: Math.round(Number(this.f.fragLimit)),
          timeLimitMin: Math.round(Number(this.f.timeLimitMin)),
          betBots: Math.round(Number(this.f.betBots)),
          joinUntil: Math.round(Number(this.f.joinUntil)),
          agentId: agentId ?? null,
          profileId: profileId ?? null,
          tableMoney: pad(lists.tableMoney, this.udt.league.tableMoney).map(Math.round),
          tierMult: pad(lists.tierMult, this.udt.league.tierMult),
          factors: pad(lists.factors, this.udt.league.factors),
        },
        keepers: {
          ...this.udt.keepers,
          max: Math.round(keep[0] ?? this.udt.keepers.max),
          skillLoss: Math.round(keep[1] ?? this.udt.keepers.skillLoss),
        },
        cupBonus: pad(lists.cupBonus, this.udt.cupBonus).map(Math.round),
      });
      this.udt = s.udt;
      this.fill(s.udt);
      this.admin.set(await this.api.udtLeagueAdmin());
      this.saved.emit('league');
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}

function defaults(): LeagueSettings {
  return {
    enabled: false,
    tiers: 2,
    size: 16,
    startDay: 4,
    slotDays: [0, 1, 2, 3, 4, 5],
    slotTime: '18:00',
    length: 'long',
    aiGames: 'simulate',
    agentId: null,
    profileId: null,
    mapPool: [],
    fragLimit: 50,
    timeLimitMin: 15,
    factors: [1, 1, 1, 1],
    aiFloor: [8, 7, 5, 5],
    tableMoney: [1200, 700, 400, 200],
    tierMult: [1.4, 1, 0.7, 0.5],
    betBots: 10,
    joinUntil: 20,
    keepTestTiers: false,
  };
}
