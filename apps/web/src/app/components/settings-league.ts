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
import { RouterLink } from '@angular/router';
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
  LeaguePlanSummary,
  LeagueSettings,
  UdtSettings,
} from '../core/types';
import { SETTINGS_STYLES, type SettingsForm } from './settings-shared';

const LENGTHS: LeagueLength[] = ['short', 'medium', 'long'];
const AI_GAMES: LeagueAiGames[] = ['simulate', 'topGame', 'all'];
const SIZES = [8, 10, 12, 14, 16];
const TIERS = [1, 2, 3, 4];
const KEEPERS = [0, 1, 2, 3, 4, 5];
const LOSSES = [0, 1, 2, 3];
/** Keeper example: a Masterful bot after a loss of 0-3 steps (not below Skilled). */
const SKILL_AFTER = ['skill.5', 'skill.4', 'skill.3', 'skill.3'] as const;
const TIER_COLORS = ['var(--udt)', 'var(--accent)', '#a3e635', 'var(--neuro)'];
const DAY_MS = 86_400_000;

interface StatusView {
  tone: 'udt' | 'accent' | 'gold' | 'ok' | 'off';
  kicker: string;
  title: string;
  text: string;
  warn: string;
  steps: { label: string; date: string; now: boolean }[];
  bar: { a: string; b: string; pct: number } | null;
  /** Offer "start now" (no league in the running season). */
  start: boolean;
  abort: 'test' | 'real' | null;
}

/**
 * Settings tab "UDT Liga" (decision 230, preview "Kalender & Liga-Einstellungen"): on the side
 * where the league stands (off, waiting for its start day, next season, running, done) with
 * "start now" (a regular league or a test run in the running season); the form: switch, tiers,
 * clubs and start day, the league evenings and the length, server and rules with the map pool
 * as in the tournament form, money (table money per place and tier, cup bonus), AI clubs and
 * keepers.
 */
