import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { Auth } from '../core/auth';
import { Icon } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { isLocalAddress } from '../core/connect';
import { scheduleText, weekdayNames } from '../core/series-text';
import { MH_ADAPTER } from '../core/race';
import type {
  AgentView,
  LibraryBot,
  SeriesPreview,
  SeriesView,
  TournamentDetail,
  TournamentSettings,
  UdtEventRules,
} from '../core/types';

const STOCK_POOL = [
  'DM-Deck16][',
  'DM-Morpheus',
  'DM-Phobos',
  'DM-Codex',
  'DM-Pressure',
  'DM-Curse][',
];

/** Monster Hunt: time limit per run (same as the adapter's defaultLimits). */
const MH_TIME_LIMIT = 20;

/** Suggested frag/time limits per team size (same as the adapter's defaultLimits). */
const LIMITS: Record<number, { fragLimit: number; timeLimitMin: number }> = {
  1: { fragLimit: 20, timeLimitMin: 10 },
  2: { fragLimit: 30, timeLimitMin: 15 },
  3: { fragLimit: 40, timeLimitMin: 15 },
  5: { fragLimit: 60, timeLimitMin: 15 },
};

/** One tournament, or a series that creates one every n weeks. */
type When = 'once' | 'series';

interface Model {
  name: string;
  when: When;
  agentId: string;
  profileId: string;
  connectAddress: string;
  scheduledAt: string;
  registrationOpen: boolean;
  /** Seeded and started by itself at the start time. */
  autoStart: boolean;
  // series schedule: weekly on some days, or daily; fixed times or every n hours
  repeat: 'weekly' | 'daily';
  days: number[];
  everyWeeks: number;
  timeMode: 'fixed' | 'interval';
  times: string[];
  everyHours: number;
  fromTime: string;
  toTime: string;
  leadValue: number;
  leadUnit: 'min' | 'h' | 'd';
  format: 'single' | 'double';
  size: number;
  teamSize: number;
  /** dm: deathmatch, mh: Monster Hunt time race (teams only). */
  game: 'dm' | 'mh';
  grandFinalReset: boolean;
  boDefault: number;
  boSemi: number;
  boFinal: number;
  boLbFinal: number;
  boGrand: number;
  checkInWindowMin: number;
  noShowSec: number;
  reconnectGraceSec: number;
  maxReconnects: number;
  botMatchMode: 'watch' | 'simulate';
  botPlacement: 'byes' | 'random';
  postTournamentShutdownSec: number;
  fragLimit: number;
  timeLimitMin: number;
  mapMode: 'vote' | 'random';
  voteTimeoutSec: number;
  countdownSec: number;
  smartStockBots: boolean;
  friendlyFirePct: 0 | 50 | 100;
  penaltySec: number;
  monsterSkill: number;
  /** Monster Hunt: lives per hunter, 0 = unlimited. */
  lives: number;
  mapPool: string[];
  /** Team games: bots of a clan play together as a team. */
  clanTeams: boolean;
  notifyMode: 'default' | 'custom' | 'off';
  /** Season tournament: ratings and season statistics (only while a season runs). */
  seasonal: boolean;
  webhookUrl: string;
  /** Dream Team tournament: managers' lineups; cap in reference Neuro (0 = none), star limit (-1 = none). */
  udt: boolean;
  udtCap: number;
  udtStars: number;
  /** High stakes: ticket in Neuro (0 = none), at the index, fewest human teams. */
  udtTicket: number;
  udtTicketIndexed: boolean;
  udtMinTeams: number;
  udtFinale: boolean;
}

/** What a stored tournament or series template contributes to the model. */
interface Parts {
  agentId: string;
  profileId: string;
  connectAddress: string | null;
  settings: TournamentSettings;
  notifyMode: 'default' | 'custom' | 'off';
  webhookUrl: string | null;
  seasonal: boolean;
  registrationOpen: boolean;
  autoStart: boolean;
  kind?: 'standard' | 'udt';
  udt?: UdtEventRules | null;
}

const UNIT_MIN = { min: 1, h: 60, d: 1440 } as const;

const pad = (n: number) => String(n).padStart(2, '0');

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * New tournament or series, edit a tournament or a series (admins). The bots are the active
 * bots of the control center; a summary on the side (below on phones) shows what is created.
 */
