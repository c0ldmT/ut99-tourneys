import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
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
export function salaryOf(b: { value: number; skill: number; udtTraits?: { code: string }[] }) {
  const f = managerEffects((b.udtTraits ?? []) as Parameters<typeof managerEffects>[0]).salary;
  return Math.round((weeklySalary(b.value, b.skill) * f) / 10) * 10;
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
}

/** A roster bot (own, another team's, a trade partner's) as a card, with the team's tag. */
export function rosterCard(
  b: Omit<CardBot, 'tag'> & { career?: CardBot['career'] },
  tag?: string,
): CardBot {
  return { ...b, ...(tag ? { tag } : {}), career: b.career ?? null };
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

/** Sub navigation of the Dream Team pages, with the test mode bar for admins. */
@Component({
  selector: 'udt-nav',
  imports: [RouterLink, RouterLinkActive, TPipe, UdtHelp],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="udt-nav" [attr.aria-label]="'udt.title' | t">
      <a routerLink="/udt" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">{{
        'udt.nav.team' | t
      }}</a>
      <a routerLink="/udt/market" routerLinkActive="active">{{ 'udt.nav.market' | t }}</a>
      <a routerLink="/udt/packs" routerLinkActive="active">{{ 'udt.nav.packs' | t }}</a>
      <a routerLink="/udt/trades" routerLinkActive="active"
        >{{ 'udt.nav.trades' | t }}
        @if (tradesIn()) {
          <span class="udt-badge" [attr.aria-label]="'udt.trades.waiting' | t: { n: tradesIn() }">{{
            tradesIn()
          }}</span>
        }
      </a>
      <a routerLink="/udt/academy" routerLinkActive="active">{{ 'udt.nav.academy' | t }}</a>
      <a routerLink="/udt/events" routerLinkActive="active">{{ 'udt.nav.events' | t }}</a>
      <a routerLink="/udt/table" routerLinkActive="active">{{ 'udt.nav.table' | t }}</a>
      <a routerLink="/udt/squads" routerLinkActive="active">{{ 'udt.nav.squads' | t }}</a>
      <a routerLink="/udt/yearbook" routerLinkActive="active">{{ 'udt.nav.yearbook' | t }}</a>
      <button type="button" class="udt-help-btn" (click)="help().open()">
        <span class="q" aria-hidden="true">?</span>{{ 'udt.help.button' | t }}
      </button>
    </nav>
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
        <button type="button" class="danger" (click)="endSeason()">
          {{ 'udt.test.seasonEnd' | t }}
        </button>
      </div>
    }
  `,
})
export class UdtNav {
  private readonly auth = inject(Auth);
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

  constructor() {
    if (this.testBar()) void this.load();
    void this.loadTrades();
    // New managers see the help once by itself.
    afterNextRender(() => this.help().openFirstTime());
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