@Component({
  selector: 'app-settings-league',
  imports: [FormsModule, RouterLink, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="lgs" data-form="league" (ngSubmit)="save()">
      <div class="lgs-main">
        <section class="card">
          <div class="lgs-head">
            <h2>{{ 'settings.tab.league' | t }}</h2>
            <label class="switch"
              ><input type="checkbox" name="lgOn" [(ngModel)]="f.enabled" /><span class="tr"></span
              >{{ 'lgs.on' | t }}</label
            >
          </div>
          <p class="muted small lgs-line">
            {{
              f.enabled
                ? ('lgs.onLine' | t: { n: f.startDay, time: f.slotTime })
                : ('lgs.onLineOff' | t)
            }}
          </p>
          <div class="lgs-trio">
            <div>
              <span class="lgs-lbl" id="lgs-tiers">{{ 'lgs.tiers' | t }}</span>
              <div class="seg" role="radiogroup" aria-labelledby="lgs-tiers">
                @for (n of tiersList; track n) {
                  <button
                    type="button"
                    role="radio"
                    [class.on]="f.tiers === n"
                    [attr.aria-checked]="f.tiers === n"
                    (click)="f.tiers = n; estimate(); touch($event)"
                  >
                    {{ n }}
                  </button>
                }
              </div>
              <span class="muted small">{{ tierNames() }}</span>
            </div>
            <div>
              <span class="lgs-lbl" id="lgs-size">{{ 'lgs.size' | t }}</span>
              <div class="seg" role="radiogroup" aria-labelledby="lgs-size">
                @for (n of sizes; track n) {
                  <button
                    type="button"
                    role="radio"
                    [class.on]="f.size === n"
                    [attr.aria-checked]="f.size === n"
                    (click)="f.size = n; estimate(); touch($event)"
                  >
                    {{ n }}
                  </button>
                }
              </div>
              <span class="muted small">{{ 'lgs.mdN' | t: { n: matchdays(f.size) } }}</span>
            </div>
            <div>
              <span class="lgs-lbl">{{ 'lgs.start' | t }}</span>
              <div class="lgs-step">
                <button
                  type="button"
                  [attr.aria-label]="'lgs.earlier' | t"
                  [disabled]="f.startDay <= 1"
                  (click)="f.startDay = f.startDay - 1; touch($event)"
                >
                  −
                </button>
                <b>{{ 'lgs.startN' | t: { n: f.startDay } }}</b>
                <button
                  type="button"
                  [attr.aria-label]="'lgs.later' | t"
                  [disabled]="f.startDay >= 30"
                  (click)="f.startDay = f.startDay + 1; touch($event)"
                >
                  +
                </button>
              </div>
            </div>
          </div>
          @if (running()) {
            <p class="small lgs-fixed">{{ 'lgs.fixed' | t }}</p>
          }
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
          <p class="muted small">{{ 'lgs.rulesNow' | t }}</p>
          <div class="lgs-fields">
            <label
              >{{ 'lgs.agent' | t }}
              <span class="lgs-withdot">
                <span class="dot" [class.on]="agentOnline()"></span>
                <select name="lgAgent" [(ngModel)]="agentId" (ngModelChange)="agentChanged()">
                  <option value="">{{ 'lgs.agentAuto' | t }}</option>
                  @for (a of agentOptions(); track a.id) {
                    <option [value]="a.id">
                      {{ a.name }} –
                      {{ a.online ? ('agents.online' | t) : ('agents.offline' | t) }}
                    </option>
                  }
                </select>
              </span>
            </label>
            <label
              >{{ 'lgs.profile' | t }}
              <select
                name="lgProfile"
                [(ngModel)]="profileId"
                (ngModelChange)="profileSig.set(profileId)"
                [disabled]="!agentId"
              >
                @for (p of profiles(); track p.id) {
                  <option [value]="p.id">{{ p.name }}</option>
                }
              </select>
            </label>
            <label
              >{{ 'lgs.fragLimit' | t }}
              <span class="lgs-unit"
                ><input
                  type="number"
                  name="lgFrags"
                  min="5"
                  max="200"
                  [(ngModel)]="f.fragLimit"
                /><span>{{ 'lgs.uFrags' | t }}</span></span
              >
            </label>
            <label
              >{{ 'lgs.timeLimit' | t }}
              <span class="lgs-unit"
                ><input
                  type="number"
                  name="lgTimeLimit"
                  min="5"
                  max="60"
                  [(ngModel)]="f.timeLimitMin"
                /><span>min</span></span
              >
            </label>
          </div>
          <div class="lgs-bar">
            <b>{{ 'lgs.betBots' | t }}</b>
            <span class="lgs-step">
              <button
                type="button"
                [attr.aria-label]="'lgs.less' | t"
                [disabled]="f.betBots <= 0"
                (click)="f.betBots = clamp(f.betBots - 5, 0, 50); touch($event)"
              >
                −
              </button>
              <b class="mono">{{ f.betBots }}</b>
              <button
                type="button"
                [attr.aria-label]="'lgs.more' | t"
                [disabled]="f.betBots >= 50"
                (click)="f.betBots = clamp(f.betBots + 5, 0, 50); touch($event)"
              >
                +
              </button>
            </span>
            <span class="muted small">{{ 'lgs.betBotsHint' | t }}</span>
          </div>

          <div class="lgs-maphead">
            <div>
              <span class="lgs-lbl" id="lgs-pool">{{ 'lgs.mapPool' | t }}</span>
              <div class="seg" role="radiogroup" aria-labelledby="lgs-pool">
                <button
                  type="button"
                  role="radio"
                  [class.on]="!ownMaps"
                  [attr.aria-checked]="!ownMaps"
                  (click)="setOwnMaps(false); touch($event)"
                >
                  {{ 'lgs.mapsAuto' | t }}
                </button>
                <button
                  type="button"
                  role="radio"
                  [class.on]="ownMaps"
                  [attr.aria-checked]="ownMaps"
                  (click)="setOwnMaps(true); touch($event)"
                >
                  {{ 'lgs.mapsOwn' | t }}
                </button>
              </div>
            </div>
            @if (ownMaps) {
              <span class="grow"></span>
              <input
                class="lgs-mapsearch"
                name="lgMapSearch"
                [ngModel]="mapFilter()"
                (ngModelChange)="mapFilter.set($event)"
                [placeholder]="'form.mapSearch' | t"
                [attr.aria-label]="'form.mapSearch' | t"
              />
              <button type="button" (click)="allMaps(true); touch($event)">
                {{ 'form.mapAll' | t }}
              </button>
              <button type="button" (click)="allMaps(false); touch($event)">
                {{ 'form.mapNone' | t }}
              </button>
            }
          </div>
          @if (!ownMaps) {
            <p class="lgs-auto small">
              {{ 'lgs.mapsAutoText' | t }}
              <b>{{ autoPool() || '–' }}</b>
            </p>
          } @else {
            <div class="lgs-maps">
              @for (m of shownMaps(); track m.id) {
                <label class="lgs-map" [class.on]="f.mapPool.includes(m.id)" [title]="m.id">
                  <input
                    type="checkbox"
                    [checked]="f.mapPool.includes(m.id)"
                    (change)="toggleMap(m.id)"
                  />
                  <span class="lgs-mid">{{ m.id }}</span>
                  @if (m.title && m.title !== m.id) {
                    <span class="lgs-mt">{{ m.title }}</span>
                  }
                </label>
              } @empty {
                <p class="muted small">{{ 'lgs.mapsNone' | t }}</p>
              }
            </div>
            <div class="lgs-addmap">
              <input
                name="lgNewMap"
                [(ngModel)]="newMap"
                placeholder="DM-Example"
                [attr.aria-label]="'form.addMap' | t"
              />
              <button type="button" [disabled]="!newMap.trim()" (click)="addMap(); touch($event)">
                {{ 'form.addMap' | t }}
              </button>
            </div>
            <p class="muted small">
              {{
                f.mapPool.length
                  ? ('lgs.mapCount' | t: { n: f.mapPool.length, m: mapChoices().length })
                  : ('lgs.mapsEmpty' | t)
              }}
            </p>
          }
        </section>

        <section class="card">
          <h2>{{ 'lgs.moneyTitle' | t }}</h2>
          <p class="muted small">{{ 'lgs.moneyHint' | t }}</p>
          <div class="lgs-scroll">
            <table class="lgs-money">
              <thead>
                <tr>
                  <th scope="col">{{ 'lgs.tableMoneyShort' | t }}</th>
                  <th scope="col">{{ 'lgs.base' | t }}</th>
                  @for (t of tierIdx(); track t) {
                    <th scope="col">
                      <span class="lgs-tn" [style.color]="tierColor(t)">{{ tierName(t) }}</span>
                      <span class="lgs-step sm">
                        <button
                          type="button"
                          [attr.aria-label]="'lgs.factorDown' | t: { tier: tierName(t) }"
                          (click)="nudge(mult, t, -0.1); touch($event)"
                        >
                          −
                        </button>
                        <span class="mono">× {{ dec(mult[t]!) }}</span>
                        <button
                          type="button"
                          [attr.aria-label]="'lgs.factorUp' | t: { tier: tierName(t) }"
                          (click)="nudge(mult, t, 0.1); touch($event)"
                        >
                          +
                        </button>
                      </span>
                    </th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (g of groups(); track g) {
                  <tr>
                    <th scope="row">{{ 'lgs.places' | t: { p: placesOf(g) } }}</th>
                    <td>
                      <span class="lgs-unit coin"
                        ><input
                          type="number"
                          min="0"
                          max="100000"
                          step="50"
                          [name]="'lgMoney' + g"
                          [(ngModel)]="money[g]"
                          [attr.aria-label]="'lgs.baseOf' | t: { p: placesOf(g) }"
                        /><span aria-hidden="true">◎</span></span
                      >
                    </td>
                    @for (t of tierIdx(); track t) {
                      <td class="mono lgs-amt">{{ amount(g, t) }}</td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <p class="muted small">{{ 'lgs.champNote' | t: { v: amount(0, 0) } }}</p>
          <div class="lgs-cup">
            <div>
              <span class="lgs-lbl">{{ 'lgs.cupBonusShort' | t }}</span>
              <span class="muted small">{{ 'lgs.cupBonusHint' | t }}</span>
            </div>
            <div class="lgs-podium">
              @for (i of [0, 1, 2]; track i) {
                <label [class]="'lgs-pod p' + i"
                  ><span class="lgs-medal">{{ i + 1 }}.</span>
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    step="50"
                    [name]="'lgCup' + i"
                    [(ngModel)]="cup[i]"
                    [attr.aria-label]="'lgs.cupOf' | t: { p: i + 1 }"
                /></label>
              }
            </div>
          </div>
        </section>

        <section class="card">
          <h2>{{ 'lgs.aiKeep' | t }}</h2>
          <div class="lgs-two">
            <div>
              <span class="lgs-lbl">{{ 'lgs.factorsShort' | t }}</span>
              <span class="muted small">{{ 'lgs.factorsHint' | t }}</span>
              @for (t of tierIdx(); track t) {
                <label class="lgs-range"
                  ><span [style.color]="tierColor(t)">{{ tierName(t) }}</span>
                  <input
                    type="range"
                    min="0.5"
                    max="1.5"
                    step="0.05"
                    [name]="'lgFactor' + t"
                    [(ngModel)]="factors[t]"
                  /><b class="mono">× {{ dec(factors[t]!) }}</b></label
                >
              }
              <div class="lgs-bar">
                <span>{{ 'lgs.joinShort' | t }}</span>
                <span class="lgs-step">
                  <button
                    type="button"
                    [attr.aria-label]="'lgs.earlier' | t"
                    [disabled]="f.joinUntil <= 0"
                    (click)="f.joinUntil = clamp(f.joinUntil - 1, 0, 30); touch($event)"
                  >
                    −
                  </button>
                  <b class="mono">{{ f.joinUntil }}</b>
                  <button
                    type="button"
                    [attr.aria-label]="'lgs.later' | t"
                    [disabled]="f.joinUntil >= 30"
                    (click)="f.joinUntil = clamp(f.joinUntil + 1, 0, 30); touch($event)"
                  >
                    +
                  </button>
                </span>
              </div>
            </div>
            <div>
              <span class="lgs-lbl" id="lgs-keep">{{ 'lgs.keepMax' | t }}</span>
              <div class="seg" role="radiogroup" aria-labelledby="lgs-keep">
                @for (n of keeperChoices; track n) {
                  <button
                    type="button"
                    role="radio"
                    [class.on]="keepMax === n"
                    [attr.aria-checked]="keepMax === n"
                    (click)="keepMax = n; touch($event)"
                  >
                    {{ n }}
                  </button>
                }
              </div>
              <span class="lgs-lbl" id="lgs-loss">{{ 'lgs.keepLoss' | t }}</span>
              <div class="seg" role="radiogroup" aria-labelledby="lgs-loss">
                @for (n of lossChoices; track n) {
                  <button
                    type="button"
                    role="radio"
                    [class.on]="keepLoss === n"
                    [attr.aria-checked]="keepLoss === n"
                    (click)="keepLoss = n; touch($event)"
                  >
                    {{ n ? '−' + n : '0' }}
                  </button>
                }
              </div>
              <span class="muted small">{{
                keepLoss
                  ? ('lgs.keepLossN' | t: { n: keepLoss, skill: skillAfter(keepLoss) })
                  : ('lgs.keepLoss0' | t)
              }}</span>
            </div>
          </div>
        </section>

        <div class="lgs-actions">
          <button type="button" (click)="discard()">{{ 'lgs.discard' | t }}</button>
          <button type="submit" class="primary" [disabled]="busy()">{{ 'lgs.save' | t }}</button>
        </div>
      </div>

      <aside class="lgs-side">
        @if (status(); as s) {
          <section class="card lgs-st" [attr.data-tone]="s.tone" aria-labelledby="lgs-st-t">
            <div class="lgs-kick">{{ s.kicker }}</div>
            <h2 id="lgs-st-t">{{ s.title }}</h2>
            @if (s.text) {
              <p class="small">{{ s.text }}</p>
            }
            @if (s.bar; as b) {
              <div class="lgs-prog">
                <span class="small muted">{{ b.a }}</span>
                <span class="small muted">{{ b.b }}</span>
                <span class="lgs-track"><span [style.width.%]="b.pct"></span></span>
              </div>
            }
            @if (s.steps.length) {
              <ol class="lgs-steps">
                @for (x of s.steps; track $index) {
                  <li [class.now]="x.now">
                    <span class="lgs-sd" aria-hidden="true"></span><span>{{ x.label }}</span
                    ><span class="mono small">{{ x.date }}</span>
                  </li>
                }
              </ol>
            }
            @if (s.warn) {
              <p class="small lgs-warn">{{ s.warn }}</p>
            }
            <div class="lgs-acts">
              @if (s.start) {
                <button type="button" class="primary udt" (click)="openStart()">
                  {{ 'lgs.startNow' | t }}
                </button>
              }
              @if (s.abort) {
                <button type="button" class="danger" [disabled]="busy()" (click)="abort(s.abort)">
                  {{ (s.abort === 'test' ? 'lgs.testAbort' : 'lgs.abort') | t }}
                </button>
              }
              <a routerLink="/calendar" class="btn">{{ 'lgs.toCalendar' | t }}</a>
            </div>
          </section>
        }
        <section class="card">
          <h2 class="lgs-h3">{{ 'lgs.test' | t }}</h2>
          <p class="muted small">{{ 'lgs.testHint' | t }}</p>
          <label class="switch small"
            ><input type="checkbox" name="lgKeepTest" [(ngModel)]="f.keepTestTiers" /><span
              class="tr"
            ></span
            >{{ 'lgs.keepTestTiers' | t }}</label
          >
        </section>
        <section class="card small muted">
          <div class="kpi">{{ 'lgs.notes' | t }}</div>
          <p>{{ 'lgs.whenFixed' | t }}</p>
          <p>{{ 'lgs.whenNow' | t }}</p>
        </section>
      </aside>
    </form>

    <dialog #dlg class="lgs-dlg" aria-labelledby="lgs-dlg-t">
      <h2 id="lgs-dlg-t">{{ 'lgs.startTitle' | t }}</h2>
      <div class="lgs-modes" role="radiogroup" [attr.aria-label]="'lgs.startTitle' | t">
        @for (m of modes; track m) {
          <button
            type="button"
            role="radio"
            [class.on]="start.mode === m"
            [attr.data-mode]="m"
            [attr.aria-checked]="start.mode === m"
            (click)="start.mode = m"
          >
            <b>{{ 'lgs.mode.' + m | t }}</b>
            <span class="small muted">{{ 'lgs.modeHint.' + m | t }}</span>
          </button>
        }
      </div>
      <label
        >{{ 'lgs.firstEvening' | t }}
        <select name="lsStart" [(ngModel)]="start.startDate" (ngModelChange)="loadFit()">
          @for (d of startDates(); track d.value) {
            <option [value]="d.value">{{ d.label }}</option>
          }
        </select>
      </label>
      <label
        >{{ 'lgs.placement' | t }}
        <select name="lsPlace" [(ngModel)]="start.placement">
          @for (p of placements; track p) {
            <option [value]="p">{{ 'lgs.placement.' + p | t }}</option>
          }
        </select>
      </label>
      <label class="switch"
        ><input type="checkbox" name="lsMoney" [(ngModel)]="start.tableMoney" /><span
          class="tr"
        ></span
        >{{ 'lgs.payMoney' | t }}</label
      >
      <div class="lgs-plan small" aria-live="polite">
        @if (fit(); as p) {
          <div class="lgs-planhead">
            <b>{{ 'lgs.plan' | t }}</b
            ><span class="lgs-ok">{{ 'lgs.fitOk' | t: { d: spare(p) } }}</span>
          </div>
          <dl>
            <dt>{{ 'lgs.fitEvenings' | t }}</dt>
            <dd>{{ 'lgs.fitEveningsN' | t: { n: p.evenings, p: p.perEvening } }}</dd>
            <dt>{{ 'lgs.fitLast' | t }}</dt>
            <dd>{{ date(p.last) }}</dd>
            <dt>{{ 'lgs.fitFinale' | t }}</dt>
            <dd>{{ date(p.relegation) }} · {{ date(p.final) }}</dd>
            <dt>{{ 'lgs.fitEst' | t }}</dt>
            <dd>{{ fitMinutes(p) }}</dd>
          </dl>
        } @else if (fitLoaded()) {
          <span class="lgs-no">{{ 'lgs.fitNo' | t }}</span>
        }
      </div>
      <p class="small muted">{{ 'lgs.modeNote.' + start.mode | t }}</p>
      <div class="lgs-actions">
        <button type="button" (click)="dlg.close()">{{ 'common.cancel' | t }}</button>
        <button
          type="button"
          class="primary udt"
          [disabled]="busy() || !fit()"
          (click)="startLeague()"
        >
          {{ (start.mode === 'real' ? 'lgs.startReal' : 'lgs.testStart') | t }}
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
  protected readonly tiersList = TIERS;
  protected readonly lengths = LENGTHS;
  protected readonly aiGames = AI_GAMES;
  protected readonly keeperChoices = KEEPERS;
  protected readonly lossChoices = LOSSES;
  protected readonly placements = ['cup', 'random', 'one'] as const;
  protected readonly modes = ['real', 'test'] as const;
  protected readonly admin = signal<LeagueAdmin | null>(null);
  protected readonly est = signal<LeagueEstimate | null>(null);
  private readonly agents = signal<AgentView[]>([]);
  /** The form (plain fields with ngModel: markForCheck after loading). */
  protected f: LeagueSettings = defaults();
  /** Table money per band of four places, the factor per tier, AI strength per tier. */
  protected money: number[] = [];
  protected mult: number[] = [];
  protected factors: number[] = [];
  protected cup: number[] = [];
  protected keepMax = 2;
  protected keepLoss = 1;
  /** The league's server ("" = the server of the newest Dream Team tournament). */
  protected agentId = '';
  protected profileId = '';
  private readonly agentSig = signal('');
  protected readonly profileSig = signal('');
  /** Own map pool (else the pool of the newest Dream Team tournament, `mapPool` empty). */
  protected ownMaps = false;
  protected newMap = '';
  protected readonly mapFilter = signal('');
  /** Bumped when the map pool changes (the map lists are computed). */
  private readonly poolRev = signal(0);
  /** Bumped when tiers/size change (money rows and columns). */
  private readonly shape = signal(0);
  protected start = {
    mode: 'real' as 'real' | 'test',
    startDate: '',
    placement: 'cup' as 'cup' | 'random' | 'one',
    tableMoney: true,
  };
  protected readonly fit = signal<LeaguePlanSummary | null>(null);
  protected readonly fitLoaded = signal(false);
  private udt: UdtSettings | null = null;
  private readonly toasts = inject(Toasts);

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

  protected readonly agentOptions = computed(() => {
    const list = this.agents().map((a) => ({ id: a.id, name: a.name, online: a.online }));
    // A saved server that is gone (or not known yet) stays selectable.
    const saved = this.agentSig();
    if (saved && !list.some((a) => a.id === saved))
      list.push({ id: saved, name: saved, online: false });
    return list;
  });

  protected readonly profiles = computed(() => {
    const a = this.agents().find((x) => x.id === this.agentSig());
    const list = (a?.profiles ?? []).map((p) => ({ id: p.id, name: p.name }));
    const saved = this.profileSig();
    if (saved && !list.some((p) => p.id === saved)) list.push({ id: saved, name: saved });
    return list;
  });

  protected readonly agentOnline = computed(
    () => this.agents().find((a) => a.id === this.agentSig())?.online ?? false,
  );

  /** Deathmatch maps of the chosen server (all servers' when none is chosen), plus the pool. */
  protected readonly mapChoices = computed(() => {
    this.poolRev();
    const agentId = this.agentSig();
    const profileId = this.profileSig();
    const out = new Map<string, { id: string; title: string }>();
    for (const a of this.agents())
      if (!agentId || a.id === agentId)
        for (const p of a.profiles)
          if (!agentId || !profileId || p.id === profileId)
            for (const m of p.inventory?.maps ?? [])
              if (/^DM-/i.test(m.id) && !out.has(m.id))
                out.set(m.id, { id: m.id, title: m.title ?? '' });
    for (const id of this.f.mapPool) if (!out.has(id)) out.set(id, { id, title: '' });
    return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
  });

  protected readonly shownMaps = computed(() => {
    const q = this.mapFilter().trim().toLowerCase();
    const all = this.mapChoices();
    return q
      ? all.filter((m) => m.id.toLowerCase().includes(q) || m.title.toLowerCase().includes(q))
      : all;
  });

  /** The pool the league uses without an own choice (from the admin view). */
  protected readonly autoPool = computed(() => (this.admin()?.mapPool ?? []).join(' · '));

  protected readonly running = computed(() => this.admin()?.status.state === 'running');

  protected readonly tierIdx = computed(() => {
    this.shape();
    return Array.from({ length: this.f.tiers }, (_, i) => i);
  });

  /** Bands of four places that exist in a tier of this size. */
  protected readonly groups = computed(() => {
    this.shape();
    return Array.from({ length: Math.ceil(this.f.size / 4) }, (_, i) => i);
  });

  protected readonly status = computed((): StatusView | null => {
    const a = this.admin();
    if (!a) return null;
    return this.statusView(a);
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
    const l = u.league;
    this.f = { ...defaults(), ...l, slotDays: [...l.slotDays], mapPool: [...l.mapPool] };
    const four = (xs: readonly number[], base: readonly number[]) =>
      base.map((b, i) => xs[i] ?? xs.at(-1) ?? b);
    this.money = four(l.tableMoney, DEFAULT_MONEY);
    this.mult = four(l.tierMult, DEFAULT_MULT);
    this.factors = four(l.factors, [1, 1, 1, 1]);
    this.cup = [0, 1, 2].map((i) => u.cupBonus[i] ?? 0);
    this.keepMax = u.keepers.max;
    this.keepLoss = u.keepers.skillLoss;
    this.agentId = l.agentId && l.profileId ? l.agentId : '';
    this.profileId = this.agentId ? (l.profileId ?? '') : '';
    this.agentSig.set(this.agentId);
    this.profileSig.set(this.profileId);
    this.ownMaps = l.mapPool.length > 0;
    this.poolRev.update((n) => n + 1);
    this.shape.update((n) => n + 1);
    this.cdr.markForCheck();
  }

  // ---------------------------------------------------------------------------------------------
  // Status
  // ---------------------------------------------------------------------------------------------

  private statusView(a: LeagueAdmin): StatusView {
    const t = (k: string, p?: Record<string, string | number>) => this.i18n.t(k, p);
    const s = a.status;
    const base: StatusView = {
      tone: 'off',
      kicker: '',
      title: '',
      text: '',
      warn: '',
      steps: [],
      bar: null,
      start: a.season !== null && !a.run,
      abort: null,
    };
    const planSteps = (p: LeaguePlanSummary, first: boolean) => [
      { label: t('lgs.step.first'), date: this.date(p.first), now: first },
      {
        label: t('lgs.step.evenings', { n: p.evenings, p: p.perEvening }),
        date: t('lgs.until', { d: this.date(p.last) }),
        now: false,
      },
      { label: t('lgs.step.relegation'), date: this.date(p.relegation), now: false },
      { label: t('lgs.step.final'), date: this.date(p.final), now: false },
    ];
    const nowLine = s.now
      ? t('lgs.st.nowText', { n: s.now.evenings, p: s.now.perEvening, d: this.date(s.now.final) })
      : a.season !== null && !a.run
        ? t('lgs.st.nowNone')
        : '';
    switch (s.state) {
      case 'running': {
        const p = s.progress!;
        return {
          ...base,
          tone: s.test ? 'gold' : 'accent',
          kicker: t(s.test ? 'lgs.st.testRunning' : 'lgs.st.running'),
          title: t('lgs.st.evening', {
            a: Math.min(p.evenings + 1, p.eveningsTotal),
            b: p.eveningsTotal,
          }),
          text: p.next
            ? t('lgs.st.next', {
                d: this.date(p.next.day),
                time: p.time,
                md: mdRange(p.next.matchdays),
              })
            : t('lgs.st.finale'),
          bar: {
            a: t('lgs.st.evenings', { a: p.evenings, b: p.eveningsTotal }),
            b: t('lgs.st.matchdays', { a: p.matchdays, b: p.matchdaysTotal }),
            pct: Math.round((100 * p.matchdays) / Math.max(1, p.matchdaysTotal)),
          },
          steps: [
            { label: t('lgs.step.relegation'), date: this.date(p.relegation), now: false },
            { label: t('lgs.step.final'), date: this.date(p.final), now: false },
          ],
          warn: s.test ? t(this.f.keepTestTiers ? 'lgs.st.testKeeps' : 'lgs.st.testNoKeep') : '',
          start: false,
          abort: p.abortable ? (s.test ? 'test' : 'real') : null,
        };
      }
      case 'done':
        return {
          ...base,
          tone: 'ok',
          kicker: t('lgs.st.done'),
          title: s.champion ? t('lgs.st.champion', { name: s.champion }) : t('lgs.st.doneTitle'),
          text: s.start
            ? t('lgs.st.nextStart', { s: s.start.season, d: this.date(s.start.day) })
            : '',
          start: false,
        };
      case 'off':
        return {
          ...base,
          kicker: t('lgs.st.off'),
          title: t('lgs.st.offTitle'),
          text: t('lgs.st.offText', { n: this.f.startDay }),
          warn: nowLine,
        };
      case 'waiting': {
        const st = s.start!;
        const days = this.daysUntil(st.day);
        return {
          ...base,
          tone: 'udt',
          kicker: t('lgs.st.waiting'),
          title: t('lgs.st.startsAt', {
            d: this.date(st.day),
            time: st.plan?.time ?? this.f.slotTime,
          }),
          text: t(days > 0 ? 'lgs.st.waitText' : 'lgs.st.waitToday', {
            s: st.season,
            n: this.f.startDay,
            days,
          }),
          steps: st.plan ? planSteps(st.plan, true) : [],
          warn: st.plan ? '' : t('lgs.st.noFit', { s: st.season }),
        };
      }
      default: {
        const st = s.start;
        return {
          ...base,
          tone: 'gold',
          kicker: t('lgs.st.nextSeason'),
          title: st ? t('lgs.st.inSeason', { s: st.season }) : t('lgs.st.nextSeasonTitle'),
          text: st
            ? t('lgs.st.nextText', { d: this.date(st.day), n: this.f.startDay })
            : t('lgs.st.noSeason', { n: this.f.startDay }),
          steps: st?.plan ? planSteps(st.plan, true) : [],
          warn: [st && !st.plan ? t('lgs.st.noFit', { s: st.season }) : '', nowLine]
            .filter(Boolean)
            .join(' '),
        };
      }
    }
  }

  private daysUntil(day: string): number {
    const today = this.admin()?.today ?? day;
    return Math.round((Date.parse(day) - Date.parse(today)) / DAY_MS);
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers for the template
  // ---------------------------------------------------------------------------------------------

  protected date(day: string | undefined): string {
    if (!day) return '';
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(
      this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB',
      { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' },
    );
  }

  protected tierName(t: number): string {
    return t === 0 ? 'Pro Series' : this.i18n.t('league.division', { n: t });
  }

  protected tierColor(t: number): string {
    return TIER_COLORS[t] ?? 'var(--text)';
  }

  protected tierNames(): string {
    return Array.from({ length: this.f.tiers }, (_, i) => this.tierName(i)).join(' · ');
  }

  protected skillAfter(loss: number): string {
    return this.i18n.t(SKILL_AFTER[loss] ?? 'skill.3');
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

  protected dec(n: number): string {
    const s = Number(n).toFixed(2);
    return this.i18n.lang() === 'de' ? s.replace('.', ',') : s;
  }

  protected clamp(n: number, lo: number, hi: number): number {
    return Math.min(hi, Math.max(lo, Math.round(Number(n) || 0)));
  }

  protected placesOf(g: number): string {
    return `${4 * g + 1}–${Math.min(this.f.size, 4 * g + 4)}`;
  }

  /** Table money of a band in a tier per week (index 1, rounded like the payment). */
  protected amount(g: number, t: number): string {
    const v = Math.round(((Number(this.money[g]) || 0) * (this.mult[t] ?? 1)) / 10) * 10;
    return v.toLocaleString(this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB');
  }

  protected nudge(list: number[], i: number, d: number) {
    list[i] = Math.min(5, Math.max(0, Math.round(((list[i] ?? 1) + d) * 100) / 100));
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
    this.shape.update((n) => n + 1);
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

  // ---------------------------------------------------------------------------------------------
  // Server and maps
  // ---------------------------------------------------------------------------------------------

  protected agentChanged() {
    this.agentSig.set(this.agentId);
    const a = this.agents().find((x) => x.id === this.agentId);
    this.profileId = a?.profiles[0]?.id ?? '';
    this.profileSig.set(this.profileId);
  }

  protected setOwnMaps(own: boolean) {
    this.ownMaps = own;
    // An own choice starts with the pool in use now.
    if (own && !this.f.mapPool.length) this.f.mapPool = [...(this.admin()?.mapPool ?? [])];
    this.poolRev.update((n) => n + 1);
  }

  protected toggleMap(m: string) {
    this.f.mapPool = this.f.mapPool.includes(m)
      ? this.f.mapPool.filter((x) => x !== m)
      : [...this.f.mapPool, m];
    this.poolRev.update((n) => n + 1);
  }

  /** All / none of the maps shown (the search narrows them); the rest of the pool stays. */
  protected allMaps(on: boolean) {
    const shown = this.shownMaps().map((m) => m.id);
    this.f.mapPool = on
      ? [...new Set([...this.f.mapPool, ...shown])]
      : this.f.mapPool.filter((id) => !shown.includes(id));
    this.poolRev.update((n) => n + 1);
  }

  protected addMap() {
    const id = this.newMap.trim();
    if (id && !this.f.mapPool.includes(id)) this.f.mapPool = [...this.f.mapPool, id];
    this.newMap = '';
    this.poolRev.update((n) => n + 1);
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

  // ---------------------------------------------------------------------------------------------
  // Start now, call off
  // ---------------------------------------------------------------------------------------------

  /** The first evening: today, tomorrow (default) or the day after. */
  protected readonly startDates = computed(() => {
    const today = this.admin()?.today ?? new Date().toISOString().slice(0, 10);
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    const de = this.i18n.lang() === 'de';
    const slotTime = this.udtSlot();
    return [0, 1, 2].map((i) => {
      const day = new Date(Date.UTC(y, m - 1, d + i));
      const name = day.toLocaleDateString(de ? 'de-DE' : 'en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        timeZone: 'UTC',
      });
      return {
        value: day.toISOString().slice(0, 10),
        label: `${this.i18n.t(`lgs.day.${i}`)}, ${name} · ${slotTime}`,
      };
    });
  });

  private readonly udtSlot = signal('18:00');

  protected openStart() {
    this.udtSlot.set(this.udt?.league.slotTime ?? '18:00');
    this.start = {
      mode: 'real',
      startDate: this.startDates()[1]!.value,
      placement: 'cup',
      tableMoney: true,
    };
    this.cdr.markForCheck();
    void this.loadFit();
    this.dlg().nativeElement.showModal();
  }

  protected async loadFit() {
    this.fitLoaded.set(false);
    try {
      this.fit.set((await this.api.udtLeagueFit(this.start.startDate)).plan);
    } catch {
      this.fit.set(null);
    } finally {
      this.fitLoaded.set(true);
    }
  }

  protected spare(p: LeaguePlanSummary): number {
    const a = this.admin();
    if (!a || a.daysLeft === null) return 0;
    return Math.max(
      0,
      a.daysLeft - Math.round((Date.parse(p.final) - Date.parse(a.today)) / DAY_MS),
    );
  }

  protected fitMinutes(p: LeaguePlanSummary): string {
    const per = this.est()?.realPerMatchday ?? 0;
    return this.duration(Math.round(per * p.perEvening * 4));
  }

  protected async startLeague() {
    this.busy.set(true);
    try {
      const { mode, ...body } = this.start;
      this.admin.set(
        mode === 'real' ? await this.api.udtLeagueStart(body) : await this.api.udtLeagueTest(body),
      );
      this.dlg().nativeElement.close();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }

  protected async abort(kind: 'test' | 'real') {
    if (!confirm(this.i18n.t(kind === 'test' ? 'lgs.testAbortConfirm' : 'lgs.abortConfirm')))
      return;
    this.busy.set(true);
    try {
      this.admin.set(await this.api.udtLeagueTestAbort());
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------------------------

  /** Back to the saved settings (the tab is not marked as unsaved any more). */
  protected async discard() {
    await this.load();
    this.saved.emit('league');
  }

  protected async save() {
    if (!this.udt) return;
    // An empty or wrong number is refused (not saved as 0 or the minimum).
    const f = this.f;
    const numbers: [string, unknown, number, number][] = [
      ['lgs.fragLimit', f.fragLimit, 5, 200],
      ['lgs.timeLimit', f.timeLimitMin, 5, 60],
      ...this.money.map((v): [string, unknown, number, number] => [
        'lgs.tableMoneyShort',
        v,
        0,
        100_000,
      ]),
      ...this.cup.map((v): [string, unknown, number, number] => [
        'lgs.cupBonusShort',
        v,
        0,
        100_000,
      ]),
    ];
    for (const [label, v, lo, hi] of numbers)
      if (
        v === null ||
        v === undefined ||
        String(v) === '' ||
        !(Number(v) >= lo && Number(v) <= hi)
      ) {
        this.toasts.error(this.i18n.t('lgs.badNumber', { field: this.i18n.t(label), lo, hi }));
        return;
      }
    if (this.agentId && !this.profileId) {
      this.toasts.error(this.i18n.t('lgs.needProfile'));
      return;
    }
    const n = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number(v) || 0));
    this.busy.set(true);
    try {
      const s = await this.api.setUdtSettings({
        league: {
          ...this.f,
          tiers: Number(this.f.tiers),
          size: Number(this.f.size),
          fragLimit: Math.round(n(this.f.fragLimit, 5, 200)),
          timeLimitMin: Math.round(n(this.f.timeLimitMin, 5, 60)),
          betBots: Math.round(n(this.f.betBots, 0, 50)),
          joinUntil: Math.round(n(this.f.joinUntil, 0, 30)),
          agentId: this.agentId && this.profileId ? this.agentId : null,
          profileId: this.agentId && this.profileId ? this.profileId : null,
          mapPool: this.ownMaps ? this.f.mapPool : [],
          tableMoney: this.money.map((v) => Math.round(n(v, 0, 100_000))),
          tierMult: this.mult.map((v) => n(v, 0, 5)),
          factors: this.factors.map((v) => n(v, 0, 5)),
        },
        keepers: { ...this.udt.keepers, max: this.keepMax, skillLoss: this.keepLoss },
        cupBonus: this.cup.map((v) => Math.round(n(v, 0, 100_000))),
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

const DEFAULT_MONEY = [1200, 700, 400, 200];
const DEFAULT_MULT = [1.4, 1, 0.7, 0.5];

/** "12–13" (or "12" for one matchday). */
function mdRange(mds: readonly number[]): string {
  return mds.length > 1 ? `${mds[0]}–${mds.at(-1)}` : String(mds[0] ?? '');
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
    tableMoney: [...DEFAULT_MONEY],
    tierMult: [...DEFAULT_MULT],
    betBots: 10,
    joinUntil: 20,
    keepTestTiers: false,
  };
}