@Component({
  selector: 'app-tournament-form',
  imports: [FormsModule, RouterLink, TPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <div>
        <h1>{{ title() | t }}</h1>
        <p class="muted sub">{{ subtitle() | t }}</p>
      </div>
      <a class="btn" routerLink="/admin/series">
        <na-icon name="copyToNew" [size]="16" /> {{ 'form.manageSeries' | t }}
      </a>
    </div>
    @if (locked()) {
      <p class="notice">{{ 'form.locked' | t }}</p>
    }
    @if (loadError()) {
      <p class="error">{{ loadError() }}</p>
    }
    @if (m(); as f) {
      <form class="layout" (ngSubmit)="save()">
        <div class="main">
          <!-- 1 Basics and date -->
          <section class="card sec">
            <header class="sh"><span class="no">1</span>{{ 'form.secBasics' | t }}</header>
            <label for="fname">{{
              (f.when === 'series' ? 'form.seriesName' : 'form.name') | t
            }}</label>
            <input
              id="fname"
              class="big"
              name="name"
              [(ngModel)]="f.name"
              (ngModelChange)="touch()"
              required
              maxlength="90"
              [placeholder]="(f.when === 'series' ? 'form.seriesNamePh' : 'form.namePh') | t"
            />
            @if (f.when === 'series') {
              <p class="muted small">{{ 'series.nameHint' | t }}</p>
            }

            @if (canChooseWhen()) {
              <div class="seg when" role="group" [attr.aria-label]="'form.when' | t">
                <button type="button" [class.on]="f.when === 'once'" (click)="setWhen('once')">
                  {{ 'form.once' | t }}
                </button>
                <button type="button" [class.on]="f.when === 'series'" (click)="setWhen('series')">
                  <na-icon name="copyToNew" [size]="15" /> {{ 'form.repeat' | t }}
                </button>
              </div>
            }

            @if (f.when === 'once') {
              <div class="fields">
                <div class="field">
                  <label for="fsched">{{ 'form.scheduledAt' | t }}</label>
                  <input
                    id="fsched"
                    name="sched"
                    type="datetime-local"
                    [(ngModel)]="f.scheduledAt"
                    (ngModelChange)="touch()"
                  />
                </div>
              </div>
            } @else {
              <div class="sched">
                <div>
                  <label>{{ 'series.repeat' | t }}</label>
                  <div class="seg">
                    <button
                      type="button"
                      [class.on]="f.repeat === 'weekly'"
                      (click)="f.repeat = 'weekly'; touch()"
                    >
                      {{ 'series.weekly' | t }}
                    </button>
                    <button
                      type="button"
                      [class.on]="f.repeat === 'daily'"
                      (click)="f.repeat = 'daily'; touch()"
                    >
                      {{ 'series.daily' | t }}
                    </button>
                  </div>
                </div>
                @if (f.repeat === 'weekly') {
                  <div>
                    <label for="fevery">{{ 'series.every' | t }}</label>
                    <select
                      id="fevery"
                      class="auto"
                      name="every"
                      [(ngModel)]="f.everyWeeks"
                      (ngModelChange)="touch()"
                    >
                      @for (n of [1, 2, 3, 4]; track n) {
                        <option [ngValue]="n">
                          {{ n === 1 ? ('series.everyWeek' | t) : ('series.everyN' | t: { n }) }}
                        </option>
                      }
                    </select>
                  </div>
                }
              </div>
              @if (f.repeat === 'weekly') {
                <label>{{ 'series.days' | t }}</label>
                <div class="seg days" role="group" [attr.aria-label]="'series.days' | t">
                  @for (w of weekdays(); track w.n) {
                    <button
                      type="button"
                      [class.on]="f.days.includes(w.n)"
                      [attr.aria-pressed]="f.days.includes(w.n)"
                      (click)="toggleDay(w.n)"
                      [title]="w.long"
                    >
                      {{ w.short }}
                    </button>
                  }
                </div>
              }
              <label>{{ 'series.times' | t }}</label>
              <div class="seg tmode">
                <button
                  type="button"
                  [class.on]="f.timeMode === 'fixed'"
                  (click)="f.timeMode = 'fixed'; touch()"
                >
                  {{ 'series.fixedTimes' | t }}
                </button>
                <button
                  type="button"
                  [class.on]="f.timeMode === 'interval'"
                  (click)="f.timeMode = 'interval'; touch()"
                >
                  {{ 'series.interval' | t }}
                </button>
              </div>
              @if (f.timeMode === 'fixed') {
                <div class="times">
                  @for (tm of f.times; track $index) {
                    <span class="tm">
                      <input
                        type="time"
                        [name]="'tm' + $index"
                        [(ngModel)]="f.times[$index]"
                        (ngModelChange)="touch()"
                        [attr.aria-label]="'series.time' | t"
                        required
                      />
                      @if (f.times.length > 1) {
                        <button
                          type="button"
                          class="icon"
                          (click)="removeTime($index)"
                          [title]="'common.delete' | t"
                          [attr.aria-label]="'common.delete' | t"
                        >
                          <na-icon name="close" [size]="15" />
                        </button>
                      }
                    </span>
                  }
                  <button type="button" (click)="addTime()" [disabled]="f.times.length >= 24">
                    <na-icon name="plus" [size]="15" /> {{ 'series.addTime' | t }}
                  </button>
                </div>
              } @else {
                <div class="fields">
                  <div class="field">
                    <label for="fhours">{{ 'series.everyHoursLabel' | t }}</label>
                    <select
                      id="fhours"
                      name="hours"
                      [(ngModel)]="f.everyHours"
                      (ngModelChange)="touch()"
                    >
                      @for (h of hourSteps; track h) {
                        <option [ngValue]="h">{{ 'series.hoursN' | t: { n: h } }}</option>
                      }
                    </select>
                  </div>
                  <div class="field">
                    <label for="ffrom">{{ 'series.from' | t }}</label>
                    <input
                      id="ffrom"
                      name="from"
                      type="time"
                      [(ngModel)]="f.fromTime"
                      (ngModelChange)="touch()"
                      required
                    />
                  </div>
                  <div class="field">
                    <label for="fto">{{ 'series.to' | t }}</label>
                    <input
                      id="fto"
                      name="to"
                      type="time"
                      [(ngModel)]="f.toTime"
                      (ngModelChange)="touch()"
                      required
                    />
                  </div>
                </div>
              }
              <div class="fields">
                <div class="field">
                  <label for="flead">{{ 'series.lead' | t }}</label>
                  <div class="unit">
                    <input
                      id="flead"
                      name="lead"
                      type="number"
                      min="0"
                      [(ngModel)]="f.leadValue"
                      (ngModelChange)="touch()"
                    /><select
                      name="leadUnit"
                      [(ngModel)]="f.leadUnit"
                      (ngModelChange)="touch()"
                      [attr.aria-label]="'series.lead' | t"
                    >
                      <option value="min">{{ 'unit.min' | t }}</option>
                      <option value="h">{{ 'unit.h' | t }}</option>
                      <option value="d">{{ 'unit.d' | t }}</option>
                    </select>
                  </div>
                </div>
              </div>
              <p class="muted small">{{ 'series.leadHint' | t }}</p>
              @if (preview(); as pv) {
                <div class="pv">
                  <span class="pvh"
                    >{{ 'series.preview' | t }}
                    <span class="muted small"
                      >· {{ 'series.perDay' | t: { n: pv.perDay } }} · {{ pv.timeZone }}</span
                    ></span
                  >
                  <ol>
                    @for (x of pv.next.slice(0, 3); track x.start) {
                      <li>
                        <b>{{ x.name }}</b> <span class="muted">{{ i18n.date(x.start) }}</span>
                      </li>
                    }
                  </ol>
                </div>
              }
              @if (previewError()) {
                <p class="error small">{{ previewError() }}</p>
              }
            }

            <div class="switches">
              @if (f.when === 'once') {
                <label class="switch"
                  ><input
                    type="checkbox"
                    name="reg"
                    [(ngModel)]="f.registrationOpen"
                    (ngModelChange)="touch()"
                  /><span class="tr"></span>{{ 'form.registrationOpen' | t }}</label
                >
              }
              <label class="switch"
                ><input
                  type="checkbox"
                  name="seasonal"
                  [(ngModel)]="f.seasonal"
                  (ngModelChange)="touch()"
                  [disabled]="!currentSeason() && !f.seasonal && f.when === 'once'"
                /><span class="tr"></span>{{ 'form.seasonal' | t }}</label
              >
              <label class="switch"
                ><input
                  type="checkbox"
                  name="autoStart"
                  [(ngModel)]="f.autoStart"
                  (ngModelChange)="touch()"
                  [disabled]="f.when === 'once' && !f.scheduledAt && !f.autoStart"
                /><span class="tr"></span>{{ 'form.autoStart' | t }}</label
              >
            </div>
            @if (f.autoStart) {
              <p class="muted small">{{ 'form.autoStartHint' | t }}</p>
            }
            @if (auth.config().udt || f.udt) {
              <label class="switch"
                ><input
                  type="checkbox"
                  name="udt"
                  [(ngModel)]="f.udt"
                  (ngModelChange)="touch()"
                  [disabled]="locked()"
                /><span class="tr"></span>{{ 'form.udt' | t }}</label
              >
              @if (f.udt) {
                <div class="row gap">
                  <label
                    >{{ 'form.udtCap' | t }}
                    <input
                      type="number"
                      name="udtCap"
                      min="0"
                      step="100"
                      class="narrow"
                      [(ngModel)]="f.udtCap"
                      (ngModelChange)="touch()"
                      [disabled]="locked()"
                    />
                  </label>
                  <label
                    >{{ 'form.udtStars' | t }}
                    <select
                      name="udtStars"
                      [(ngModel)]="f.udtStars"
                      (ngModelChange)="touch()"
                      [disabled]="locked()"
                    >
                      <option [ngValue]="-1">{{ 'form.udtNoLimit' | t }}</option>
                      @for (n of [0, 1, 2, 3, 4, 5]; track n) {
                        <option [ngValue]="n">{{ n }}</option>
                      }
                    </select>
                  </label>
                </div>
                <p class="muted small">{{ 'form.udtHint' | t }}</p>
                <div class="row gap">
                  <label
                    >{{ 'form.udtTicket' | t }}
                    <input
                      type="number"
                      name="udtTicket"
                      min="0"
                      step="100"
                      class="narrow"
                      [(ngModel)]="f.udtTicket"
                      (ngModelChange)="touch()"
                      [disabled]="locked()"
                    />
                  </label>
                  @if (f.udtTicket > 0) {
                    <label
                      >{{ 'form.udtMinTeams' | t }}
                      <input
                        type="number"
                        name="udtMinTeams"
                        min="2"
                        max="16"
                        class="narrow"
                        [(ngModel)]="f.udtMinTeams"
                        (ngModelChange)="touch()"
                        [disabled]="locked()"
                      />
                    </label>
                    <label class="switch"
                      ><input
                        type="checkbox"
                        name="udtTicketIndexed"
                        [(ngModel)]="f.udtTicketIndexed"
                        (ngModelChange)="touch()"
                        [disabled]="locked()"
                      /><span class="tr"></span>{{ 'form.udtTicketIndexed' | t }}</label
                    >
                  }
                </div>
                <p class="muted small">{{ 'form.udtTicketHint' | t }}</p>
                <label class="switch"
                  ><input
                    type="checkbox"
                    name="udtFinale"
                    [(ngModel)]="f.udtFinale"
                    (ngModelChange)="touch()"
                    [disabled]="locked()"
                  /><span class="tr"></span>{{ 'form.udtFinale' | t }}</label
                >
                <p class="muted small">{{ 'form.udtFinaleHint' | t }}</p>
              }
            }
            <p class="muted small">
              {{ 'form.seasonalHint' | t }}
              @if (currentSeason(); as n) {
                <span class="ok">{{ 'form.seasonRunning' | t: { n } }}</span>
              } @else if (f.when === 'series') {
                {{ 'form.seasonalSeries' | t }}
              } @else {
                <span class="err">{{ 'form.seasonNone' | t }}</span>
              }
            </p>
          </section>

          <!-- 2 Game and bracket -->
          <section class="card sec" [class.lock]="locked()">
            <header class="sh"><span class="no">2</span>{{ 'form.secGame' | t }}</header>
            <div class="tiles" role="group" [attr.aria-label]="'form.game' | t">
              <button
                type="button"
                class="tile"
                [class.on]="f.game === 'dm'"
                [disabled]="locked()"
                (click)="onGame('dm')"
              >
                <na-icon name="target" [size]="26" />
                <b>{{ 'form.gameDm' | t }}</b>
                <span class="muted small">{{ 'form.gameDmHint' | t }}</span>
              </button>
              <button
                type="button"
                class="tile"
                [class.on]="f.game === 'mh'"
                [disabled]="locked()"
                (click)="onGame('mh')"
              >
                <na-icon name="skull" [size]="26" />
                <b>{{ 'form.gameMh' | t }}</b>
                <span class="muted small">{{ 'form.gameMhHint' | t }}</span>
              </button>
            </div>

            <div class="opts">
              <div>
                <label>{{ 'form.mode' | t }}</label>
                <div class="seg">
                  @for (k of f.game === 'mh' ? [2, 3, 5] : teamSizes; track k) {
                    <button
                      type="button"
                      [class.on]="f.teamSize === k"
                      [disabled]="locked()"
                      (click)="onTeamSize(k)"
                    >
                      {{ k === 1 ? '1v1' : k + 'v' + k }}
                    </button>
                  }
                </div>
              </div>
              <div>
                <label>{{ 'form.format' | t }}</label>
                <div class="seg">
                  @for (x of formats; track x) {
                    <button
                      type="button"
                      [class.on]="f.format === x"
                      [disabled]="locked()"
                      (click)="f.format = x; touch()"
                    >
                      {{ 'format.' + x | t }}
                    </button>
                  }
                </div>
              </div>
              <div>
                <label>{{ (f.teamSize > 1 ? 'form.sizeTeams' : 'form.size') | t }}</label>
                <div class="seg">
                  @for (s of f.teamSize > 1 ? [4, 8, 16] : [4, 8, 16, 32]; track s) {
                    <button
                      type="button"
                      [class.on]="f.size === s"
                      [disabled]="locked()"
                      (click)="f.size = s; touch()"
                    >
                      {{ s }}
                    </button>
                  }
                </div>
              </div>
              <div>
                <label>{{ 'form.boDefault' | t }}</label>
                <div class="seg">
                  @for (b of bestOf; track b) {
                    <button
                      type="button"
                      [class.on]="f.boDefault === b"
                      [disabled]="locked()"
                      (click)="f.boDefault = b; touch()"
                    >
                      Bo{{ b }}
                    </button>
                  }
                </div>
              </div>
            </div>
            @if (f.format === 'double') {
              <label class="switch"
                ><input
                  type="checkbox"
                  name="gfr"
                  [(ngModel)]="f.grandFinalReset"
                  (ngModelChange)="touch()"
                  [disabled]="locked()"
                /><span class="tr"></span>{{ 'form.gfReset' | t }}</label
              >
            }
            <details class="more" [open]="boCustomized()">
              <summary>{{ 'form.boCustom' | t }}</summary>
              <div class="fields">
                @for (k of boKeys(); track k.key) {
                  <div class="field">
                    <label [for]="k.key">{{ k.label | t }}</label>
                    <select
                      [id]="k.key"
                      [name]="k.key"
                      [(ngModel)]="f[k.key]"
                      (ngModelChange)="touch()"
                      [disabled]="locked()"
                    >
                      <option [ngValue]="0">{{ 'form.boSame' | t }}</option>
                      @for (b of bestOf; track b) {
                        <option [ngValue]="b">Bo{{ b }}</option>
                      }
                    </select>
                  </div>
                }
              </div>
            </details>
          </section>

          <!-- 3 Match rules and maps -->
          <section class="card sec" [class.lock]="locked()">
            <header class="sh"><span class="no">3</span>{{ 'form.secRules' | t }}</header>
            <fieldset class="plain" [disabled]="locked()">
              <div class="fields">
                @if (f.game === 'mh') {
                  <div class="field">
                    <label for="ftl">{{ 'form.runTimeLimit2' | t }}</label>
                    <div class="unit">
                      <input
                        id="ftl"
                        type="number"
                        name="tl"
                        min="1"
                        max="60"
                        [(ngModel)]="f.timeLimitMin"
                        (ngModelChange)="touch()"
                      /><span>min</span>
                    </div>
                  </div>
                  <div class="field">
                    <label for="fpen">{{ 'form.penalty2' | t }}</label>
                    <div class="unit">
                      <input
                        id="fpen"
                        type="number"
                        name="pen"
                        min="0"
                        max="60"
                        [(ngModel)]="f.penaltySec"
                      /><span>s</span>
                    </div>
                  </div>
                  <div class="field">
                    <label for="flives">{{ 'form.lives' | t }}</label>
                    <select id="flives" name="lives" [(ngModel)]="f.lives">
                      @for (n of livesChoices; track n) {
                        <option [ngValue]="n">
                          {{ n === 0 ? ('form.livesUnlimited' | t) : n }}
                        </option>
                      }
                    </select>
                  </div>
                  <div class="field">
                    <label for="fmsk">{{ 'form.monsterSkill' | t }}</label>
                    <select id="fmsk" name="msk" [(ngModel)]="f.monsterSkill">
                      @for (s of skills; track s) {
                        <option [ngValue]="s">{{ s }} – {{ 'skill.' + s | t }}</option>
                      }
                    </select>
                  </div>
                } @else {
                  <div class="field">
                    <label for="ffl">{{ 'form.fragLimit2' | t }}</label>
                    <div class="unit">
                      <input
                        id="ffl"
                        type="number"
                        name="fl"
                        min="0"
                        max="200"
                        [(ngModel)]="f.fragLimit"
                        (ngModelChange)="touch()"
                      /><span>{{ 'form.uFrags' | t }}</span>
                    </div>
                  </div>
                  <div class="field">
                    <label for="ftl2">{{ 'form.timeLimit2' | t }}</label>
                    <div class="unit">
                      <input
                        id="ftl2"
                        type="number"
                        name="tl"
                        min="0"
                        max="60"
                        [(ngModel)]="f.timeLimitMin"
                        (ngModelChange)="touch()"
                      /><span>min</span>
                    </div>
                  </div>
                  @if (f.teamSize > 1) {
                    <div class="field">
                      <label>{{ 'form.friendlyFire' | t }}</label>
                      <div class="seg">
                        @for (p of ffChoices; track p) {
                          <button
                            type="button"
                            [class.on]="f.friendlyFirePct === p"
                            (click)="f.friendlyFirePct = p"
                          >
                            {{ p }} %
                          </button>
                        }
                      </div>
                    </div>
                  }
                }
              </div>
              <p class="muted small">
                {{ (f.game === 'mh' ? 'form.limitHintMh' : 'form.limitHint') | t }}
              </p>
              @if (f.game === 'mh') {
                <p class="muted small">
                  <strong>{{ 'form.botAi' | t }}</strong> {{ 'form.botAiHint' | t }}
                </p>
              }

              <div class="maphead">
                <div>
                  <label>{{ 'form.maps' | t }}</label>
                  <div class="seg">
                    <button
                      type="button"
                      [class.on]="f.mapMode === 'vote'"
                      (click)="f.mapMode = 'vote'; touch()"
                    >
                      {{ 'form.mapVote' | t }}
                    </button>
                    <button
                      type="button"
                      [class.on]="f.mapMode === 'random'"
                      (click)="f.mapMode = 'random'; touch()"
                    >
                      {{ 'form.mapRandom' | t }}
                    </button>
                  </div>
                </div>
                <span class="grow"></span>
                <input
                  class="mapsearch"
                  name="msearch"
                  [ngModel]="mapFilter()"
                  (ngModelChange)="mapFilter.set($event)"
                  [placeholder]="'form.mapSearch' | t"
                  [attr.aria-label]="'form.mapSearch' | t"
                />
                <button type="button" (click)="allMaps(true)">{{ 'form.mapAll' | t }}</button>
                <button type="button" (click)="allMaps(false)">{{ 'form.mapNone' | t }}</button>
              </div>
              <div class="maps">
                @for (map of shownMaps(); track map.id) {
                  <label
                    class="map"
                    [class.on]="f.mapPool.includes(map.id)"
                    [title]="map.title || map.id"
                  >
                    <input
                      type="checkbox"
                      [checked]="f.mapPool.includes(map.id)"
                      (change)="toggleMap(map.id)"
                    />
                    <span class="mid">{{ map.id }}</span>
                    @if (map.title && map.title !== map.id) {
                      <span class="mt">{{ map.title }}</span>
                    }
                    @if (map.stock === false) {
                      <span class="cust" [title]="'form.customMapHint' | t">*</span>
                    }
                  </label>
                } @empty {
                  <p class="muted small">{{ 'form.noMaps' | t }}</p>
                }
              </div>
              <div class="addmap">
                <input
                  name="newmap"
                  [(ngModel)]="newMap"
                  [placeholder]="f.game === 'mh' ? 'MH-Example' : 'DM-Example'"
                  [attr.aria-label]="'form.addMap' | t"
                />
                <button type="button" (click)="addMap()" [disabled]="!newMap.trim()">
                  <na-icon name="plus" [size]="15" /> {{ 'form.addMap' | t }}
                </button>
              </div>
              @if (!inventoryMaps().length) {
                <p class="muted small">
                  {{ (f.game === 'mh' ? 'form.noInventoryMh' : 'form.noInventory') | t }}
                </p>
              }
            </fieldset>
          </section>

          <!-- 4 Server -->
          <section class="card sec" [class.lock]="locked()">
            <header class="sh"><span class="no">4</span>{{ 'form.secServer' | t }}</header>
            @if (!agents().length) {
              <p class="notice">
                {{ 'form.noAgents' | t }} <a routerLink="/admin/agents">{{ 'nav.agents' | t }}</a>
              </p>
            }
            <fieldset class="plain" [disabled]="locked()">
              <div class="fields">
                <div class="field">
                  <label for="fagent">{{ 'form.agent' | t }}</label>
                  <div class="withdot">
                    <span class="dot" [class.on]="agent()?.online"></span>
                    <select
                      id="fagent"
                      name="agent"
                      [(ngModel)]="f.agentId"
                      (ngModelChange)="onAgent()"
                    >
                      @for (a of agents(); track a.id) {
                        <option [value]="a.id">
                          {{ a.name }} –
                          {{ a.online ? ('agents.online' | t) : ('agents.offline' | t) }}
                        </option>
                      }
                    </select>
                  </div>
                </div>
                <div class="field">
                  <label for="fprof">{{ 'form.profile' | t }}</label>
                  <select
                    id="fprof"
                    name="profile"
                    [(ngModel)]="f.profileId"
                    (ngModelChange)="touch()"
                  >
                    @for (p of profiles(); track p.id) {
                      <option [value]="p.id">{{ p.name }}</option>
                    }
                  </select>
                </div>
              </div>
            </fieldset>
            <details class="more" [open]="!!f.connectAddress">
              <summary>{{ 'form.connectAddress' | t }}</summary>
              <input
                name="addr"
                [(ngModel)]="f.connectAddress"
                [placeholder]="profileAddress() || 'ut.example.com:7777'"
              />
              <p class="muted small">{{ 'form.connectHint' | t }}</p>
            </details>
            @if (isLocal(f.connectAddress || profileAddress())) {
              <p class="error small">{{ 'form.localAddress' | t }}</p>
            }
          </section>

          <!-- 5 Bots -->
          <section class="card sec">
            <header class="sh">
              <span class="no">5</span>{{ 'form.secBots' | t }}
              <span class="grow"></span>
              <a class="btn small" routerLink="/admin/bots">{{ 'form.botsCenter' | t }}</a>
            </header>
            @if (activeLibrary().length) {
              <p>
                {{ 'form.botsFromCenter' | t: { n: activeLibrary().length } }}
              </p>
              <div class="bots">
                @for (b of activeLibrary(); track b.id) {
                  <a class="bchip" [routerLink]="['/bots', b.id]" [title]="'skill.' + b.skill | t">
                    <span class="sk" [attr.data-s]="b.skill">{{ b.skill }}</span>
                    {{ b.gameName }}
                  </a>
                }
              </div>
            } @else {
              <p class="notice">{{ 'form.botsNone' | t }}</p>
            }
            @if (tooFewBots()) {
              <p class="error small">{{ 'form.botsTooFew' | t: { n: f.teamSize * 2 } }}</p>
            }
            @if (ownPool()) {
              <p class="notice small">{{ 'form.botsLegacy' | t }}</p>
            }
            <p class="muted small">
              @if (f.teamSize > 1) {
                {{ 'form.botPoolHintTeam' | t: { n: f.teamSize * 2 } }}
              } @else {
                {{ 'form.botPoolHint' | t: { size: f.size } }}
              }
              {{ 'form.botsFixed' | t }}
            </p>
            <div class="switches">
              @if (f.teamSize > 1) {
                <label class="switch"
                  ><input
                    type="checkbox"
                    name="clanTeams"
                    [(ngModel)]="f.clanTeams"
                    [disabled]="locked()"
                  /><span class="tr"></span>{{ 'form.clanTeams' | t }}</label
                >
              }
              <label class="switch"
                ><input
                  type="checkbox"
                  name="ssb"
                  [(ngModel)]="f.smartStockBots"
                  [disabled]="locked()"
                /><span class="tr"></span>{{ 'form.smartStockBots' | t }}</label
              >
            </div>
            <p class="muted small">
              @if (f.teamSize > 1) {
                {{ 'form.clanTeamsHint' | t }}
              }
              {{ 'form.smartStockBotsHint' | t }}
              @switch (ssbInstalled()) {
                @case (true) {
                  <span class="ok">{{ 'form.ssbInstalled' | t }}</span>
                }
                @case (false) {
                  <span class="err">{{ 'form.ssbMissing' | t }}</span>
                }
                @default {
                  {{ 'form.ssbUnknown' | t }}
                }
              }
            </p>
          </section>

          <!-- 6 Discord -->
          <section class="card sec">
            <header class="sh"><span class="no">6</span>{{ 'form.notify' | t }}</header>
            <div class="seg">
              @for (x of notifyModes; track x) {
                <button
                  type="button"
                  [class.on]="f.notifyMode === x"
                  (click)="f.notifyMode = x; touch()"
                >
                  {{ notifyLabel(x) | t }}
                </button>
              }
            </div>
            @if (f.notifyMode === 'custom') {
              <div class="field hook">
                <label for="fwh">{{ 'form.webhookUrl' | t }}</label>
                <input
                  id="fwh"
                  name="wh"
                  [(ngModel)]="f.webhookUrl"
                  placeholder="https://discord.com/api/webhooks/…"
                  maxlength="300"
                />
              </div>
            }
            <p class="muted small">
              {{ 'form.notifyHint' | t }}
              {{ (notifyStatus().directMessages ? 'form.notifyDmOn' : 'form.notifyDmOff') | t }}
            </p>
          </section>

          <!-- 7 Advanced -->
          <details class="card sec adv">
            <summary class="sh">
              <span class="no">7</span>{{ 'form.secAdvanced' | t }}
              <span class="muted small">{{ 'form.secAdvancedHint' | t }}</span>
            </summary>
            <fieldset class="plain" [disabled]="locked()">
              <div class="fields">
                <div class="field">
                  <label for="fci">{{ 'form.checkIn' | t }}</label>
                  <input
                    id="fci"
                    type="number"
                    name="ci"
                    min="1"
                    max="120"
                    [(ngModel)]="f.checkInWindowMin"
                  />
                </div>
                <div class="field">
                  <label for="fns">{{ 'form.noShow' | t }}</label>
                  <input
                    id="fns"
                    type="number"
                    name="ns"
                    min="30"
                    max="1800"
                    [(ngModel)]="f.noShowSec"
                  />
                </div>
                <div class="field">
                  <label for="frg">{{ 'form.reconnectGrace' | t }}</label>
                  <input
                    id="frg"
                    type="number"
                    name="rg"
                    min="30"
                    max="1800"
                    [(ngModel)]="f.reconnectGraceSec"
                  />
                </div>
                <div class="field">
                  <label for="fmr">{{ 'form.maxReconnects' | t }}</label>
                  <input
                    id="fmr"
                    type="number"
                    name="mr"
                    min="0"
                    max="10"
                    [(ngModel)]="f.maxReconnects"
                  />
                </div>
                <div class="field">
                  <label for="fsd">{{ 'form.shutdown' | t }}</label>
                  <input
                    id="fsd"
                    type="number"
                    name="sd"
                    min="0"
                    max="7200"
                    [(ngModel)]="f.postTournamentShutdownSec"
                  />
                </div>
                <div class="field">
                  <label for="fvt">{{ 'form.voteTimeout' | t }}</label>
                  <input
                    id="fvt"
                    type="number"
                    name="vt"
                    min="10"
                    max="120"
                    [(ngModel)]="f.voteTimeoutSec"
                  />
                </div>
                <div class="field">
                  <label for="fcd">{{ 'form.countdown' | t }}</label>
                  <input
                    id="fcd"
                    type="number"
                    name="cd"
                    min="3"
                    max="30"
                    [(ngModel)]="f.countdownSec"
                  />
                </div>
                <div class="field">
                  <label for="fbmm">{{ 'form.botMatches' | t }}</label>
                  <select id="fbmm" name="bmm" [(ngModel)]="f.botMatchMode">
                    <option value="watch">{{ 'form.botWatch' | t }}</option>
                    <option value="simulate">{{ 'form.botSimulate' | t }}</option>
                  </select>
                </div>
                <div class="field">
                  <label for="fbp">{{ 'form.botPlacement' | t }}</label>
                  <select id="fbp" name="bp" [(ngModel)]="f.botPlacement">
                    <option value="byes">{{ 'form.botByes' | t }}</option>
                    <option value="random">{{ 'form.botRandom' | t }}</option>
                  </select>
                </div>
              </div>
              <p class="muted small">{{ 'form.botPlacementHint' | t }}</p>
            </fieldset>
          </details>
        </div>

        <!-- Summary -->
        <aside class="side">
          <div class="card sum">
            <header class="sh">{{ 'form.summary' | t }}</header>
            <div class="sname">{{ previewName() || ('form.unnamed' | t) }}</div>
            @if (f.seasonal) {
              <span class="badge season">{{ 'form.seasonBadge' | t }}</span>
            }
            <dl>
              <dt>{{ 'form.sumWhen' | t }}</dt>
              <dd>{{ whenText() }}</dd>
              <dt>{{ 'form.game' | t }}</dt>
              <dd>
                {{ (f.game === 'mh' ? 'form.gameMhShort' : 'form.gameDm') | t }} ·
                {{ f.teamSize === 1 ? '1v1' : f.teamSize + 'v' + f.teamSize }}
              </dd>
              <dt>{{ 'form.bracket' | t }}</dt>
              <dd>
                {{ 'format.' + f.format | t }} · {{ f.size }} · Bo{{ f.boDefault }}
                @if (f.format === 'double' && f.boGrand) {
                  ({{ 'form.gfShort' | t }} Bo{{ f.boGrand }})
                }
              </dd>
              <dt>{{ 'form.rules' | t }}</dt>
              <dd>{{ rulesText() }}</dd>
              <dt>{{ 'form.server' | t }}</dt>
              <dd>
                <span class="dot" [class.on]="agent()?.online"></span>
                {{ agent()?.name ?? '–' }}
                @if (profile(); as p) {
                  · {{ p.name }}
                }
              </dd>
              <dt>{{ 'form.secBots' | t }}</dt>
              <dd>{{ botsText() }}</dd>
              <dt>Discord</dt>
              <dd>{{ notifyLabel(f.notifyMode) | t }}</dd>
            </dl>
            @if (error()) {
              <p class="error small">{{ error() }}</p>
            }
            <button class="primary go" type="submit" [disabled]="busy() || !f.name.trim()">
              {{ submitLabel() | t }}
            </button>
            <a class="btn cancel" [routerLink]="cancelLink()">{{ 'common.cancel' | t }}</a>
          </div>
        </aside>

        <div class="mbar">
          <span class="mname">{{ previewName() || ('form.unnamed' | t) }}</span>
          <button class="primary" type="submit" [disabled]="busy() || !f.name.trim()">
            {{ submitLabel() | t }}
          </button>
        </div>
      </form>
    }
  `,
  styles: `
    .head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 18px;
    }
    .head h1 {
      margin: 0;
    }
    .sub {
      margin: 4px 0 0;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 20px;
      align-items: start;
    }
    .main {
      min-width: 0;
    }
    .sec {
      padding: 18px 20px 14px;
    }
    .sh {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 1.15rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text);
      margin-bottom: 14px;
    }
    .sh .grow {
      flex: 1;
    }
    .no {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: 1px solid var(--accent-dim);
      color: var(--accent);
      font-family: var(--font-mono);
      font-size: 0.8rem;
    }
    .lock .sh::after {
      content: '🔒';
      font-size: 0.85rem;
    }
    input.big {
      font-size: 1.25rem;
      font-weight: 600;
      min-height: 46px;
      margin-bottom: 4px;
    }
    .seg.when {
      margin: 14px 0 12px;
    }
    .seg.days,
    .seg.tmode {
      margin-bottom: 12px;
    }
    .sched {
      display: flex;
      flex-wrap: wrap;
      gap: 12px 22px;
      align-items: flex-end;
      margin-bottom: 12px;
    }
    .times {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 14px;
    }
    .tm {
      display: inline-flex;
      align-items: center;
    }
    .tm input {
      width: 120px;
    }
    .unit select {
      width: auto;
      border-left: 0;
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
      background: var(--panel-2);
    }
    .unit:has(select) input {
      max-width: 110px;
    }
    .pv {
      border-left: 2px solid var(--accent-dim);
      padding: 4px 0 4px 12px;
      margin: 6px 0 4px;
    }
    .pvh {
      font-weight: 600;
      font-size: 0.86rem;
      color: var(--text-2);
    }
    .pv li span {
      margin-left: 8px;
    }
    .pv ol {
      margin: 6px 0 0;
      padding-left: 18px;
      font-size: 0.9rem;
    }
    .seg.days button {
      min-width: 46px;
    }
    .tiles {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }
    .tile {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      text-align: left;
      padding: 14px 16px;
      min-height: 0;
      border-radius: var(--radius);
      background: var(--bg-2);
      color: var(--text-2);
    }
    .tile b {
      font-family: var(--font-display);
      font-size: 1.15rem;
      letter-spacing: 0.03em;
      color: var(--text);
    }
    .tile.on {
      border-color: var(--accent);
      background: var(--me-bg);
      color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
    }
    .opts {
      display: flex;
      flex-wrap: wrap;
      gap: 14px 22px;
      margin-bottom: 12px;
    }
    .switches {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 24px;
      margin: 10px 0 4px;
    }
    fieldset.plain {
      border: 0;
      padding: 0;
      margin: 0;
      min-width: 0;
    }
    details.more {
      margin: 8px 0 4px;
    }
    details.more summary {
      cursor: pointer;
      color: var(--accent);
      font-weight: 600;
      font-size: 0.9rem;
      margin-bottom: 10px;
    }
    details.adv > summary {
      cursor: pointer;
      list-style: none;
      margin-bottom: 0;
    }
    details.adv[open] > summary {
      margin-bottom: 14px;
    }
    details.adv > summary .muted {
      font-family: var(--font);
      text-transform: none;
      letter-spacing: 0;
      font-weight: 400;
    }
    .maphead {
      display: flex;
      align-items: flex-end;
      flex-wrap: wrap;
      gap: 8px;
      margin: 14px 0 10px;
    }
    .maphead .grow {
      flex: 1;
    }
    .mapsearch {
      width: 200px;
    }
    .maps {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 8px;
    }
    label.map {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin: 0;
      padding: 9px 12px 9px 34px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--bg-2);
      cursor: pointer;
      min-width: 0;
    }
    label.map input {
      position: absolute;
      left: 11px;
      top: 11px;
    }
    label.map.on {
      border-color: var(--accent-dim);
      background: var(--me-bg);
    }
    .mid {
      font-family: var(--font-mono);
      font-size: 0.82rem;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mt {
      font-weight: 400;
      color: var(--muted);
      font-size: 0.78rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cust {
      position: absolute;
      right: 8px;
      top: 6px;
      color: var(--neuro);
    }
    .addmap {
      display: flex;
      gap: 8px;
      margin: 10px 0 6px;
      max-width: 380px;
    }
    .withdot {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .bots {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }
    .bchip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px 3px 4px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--text);
      font-size: 0.88rem;
      background: var(--bg-2);
    }
    .bchip:hover {
      border-color: var(--accent-dim);
      text-decoration: none;
    }
    .sk {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      font-family: var(--font-mono);
      font-size: 0.72rem;
      background: var(--panel-3);
      color: var(--text-2);
    }
    .sk[data-s='5'],
    .sk[data-s='6'] {
      color: var(--neuro);
    }
    .sk[data-s='7'] {
      background: var(--hot);
      color: #fff;
    }
    .btn.small {
      min-height: 30px;
      padding: 3px 12px;
      font-family: var(--font);
      text-transform: none;
      letter-spacing: 0;
      font-size: 0.85rem;
    }
    .hook {
      margin-top: 12px;
    }
    .ok {
      color: var(--live);
    }
    .err {
      color: var(--danger);
    }
    .side {
      position: sticky;
      top: 84px;
    }
    .sum .sh {
      margin-bottom: 8px;
      font-size: 0.95rem;
      color: var(--text-2);
    }
    .sname {
      font-family: var(--font-display);
      font-style: italic;
      font-weight: 800;
      font-size: 1.5rem;
      text-transform: uppercase;
      line-height: 1.1;
      margin-bottom: 6px;
      overflow-wrap: anywhere;
    }
    dl {
      margin: 12px 0;
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 6px 12px;
      font-size: 0.9rem;
    }
    dt {
      color: var(--muted);
    }
    dd {
      margin: 0;
      color: var(--text);
    }
    .go {
      width: 100%;
      min-height: 44px;
      font-size: 1.02rem;
    }
    .cancel {
      width: 100%;
      margin-top: 8px;
    }
    .mbar {
      display: none;
    }
    @media (max-width: 960px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .side {
        position: static;
      }
      .side .go {
        display: none;
      }
      .mbar {
        display: flex;
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 20;
        align-items: center;
        gap: 12px;
        padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
        background: rgba(11, 13, 19, 0.96);
        border-top: 1px solid var(--line);
        backdrop-filter: blur(8px);
      }
      .mname {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 600;
      }
      .layout {
        padding-bottom: 64px;
      }
    }
    @media (max-width: 560px) {
      .tiles {
        grid-template-columns: 1fr;
      }
      .mapsearch {
        width: 100%;
      }
    }
  `,
})
export class TournamentFormPage {
  /** Route parameter when editing a tournament. */
  readonly id = input<string | undefined>(undefined);
  /** Route parameter when editing a series. */
  readonly sid = input<string | undefined>(undefined);
  /** ?mode=series: a new series; ?from=<tournament id>: prefilled from that tournament. */
  readonly mode = input<string | undefined>(undefined);
  readonly from = input<string | undefined>(undefined);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly auth = inject(Auth);
  protected readonly i18n = inject(I18n);

  protected readonly agents = signal<AgentView[]>([]);
  /** The running season (null: out of season, season tournaments cannot be created). */
  protected readonly currentSeason = signal<number | null>(null);
  protected readonly m = signal<Model | null>(null);
  protected readonly detail = signal<TournamentDetail | null>(null);
  protected readonly seriesView = signal<SeriesView | null>(null);
  protected readonly error = signal('');
  protected readonly loadError = signal('');
  protected readonly busy = signal(false);
  protected readonly bestOf = [1, 3, 5, 7];
  protected readonly skills = [0, 1, 2, 3, 4, 5, 6, 7];
  protected readonly livesChoices = [0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20];
  protected readonly teamSizes = [1, 2, 3, 5];
  protected readonly formats = ['single', 'double'] as const;
  protected readonly ffChoices = [0, 50, 100] as const;
  protected readonly notifyModes = ['default', 'custom', 'off'] as const;
  protected readonly mapFilter = signal('');
  protected newMap = '';
  /** Bumped when the model changes (the model is mutated in place by the form). */
  private readonly tick = signal(0);

  protected readonly editing = computed(() => !!this.id() || !!this.sid());
  protected readonly canChooseWhen = computed(() => !this.editing());
  protected readonly title = computed(() =>
    this.sid()
      ? 'series.edit'
      : this.id()
        ? 'form.editTitle'
        : this.model()?.when === 'series'
          ? 'series.new'
          : 'form.newTitle',
  );
  protected readonly subtitle = computed(() =>
    this.model()?.when === 'series' ? 'form.subSeries' : 'form.subOnce',
  );
  protected readonly submitLabel = computed(() =>
    this.editing()
      ? 'common.save'
      : this.model()?.when === 'series'
        ? 'form.createSeries'
        : 'form.create',
  );
  protected readonly cancelLink = computed(() =>
    this.id() ? ['/t', this.id()] : this.sid() ? ['/admin/series'] : ['/'],
  );
  /** What the installation offers (from the detail when editing, else the site config). */
  protected readonly notifyStatus = computed(() => {
    const n = this.detail()?.notify;
    return {
      defaultChannel: n?.defaultChannel ?? !!this.auth.config().notify?.defaultChannel,
      directMessages: n?.directMessages ?? !!this.auth.config().notify?.directMessages,
    };
  });
  protected readonly locked = computed(() => !!this.detail() && this.detail()!.phase !== 'draft');
  private readonly botsLocked = computed(() =>
    ['checkIn', 'running', 'paused'].includes(this.detail()?.phase ?? ''),
  );
  /** An older tournament with its own bot list (switches to the control center on saving). */
  protected readonly ownPool = computed(
    () => !!this.detail() && !this.detail()!.botsFromLibrary && !this.botsLocked(),
  );

  /** The model, re-read whenever the form changed it. */
  private readonly model = computed(
    () => {
      this.tick();
      return this.m();
    },
    // The same object, changed in place: every tick counts as a change.
    { equal: () => false },
  );
  protected readonly agent = computed(() =>
    this.agents().find((a) => a.id === this.model()?.agentId),
  );
  protected readonly profiles = computed(() => this.agent()?.profiles ?? []);
  protected readonly profile = computed(() =>
    this.profiles().find((p) => p.id === this.model()?.profileId),
  );
  protected readonly isLocal = isLocalAddress;
  protected readonly profileAddress = computed(() => this.profile()?.publicAddress ?? '');
  protected readonly inventoryMaps = computed(() => this.profile()?.inventory?.maps ?? []);
  /** The website's bots (control center). */
  protected readonly library = signal<LibraryBot[]>([]);
  protected readonly activeLibrary = computed(() => this.library().filter((b) => b.active));
  protected readonly tooFewBots = computed(() => {
    const f = this.model();
    const n = this.activeLibrary().length;
    return !!f && f.teamSize > 1 && n > 0 && n < 2 * f.teamSize;
  });
  /** true/false once the server was scanned, null if unknown. */
  protected readonly ssbInstalled = computed(() => {
    const pk = this.profile()?.inventory?.packages;
    return pk ? pk.some((p) => p.toLowerCase() === 'smartstockbots') : null;
  });
  protected readonly mapChoices = computed(() => {
    const f = this.model();
    const prefix = f?.game === 'mh' ? 'MH-' : 'DM-';
    const inv = this.inventoryMaps().filter((x) => x.id.toUpperCase().startsWith(prefix));
    const list: { id: string; title?: string; stock?: boolean }[] = inv.length
      ? [...inv]
      : f?.game === 'mh'
        ? []
        : STOCK_POOL.map((id) => ({ id, stock: true }));
    for (const id of f?.mapPool ?? []) if (!list.some((x) => x.id === id)) list.push({ id });
    return list.sort((a, b) => a.id.localeCompare(b.id));
  });
  protected readonly shownMaps = computed(() => {
    const q = this.mapFilter().trim().toLowerCase();
    return q
      ? this.mapChoices().filter(
          (x) => x.id.toLowerCase().includes(q) || (x.title ?? '').toLowerCase().includes(q),
        )
      : this.mapChoices();
  });

  protected readonly weekdays = computed(() => {
    const short = weekdayNames(this.i18n);
    const long = weekdayNames(this.i18n, 'long');
    return short.map((name, i) => ({ n: i + 1, short: name, long: long[i] ?? name }));
  });

  protected boKeys = computed(() => {
    const double = this.model()?.format === 'double';
    const keys: { key: 'boSemi' | 'boFinal' | 'boLbFinal' | 'boGrand'; label: string }[] = [
      { key: 'boSemi', label: 'form.boSemi' },
      { key: 'boFinal', label: double ? 'form.boWbFinal' : 'form.boFinal' },
    ];
    if (double)
      keys.push(
        { key: 'boLbFinal', label: 'form.boLbFinal' },
        { key: 'boGrand', label: 'form.boGrand' },
      );
    return keys;
  });
  protected readonly boCustomized = computed(() => {
    const f = this.model();
    return !!f && !!(f.boSemi || f.boFinal || f.boLbFinal);
  });

  /** The schedule as the API takes it. */
  private readonly scheduleBody = computed(() => {
    const f = this.model();
    if (!f || f.when !== 'series') return null;
    return {
      name: f.name.trim(),
      days: f.repeat === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : [...f.days].sort(),
      times: f.timeMode === 'fixed' ? f.times.filter(Boolean) : [],
      every:
        f.timeMode === 'interval'
          ? { hours: Number(f.everyHours), from: f.fromTime, to: f.toTime }
          : null,
      everyWeeks: f.repeat === 'daily' ? 1 : Number(f.everyWeeks),
      leadMinutes: Math.max(0, Math.round(Number(f.leadValue) || 0)) * UNIT_MIN[f.leadUnit],
    };
  });
  /** The next starts of the series (asked from the API: season time zone, names). */
  protected readonly preview = signal<SeriesPreview | null>(null);
  protected readonly previewError = signal('');
  private previewTimer?: ReturnType<typeof setTimeout>;
  private previewSeq = 0;
  protected readonly hourSteps = [1, 2, 3, 4, 6, 8, 12];

  protected readonly previewName = computed(() => {
    const f = this.model();
    if (!f) return '';
    if (f.when !== 'series') return f.name.trim();
    return this.preview()?.next[0]?.name ?? f.name.trim();
  });

  protected readonly whenText = computed(() => {
    const f = this.model();
    if (!f) return '';
    if (f.when === 'once')
      return f.scheduledAt
        ? this.i18n.date(new Date(f.scheduledAt).toISOString())
        : this.i18n.t('form.noDate');
    const b = this.scheduleBody();
    if (!b) return '';
    const rhythm = scheduleText(this.i18n, b);
    const at = this.preview()?.next[0]?.start;
    return at ? `${rhythm} · ${this.i18n.t('form.sumNext', { when: this.i18n.date(at) })}` : rhythm;
  });

  protected readonly rulesText = computed(() => {
    const f = this.model();
    if (!f) return '';
    const maps = this.i18n.t('form.sumMaps', { n: f.mapPool.length });
    if (f.game === 'mh') return `${f.timeLimitMin} min / Run · ${maps}`;
    const limits = [
      f.fragLimit ? `${f.fragLimit} ${this.i18n.t('form.uFrags')}` : '',
      f.timeLimitMin ? `${f.timeLimitMin} min` : '',
    ].filter(Boolean);
    return `${limits.join(' / ') || '–'} · ${maps}`;
  });

  protected readonly botsText = computed(() => {
    if (this.ownPool()) return this.i18n.t('form.sumBotsSwitch');
    const n = this.activeLibrary().length;
    return n ? this.i18n.t('form.sumBots', { n }) : this.i18n.t('form.sumBotsServer');
  });

  constructor() {
    void this.init();
    // The preview follows the schedule (a moment after the last change).
    effect(() => {
      const b = this.scheduleBody();
      const nextNumber = this.seriesView()?.nextNumber;
      clearTimeout(this.previewTimer);
      if (!b) return;
      this.previewTimer = setTimeout(() => void this.loadPreview({ ...b, nextNumber }), 300);
    });
  }

  private async loadPreview(body: unknown) {
    const seq = ++this.previewSeq;
    try {
      const pv = await this.api.previewSeries(body);
      if (seq !== this.previewSeq) return;
      this.preview.set(pv);
      this.previewError.set('');
    } catch (e) {
      if (seq !== this.previewSeq) return;
      this.preview.set(null);
      this.previewError.set(errorText(e));
    }
  }

  protected toggleDay(n: number) {
    const f = this.m();
    if (!f) return;
    if (f.days.includes(n)) {
      if (f.days.length > 1) f.days = f.days.filter((d) => d !== n);
    } else f.days = [...f.days, n].sort();
    this.touch();
  }

  protected addTime() {
    const f = this.m();
    if (!f || f.times.length >= 24) return;
    const last = f.times.at(-1) ?? '18:00';
    const h = (Number(last.slice(0, 2)) + 2) % 24;
    f.times = [...f.times, `${pad(h)}:${last.slice(3, 5) || '00'}`];
    this.touch();
  }

  protected removeTime(i: number) {
    const f = this.m();
    if (!f || f.times.length < 2) return;
    f.times = f.times.filter((_, j) => j !== i);
    this.touch();
  }

  protected touch() {
    this.tick.update((n) => n + 1);
  }

  protected notifyLabel(x: Model['notifyMode']): string {
    if (x === 'default')
      return this.notifyStatus().defaultChannel
        ? 'form.notifyDefaultShort'
        : 'form.notifyDefaultNone';
    return x === 'custom' ? 'form.notifyCustom' : 'form.notifyOff';
  }

  private async init() {
    try {
      const [agents, bots, seasons] = await Promise.all([
        this.api.agents(),
        this.api.bots(),
        this.api.seasons(),
      ]);
      this.agents.set(agents);
      this.library.set(bots.bots);
      this.currentSeason.set(seasons.current);
      const id = this.id();
      const sid = this.sid();
      if (id) {
        const d = await this.api.tournament(id);
        this.detail.set(d);
        this.m.set(this.fromDetail(d));
      } else if (sid) {
        const s = (await this.api.series()).find((x) => x.id === sid);
        if (!s) throw new Error(this.i18n.t('form.seriesMissing'));
        this.seriesView.set(s);
        this.m.set(this.fromSeries(s));
      } else {
        const from = this.from();
        const f = from
          ? this.fromDetail(await this.api.tournament(from))
          : this.defaults(agents.find((x) => x.online) ?? agents[0]);
        if (this.mode() === 'series') this.toSeries(f);
        this.m.set(f);
      }
    } catch (e) {
      this.loadError.set(errorText(e));
    }
  }

  private defaults(a?: AgentView): Model {
    return {
      name: '',
      when: 'once',
      agentId: a?.id ?? '',
      profileId: a?.profiles[0]?.id ?? '',
      connectAddress: '',
      scheduledAt: '',
      registrationOpen: true,
      autoStart: false,
      repeat: 'weekly',
      days: [5],
      everyWeeks: 1,
      timeMode: 'fixed',
      times: ['20:00'],
      everyHours: 4,
      fromTime: '00:00',
      toTime: '23:59',
      leadValue: 7,
      leadUnit: 'd',
      format: 'double',
      size: 8,
      teamSize: 1,
      game: 'dm',
      grandFinalReset: true,
      boDefault: 1,
      boSemi: 0,
      boFinal: 0,
      boLbFinal: 0,
      boGrand: 3,
      checkInWindowMin: 10,
      noShowSec: 180,
      reconnectGraceSec: 180,
      maxReconnects: 2,
      botMatchMode: 'watch',
      botPlacement: 'byes',
      postTournamentShutdownSec: 30,
      fragLimit: 20,
      timeLimitMin: 10,
      mapMode: 'vote',
      voteTimeoutSec: 45,
      countdownSec: 5,
      smartStockBots: !!a?.profiles[0]?.inventory?.packages?.some(
        (p) => p.toLowerCase() === 'smartstockbots',
      ),
      friendlyFirePct: 0,
      penaltySec: 5,
      monsterSkill: 5,
      lives: 0,
      notifyMode: 'default',
      webhookUrl: '',
      seasonal: this.currentSeason() !== null,
      mapPool: [...STOCK_POOL],
      clanTeams: false,
      udt: false,
      udtCap: 0,
      udtStars: -1,
      udtTicket: 0,
      udtTicketIndexed: true,
      udtMinTeams: 4,
      udtFinale: false,
    };
  }

  /** The model of stored settings (tournament or series template). */
  private fromParts(p: Parts, name: string, scheduledAt: string | null): Model {
    const s = p.settings;
    const r = s.game.rules as Record<string, unknown>;
    const num = (k: string, dflt: number) => (typeof r[k] === 'number' ? (r[k] as number) : dflt);
    return {
      ...this.defaults(),
      name,
      agentId: p.agentId,
      profileId: p.profileId,
      connectAddress: p.connectAddress ?? '',
      scheduledAt: toLocalInput(scheduledAt),
      registrationOpen: p.registrationOpen,
      autoStart: p.autoStart,
      format: s.format,
      size: s.size,
      teamSize: s.teamSize ?? 1,
      game: s.game.adapter === MH_ADAPTER ? 'mh' : 'dm',
      grandFinalReset: s.grandFinalReset,
      boDefault: s.bestOf.default,
      boSemi: s.bestOf.semifinal ?? 0,
      boFinal: s.bestOf.final ?? 0,
      boLbFinal: s.bestOf.lbFinal ?? 0,
      boGrand: s.bestOf.grandFinal ?? 0,
      checkInWindowMin: s.checkInWindowMin,
      noShowSec: s.noShowSec,
      reconnectGraceSec: s.reconnectGraceSec,
      maxReconnects: s.maxReconnects,
      botMatchMode: s.botMatchMode,
      botPlacement: s.botPlacement,
      postTournamentShutdownSec: s.postTournamentShutdownSec,
      fragLimit: num('fragLimit', 20),
      timeLimitMin: num('timeLimitMin', 10),
      mapMode: r['mapMode'] === 'random' ? 'random' : 'vote',
      voteTimeoutSec: num('voteTimeoutSec', 45),
      countdownSec: num('countdownSec', 5),
      smartStockBots: r['smartStockBots'] === true,
      friendlyFirePct:
        r['friendlyFirePct'] === 50 || r['friendlyFirePct'] === 100 ? r['friendlyFirePct'] : 0,
      penaltySec: num('penaltySec', 5),
      monsterSkill: num('monsterSkill', 5),
      lives: num('lives', 0),
      notifyMode: p.notifyMode,
      webhookUrl: p.webhookUrl ?? '',
      seasonal: p.seasonal,
      mapPool: Array.isArray(r['mapPool']) ? [...(r['mapPool'] as string[])] : [],
      clanTeams: s.clanTeams ?? false,
      udt: p.kind === 'udt',
      udtCap: p.udt?.valueCap ?? 0,
      udtStars: p.udt?.starLimit ?? -1,
      udtTicket: p.udt?.ticket ?? 0,
      udtTicketIndexed: p.udt?.ticketIndexed ?? true,
      udtMinTeams: p.udt?.minTeams ?? 4,
      udtFinale: p.udt?.finale ?? false,
    };
  }

  private fromDetail(d: TournamentDetail): Model {
    return this.fromParts(
      {
        agentId: d.agentId,
        profileId: d.profileId,
        connectAddress: d.connectAddressOverride,
        settings: d.settings,
        notifyMode: d.notify?.mode ?? 'default',
        webhookUrl: d.notify?.webhookUrl ?? null,
        seasonal: d.seasonal,
        registrationOpen: d.registrationOpen,
        autoStart: d.autoStart,
        kind: d.kind ?? 'standard',
        udt: d.udt ?? null,
      },
      d.name,
      d.scheduledAt,
    );
  }

  private fromSeries(s: SeriesView): Model {
    const t = s.template;
    const f = this.fromParts(
      {
        agentId: t.agentId,
        profileId: t.profileId,
        connectAddress: t.connectAddress ?? null,
        settings: t.settings,
        notifyMode: t.notifyMode ?? 'default',
        webhookUrl: t.webhookUrl ?? null,
        seasonal: !!t.seasonal,
        registrationOpen: true,
        autoStart: !!t.autoStart,
        kind: t.kind ?? 'standard',
        udt: t.udt ?? null,
      },
      s.name,
      null,
    );
    return {
      ...f,
      when: 'series',
      repeat: s.days.length === 7 ? 'daily' : 'weekly',
      days: s.days.length === 7 ? [5] : [...s.days],
      everyWeeks: s.everyWeeks,
      timeMode: s.every ? 'interval' : 'fixed',
      times: s.times.length ? [...s.times] : ['20:00'],
      everyHours: s.every?.hours ?? 4,
      fromTime: s.every?.from ?? '00:00',
      toTime: s.every?.to ?? '23:59',
      ...this.leadParts(s.leadMinutes),
    };
  }

  /** A lead time in minutes as value and unit (the largest unit that fits). */
  private leadParts(min: number): Pick<Model, 'leadValue' | 'leadUnit'> {
    if (min && min % 1440 === 0) return { leadValue: min / 1440, leadUnit: 'd' };
    if (min && min % 60 === 0) return { leadValue: min / 60, leadUnit: 'h' };
    return { leadValue: min, leadUnit: 'min' };
  }

  /** A series from the form's tournament: name pattern and schedule from its start. */
  private toSeries(f: Model) {
    f.when = 'series';
    if (f.name && !/\{n\}|\{date\}/.test(f.name))
      f.name = `${f.name.replace(/\s*#?\d+$/, '')} #{n}`;
    if (f.scheduledAt) {
      const at = new Date(f.scheduledAt);
      f.repeat = 'weekly';
      f.days = [((at.getDay() + 6) % 7) + 1];
      f.timeMode = 'fixed';
      f.times = [`${pad(at.getHours())}:${pad(at.getMinutes())}`];
    }
    f.scheduledAt = '';
  }

  protected setWhen(w: When) {
    const f = this.m();
    if (!f || f.when === w) return;
    if (w === 'series') this.toSeries(f);
    else f.when = 'once';
    this.touch();
  }

  /** Switches the mode; limits still at the old mode's suggestion follow the new one. */
  protected onTeamSize(k: number) {
    const f = this.m();
    if (!f) return;
    const before = LIMITS[f.teamSize];
    const after = LIMITS[k];
    if (before && after && f.game === 'dm') {
      if (f.fragLimit === before.fragLimit) f.fragLimit = after.fragLimit;
      if (f.timeLimitMin === before.timeLimitMin) f.timeLimitMin = after.timeLimitMin;
    }
    f.teamSize = k;
    if (k > 1 && f.size > 16) f.size = 16;
    this.touch();
  }

  /** Switches between deathmatch and Monster Hunt: teams only, own maps and time limit. */
  protected onGame(game: 'dm' | 'mh') {
    const f = this.m();
    if (!f || f.game === game) return;
    const prefix = game === 'mh' ? 'MH-' : 'DM-';
    f.mapPool = f.mapPool.filter((id) => id.toUpperCase().startsWith(prefix));
    if (game === 'mh') {
      if (f.teamSize === 1) f.teamSize = 2;
      if (f.size > 16) f.size = 16;
      f.timeLimitMin = MH_TIME_LIMIT;
    } else {
      const l = LIMITS[f.teamSize];
      if (l) {
        f.fragLimit = l.fragLimit;
        f.timeLimitMin = l.timeLimitMin;
      }
      if (!f.mapPool.length) f.mapPool = [...STOCK_POOL];
    }
    f.game = game;
    this.touch();
  }

  protected onAgent() {
    const f = this.m();
    if (!f) return;
    f.profileId = this.agents().find((a) => a.id === f.agentId)?.profiles[0]?.id ?? '';
    this.touch();
  }

  protected toggleMap(id: string) {
    const f = this.m();
    if (!f) return;
    const i = f.mapPool.indexOf(id);
    if (i >= 0) f.mapPool.splice(i, 1);
    else f.mapPool.push(id);
    this.touch();
  }

  /** Selects or clears the maps shown (the search narrows them). */
  protected allMaps(on: boolean) {
    const f = this.m();
    if (!f) return;
    const shown = this.shownMaps().map((x) => x.id);
    f.mapPool = on
      ? [...new Set([...f.mapPool, ...shown])]
      : f.mapPool.filter((id) => !shown.includes(id));
    this.touch();
  }

  protected addMap() {
    const id = this.newMap.trim();
    const f = this.m();
    if (!f || !id) return;
    if (!f.mapPool.includes(id)) f.mapPool.push(id);
    this.newMap = '';
    this.touch();
  }

  private settings(f: Model) {
    const bestOf: Record<string, number> = { default: f.boDefault };
    if (f.boSemi) bestOf['semifinal'] = f.boSemi;
    if (f.boFinal) bestOf['final'] = f.boFinal;
    if (f.format === 'double' && f.boLbFinal) bestOf['lbFinal'] = f.boLbFinal;
    if (f.format === 'double' && f.boGrand) bestOf['grandFinal'] = f.boGrand;
    return {
      format: f.format,
      size: f.size,
      teamSize: f.teamSize,
      grandFinalReset: f.format === 'double' ? f.grandFinalReset : false,
      bestOf,
      checkInWindowMin: f.checkInWindowMin,
      noShowSec: f.noShowSec,
      reconnectGraceSec: f.reconnectGraceSec,
      maxReconnects: f.maxReconnects,
      botMatchMode: f.botMatchMode,
      botPlacement: f.botPlacement,
      clanTeams: f.teamSize > 1 && f.clanTeams,
      postTournamentShutdownSec: f.postTournamentShutdownSec,
      game: {
        adapter: f.game === 'mh' ? MH_ADAPTER : 'ut99-dm',
        rules: {
          fragLimit: f.game === 'mh' ? 0 : f.fragLimit,
          timeLimitMin: f.timeLimitMin,
          mapMode: f.mapMode,
          mapPool: f.mapPool,
          voteTimeoutSec: f.voteTimeoutSec,
          countdownSec: f.countdownSec,
          smartStockBots: f.smartStockBots,
          friendlyFirePct: f.game === 'mh' ? 0 : f.friendlyFirePct,
          penaltySec: f.penaltySec,
          monsterSkill: f.monsterSkill,
          lives: f.lives,
        },
      },
    };
  }

  /** What every tournament of a series gets (the bots: the control center). */
  private template(f: Model) {
    return {
      agentId: f.agentId,
      profileId: f.profileId,
      connectAddress: f.connectAddress.trim() || null,
      notifyMode: f.notifyMode,
      webhookUrl: f.notifyMode === 'custom' ? f.webhookUrl.trim() : null,
      seasonal: f.seasonal,
      autoStart: f.autoStart,
      settings: this.settings(f),
      kind: f.udt ? ('udt' as const) : ('standard' as const),
      ...(f.udt
        ? {
            udt: {
              valueCap: Number(f.udtCap) > 0 ? Math.round(Number(f.udtCap)) : null,
              starLimit: Number(f.udtStars) >= 0 ? Number(f.udtStars) : null,
              ticket: Number(f.udtTicket) > 0 ? Math.round(Number(f.udtTicket)) : null,
              ticketIndexed: !!f.udtTicketIndexed,
              minTeams: Math.min(16, Math.max(2, Math.round(Number(f.udtMinTeams) || 4))),
              finale: !!f.udtFinale,
            },
          }
        : {}),
    };
  }

  protected async save() {
    const f = this.m();
    if (!f) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const id = this.id();
      const sid = this.sid();
      if (sid) {
        await this.api.updateSeries(sid, { ...this.scheduleBody()!, template: this.template(f) });
        await this.router.navigate(['/admin/series']);
      } else if (f.when === 'series') {
        await this.api.createSeries({ ...this.scheduleBody()!, template: this.template(f) });
        await this.router.navigate(['/admin/series']);
      } else {
        const t = this.template(f);
        const common = {
          name: f.name.trim(),
          scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null,
          registrationOpen: f.registrationOpen,
          connectAddress: t.connectAddress,
          notifyMode: t.notifyMode,
          webhookUrl: t.webhookUrl,
          seasonal: t.seasonal,
          autoStart: !!f.scheduledAt && f.autoStart,
        };
        const udt = { kind: t.kind, ...(t.udt ? { udt: t.udt } : {}) };
        if (id) {
          const patch: Record<string, unknown> = { ...common };
          if (!this.locked())
            Object.assign(patch, {
              agentId: t.agentId,
              profileId: t.profileId,
              settings: t.settings,
              ...udt,
            });
          // An older tournament with its own list takes the control center's bots.
          if (this.ownPool()) patch['botPool'] = [];
          await this.api.updateTournament(id, patch);
          await this.router.navigate(['/t', id]);
        } else {
          const d = await this.api.createTournament({
            ...common,
            agentId: t.agentId,
            profileId: t.profileId,
            settings: t.settings,
            ...udt,
          });
          await this.router.navigate(['/t', d.id]);
        }
      }
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }
}
