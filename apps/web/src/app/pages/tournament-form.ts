import { type Choice, Segment } from '../components/choice';
import { TempoPick } from '../components/tempo-pick';
import { FormSectionHead } from '../components/form-section-head';
import { FormPresets } from '../components/form-presets';
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
import { Icon, UdtMark } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { isLocalAddress } from '../core/connect';
import { scheduleText, weekdayNames } from '../core/series-text';
import { MH_ADAPTER } from '../core/race';
import { hoursText, maxGames, maxMinutes } from '../core/bracket-time';
import { Toasts } from '../core/toast';
import type {
  AgentView,
  LibraryBot,
  SeriesPreview,
  SeriesView,
  TournamentDetail,
  TournamentPreset,
  TournamentPresetBody,
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

/**
 * Tournament lengths (Mario 27.10.): best of per round and frag/time limits - for one on one
 * as given, for teams scaled from LIMITS; Monster Hunt: the time per run.
 */
type Length = 'short' | 'medium' | 'long';
const LENGTHS: Record<
  Length,
  {
    frags: number;
    minutes: number;
    mhMinutes: number;
    bo: Pick<Model, 'boDefault' | 'boSemi' | 'boFinal' | 'boLbFinal' | 'boGrand'>;
  }
> = {
  short: {
    frags: 8,
    minutes: 8,
    mhMinutes: 15,
    bo: { boDefault: 1, boSemi: 0, boFinal: 0, boLbFinal: 0, boGrand: 1 },
  },
  medium: {
    frags: 15,
    minutes: 10,
    mhMinutes: 20,
    bo: { boDefault: 1, boSemi: 0, boFinal: 3, boLbFinal: 0, boGrand: 3 },
  },
  long: {
    frags: 30,
    minutes: 12,
    mhMinutes: 25,
    bo: { boDefault: 3, boSemi: 0, boFinal: 5, boLbFinal: 0, boGrand: 5 },
  },
};

/** Frag and time limit of a length for a team size (1v1 as set, teams by the LIMITS ratio). */
function lengthLimits(l: Length, teamSize: number): { fragLimit: number; timeLimitMin: number } {
  const one = LIMITS[1]!;
  const base = LIMITS[teamSize] ?? one;
  const x = LENGTHS[l];
  return {
    fragLimit: Math.round((x.frags * base.fragLimit) / one.fragLimit),
    timeLimitMin: Math.round((x.minutes * base.timeLimitMin) / one.timeLimitMin),
  };
}

/** One tournament, or a series that creates one every n weeks. */
type When = 'once' | 'series';

interface Model {
  name: string;
  when: When;
  agentId: string;
  profileId: string;
  /** A free server of the pool at the start (decision 282). */
  serverAuto: boolean;
  /** Servers it may use at once (decision 291). */
  parallel: number;
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
  serverAuto: boolean;
  parallel?: number;
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

/** Servers a tournament may use at once (decision 291, as the API). */
const MAX_PARALLEL = 8;
/** "All sections open" instead of compact (decision 324), per browser. */
const OPEN_KEY = 'tourney.form.open';

function readAllOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

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
  imports: [
    Segment,
    TempoPick,
    FormSectionHead,
    FormPresets,
    FormsModule,
    RouterLink,
    TPipe,
    Icon,
    UdtMark,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <div>
        <h1>{{ title() | t }}</h1>
        <p class="muted sub">{{ subtitle() | t }}</p>
      </div>
      <div class="hacts">
        @if (!editing()) {
          <!-- Compact is the default; "all open" is remembered in this browser (decision 324). -->
          <label class="switch"
            ><input
              type="checkbox"
              [checked]="allOpen()"
              (change)="setAllOpen($any($event.target).checked)"
            /><span class="tr"></span>{{ 'form.allOpen' | t }}</label
          >
        }
        <a class="btn" routerLink="/admin/series">
          <na-icon name="copyToNew" [size]="16" /> {{ 'form.manageSeries' | t }}
        </a>
      </div>
    </div>
    @if (locked()) {
      <p class="notice">{{ 'form.locked' | t }}</p>
    }
    @if (m(); as f) {
      @if (!locked()) {
        <!-- The admin's presets (decision 325): apply, save as, delete. -->
        <na-form-presets
          [body]="presetBody()"
          [suggest]="f.name"
          [disabled]="busy()"
          (apply)="applyPreset($event)"
        />
      }
      <form class="layout" (ngSubmit)="save()">
        <div class="main">
          <!-- 1 Basics and date -->
          <section class="card sec" id="sec-1">
            <na-sec-head [n]="1" title="form.secBasics" />
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

            <div class="lbl">{{ 'form.kind' | t }}</div>
            <div class="tiles kinds" role="group" [attr.aria-label]="'form.kind' | t">
              <button
                type="button"
                class="tile"
                [class.on]="kindOf(f) === 'classic'"
                [attr.aria-pressed]="kindOf(f) === 'classic'"
                [disabled]="locked() && f.udt"
                (click)="setKind('classic')"
              >
                <na-icon name="flame" [size]="22" />
                <b>{{ 'form.kindClassic' | t }}</b>
                <span class="muted small">{{ 'form.kindClassicHint' | t }}</span>
              </button>
              <button
                type="button"
                class="tile"
                [class.on]="kindOf(f) === 'season'"
                [attr.aria-pressed]="kindOf(f) === 'season'"
                [disabled]="(locked() && f.udt) || (!currentSeason() && f.when === 'once')"
                (click)="setKind('season')"
              >
                <na-icon name="crown" [size]="22" />
                <b>{{ 'form.kindSeason' | t }}</b>
                <span class="muted small">{{ 'form.kindSeasonHint' | t }}</span>
                <!-- Whether a season runs (season and Dream Team tournaments need one). -->
                @if (currentSeason(); as n) {
                  <span class="ok small">{{ 'form.seasonRunning' | t: { n } }}</span>
                } @else if (f.when === 'series') {
                  <span class="small">{{ 'form.seasonalSeriesShort' | t }}</span>
                } @else {
                  <span class="err small">{{ 'form.seasonNoneShort' | t }}</span>
                }
              </button>
              @if (auth.config().udt || f.udt) {
                <button
                  type="button"
                  class="tile udt"
                  [class.on]="f.udt"
                  [attr.aria-pressed]="f.udt"
                  [disabled]="locked() || (!currentSeason() && f.when === 'once')"
                  (click)="setKind('udt')"
                >
                  <na-udt-mark [size]="22" />
                  <b>{{ 'form.kindUdt' | t }}</b>
                  <span class="muted small">{{ 'form.kindUdtHint' | t }}</span>
                </button>
              }
            </div>
            @if (f.udt) {
              <fieldset class="plain udtbox" [disabled]="locked()">
                <legend>{{ 'form.udtRules' | t }}</legend>
                <div class="fields">
                  <div class="field">
                    <label for="fucap">{{ 'form.udtCap' | t }}</label>
                    <input
                      id="fucap"
                      type="number"
                      name="udtCap"
                      min="0"
                      step="100"
                      [(ngModel)]="f.udtCap"
                      (ngModelChange)="touch()"
                    />
                  </div>
                  <div class="field">
                    <label for="fustars">{{ 'form.udtStars' | t }}</label>
                    <select
                      id="fustars"
                      name="udtStars"
                      [(ngModel)]="f.udtStars"
                      (ngModelChange)="touch()"
                    >
                      <option [ngValue]="-1">{{ 'form.udtNoLimit' | t }}</option>
                      @for (n of [0, 1, 2, 3, 4, 5]; track n) {
                        <option [ngValue]="n">{{ n }}</option>
                      }
                    </select>
                  </div>
                  <div class="field">
                    <label for="futicket">{{ 'form.udtTicket' | t }}</label>
                    <input
                      id="futicket"
                      type="number"
                      name="udtTicket"
                      min="0"
                      step="100"
                      [(ngModel)]="f.udtTicket"
                      (ngModelChange)="touch()"
                    />
                  </div>
                  @if (f.udtTicket > 0) {
                    <div class="field">
                      <label for="fumin">{{ 'form.udtMinTeams' | t }}</label>
                      <input
                        id="fumin"
                        type="number"
                        name="udtMinTeams"
                        min="2"
                        max="16"
                        [(ngModel)]="f.udtMinTeams"
                        (ngModelChange)="touch()"
                      />
                    </div>
                  }
                </div>
                <p class="muted small">{{ 'form.udtHint' | t }} {{ 'form.udtTicketHint' | t }}</p>
                <div class="optrows">
                  @if (f.udtTicket > 0) {
                    <label class="switch optrow"
                      ><span class="ot"
                        ><b>{{ 'form.udtTicketIndexed' | t }}</b></span
                      ><input
                        type="checkbox"
                        name="udtTicketIndexed"
                        [(ngModel)]="f.udtTicketIndexed"
                        (ngModelChange)="touch()" /><span class="tr"></span
                    ></label>
                  }
                  <label class="switch optrow"
                    ><span class="ot"
                      ><b>{{ 'form.udtFinale' | t }}</b
                      ><span class="muted small">{{ 'form.udtFinaleHint' | t }}</span></span
                    ><input
                      type="checkbox"
                      name="udtFinale"
                      [(ngModel)]="f.udtFinale"
                      (ngModelChange)="touch()" /><span class="tr"></span
                  ></label>
                </div>
              </fieldset>
            }

            <!-- Date and flow in one row (decision 324). -->
            <div class="lbl">{{ 'form.when' | t }}</div>
            <div class="when-row">
              <div class="wcol">
                @if (canChooseWhen()) {
                  <na-segment
                    [options]="whenOptions"
                    [value]="f.when"
                    (valueChange)="setWhen($event)"
                    label="form.when"
                  />
                }
                @if (f.when === 'once') {
                  <input
                    id="fsched"
                    name="sched"
                    type="datetime-local"
                    [(ngModel)]="f.scheduledAt"
                    (ngModelChange)="touch()"
                    [attr.aria-label]="'form.scheduledAt' | t"
                  />
                }
              </div>
              @if (f.when === 'once') {
                <label class="switch optrow"
                  ><span class="ot"
                    ><b>{{ 'form.registrationOpen' | t }}</b
                    ><span class="muted small">{{ 'form.registrationOpenShort' | t }}</span></span
                  ><input
                    type="checkbox"
                    name="reg"
                    [(ngModel)]="f.registrationOpen"
                    (ngModelChange)="touch()" /><span class="tr"></span
                ></label>
              }
              <label class="switch optrow" [title]="'form.autoStartHint' | t"
                ><span class="ot"
                  ><b>{{ 'form.autoStart' | t }}</b
                  ><span class="muted small">{{ 'form.autoStartShort' | t }}</span></span
                ><input
                  type="checkbox"
                  name="autoStart"
                  [(ngModel)]="f.autoStart"
                  (ngModelChange)="touch()"
                  [disabled]="f.when === 'once' && !f.scheduledAt && !f.autoStart" /><span
                  class="tr"
                ></span
              ></label>
            </div>

            @if (f.when === 'series') {
              <div class="sched">
                <div>
                  <label>{{ 'series.repeat' | t }}</label>
                  <na-segment
                    [options]="repeatOptions"
                    [value]="f.repeat"
                    (valueChange)="f.repeat = $event; touch()"
                    label="series.repeat"
                  />
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
              <na-segment
                class="tmode"
                [options]="timeModeOptions"
                [value]="f.timeMode"
                (valueChange)="f.timeMode = $event; touch()"
                label="series.times"
              />
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
          </section>

          <!-- 2 Game and bracket -->
          <section class="card sec" id="sec-2">
            <na-sec-head
              [n]="2"
              title="form.secGame"
              [line]="lines()[2] ?? ''"
              [compact]="compact()"
              [open]="isOpen(2)"
              [locked]="locked()"
              controls="sb-2"
              (toggle)="toggle(2)"
            />
            <div class="sb" id="sb-2" [hidden]="!isOpen(2)">
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

              <div class="lbl">{{ 'form.length' | t }}</div>
              <div class="seg len" role="group" [attr.aria-label]="'form.length' | t">
                @for (l of lengths; track l) {
                  <button
                    type="button"
                    [class.on]="lengthNow() === l"
                    [attr.aria-pressed]="lengthNow() === l"
                    [disabled]="locked()"
                    (click)="setLength(l)"
                  >
                    <b>{{ 'form.len.' + l | t }}</b>
                    <small>{{ lengthText(l) }}</small>
                  </button>
                }
                <button
                  type="button"
                  [class.on]="lengthNow() === 'custom'"
                  [attr.aria-pressed]="lengthNow() === 'custom'"
                  [disabled]="locked()"
                  (click)="customOpen.set(!customOpen())"
                >
                  <b>{{ 'form.len.custom' | t }}</b>
                  <small>{{ 'form.lenCustomHint' | t }}</small>
                </button>
              </div>
              <p class="muted small">{{ durationText() }}</p>

              <div class="opts">
                <div>
                  <label>{{ 'form.mode' | t }}</label>
                  <na-segment
                    [options]="f.game === 'mh' ? teamSizeOptionsMh : teamSizeOptions"
                    [value]="f.teamSize"
                    (valueChange)="onTeamSize($event)"
                    [disabled]="locked()"
                    label="form.mode"
                  />
                </div>
                <div>
                  <label>{{ 'form.format' | t }}</label>
                  <na-segment
                    [options]="formatOptions"
                    [value]="f.format"
                    (valueChange)="f.format = $event; touch()"
                    [disabled]="locked()"
                    label="form.format"
                  />
                </div>
                <div>
                  <label>{{ (f.teamSize > 1 ? 'form.sizeTeams' : 'form.size') | t }}</label>
                  <na-segment
                    [options]="f.teamSize > 1 ? sizeOptionsTeams : sizeOptions"
                    [value]="f.size"
                    (valueChange)="f.size = $event; touch()"
                    [disabled]="locked()"
                    [label]="f.teamSize > 1 ? 'form.sizeTeams' : 'form.size'"
                  />
                </div>
                <div>
                  <label>{{ 'form.boDefault' | t }}</label>
                  <na-segment
                    [options]="boOptions"
                    [value]="f.boDefault"
                    (valueChange)="f.boDefault = $event; touch()"
                    [disabled]="locked()"
                    label="form.boDefault"
                  />
                </div>
              </div>
              <div class="optrows">
                @if (f.format === 'double') {
                  <label class="switch optrow"
                    ><span class="ot"
                      ><b>{{ 'form.gfReset' | t }}</b></span
                    ><input
                      type="checkbox"
                      name="gfr"
                      [(ngModel)]="f.grandFinalReset"
                      (ngModelChange)="touch()"
                      [disabled]="locked()" /><span class="tr"></span
                  ></label>
                }
                @if (f.teamSize > 1) {
                  <label class="switch optrow"
                    ><span class="ot"
                      ><b>{{ 'form.clanTeams' | t }}</b
                      ><span class="muted small">{{ 'form.clanTeamsHint' | t }}</span></span
                    ><input
                      type="checkbox"
                      name="clanTeams"
                      [(ngModel)]="f.clanTeams"
                      [disabled]="locked()" /><span class="tr"></span
                  ></label>
                }
              </div>
              @if (tooFewBots()) {
                <p class="error small">{{ 'form.botsTooFew' | t: { n: f.teamSize * 2 } }}</p>
              }
              @if (ownPool()) {
                <p class="notice small">{{ 'form.botsLegacy' | t }}</p>
              }
              <details
                class="more"
                [open]="lengthNow() === 'custom' || customOpen()"
                (toggle)="customOpen.set($any($event.target).open)"
              >
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
            </div>
          </section>

          <!-- 3 Match rules and maps -->
          <section class="card sec" id="sec-3">
            <na-sec-head
              [n]="3"
              title="form.secRules"
              [line]="lines()[3] ?? ''"
              [compact]="compact()"
              [open]="isOpen(3)"
              [locked]="locked()"
              controls="sb-3"
              (toggle)="toggle(3)"
            />
            <div class="sb" id="sb-3" [hidden]="!isOpen(3)">
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
                        <na-segment
                          [options]="ffOptions"
                          [value]="f.friendlyFirePct"
                          (valueChange)="f.friendlyFirePct = $event"
                          label="form.friendlyFire"
                        />
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
                    <na-segment
                      [options]="mapModeOptions"
                      [value]="f.mapMode"
                      (valueChange)="f.mapMode = $event; touch()"
                      label="form.maps"
                    />
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
            </div>
          </section>

          <!-- 4 Server and tempo -->
          <section class="card sec" id="sec-4">
            <na-sec-head
              [n]="4"
              title="form.secServerTempo"
              [line]="lines()[4] ?? ''"
              [compact]="compact()"
              [open]="isOpen(4)"
              [locked]="locked()"
              controls="sb-4"
              (toggle)="toggle(4)"
            />
            <div class="sb" id="sb-4" [hidden]="!isOpen(4)">
              @if (!agents().length) {
                <p class="notice">
                  {{ 'form.noAgents' | t }} <a routerLink="/admin/agents">{{ 'nav.agents' | t }}</a>
                </p>
              }
              <fieldset class="plain" [disabled]="locked()">
                <label class="switch optrow"
                  ><span class="ot"
                    ><b>{{ 'form.serverAuto' | t }}</b
                    ><span class="muted small">{{ 'form.serverAutoShortHint' | t }}</span></span
                  ><input
                    type="checkbox"
                    name="serverAuto"
                    [(ngModel)]="f.serverAuto"
                    (ngModelChange)="touch()" /><span class="tr"></span
                ></label>

                <!-- Tempo (decision 324): one after the other or parallel, each with its time. -->
                <na-tempo-pick
                  [parallel]="f.parallel"
                  (parallelChange)="setParallel($event)"
                  [remembered]="parPick()"
                  [max]="maxParallel"
                  [online]="serversNow()"
                  [pool]="poolAgents()"
                  [estimate]="estimateFn"
                  [simulated]="f.botMatchMode === 'simulate' && !f.udt"
                  [disabled]="locked()"
                />

                <details class="more" [open]="!f.serverAuto || !!f.connectAddress">
                  <summary>{{ 'form.serverMore' | t }}</summary>
                  <div class="fields">
                    <div class="field">
                      <label for="fagent">{{
                        (f.serverAuto ? 'form.agentPreferred' : 'form.agent') | t
                      }}</label>
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
                        (ngModelChange)="onProfile()"
                      >
                        @for (p of profiles(); track p.id) {
                          <option [value]="p.id">{{ p.name }}</option>
                        }
                      </select>
                    </div>
                    <div class="field">
                      <label for="faddr">{{ 'form.connectAddress' | t }}</label>
                      <input
                        id="faddr"
                        name="addr"
                        [(ngModel)]="f.connectAddress"
                        [placeholder]="profileAddress() || 'ut.example.com:7777'"
                      />
                    </div>
                  </div>
                  <p class="muted small">{{ 'form.connectHint' | t }}</p>
                </details>
              </fieldset>
              @if (isLocal(f.connectAddress || profileAddress())) {
                <p class="error small">{{ 'form.localAddress' | t }}</p>
              }
            </div>
          </section>

          <!-- 5 Discord -->
          <section class="card sec" id="sec-5">
            <na-sec-head
              [n]="5"
              title="form.notify"
              [line]="lines()[5] ?? ''"
              [compact]="compact()"
              [open]="isOpen(5)"
              controls="sb-5"
              (toggle)="toggle(5)"
            />
            <div class="sb" id="sb-5" [hidden]="!isOpen(5)">
              <na-segment
                [options]="notifyOptions()"
                [value]="f.notifyMode"
                (valueChange)="f.notifyMode = $event; touch()"
                label="form.notify"
              />
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
            </div>
          </section>

          <!-- 6 Advanced -->
          <section class="card sec" id="sec-6">
            <na-sec-head
              [n]="6"
              title="form.secAdvanced"
              [line]="lines()[6] ?? ''"
              [compact]="compact()"
              [open]="isOpen(6)"
              controls="sb-6"
              (toggle)="toggle(6)"
            />
            <div class="sb" id="sb-6" [hidden]="!isOpen(6)">
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
                    <select id="fbmm" name="bmm" [(ngModel)]="f.botMatchMode" [disabled]="f.udt">
                      <option value="watch">{{ 'form.botWatch' | t }}</option>
                      @if (!f.udt) {
                        <option value="simulate">{{ 'form.botSimulate' | t }}</option>
                      }
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
            </div>
          </section>
        </div>

        <!-- Summary -->
        <aside class="side">
          <div class="card sum">
            <div class="sumh">{{ 'form.summary' | t }}</div>
            <div class="sname">{{ previewName() || ('form.unnamed' | t) }}</div>
            @if (f.seasonal) {
              <span class="badge season">{{ 'form.seasonBadge' | t }}</span>
            }
            <dl>
              <!-- Each line leads to its section (opened in compact mode, decision 324). -->
              <dt>{{ 'form.sumWhen' | t }}</dt>
              <dd>
                <button type="button" class="link sgo" (click)="go(1)">{{ whenText() }}</button>
              </dd>
              <dt>{{ 'form.game' | t }}</dt>
              <dd>
                <button type="button" class="link sgo" (click)="go(2)">
                  {{ (f.game === 'mh' ? 'form.gameMhShort' : 'form.gameDm') | t }} ·
                  {{ f.teamSize === 1 ? '1v1' : f.teamSize + 'v' + f.teamSize }}
                </button>
              </dd>
              <dt>{{ 'form.bracket' | t }}</dt>
              <dd>
                <button type="button" class="link sgo" (click)="go(2)">
                  {{ 'format.' + f.format | t }} · {{ f.size }} · Bo{{ f.boDefault }}
                  @if (f.format === 'double' && f.boGrand) {
                    ({{ 'form.gfShort' | t }} Bo{{ f.boGrand }})
                  }
                </button>
              </dd>
              <dt>{{ 'form.rules' | t }}</dt>
              <dd>
                <button type="button" class="link sgo" (click)="go(3)">{{ rulesText() }}</button>
              </dd>
              <dt>{{ 'form.server' | t }}</dt>
              <dd>
                <button type="button" class="link sgo" (click)="go(4)">
                  @if (serverAuto()) {
                    {{ 'form.serverAutoShort' | t: { name: agent()?.name ?? '–' } }}
                  } @else {
                    <span class="dot" [class.on]="agent()?.online"></span>
                    {{ agent()?.name ?? '–' }}
                    @if (profile(); as p) {
                      · {{ p.name }}
                    }
                  }
                  @if (f.parallel > 1) {
                    · {{ 'form.parallelN' | t: { n: f.parallel } }}
                  }
                </button>
              </dd>
              <dt>{{ 'form.secBots' | t }}</dt>
              <dd>{{ botsText() }}</dd>
              <dt>Discord</dt>
              <dd>
                <button type="button" class="link sgo" (click)="go(5)">
                  {{ notifyLabel(f.notifyMode) | t }}
                </button>
              </dd>
            </dl>
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
      scroll-margin-top: 84px;
    }
    .hacts {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px 18px;
    }
    .when-row {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr);
      gap: 10px;
      align-items: stretch;
    }
    .wcol {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .when-row .optrow {
      margin: 0;
      background: var(--panel-2);
      border-radius: var(--radius);
      padding: 10px 12px;
    }
    .sgo {
      display: inline;
      text-align: left;
      color: inherit;
      text-decoration: underline dotted var(--line);
      text-underline-offset: 3px;
    }
    input.big {
      font-size: var(--fs-xl);
      font-weight: 600;
      min-height: 46px;
      margin-bottom: 4px;
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
      font-size: var(--fs-sm);
      color: var(--text-2);
    }
    .pv li span {
      margin-left: 8px;
    }
    .pv ol {
      margin: 6px 0 0;
      padding-left: 18px;
      font-size: var(--fs-md);
    }
    .seg.days button {
      min-width: 46px;
    }
    .lbl {
      font-size: var(--fs-sm);
      font-weight: 600;
      color: var(--text-2);
      margin: 14px 0 6px;
    }
    .tiles.kinds {
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      margin-bottom: 6px;
    }
    .tiles.kinds .tile {
      padding: 10px 14px;
    }
    .tile.udt.on {
      border-color: var(--udt);
      background: color-mix(in srgb, var(--udt) 12%, transparent);
      color: #d7b4ff;
      box-shadow: inset 0 0 0 1px var(--udt);
    }
    fieldset.plain.udtbox {
      border: 1px solid color-mix(in srgb, var(--udt) 45%, transparent);
      border-radius: var(--radius);
      padding: 12px 16px 4px;
      margin: 6px 0 14px;
    }
    fieldset.plain.udtbox legend {
      padding: 0 6px;
      font-weight: 700;
      color: #d7b4ff;
    }
    .seg.len {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      width: 100%;
    }
    .seg.len button {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      padding: 8px 12px;
      text-align: left;
    }
    .seg.len small {
      font-weight: 500;
      font-size: var(--fs-xs);
      opacity: 0.85;
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
      justify-content: flex-start;
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
      font-size: var(--fs-lg);
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
      font-size: var(--fs-md);
      margin-bottom: 10px;
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
      font-size: var(--fs-sm);
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mt {
      font-weight: 400;
      color: var(--muted);
      font-size: var(--fs-xs);
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
    .sumh {
      margin-bottom: 8px;
      font-family: var(--font-display);
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--text-2);
    }
    .sname {
      font-family: var(--font-display);
      font-style: italic;
      font-weight: 800;
      font-size: var(--fs-2xl);
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
      font-size: var(--fs-md);
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
      font-size: var(--fs-base);
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
        background: color-mix(in srgb, var(--bg-2) 96%, transparent);
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
      .seg.len {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .tiles.kinds {
        grid-template-columns: 1fr;
      }
      .mapsearch {
        width: 100%;
      }
    }
    @media (max-width: 760px) {
      .when-row {
        grid-template-columns: minmax(0, 1fr);
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
  private readonly toasts = inject(Toasts);

  protected readonly agents = signal<AgentView[]>([]);
  /** The running season (null: out of season, season tournaments cannot be created). */
  protected readonly currentSeason = signal<number | null>(null);
  protected readonly m = signal<Model | null>(null);
  protected readonly detail = signal<TournamentDetail | null>(null);
  protected readonly seriesView = signal<SeriesView | null>(null);
  protected readonly busy = signal(false);
  protected readonly bestOf = [1, 3, 5, 7];
  protected readonly boOptions: Choice<number>[] = this.bestOf.map((b) => ({
    value: b,
    text: 'Bo' + b,
  }));
  protected readonly whenOptions: Choice<'once' | 'series'>[] = [
    { value: 'once', label: 'form.once' },
    { value: 'series', label: 'form.repeat', icon: 'copyToNew' },
  ];
  protected readonly repeatOptions: Choice<'weekly' | 'daily'>[] = [
    { value: 'weekly', label: 'series.weekly' },
    { value: 'daily', label: 'series.daily' },
  ];
  protected readonly timeModeOptions: Choice<'fixed' | 'interval'>[] = [
    { value: 'fixed', label: 'series.fixedTimes' },
    { value: 'interval', label: 'series.interval' },
  ];
  protected readonly mapModeOptions: Choice<'vote' | 'random'>[] = [
    { value: 'vote', label: 'form.mapVote' },
    { value: 'random', label: 'form.mapRandom' },
  ];
  protected readonly sizeOptions: Choice<number>[] = [4, 8, 16, 32].map((s) => ({
    value: s,
    text: String(s),
  }));
  protected readonly sizeOptionsTeams = this.sizeOptions.slice(0, 3);
  protected readonly skills = [0, 1, 2, 3, 4, 5, 6, 7];
  protected readonly livesChoices = [0, 1, 2, 3, 4, 5, 6, 8, 10, 15, 20];
  protected readonly teamSizes = [1, 2, 3, 5];
  protected readonly formats = ['single', 'double'] as const;
  protected readonly ffChoices = [0, 50, 100] as const;
  protected readonly teamSizeOptions: Choice<number>[] = this.teamSizes.map((k) => ({
    value: k,
    text: k === 1 ? '1v1' : k + 'v' + k,
  }));
  protected readonly teamSizeOptionsMh: Choice<number>[] = [2, 3, 5].map((k) => ({
    value: k,
    text: k + 'v' + k,
  }));
  protected readonly formatOptions = this.formats.map((x) => ({ value: x, label: 'format.' + x }));
  protected readonly ffOptions = this.ffChoices.map((p) => ({ value: p, text: p + ' %' }));
  protected readonly notifyOptions = computed(() =>
    this.notifyModes.map((x) => ({ value: x, label: this.notifyLabel(x) })),
  );
  protected readonly notifyModes = ['default', 'custom', 'off'] as const;
  protected readonly mapFilter = signal('');
  protected readonly lengths: Length[] = ['short', 'medium', 'long'];
  /** "Custom" opens the best of per round. */
  protected readonly customOpen = signal(false);
  /** Only a new tournament takes every map of the server (until maps are chosen by hand). */
  private mapsByHand = true;
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
  protected readonly serverAuto = computed(() => !!this.model()?.serverAuto);
  protected readonly maxParallel = MAX_PARALLEL;
  /** Servers of the parallel tile while "one after the other" is chosen. */
  protected readonly parPick = signal(2);
  /** The servers of the pool (decision 282). */
  protected readonly poolAgents = computed(() =>
    this.agents().filter((a) => a.inPool && a.profiles.length),
  );
  /** Servers that could play at once now: the pool's online ones and the chosen one. */
  protected readonly serversNow = computed(() => {
    const on = new Set(
      this.poolAgents()
        .filter((a) => a.online)
        .map((a) => a.id),
    );
    const a = this.agent();
    if (a?.online) on.add(a.id);
    return Math.max(1, on.size);
  });

  /** Compact (decision 324): a new tournament shows section 1, the others as one line. */
  protected readonly allOpen = signal(readAllOpen());
  protected readonly compact = computed(() => !this.editing() && !this.allOpen());
  private readonly opened = signal<ReadonlySet<number>>(new Set());
  /** Servers in the pool (decision 282). */
  protected readonly poolSize = computed(
    () => this.agents().filter((a) => a.inPool && a.profiles.length).length,
  );
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
  /** The length the settings match, else custom. */
  protected readonly lengthNow = computed((): Length | 'custom' => {
    const f = this.model();
    if (!f) return 'custom';
    return this.lengths.find((l) => this.isLength(f, l)) ?? 'custom';
  });

  /**
   * At most how long the bracket takes (every match to its last game, every game to the limit);
   * parallel matches with the servers chosen (decision 324; the tempo shows how many are online).
   */
  protected readonly durationText = computed(() => {
    const f = this.model();
    if (!f) return '';
    const n = maxGames(f);
    const per = f.timeLimitMin || 15;
    const p = f.parallel;
    const text = this.i18n.t('form.lenDuration', {
      d: hoursText(maxMinutes(f, per, p)),
      n,
      m: per,
    });
    return p > 1 ? `${text} ${this.i18n.t('form.lenParallel', { n: p })}` : text;
  });

  /** "≈ 2 h 10 min" with `servers` matches at once. */
  protected estimate(servers: number): string {
    const f = this.model();
    if (!f) return '';
    return `≈ ${hoursText(maxMinutes(f, f.timeLimitMin || 15, servers))}`;
  }

  /** `estimate` for the tempo tiles (re-created when the model changes, so they update). */
  protected get estimateFn(): (servers: number) => string {
    return this.estimates();
  }
  private readonly estimates = computed(() => {
    this.model();
    this.serversNow();
    return (n: number) => this.estimate(n);
  });

  protected setParallel(n: number) {
    const f = this.m();
    if (!f) return;
    const p = Math.min(MAX_PARALLEL, Math.max(1, n));
    if (p > 1) this.parPick.set(p);
    f.parallel = p;
    this.touch();
  }

  /** One line per section for compact mode. */
  protected readonly lines = computed((): Record<number, string> => {
    const f = this.model();
    if (!f) return {};
    const t = (k: string, p?: Record<string, string | number>) => this.i18n.t(k, p);
    const server = f.serverAuto
      ? t('form.serverAutoShort', { name: this.agent()?.name ?? '–' })
      : (this.agent()?.name ?? '–');
    const tempo = f.parallel > 1 ? t('form.parallelN', { n: f.parallel }) : t('form.tempoOne');
    return {
      2: [
        t(f.game === 'mh' ? 'form.gameMhShort' : 'form.gameDm'),
        f.teamSize === 1 ? '1v1' : `${f.teamSize}v${f.teamSize}`,
        t(`format.${f.format}`),
        String(f.size),
        `Bo${f.boDefault}`,
        t(`form.len.${this.lengthNow()}`),
      ].join(' · '),
      3: this.rulesText(),
      4: [server, tempo, this.estimate(f.parallel)].join(' · '),
      5: t(this.notifyLabel(f.notifyMode)),
      6: t('form.secAdvancedHint'),
    };
  });

  protected isOpen(n: number): boolean {
    return !this.compact() || n === 1 || this.opened().has(n);
  }

  protected toggle(n: number) {
    this.opened.update((s) => {
      const x = new Set(s);
      if (!x.delete(n)) x.add(n);
      return x;
    });
  }

  /** A line of the summary: opens its section and scrolls there. */
  protected go(n: number) {
    if (!this.isOpen(n)) this.toggle(n);
    setTimeout(() =>
      document.getElementById(`sec-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    );
  }

  protected setAllOpen(on: boolean) {
    this.allOpen.set(on);
    try {
      localStorage.setItem(OPEN_KEY, on ? '1' : '0');
    } catch {
      // storage unavailable: for this visit
    }
  }

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
        if (!s) {
          this.toasts.error(this.i18n.t('form.seriesMissing'));
          return;
        }
        this.seriesView.set(s);
        this.m.set(this.fromSeries(s));
      } else {
        const from = this.from();
        const f = from
          ? this.fromDetail(await this.api.tournament(from))
          : this.defaults(agents.find((x) => x.online) ?? agents[0]);
        if (this.mode() === 'series') this.toSeries(f);
        this.m.set(f);
        // A copy keeps its maps; a new one starts medium with every map of the server.
        if (!from) {
          this.mapsByHand = false;
          this.applyLength(f, 'medium');
          this.autoMaps(f);
          this.touch();
        }
      }
    } catch {
      // the Api shows the error as a toast
    }
  }

  private defaults(a?: AgentView): Model {
    return {
      name: '',
      when: 'once',
      agentId: a?.id ?? '',
      profileId: a?.profiles[0]?.id ?? '',
      serverAuto: true,
      parallel: 1,
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
      serverAuto: p.serverAuto,
      parallel: p.parallel ?? 1,
      connectAddress: p.connectAddress ?? '',
      scheduledAt: toLocalInput(scheduledAt),
      registrationOpen: p.registrationOpen,
      autoStart: p.autoStart,
      // League matchdays (fixtures) are made by the league, not with this form.
      format: s.format === 'fixtures' ? 'single' : s.format,
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
        serverAuto: d.serverAuto,
        parallel: d.parallel ?? 1,
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
        serverAuto: !!t.serverAuto,
        parallel: t.parallel ?? 1,
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

  protected kindOf(f: Model): 'classic' | 'season' | 'udt' {
    return f.udt ? 'udt' : f.seasonal ? 'season' : 'classic';
  }

  /** Classic, season or Dream Team (a Dream Team tournament always counts for the season). */
  protected setKind(k: 'classic' | 'season' | 'udt') {
    const f = this.m();
    if (!f) return;
    f.udt = k === 'udt';
    f.seasonal = k !== 'classic';
    this.touch();
  }

  private isLength(f: Model, l: Length): boolean {
    const x = LENGTHS[l];
    const keys: (keyof typeof x.bo)[] =
      f.format === 'double'
        ? ['boDefault', 'boSemi', 'boFinal', 'boLbFinal', 'boGrand']
        : ['boDefault', 'boSemi', 'boFinal'];
    if (keys.some((k) => f[k] !== x.bo[k])) return false;
    if (f.game === 'mh') return f.timeLimitMin === x.mhMinutes;
    const lim = lengthLimits(l, f.teamSize);
    return f.fragLimit === lim.fragLimit && f.timeLimitMin === lim.timeLimitMin;
  }

  private applyLength(f: Model, l: Length) {
    Object.assign(f, LENGTHS[l].bo);
    if (f.game === 'mh') f.timeLimitMin = LENGTHS[l].mhMinutes;
    else Object.assign(f, lengthLimits(l, f.teamSize));
  }

  protected setLength(l: Length) {
    const f = this.m();
    if (!f) return;
    this.applyLength(f, l);
    this.customOpen.set(false);
    this.touch();
  }

  /** "Bo1 · 8 frags · 8 min" for the length buttons (the current mode). */
  protected lengthText(l: Length): string {
    const f = this.model();
    if (!f) return '';
    const x = LENGTHS[l];
    const bo = [`Bo${x.bo.boDefault}`];
    if (x.bo.boFinal) bo.push(this.i18n.t('form.lenFinal', { n: x.bo.boFinal }));
    if (f.game === 'mh') return `${bo.join(' · ')} · ${x.mhMinutes} min`;
    const lim = lengthLimits(l, f.teamSize);
    return `${bo.join(' · ')} · ${lim.fragLimit} ${this.i18n.t('form.uFrags')} · ${lim.timeLimitMin} min`;
  }

  /** A new tournament: every map of the server for its game (until maps are chosen by hand). */
  private autoMaps(f: Model) {
    if (this.mapsByHand) return;
    const prefix = f.game === 'mh' ? 'MH-' : 'DM-';
    const maps = this.inventoryMaps()
      .map((x) => x.id)
      .filter((id) => id.toUpperCase().startsWith(prefix));
    if (maps.length) f.mapPool = maps;
    else if (f.game === 'dm') f.mapPool = [...STOCK_POOL];
  }

  protected onProfile() {
    const f = this.m();
    if (!f) return;
    // The profile read below follows the model only after a touch.
    this.touch();
    this.autoMaps(f);
    this.touch();
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
    // A length's limits follow the mode (custom ones stay).
    const len = this.lengthNow();
    f.teamSize = k;
    if (len !== 'custom') this.applyLength(f, len);
    if (k > 1 && f.size > 16) f.size = 16;
    this.touch();
  }

  /** Switches between deathmatch and Monster Hunt: teams only, own maps and time limit. */
  protected onGame(game: 'dm' | 'mh') {
    const f = this.m();
    if (!f || f.game === game) return;
    const len = this.lengthNow();
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
    if (len !== 'custom') this.applyLength(f, len);
    this.autoMaps(f);
    this.touch();
  }

  protected onAgent() {
    const f = this.m();
    if (!f) return;
    f.profileId = this.agents().find((a) => a.id === f.agentId)?.profiles[0]?.id ?? '';
    this.touch();
    this.autoMaps(f);
    this.touch();
  }

  protected toggleMap(id: string) {
    const f = this.m();
    if (!f) return;
    this.mapsByHand = true;
    const i = f.mapPool.indexOf(id);
    if (i >= 0) f.mapPool.splice(i, 1);
    else f.mapPool.push(id);
    this.touch();
  }

  /** Selects or clears the maps shown (the search narrows them). */
  protected allMaps(on: boolean) {
    const f = this.m();
    if (!f) return;
    this.mapsByHand = true;
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
    this.mapsByHand = true;
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
      // Dream Team matches are always played (traits, values and form only act in the game).
      botMatchMode: f.udt ? 'watch' : f.botMatchMode,
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
          friendlyFirePct: f.game === 'mh' ? 0 : f.friendlyFirePct,
          penaltySec: f.penaltySec,
          monsterSkill: f.monsterSkill,
          lives: f.lives,
        },
      },
    };
  }

  /** What a preset keeps (decision 325): the template and whether players sign up. */
  protected readonly presetBody = computed((): TournamentPresetBody => {
    const f = this.model();
    if (!f) return { agentId: '', profileId: '', settings: {} as TournamentSettings };
    // The template's settings are built as plain values (the API checks them).
    return {
      ...this.template(f),
      registrationOpen: f.registrationOpen,
    } as unknown as TournamentPresetBody;
  });

  /**
   * Applies a preset: its settings, server, tempo, Discord and Dream Team rules; the name (when
   * one is typed), the date and a series' schedule stay. A server that is gone falls back to the
   * first online one; a season kind needs a season (or a series).
   */
  protected applyPreset(p: TournamentPreset) {
    const f = this.m();
    if (!f) return;
    const b = p.body;
    const agent =
      this.agents().find((a) => a.id === b.agentId) ??
      this.agents().find((a) => a.online) ??
      this.agents()[0];
    const n = this.fromParts(
      {
        agentId: agent?.id ?? b.agentId,
        profileId: agent?.profiles.some((x) => x.id === b.profileId)
          ? b.profileId
          : (agent?.profiles[0]?.id ?? b.profileId),
        serverAuto: !!b.serverAuto,
        parallel: b.parallel ?? 1,
        connectAddress: b.connectAddress ?? null,
        settings: b.settings,
        notifyMode: b.notifyMode ?? 'default',
        webhookUrl: b.webhookUrl ?? null,
        seasonal: !!b.seasonal,
        registrationOpen: b.registrationOpen ?? true,
        autoStart: !!b.autoStart,
        kind: b.kind ?? 'standard',
        udt: b.udt ?? null,
      },
      f.name.trim() ? f.name : p.name,
      null,
    );
    const keep: (keyof Model)[] = [
      'when',
      'scheduledAt',
      'repeat',
      'days',
      'everyWeeks',
      'timeMode',
      'times',
      'everyHours',
      'fromTime',
      'toTime',
      'leadValue',
      'leadUnit',
    ];
    for (const k of keep) (n as unknown as Record<string, unknown>)[k] = f[k];
    if (this.currentSeason() === null && n.when === 'once') {
      n.seasonal = false;
      n.udt = false;
    }
    if (n.parallel > 1) this.parPick.set(n.parallel);
    this.mapsByHand = true;
    this.m.set(n);
    this.touch();
  }

  /** What every tournament of a series gets (the bots: the control center). */
  private template(f: Model) {
    return {
      agentId: f.agentId,
      profileId: f.profileId,
      serverAuto: f.serverAuto,
      parallel: Math.min(MAX_PARALLEL, Math.max(1, Math.round(Number(f.parallel) || 1))),
      connectAddress: f.connectAddress.trim() || null,
      notifyMode: f.notifyMode,
      webhookUrl: f.notifyMode === 'custom' ? f.webhookUrl.trim() : null,
      seasonal: f.udt || f.seasonal,
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
              serverAuto: t.serverAuto,
              parallel: t.parallel,
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
            serverAuto: t.serverAuto,
            parallel: t.parallel,
            settings: t.settings,
            ...udt,
          });
          await this.router.navigate(['/t', d.id]);
        }
      }
    } catch {
      // the Api shows the error as a toast
    } finally {
      this.busy.set(false);
    }
  }
}
