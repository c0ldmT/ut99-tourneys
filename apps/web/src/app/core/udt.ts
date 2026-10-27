import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import {
  madeSalaryShare,
  baseValue,
  botRarity,
  bracketOf,
  buildCost,
  xpForLevel,
  managerEffects,
  RARITIES,
  SCRAP,
  valueScore,
  weeklySalary,
} from '@tourney/udt';
import { UdtHelp } from '../components/udt-help';
import { Api } from './api';
import { Auth } from './auth';
import { Coin } from './brand';
import { I18n, TPipe } from './i18n';
import { NeuroPipe } from './neuro';
import { Toasts } from './toast';
import { UDT_AREAS, udtAreaOf, udtAreas, type UdtAreaItem } from './udt-areas';
import type { BotTraitsView, UdtCareer, UdtRarity, UdtTestState, UdtTraitOnBot } from './types';

export {
  baseValue,
  botRarity,
  bracketOf,
  buildCost,
  managerEffects,
  RARITIES,
  SCRAP,
  valueScore,
  weeklySalary,
};

/** Salary of a roster bot with its manager traits (the penny pincher). */
export function salaryOf(
  b: { value: number; skill: number; udtTraits?: { code: string }[] },
  /** Share of the full salary (bots a team made: `madeSalaryShare` of their origin). */
  share = 1,
) {
  const f = managerEffects((b.udtTraits ?? []) as Parameters<typeof managerEffects>[0]).salary;
  return Math.round((weeklySalary(b.value, b.skill) * f * share) / 10) * 10;
}

/** A roster bot's weekly salary: bought in full, blueprint bots a share, other own bots none. */
export function rosterSalary(b: {
  value: number;
  skill: number;
  starter: boolean;
  udtTraits?: { code: string }[];
  own?: { origin: string; keptFrom?: number | null } | null;
}): number {
  // The starter and keepers play for free.
  if (b.starter || b.own?.keptFrom) return 0;
  const share = madeSalaryShare(b.own?.origin);
  return share ? salaryOf(b, share) : 0;
}

/** UT99 skill names 0..7. */
export const SKILL_NAMES = [
  'Novice',
  'Average',
  'Experienced',
  'Skilled',
  'Adept',
  'Masterful',
  'Inhuman',
  'Godlike',
];

/** Values -1..1 shown as 0..100. */
export const pct = (v: number | undefined) => Math.round(((v ?? 0) + 1) * 50);

/** "4" or "4–6". */
export function potText(p: readonly [number, number]): string {
  return p[0] === p[1] ? `${p[0]}` : `${p[0]}–${p[1]}`;
}

/** The skill names of a potential range ("Skilled – Masterful"). */
export function potNames(p: readonly [number, number]): string {
  return (p[0] === p[1] ? [p[0]] : p).map((s) => SKILL_NAMES[s] ?? '').join(' – ');
}

/** Where a bot stands against its potential (the range's top is the most it can be). */
export function potState(
  skill: number,
  p: readonly [number, number],
): { kind: 'reached' | 'maybe' | 'left'; a: number; b: number } {
  const s = Math.round(skill);
  if (s >= p[1]) return { kind: 'reached', a: 0, b: 0 };
  if (s >= p[0]) return { kind: 'maybe', a: 0, b: p[1] - s };
  return { kind: 'left', a: p[0] - s, b: p[1] - s };
}

/** The potential in words: "Potential: skill 4–6 (…) · +1–3 skill possible". */
export function potLine(i18n: I18n, skill: number, p: readonly [number, number]): string {
  const st = potState(skill, p);
  const head = i18n.t('udt.pot.title', { p: potText(p), names: potNames(p) });
  const tail =
    st.kind === 'reached'
      ? i18n.t('udt.pot.reached')
      : st.kind === 'maybe'
        ? i18n.t('udt.pot.maybe', { n: st.b })
        : i18n.t(st.a === st.b ? 'udt.pot.left1' : 'udt.pot.left', { a: st.a, b: st.b });
  return `${head} · ${tail}`;
}

export interface CardBot {
  name: string;
  skill: number;
  rarity: UdtRarity;
  traits: BotTraitsView;
  value?: number;
  tag?: string;
  stamina?: number;
  /** Roster bots: traits, slots and the values with the traits. */
  udtTraits?: UdtTraitOnBot[];
  slots?: number;
  level?: number;
  /** Dream Team experience (roster bots): the card shows the way to the next level. */
  xp?: number;
  effective?: { skill: number; traits: BotTraitsView; overflow: boolean };
  career?: UdtCareer | null;
  /** Bots a manager made (and talents, blueprints): the skill they can grow to. */
  potential?: readonly [number, number];
}

