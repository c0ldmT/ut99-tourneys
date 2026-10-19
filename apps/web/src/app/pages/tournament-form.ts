import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { Auth } from '../core/auth';
import { Icon } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { isLocalAddress } from '../core/connect';
import { MH_ADAPTER } from '../core/race';
import type {
  AgentView,
  LibraryBot,
  SeriesView,
  TournamentDetail,
  TournamentSettings,
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
  // series schedule
  weekday: number;
  time: string;
  everyWeeks: number;
  leadDays: number;
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
              <label>{{ 'series.weekday' | t }}</label>
              <div class="seg days" role="group" [attr.aria-label]="'series.weekday' | t">
                @for (w of weekdays(); track w.n) {
                  <button
                    type="button"
                    [class.on]="f.weekday === w.n"
                    (click)="f.weekday = w.n; touch()"
                    [title]="w.long"
                  >
                    {{ w.short }}
                  </button>
                }
              </div>
              <div class="fields">
                <div class="field">
                  <label for="ftime">{{ 'series.time' | t }}</label>
                  <input
                    id="ftime"
                    name="time"
                    type="time"
                    [(ngModel)]="f.time"
                    (ngModelChange)="touch()"
                    required
                  />
                </div>
                <div class="field">
                  <label for="fevery">{{ 'series.every' | t }}</label>
                  <select
                    id="fevery"
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
                <div class="field">
                  <label for="flead">{{ 'series.lead' | t }}</label>
                  <div class="unit">
                    <input
                      id="flead"
                      name="lead"
                      type="number"
                      min="0"
                      max="28"
                      [(ngModel)]="f.leadDays"
                      (ngModelChange)="touch()"
                    /><span>{{ 'form.uDays' | t }}</span>
                  </div>
                </div>
              </div>
              <p class="muted small">{{ 'series.leadHint' | t }}</p>
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
            </div>
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
    .seg.days {
      margin-bottom: 12px;
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
  private readonly auth = inject(Auth);
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
  private readonly model = computed(() => {
    this.tick();
    return this.m();
  });
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
    const loc = this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB';
    // 2026-10-19 is a Monday.
    return [1, 2, 3, 4, 5, 6, 7].map((n) => {
      const d = new Date(Date.UTC(2026, 9, 18 + n));
      return {
        n,
        short: d.toLocaleDateString(loc, { weekday: 'short', timeZone: 'UTC' }).replace('.', ''),
        long: d.toLocaleDateString(loc, { weekday: 'long', timeZone: 'UTC' }),
      };
    });
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

  /** The next start of a series as the browser sees it (local time). */
  private readonly nextSeriesStart = computed(() => {
    const f = this.model();
    if (!f || f.when !== 'series') return null;
    const [h, min] = (f.time || '20:00').split(':').map(Number);
    const d = new Date();
    d.setSeconds(0, 0);
    d.setHours(h ?? 20, min ?? 0);
    const diff = (f.weekday - (((d.getDay() + 6) % 7) + 1) + 7) % 7;
    d.setDate(d.getDate() + diff);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 7);
    return d;
  });

  protected readonly previewName = computed(() => {
    const f = this.model();
    if (!f) return '';
    const name = f.name.trim();
    if (f.when !== 'series' || !name) return name;
    const n = String(this.seriesView()?.nextNumber ?? 1);
    const at = this.nextSeriesStart();
    const date = at ? `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.` : '';
    return /\{n\}|\{date\}/.test(name)
      ? name.replace(/\{n\}/g, n).replace(/\{date\}/g, date)
      : `${name} #${n}`;
  });

  protected readonly whenText = computed(() => {
    const f = this.model();
    if (!f) return '';
    if (f.when === 'once')
      return f.scheduledAt
        ? this.i18n.date(new Date(f.scheduledAt).toISOString())
        : this.i18n.t('form.noDate');
    const day = this.weekdays().find((w) => w.n === f.weekday)?.long ?? '';
    const rhythm =
      f.everyWeeks > 1
        ? this.i18n.t('series.rhythmN', { n: f.everyWeeks, day, time: f.time })
        : this.i18n.t('series.rhythm1', { day, time: f.time });
    const at = this.nextSeriesStart();
    return at
      ? `${rhythm} · ${this.i18n.t('form.sumNext', { when: this.i18n.date(at.toISOString()) })}`
      : rhythm;
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
      weekday: 5,
      time: '20:00',
      everyWeeks: 1,
      leadDays: 7,
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
      },
      s.name,
      null,
    );
    return {
      ...f,
      when: 'series',
      weekday: s.weekday,
      time: s.time,
      everyWeeks: s.everyWeeks,
      leadDays: s.leadDays,
    };
  }

  /** A series from the form's tournament: name pattern and schedule from its start. */
  private toSeries(f: Model) {
    f.when = 'series';
    if (f.name && !/\{n\}|\{date\}/.test(f.name))
      f.name = `${f.name.replace(/\s*#?\d+$/, '')} #{n}`;
    if (f.scheduledAt) {
      const at = new Date(f.scheduledAt);
      f.weekday = ((at.getDay() + 6) % 7) + 1;
      f.time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
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
      settings: this.settings(f),
    };
  }

  private schedule(f: Model) {
    return {
      name: f.name.trim(),
      weekday: Number(f.weekday),
      time: f.time,
      everyWeeks: Number(f.everyWeeks),
      leadDays: Math.max(0, Math.round(Number(f.leadDays) || 0)),
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
        await this.api.updateSeries(sid, { ...this.schedule(f), template: this.template(f) });
        await this.router.navigate(['/admin/series']);
      } else if (f.when === 'series') {
        await this.api.createSeries({ ...this.schedule(f), template: this.template(f) });
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
        };
        if (id) {
          const patch: Record<string, unknown> = { ...common };
          if (!this.locked())
            Object.assign(patch, {
              agentId: t.agentId,
              profileId: t.profileId,
              settings: t.settings,
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