/** A roster bot (own, another team's, a trade partner's) as a card, with the team's tag. */
export function rosterCard(
  b: Omit<CardBot, 'tag'> & {
    career?: CardBot['career'];
    own?: { potential: [number, number] } | null;
  },
  tag?: string,
): CardBot {
  return {
    ...b,
    ...(tag ? { tag } : {}),
    ...(b.own ? { potential: b.own.potential } : {}),
    career: b.career ?? null,
  };
}

/** A bot as a Dream Team card (rarity from the skill): skill, values, value, stamina. */
@Component({
  selector: 'udt-card',
  imports: [Coin, NeuroPipe, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let b = bot();
    @let v = b.effective?.traits ?? b.traits;
    @let sk = b.effective?.skill ?? b.skill;
    <div class="udt-card r-{{ b.rarity }}" [class.small]="small()" [class.dim]="dim()">
      @if (badge()) {
        <span class="udt-cbadge">{{ badge() }}</span>
      }
      @if (points() > 0) {
        <button
          type="button"
          class="udt-plaque"
          [title]="'udt.points.plaque' | t: { n: points() }"
          [attr.aria-label]="'udt.points.plaque' | t: { n: points() }"
          (click)="$event.stopPropagation(); pointsClick.emit()"
          (pointerdown)="$event.stopPropagation()"
          (mousedown)="$event.stopPropagation()"
          (touchstart)="$event.stopPropagation()"
        >
          +{{ points() }}
        </button>
      }
      <div class="in">
        <div class="top">
          <div class="sk">
            <div class="ovr">{{ round(sk) }}{{ b.effective?.overflow ? '+' : '' }}</div>
          </div>
          <div class="meta">
            <span class="rar">{{ rarityLabel() }}</span>
            @if (b.level) {
              <span class="lvl">Level {{ b.level }}</span>
            }
            @if (b.potential; as p) {
              @let ps = potState(b.skill, p);
              <span
                class="udt-potc"
                [class.max]="ps.kind === 'reached'"
                [title]="potLine(b.skill, p)"
                >{{
                  ps.kind === 'reached'
                    ? ('udt.pot.chipMax' | t)
                    : ('udt.pot.chip' | t: { p: potText(p) })
                }}</span
              >
            }
            @if (b.career) {
              <span
                [class]="'car ph-' + b.career.phase"
                [title]="'udt.career.age' | t: { n: b.career.age }"
                >{{ 'udt.career.' + b.career.phase | t }}</span
              >
              @if (b.career.form !== 'normal') {
                <span
                  class="frm f-{{ b.career.form }}"
                  [title]="'udt.form.title.' + b.career.form | t"
                  [attr.aria-label]="'udt.form.title.' + b.career.form | t"
                  >Form {{ b.career.form === 'hot' ? '▲' : '▼' }}</span
                >
              }
            }
          </div>
        </div>
        <div class="tier">{{ skillName(sk) }}</div>
        @if (!small()) {
          <div class="pic">
            <svg width="96" height="68" viewBox="0 0 120 100" aria-hidden="true">
              <path
                d="M60 14c-15 0-26 11-26 26v8c0 5 3 9 7 11v6c-14 4-27 12-31 35h100c-4-23-17-31-31-35v-6c4-2 7-6 7-11v-8c0-15-11-26-26-26z"
                fill="#1b2130"
              />
              <path class="vis" d="M40 38h40c2 0 3 2 2 4l-4 8H42l-4-8c-1-2 0-4 2-4z" opacity=".9" />
            </svg>
          </div>
        }
        <div class="name" [title]="(b.tag ?? '') + b.name">
          @if (b.tag) {
            <span class="tag">{{ b.tag }}</span>
          }
          {{ b.name }}
        </div>
        <div class="stats">
          <span [class.up]="v.accuracy !== b.traits.accuracy" title="Accuracy"
            ><i>ACC</i><b>{{ pct(v.accuracy) }}</b></span
          >
          <span [class.up]="v.alertness !== b.traits.alertness" title="Alertness"
            ><i>ALT</i><b>{{ pct(v.alertness) }}</b></span
          >
          <span [class.up]="v.strafing !== b.traits.strafing" title="Strafing"
            ><i>STR</i><b>{{ pct(v.strafing) }}</b></span
          >
        </div>
        @if (b.udtTraits?.length) {
          <div class="udt-traits">
            @for (t of b.udtTraits; track t.id) {
              <span class="udt-trait r-{{ t.rarity }}" [title]="'udt.traitE.' + t.code | t">{{
                'udt.trait.' + t.code | t
              }}</span>
            }
          </div>
        }
        @if (b.stamina !== undefined) {
          <div class="udt-bar" [title]="('udt.stamina' | t) + ' ' + b.stamina">
            <i [style.width.%]="b.stamina" [style.background]="staminaColor(b.stamina)"></i>
          </div>
        }
        @if (xpStep(); as x) {
          <div
            class="udt-bar xp"
            [title]="'udt.points.xpBar' | t: { xp: x.in, need: x.need, lv: (b.level ?? 1) + 1 }"
          >
            <i [style.width.%]="x.pct"></i>
          </div>
        }
        @if (b.value !== undefined || note()) {
          <div class="foot">
            @if (b.value !== undefined) {
              <span class="neuro"><na-coin [size]="13" /> {{ b.value | neuro: false }}</span>
            }
            @if (note()) {
              <span class="note">{{ note() }}</span>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class UdtCard {
  readonly bot = input.required<CardBot>();
  readonly small = input(false);
  /** Not available (e.g. cannot be traded): toned down, the reason in the foot. */
  readonly dim = input(false);
  /** A short line in the foot (e.g. why the bot cannot be traded). */
  readonly note = input<string | null>(null);
  /** A pill on top of the card (e.g. "Keeper"). */
  readonly badge = input<string | null>(null);
  /** Development points to give (own bots): a gold plaque, a click opens them. */
  readonly points = input(0);
  readonly pointsClick = output<void>();
  /** XP within the level and what the next level needs (roster bots). */
  protected readonly xpStep = computed(() => xpStep(this.bot().xp, this.bot().level));
  private readonly i18n = inject(I18n);
  protected readonly round = Math.round;
  protected readonly pct = pct;
  protected skillName(s: number) {
    return SKILL_NAMES[Math.max(0, Math.min(7, Math.round(s)))];
  }
  protected readonly rarityLabel = computed(() => this.i18n.t(`udt.rarity.${this.bot().rarity}`));
  protected readonly potState = potState;
  protected readonly potText = potText;
  /** The potential with its names and what is left (the chip's title). */
  protected potLine(skill: number, p: readonly [number, number]) {
    return potLine(this.i18n, skill, p);
  }
  protected staminaColor(s: number) {
    return staminaColor(s);
  }
}

/** XP of a bot within its level: what it has, what the next level needs, as a share. */
export function xpStep(xp: number | undefined, level: number | undefined) {
  if (xp === undefined || !level) return null;
  const from = xpForLevel(level);
  const need = xpForLevel(level + 1) - from;
  const got = Math.max(0, xp - from);
  return { in: got, need, pct: Math.min(100, Math.round((got / need) * 100)) };
}

export function staminaColor(s: number): string {
  return s >= 60 ? 'var(--live)' : s >= 40 ? '#f59e0b' : 'var(--danger)';
}

/**
 * Navigation of the Dream Team pages (decision 228): the way back to the hub, the areas (my
 * team, league, packs, cups, transfers) and the pages of the current area; the help and, for
 * admins in test mode, the test bar. `bare`: only help and test bar (the hub draws its own).
 */
@Component({
  selector: 'udt-nav',
  imports: [RouterLink, TPipe, UdtHelp],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!bare()) {
      <nav class="udt-nav" [attr.aria-label]="'udt.title' | t">
        <div class="udt-areas">
          <a
            routerLink="/udt"
            class="udt-hubbtn"
            [title]="'udt.hub.title' | t"
            [attr.aria-label]="'udt.hub.title' | t"
            ><span
              ><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 21 12 12 21 3 12zM3 12h18M12 3v18" /></svg></span
          ></a>
          @for (a of areas(); track a.id) {
            <a
              class="udt-area"
              [routerLink]="a.items[0]!.link"
              [class.on]="a.id === area()"
              [attr.aria-current]="a.id === area() ? 'true' : null"
              [style.--ac]="a.color"
              [style.--acr]="a.rgb"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path [attr.d]="a.icon" />
              </svg>
              <span class="l">{{ a.label | t }}</span
              ><span class="s">{{ a.short | t }}</span>
              @if (a.id === 'trans' && tradesIn()) {
                <span
                  class="udt-badge"
                  [attr.aria-label]="'udt.trades.waiting' | t: { n: tradesIn() }"
                  >{{ tradesIn() }}</span
                >
              }
            </a>
          }
          <button type="button" class="udt-help-btn" (click)="help().open()">
            <span class="q" aria-hidden="true">?</span
            ><span class="hl">{{ 'udt.help.button' | t }}</span>
          </button>
        </div>
        @if (current(); as c) {
          <div class="udt-tabs" [style.--ac]="c.color">
            @for (i of c.items; track i.label) {
              <a
                [routerLink]="i.link"
                [fragment]="i.fragment"
                [class.active]="isActive(i)"
                [attr.aria-current]="isActive(i) ? 'page' : null"
                (click)="again(i)"
                >{{ i.label | t }}
                @if (i.badge === 'trades' && tradesIn()) {
                  <span class="udt-badge">{{ tradesIn() }}</span>
                }
              </a>
            }
          </div>
        }
      </nav>
    }
    <udt-help />
    @if (testBar()) {
      <div class="udt-test" role="region" [attr.aria-label]="'udt.test.title' | t">
        <b>{{ 'udt.test.title' | t }}</b>
        @if (state(); as s) {
          <span class="mono small"
            >{{ s.now.slice(0, 16).replace('T', ' ') }} (+{{ s.offsetHours }} h)</span
          >
        }
        <button type="button" (click)="run('advance', { hours: 1 })">+1 h</button>
        <button type="button" (click)="run('advance', { hours: 24 })">
          +1 {{ 'udt.test.day' | t }}
        </button>
        <button type="button" (click)="run('advance', { hours: 168 })">
          +1 {{ 'udt.test.week' | t }}
        </button>
        <button type="button" (click)="run('market-day')">{{ 'udt.test.marketDay' | t }}</button>
        <button type="button" (click)="run('managers', { count: 3 })">
          +3 {{ 'udt.test.managers' | t }}
        </button>
        <button type="button" (click)="run('managers/act')">{{ 'udt.test.act' | t }}</button>
        <button type="button" (click)="run('league/day')">{{ 'udt.test.leagueDay' | t }}</button>
        <button type="button" (click)="run('league/end')">{{ 'udt.test.leagueEnd' | t }}</button>
        <button type="button" class="danger" (click)="endSeason()">
          {{ 'udt.test.seasonEnd' | t }}
        </button>
      </div>
    }
  `,
})
export class UdtNav {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  /** Only the help and the test bar (the hub draws its own areas). */
  readonly bare = input(false);
  /** The address shown (path and fragment). */
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  protected readonly areas = computed(() => udtAreas(!!this.auth.config().udtLeague));
  protected readonly area = computed(() => udtAreaOf(this.url()));
  /** The area of the page (also one hidden from the row, e.g. a league before the config knows). */
  protected readonly current = computed(() => UDT_AREAS.find((a) => a.id === this.area()) ?? null);
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  private readonly toasts = inject(Toasts);
  /** Something changed (time, market, managers): the page reloads. */
  readonly changed = output<void>();
  protected readonly state = signal<UdtTestState | null>(null);
  /** Trade offers waiting for the manager. */
  protected readonly tradesIn = signal(0);
  protected readonly testBar = computed(
    () => !!this.auth.config().testMode && !!this.auth.me()?.isAdmin,
  );

  protected readonly help = viewChild.required(UdtHelp);

  /** Opens the help (the hub's button in its middle). */
  openHelp(): void {
    this.help().open();
  }

  /** A tab is the page shown: same path (the league's table also on /udt/league/table), same anchor. */
  protected isActive(i: UdtAreaItem): boolean {
    const [rest, fragment] = this.url().split('#') as [string, string | undefined];
    const path = rest.split('?')[0]!;
    const same =
      path === i.link ||
      (i.link === '/udt/league' ? path === '/udt/league/table' : path.startsWith(i.link + '/'));
    return same && (i.fragment ?? null) === (fragment ?? null);
  }

  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);

  constructor() {
    if (this.testBar()) void this.load();
    afterNextRender(() => {
      // The hub shows the offers itself (bare: no areas here).
      if (!this.bare()) void this.loadTrades();
      // New managers see the help once by itself.
      this.help().openFirstTime();
      // Phones: the tab row scrolls; the page shown in view.
      const row = this.host.nativeElement.querySelector<HTMLElement>('.udt-tabs');
      const tab = row?.querySelector<HTMLElement>('a.active');
      if (row && tab && row.scrollWidth > row.clientWidth)
        row.scrollLeft = tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2;
    });
  }

  /** A tab of the page shown again (the router ignores it): to its part, or the top. */
  protected again(i: UdtAreaItem): void {
    if (!this.isActive(i)) return;
    if (i.fragment)
      document.getElementById(i.fragment)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  private async loadTrades() {
    try {
      const t = await this.api.udtTrades(true);
      this.tradesIn.set(t.open.filter((x) => x.incoming).length);
    } catch {
      this.tradesIn.set(0);
    }
  }

  private async load() {
    try {
      this.state.set(await this.api.udtTest(true));
    } catch {
      this.state.set(null);
    }
  }

  protected async run(what: string, body?: unknown) {
    try {
      const r = await this.api.udtTestDo(what, body);
      if (r && typeof r === 'object' && 'now' in r) {
        this.state.set(r as UdtTestState);
        this.toasts.success(this.i18n.t('ok.done'));
      } else {
        // The result says what happened (e.g. managers made, season results): keep it readable.
        this.toasts.info(JSON.stringify(r));
        await this.load();
      }
      this.changed.emit();
      void this.loadTrades();
    } catch {
      // the Api shows the error as a toast
    }
  }

  protected endSeason() {
    if (confirm(this.i18n.t('udt.test.seasonEndConfirm'))) void this.run('season-end');
  }
}
