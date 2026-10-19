import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Icon } from '../core/brand';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { assetLabel, COMBAT_STYLES, combatStyleKey, skinPackage } from '../core/bots';
import { I18n, TPipe } from '../core/i18n';
import {
  BOT_LINE_KINDS,
  type AgentView,
  type BotAssets,
  type BotClan,
  type BotLineKind,
  type BotRival,
  type LibraryBot,
  type PublicUser,
} from '../core/types';

type Tab = 'bots' | 'clans' | 'teams';

/** Editor state of a bot (new or existing). */
interface Draft {
  id: string | null;
  name: string;
  clanId: string | null;
  skill: number;
  botClass: string;
  skin: string;
  face: string;
  voice: string;
  favoriteWeapon: string;
  accuracy: number;
  alertness: number;
  combatStyle: number;
  camping: number;
  strafing: number;
  jumpy: boolean;
  talk: number;
  lines: Record<BotLineKind, string[]>;
  rivals: BotRival[];
  bio: string;
  color: string;
  active: boolean;
}

interface ClanDraft {
  id: string | null;
  name: string;
  tag: string;
  color: string;
  description: string;
}

/** UT cuts player names to 24 characters; clan tag + name must fit. */
const GAME_NAME_CHARS = 24;

const emptyLines = () =>
  Object.fromEntries(BOT_LINE_KINDS.map((k) => [k, [] as string[]])) as Record<
    BotLineKind,
    string[]
  >;

/** Bot control center (admins): the website's bots, clans and team names. */
@Component({
  selector: 'app-bots',
  imports: [TPipe, FormsModule, RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ 'bots.title' | t }}</h1>
    <p class="muted small">{{ 'bots.intro' | t }}</p>
    <div class="tabs">
      <button [class.active]="tab() === 'bots'" (click)="tab.set('bots')">
        {{ 'bots.tab.bots' | t: { n: bots().length } }}
      </button>
      <button [class.active]="tab() === 'clans'" (click)="tab.set('clans')">
        {{ 'bots.tab.clans' | t: { n: clans().length } }}
      </button>
      <button [class.active]="tab() === 'teams'" (click)="tab.set('teams')">
        {{ 'bots.tab.teams' | t }}
      </button>
    </div>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (notice()) {
      <p class="notice">{{ notice() }}</p>
    }

    @switch (tab()) {
      @case ('bots') {
        @if (draft(); as d) {
          <form class="card editor" (ngSubmit)="saveBot(d)">
            <div class="spread">
              <h2>
                {{ (d.id ? 'bots.edit' : 'bots.new') | t }}
                <span class="mono game-name" [class.too-long]="gameName(d).length > maxName">{{
                  gameName(d)
                }}</span>
              </h2>
              <span class="muted small"
                >{{ gameName(d).length }}/{{ maxName }} {{ 'bots.chars' | t }}</span
              >
            </div>

            <fieldset>
              <legend>{{ 'bots.sec.basics' | t }}</legend>
              <div class="fields">
                <div class="field">
                  <label for="bn">{{ 'bots.name' | t }}</label>
                  <input id="bn" name="name" [(ngModel)]="d.name" maxlength="20" required />
                </div>
                <div class="field">
                  <label for="bc">{{ 'bots.clan' | t }}</label>
                  <select id="bc" name="clan" [(ngModel)]="d.clanId">
                    <option [ngValue]="null">{{ 'bots.noClan' | t }}</option>
                    @for (c of clans(); track c.id) {
                      <option [ngValue]="c.id">{{ c.tag }} {{ c.name }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label for="bs">{{ 'bots.skill' | t }}</label>
                  <select id="bs" name="skill" [(ngModel)]="d.skill">
                    @for (s of skills; track s) {
                      <option [ngValue]="s">{{ s }} – {{ 'skill.' + s | t }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label for="bcol">{{ 'bots.color' | t }}</label>
                  <input id="bcol" type="color" name="color" [(ngModel)]="d.color" />
                </div>
              </div>
              <label class="row"
                ><input type="checkbox" name="active" [(ngModel)]="d.active" />
                {{ 'bots.activeLabel' | t }}</label
              >
              <p class="muted small">{{ 'bots.activeHint' | t }}</p>
              <div class="field">
                <label for="bbio">{{ 'bots.bio' | t }}</label>
                <textarea
                  id="bbio"
                  name="bio"
                  rows="2"
                  maxlength="1000"
                  [(ngModel)]="d.bio"
                ></textarea>
              </div>
            </fieldset>

            <fieldset>
              <legend>{{ 'bots.sec.look' | t }}</legend>
              <div class="fields">
                <div class="field">
                  <label for="bcls">{{ 'bots.class' | t }}</label>
                  <input
                    id="bcls"
                    name="cls"
                    list="bcls-list"
                    [placeholder]="'bots.default' | t"
                    [ngModel]="d.botClass"
                    (change)="setClass(d, $any($event.target).value.trim())"
                  />
                  <datalist id="bcls-list">
                    @for (c of withCurrent(assets()?.botClasses, d.botClass); track c.name) {
                      <option [value]="c.name">{{ c.label }}</option>
                    }
                  </datalist>
                </div>
                <div class="field">
                  <label for="bskin">{{ 'bots.skin' | t }}</label>
                  <input
                    id="bskin"
                    name="skin"
                    list="bskin-list"
                    [placeholder]="'bots.default' | t"
                    [(ngModel)]="d.skin"
                  />
                  <datalist id="bskin-list">
                    @for (s of skinsFor(d); track s.name) {
                      <option [value]="s.name">{{ s.label }}</option>
                    }
                  </datalist>
                </div>
                <div class="field">
                  <label for="bface">{{ 'bots.face' | t }}</label>
                  <input
                    id="bface"
                    name="face"
                    list="bface-list"
                    [placeholder]="'bots.default' | t"
                    [(ngModel)]="d.face"
                  />
                  <datalist id="bface-list">
                    @for (f of facesFor(d); track f.name) {
                      <option [value]="f.name">{{ f.label }}</option>
                    }
                  </datalist>
                </div>
                <div class="field">
                  <label for="bvoice">{{ 'bots.voice' | t }}</label>
                  <select id="bvoice" name="voice" [(ngModel)]="d.voice">
                    <option value="">{{ 'bots.default' | t }}</option>
                    @for (v of withCurrent(assets()?.voices, d.voice); track v.name) {
                      <option [value]="v.name">{{ v.label }}</option>
                    }
                  </select>
                </div>
              </div>
              <p class="muted small">{{ 'bots.lookHint' | t }}</p>
            </fieldset>

            <fieldset>
              <legend>{{ 'bots.sec.style' | t }}</legend>
              <div class="fields">
                <div class="field">
                  <label for="bfw">{{ 'bots.weapon' | t }}</label>
                  <select id="bfw" name="fw" [(ngModel)]="d.favoriteWeapon">
                    <option value="">{{ 'bots.none' | t }}</option>
                    @for (w of withCurrent(assets()?.weapons, d.favoriteWeapon); track w.name) {
                      <option [value]="w.name">{{ w.label }}</option>
                    }
                  </select>
                </div>
                <div class="field">
                  <label for="bcs">{{ 'bots.combatStyle' | t }}</label>
                  <select id="bcs" name="cs" [(ngModel)]="d.combatStyle">
                    @for (s of styles; track s.value) {
                      <option [ngValue]="s.value">{{ s.key | t }}</option>
                    }
                  </select>
                </div>
              </div>
              <div class="sliders">
                @for (t of traitRows; track t.key) {
                  <label class="slider"
                    ><span>{{ 'bots.trait.' + t.key | t }}</span>
                    <input
                      type="range"
                      [name]="t.key"
                      [min]="t.min"
                      max="1"
                      step="0.05"
                      [ngModel]="trait(d, t.key)"
                      (ngModelChange)="setTrait(d, t.key, $event)"
                    />
                    <span class="mono val">{{
                      t.min < 0 ? signed(trait(d, t.key)) : trait(d, t.key).toFixed(2)
                    }}</span>
                  </label>
                }
              </div>
              <label class="row"
                ><input type="checkbox" name="jumpy" [(ngModel)]="d.jumpy" />
                {{ 'bots.jumpy' | t }}</label
              >
              <p class="muted small">{{ 'bots.styleHint' | t }}</p>
            </fieldset>

            <fieldset>
              <legend>{{ 'bots.sec.personality' | t }}</legend>
              <label class="slider"
                ><span>{{ 'bots.talk' | t }}</span>
                <input type="range" name="talk" min="0" max="100" step="5" [(ngModel)]="d.talk" />
                <span class="mono val">{{ d.talk }} %</span>
              </label>
              <p class="muted small">{{ 'bots.linesHint' | t }}</p>
              @for (k of kinds; track k) {
                <div class="kind">
                  <div class="spread">
                    <b>{{ 'bots.kind.' + k | t }}</b>
                    <button type="button" class="link" (click)="d.lines[k].push('')">
                      + {{ 'bots.addLine' | t }}
                    </button>
                  </div>
                  @for (l of d.lines[k]; track $index) {
                    <div class="row line">
                      <input
                        [name]="k + $index"
                        [(ngModel)]="d.lines[k][$index]"
                        maxlength="120"
                        [placeholder]="'bots.linePlaceholder.' + k | t"
                      />
                      <button type="button" class="link" (click)="d.lines[k].splice($index, 1)">
                        ✕
                      </button>
                    </div>
                  }
                </div>
              }
              <p class="muted small">{{ lineCount(d) }}/64 {{ 'bots.linesCount' | t }}</p>
            </fieldset>

            <fieldset>
              <legend>{{ 'bots.sec.rivals' | t }}</legend>
              <p class="muted small">{{ 'bots.rivalsHint' | t }}</p>
              @for (r of d.rivals; track $index) {
                <div class="row line">
                  <span class="grow">{{ rivalName(r) }}</span>
                  <select [name]="'rl' + $index" [(ngModel)]="r.level" class="auto">
                    <option value="rival">{{ 'bots.rival' | t }}</option>
                    <option value="nemesis">{{ 'bots.nemesis' | t }}</option>
                  </select>
                  <button
                    type="button"
                    class="icon"
                    (click)="d.rivals.splice($index, 1)"
                    [title]="'common.remove' | t"
                    [attr.aria-label]="'common.remove' | t"
                  >
                    <na-icon name="close" [size]="15" />
                  </button>
                </div>
              }
              @if (d.rivals.length < 16) {
                <div class="row add-rival">
                  <select name="newRival" [(ngModel)]="newRival" class="grow-select">
                    <option value="">{{ 'bots.pickRival' | t }}</option>
                    <optgroup [label]="'bots.players' | t">
                      @for (u of users(); track u.id) {
                        @if (!hasRival(d, 'user', u.id)) {
                          <option [value]="'user:' + u.id">{{ u.displayName }}</option>
                        }
                      }
                    </optgroup>
                    <optgroup [label]="'bots.tab.bots' | t: { n: bots().length }">
                      @for (b of bots(); track b.id) {
                        @if (b.id !== d.id && !hasRival(d, 'bot', b.id)) {
                          <option [value]="'bot:' + b.id">{{ b.gameName }}</option>
                        }
                      }
                    </optgroup>
                  </select>
                  <button type="button" (click)="addRival(d)" [disabled]="!newRival">
                    {{ 'bots.addRival' | t }}
                  </button>
                </div>
              }
            </fieldset>

            <div class="row">
              <button type="submit" class="primary" [disabled]="busy() || !d.name.trim()">
                {{ 'common.save' | t }}
              </button>
              <button type="button" (click)="draft.set(null)">{{ 'common.cancel' | t }}</button>
            </div>
          </form>
        } @else {
          <div class="card">
            <div class="row toolbar">
              <input
                class="search"
                type="search"
                [placeholder]="'bots.search' | t"
                [ngModel]="query()"
                (ngModelChange)="query.set($event)"
                name="q"
              />
              <select
                class="auto"
                [ngModel]="status()"
                (ngModelChange)="status.set($event)"
                name="st"
              >
                <option value="all">{{ 'bots.filter.all' | t }}</option>
                <option value="active">{{ 'bots.filter.active' | t }}</option>
                <option value="retired">{{ 'bots.filter.retired' | t }}</option>
              </select>
              <select
                class="auto"
                [ngModel]="clanFilter()"
                (ngModelChange)="clanFilter.set($event)"
                name="cf"
              >
                <option value="">{{ 'bots.filter.anyClan' | t }}</option>
                <option value="-">{{ 'bots.noClan' | t }}</option>
                @for (c of clans(); track c.id) {
                  <option [value]="c.id">{{ c.tag }} {{ c.name }}</option>
                }
              </select>
              <span class="grow"></span>
              <button class="primary" (click)="newBot()">{{ 'bots.new' | t }}</button>
              <button (click)="panel.set(panel() === 'random' ? null : 'random')">
                {{ 'bots.random' | t }}
              </button>
              <button (click)="panel.set(panel() === 'import' ? null : 'import')">
                {{ 'bots.import' | t }}
              </button>
            </div>

            @if (panel() === 'random') {
              <form class="row sub" (ngSubmit)="random()">
                <label
                  >{{ 'bots.count' | t }}
                  <input
                    type="number"
                    name="rc"
                    min="1"
                    max="50"
                    [(ngModel)]="randomCount"
                    class="narrow"
                  />
                </label>
                <label
                  >{{ 'bots.clan' | t }}
                  <select name="rcl" [(ngModel)]="randomClan">
                    <option value="">{{ 'bots.noClan' | t }}</option>
                    @for (c of clans(); track c.id) {
                      <option [value]="c.id">{{ c.tag }} {{ c.name }}</option>
                    }
                  </select>
                </label>
                <label
                  >{{ 'bots.skill' | t }}
                  <select name="rsk" [(ngModel)]="randomSkill">
                    @for (s of skills; track s) {
                      <option [ngValue]="s">{{ s }} – {{ 'skill.' + s | t }}</option>
                    }
                  </select>
                </label>
                <button type="submit" class="primary" [disabled]="busy()">
                  {{ 'bots.create' | t }}
                </button>
                <p class="muted small full">{{ 'bots.randomHint' | t }}</p>
              </form>
            }
            @if (panel() === 'import') {
              <form class="row sub" (ngSubmit)="importBots()">
                <label
                  >{{ 'bots.server' | t }}
                  <select name="srv" [(ngModel)]="importFrom">
                    @for (a of agents(); track a.id) {
                      @for (p of a.profiles; track p.id) {
                        <option [value]="a.id + '/' + p.id">
                          {{ a.name }} – {{ p.name || p.id }} ({{ p.inventory?.bots?.length ?? 0 }})
                        </option>
                      }
                    }
                  </select>
                </label>
                <button type="submit" class="primary" [disabled]="busy() || !importFrom">
                  {{ 'bots.importNow' | t }}
                </button>
                <p class="muted small full">{{ 'bots.importHint' | t }}</p>
              </form>
            }

            @if (filtered().length) {
              <div class="scroll">
                <table class="botlist">
                  <thead>
                    <tr>
                      <th>{{ 'bots.name' | t }}</th>
                      <th>{{ 'bots.skill' | t }}</th>
                      <th class="wide">{{ 'bots.combatStyle' | t }}</th>
                      <th class="acts">
                        <span class="sr">{{ 'bots.actions' | t }}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (b of filtered(); track b.id) {
                      <tr [class.retired]="!b.active">
                        <td>
                          <div class="bname">
                            @if (b.color) {
                              <span class="swatch" [style.background]="b.color"></span>
                            }
                            <a [routerLink]="['/bots', b.id]">{{ b.gameName }}</a>
                            @if (!b.active) {
                              <span class="badge">{{ 'bots.retired' | t }}</span>
                            }
                          </div>
                          <div class="muted small sub">
                            @if (b.clanId) {
                              {{ clanName(b.clanId) }} ·
                            }
                            {{
                              'bots.summary'
                                | t
                                  : {
                                      talk: b.personality.talk,
                                      lines: b.personality.lines.length,
                                      rivals: b.personality.rivals.length,
                                    }
                            }}
                          </div>
                        </td>
                        <td class="nowrap">
                          <span class="mono">{{ b.skill }}</span>
                          <span class="muted small skn"> {{ 'skill.' + b.skill | t }}</span>
                        </td>
                        <td class="wide">
                          {{ styleKey(b.traits.combatStyle) | t }}
                          <div class="muted small">
                            {{ label(assets()?.botClasses, b.botClass) || ('bots.default' | t) }}
                          </div>
                        </td>
                        <td class="acts">
                          <div class="iconbtns">
                            <button
                              class="icon"
                              (click)="edit(b)"
                              [title]="'common.edit' | t"
                              [attr.aria-label]="('common.edit' | t) + ' ' + b.gameName"
                            >
                              <na-icon name="edit" />
                            </button>
                            <button
                              class="icon"
                              (click)="toggleActive(b)"
                              [disabled]="busy()"
                              [title]="(b.active ? 'bots.retire' : 'bots.activate') | t"
                              [attr.aria-label]="
                                ((b.active ? 'bots.retire' : 'bots.activate') | t) +
                                ' ' +
                                b.gameName
                              "
                            >
                              <na-icon [name]="b.active ? 'pause' : 'play'" />
                            </button>
                            <button
                              class="icon dng"
                              (click)="removeBot(b)"
                              [disabled]="busy()"
                              [title]="'common.delete' | t"
                              [attr.aria-label]="('common.delete' | t) + ' ' + b.gameName"
                            >
                              <na-icon name="delete" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="muted">{{ (bots().length ? 'bots.noMatch' : 'bots.empty') | t }}</p>
            }
          </div>
        }
      }

      @case ('clans') {
        <div class="card">
          @if (clans().length) {
            <div class="scroll">
              <table>
                <thead>
                  <tr>
                    <th>{{ 'bots.clanTag' | t }}</th>
                    <th>{{ 'bots.clanName' | t }}</th>
                    <th>{{ 'bots.members' | t }}</th>
                    <th>{{ 'bots.description' | t }}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of clans(); track c.id) {
                    <tr>
                      <td class="mono">
                        @if (c.color) {
                          <span class="swatch" [style.background]="c.color"></span>
                        }
                        {{ c.tag }}
                      </td>
                      <td>{{ c.name }}</td>
                      <td>{{ members(c.id) }}</td>
                      <td class="muted small">{{ c.description }}</td>
                      <td class="actions">
                        <div class="iconbtns">
                          <button
                            class="icon"
                            (click)="editClan(c)"
                            [title]="'common.edit' | t"
                            [attr.aria-label]="('common.edit' | t) + ' ' + c.name"
                          >
                            <na-icon name="edit" />
                          </button>
                          <button
                            class="icon dng"
                            (click)="removeClan(c)"
                            [disabled]="busy()"
                            [title]="'common.delete' | t"
                            [attr.aria-label]="('common.delete' | t) + ' ' + c.name"
                          >
                            <na-icon name="delete" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="muted">{{ 'bots.noClans' | t }}</p>
          }
        </div>
        <form class="card clan-form" (ngSubmit)="saveClan()">
          <h2>{{ (clanDraft.id ? 'bots.editClan' : 'bots.newClan') | t }}</h2>
          <div class="fields">
            <div class="field">
              <label for="cn">{{ 'bots.clanName' | t }}</label>
              <input id="cn" name="cn" [(ngModel)]="clanDraft.name" maxlength="40" required />
            </div>
            <div class="field">
              <label for="ct">{{ 'bots.clanTag' | t }}</label>
              <input
                id="ct"
                name="ct"
                [(ngModel)]="clanDraft.tag"
                maxlength="8"
                required
                placeholder="[TC]"
              />
            </div>
            <div class="field">
              <label for="cc">{{ 'bots.color' | t }}</label>
              <input id="cc" type="color" name="cc" [(ngModel)]="clanDraft.color" />
            </div>
          </div>
          <div class="field">
            <label for="cd">{{ 'bots.description' | t }}</label>
            <textarea
              id="cd"
              name="cd"
              rows="2"
              maxlength="500"
              [(ngModel)]="clanDraft.description"
            ></textarea>
          </div>
          <p class="muted small">{{ 'bots.clanHint' | t }}</p>
          <div class="row">
            <button
              type="submit"
              class="primary"
              [disabled]="busy() || !clanDraft.name.trim() || !clanDraft.tag.trim()"
            >
              {{ (clanDraft.id ? 'common.save' : 'bots.create') | t }}
            </button>
            @if (clanDraft.id) {
              <button type="button" (click)="resetClan()">{{ 'common.cancel' | t }}</button>
            }
          </div>
        </form>
      }

      @case ('teams') {
        <form class="card" (ngSubmit)="saveTeamNames()">
          <h2>{{ 'bots.teamNames' | t }}</h2>
          <p class="muted small">{{ 'bots.teamNamesHint' | t }}</p>
          <textarea name="tn" rows="12" [(ngModel)]="teamNames"></textarea>
          <div class="row">
            <button type="submit" class="primary" [disabled]="busy()">
              {{ 'common.save' | t }}
            </button>
            @if (savedTeams()) {
              <span class="muted small">{{ 'settings.saved' | t }}</span>
            }
          </div>
        </form>
      }
    }
  `,
  styles: `
    table.botlist td {
      vertical-align: middle;
    }
    .bname {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
    }
    .sub {
      margin-top: 2px;
      white-space: normal;
    }
    .nowrap {
      white-space: nowrap;
    }
    th.acts,
    td.acts {
      width: 1%;
      text-align: right;
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
    @media (max-width: 640px) {
      .wide,
      .skn {
        display: none;
      }
      button.icon {
        width: 32px;
      }
    }
    .toolbar {
      margin-bottom: 12px;
    }
    .search {
      max-width: 260px;
    }
    select.auto,
    .auto {
      width: auto;
    }
    .grow {
      flex: 1;
    }
    .grow-select {
      flex: 1;
      min-width: 0;
      width: auto;
    }
    form.sub {
      align-items: flex-end;
      gap: 12px;
      padding: 12px 0;
      border-top: 1px solid var(--border);
      margin-bottom: 12px;
    }
    form.sub label {
      margin: 0;
    }
    form.sub select,
    form.sub input {
      display: block;
      margin-top: 4px;
    }
    .full {
      flex-basis: 100%;
      margin: 0;
    }
    input.narrow {
      width: 90px;
    }
    .scroll {
      overflow-x: auto;
    }
    table {
      white-space: nowrap;
    }
    tr.retired td {
      opacity: 0.6;
    }
    .actions {
      display: flex;
      gap: 4px;
      justify-content: flex-end;
    }
    .actions button {
      padding: 3px 9px;
      font-size: 0.85rem;
    }
    .swatch {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 3px;
      margin-right: 6px;
      vertical-align: middle;
    }
    .badge {
      margin-left: 6px;
    }
    .editor h2 {
      margin: 0 0 12px;
    }
    .game-name {
      margin-left: 8px;
      color: var(--accent);
    }
    .game-name.too-long {
      color: var(--danger);
    }
    input[type='color'] {
      height: 36px;
      padding: 2px;
    }
    .sliders {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 4px 16px;
      margin-bottom: 8px;
    }
    label.slider {
      display: grid;
      grid-template-columns: 110px 1fr 48px;
      align-items: center;
      gap: 8px;
      margin: 4px 0;
    }
    label.slider input {
      padding: 0;
    }
    .val {
      text-align: right;
    }
    .kind {
      margin: 10px 0;
    }
    .line {
      margin: 4px 0;
      flex-wrap: nowrap;
    }
    .add-rival {
      margin-top: 8px;
    }
    .clan-form {
      max-width: 820px;
    }
  `,
})
export class BotsPage {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  private readonly route = inject(ActivatedRoute);

  protected readonly tab = signal<Tab>('bots');
  protected readonly bots = signal<LibraryBot[]>([]);
  protected readonly clans = signal<BotClan[]>([]);
  protected readonly assets = signal<BotAssets | null>(null);
  protected readonly users = signal<PublicUser[]>([]);
  protected readonly agents = signal<AgentView[]>([]);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly panel = signal<'random' | 'import' | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly savedTeams = signal(false);
  protected readonly query = signal('');
  protected readonly status = signal<'all' | 'active' | 'retired'>('all');
  protected readonly clanFilter = signal('');

  protected readonly skills = [0, 1, 2, 3, 4, 5, 6, 7];
  protected readonly styles = COMBAT_STYLES;
  protected readonly kinds = BOT_LINE_KINDS;
  protected readonly maxName = GAME_NAME_CHARS;
  protected readonly traitRows: { key: TraitKey; min: number }[] = [
    { key: 'accuracy', min: -1 },
    { key: 'alertness', min: -1 },
    { key: 'strafing', min: -1 },
    { key: 'camping', min: 0 },
  ];
  protected readonly label = assetLabel;
  protected readonly styleKey = combatStyleKey;

  protected newRival = '';
  protected randomCount = 5;
  protected randomClan = '';
  protected randomSkill = 4;
  protected importFrom = '';
  protected teamNames = '';
  protected clanDraft: ClanDraft = emptyClan();

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const st = this.status();
    const cf = this.clanFilter();
    return this.bots()
      .filter((b) => (st === 'all' ? true : st === 'active' ? b.active : !b.active))
      .filter((b) => (!cf ? true : cf === '-' ? !b.clanId : b.clanId === cf))
      .filter(
        (b) =>
          !q ||
          b.gameName.toLowerCase().includes(q) ||
          (b.bio ?? '').toLowerCase().includes(q) ||
          this.clanName(b.clanId).toLowerCase().includes(q),
      );
  });

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      const [list, settings] = await Promise.all([this.api.bots(), this.api.settings()]);
      this.bots.set(list.bots);
      this.clans.set(list.clans);
      this.teamNames = settings.teamNames.join('\n');
      // From a bot profile: "edit in the control center".
      const edit = list.bots.find((b) => b.id === this.route.snapshot.queryParamMap.get('edit'));
      if (edit) this.edit(edit);
      // Not needed for the list: load after it.
      const [assets, users, agents] = await Promise.all([
        this.api.botAssets(),
        this.api.users(),
        this.api.agents(),
      ]);
      this.assets.set(assets);
      this.users.set(users);
      this.agents.set(agents);
      const first = agents.find((a) => a.profiles.length);
      if (first && !this.importFrom) this.importFrom = `${first.id}/${first.profiles[0]!.id}`;
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  private async reload() {
    const list = await this.api.bots();
    this.bots.set(list.bots);
    this.clans.set(list.clans);
  }

  private async run(fn: () => Promise<unknown>) {
    this.busy.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      await fn();
      await this.reload();
      return true;
    } catch (e) {
      this.error.set(errorText(e));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  // --- list ---------------------------------------------------------------------------------

  protected clanName(id: string | null): string {
    if (!id) return '';
    const c = this.clans().find((x) => x.id === id);
    return c ? `${c.tag} ${c.name}` : '';
  }

  protected members(clanId: string): number {
    return this.bots().filter((b) => b.clanId === clanId).length;
  }

  protected toggleActive(b: LibraryBot) {
    void this.run(() => this.api.updateBot(b.id, { active: !b.active }));
  }

  protected removeBot(b: LibraryBot) {
    if (!confirm(this.i18n.t('bots.deleteConfirm', { name: b.gameName }))) return;
    void this.run(() => this.api.deleteBot(b.id));
  }

  protected random() {
    void this.run(async () => {
      const made = await this.api.randomBots({
        count: Math.max(1, Math.min(50, Math.round(Number(this.randomCount) || 1))),
        skill: this.randomSkill,
        ...(this.randomClan ? { clanId: this.randomClan } : {}),
      });
      this.notice.set(this.i18n.t('bots.randomDone', { n: made.length }));
      this.panel.set(null);
    });
  }

  protected importBots() {
    const [agentId, profileId] = this.importFrom.split('/');
    if (!agentId) return;
    void this.run(async () => {
      const r = await this.api.importBots(agentId, profileId);
      this.notice.set(
        this.i18n.t('bots.importDone', { n: r.created.length, skipped: r.skipped.length }),
      );
      this.panel.set(null);
    });
  }

  // --- editor -------------------------------------------------------------------------------

  protected newBot() {
    this.newRival = '';
    this.draft.set({
      id: null,
      name: '',
      clanId: null,
      skill: 4,
      botClass: '',
      skin: '',
      face: '',
      voice: '',
      favoriteWeapon: '',
      accuracy: 0,
      alertness: 0,
      combatStyle: 0,
      camping: 0,
      strafing: 0,
      jumpy: false,
      talk: 30,
      lines: emptyLines(),
      rivals: [],
      bio: '',
      color: '#f0a020',
      active: true,
    });
  }

  protected edit(b: LibraryBot) {
    const lines = emptyLines();
    for (const l of b.personality.lines) lines[l.kind].push(l.text);
    this.newRival = '';
    this.draft.set({
      id: b.id,
      name: b.name,
      clanId: b.clanId,
      skill: b.skill,
      botClass: b.botClass ?? '',
      skin: b.skin ?? '',
      face: b.face ?? '',
      voice: b.traits.voice ?? '',
      favoriteWeapon: b.traits.favoriteWeapon ?? '',
      accuracy: b.traits.accuracy ?? 0,
      alertness: b.traits.alertness ?? 0,
      combatStyle: COMBAT_STYLES.find((s) => s.value === b.traits.combatStyle)?.value ?? 0,
      camping: b.traits.camping ?? 0,
      strafing: b.traits.strafing ?? 0,
      jumpy: !!b.traits.jumpy,
      talk: b.personality.talk,
      lines,
      rivals: b.personality.rivals.map((r) => ({ ...r })),
      bio: b.bio ?? '',
      color: b.color ?? '#f0a020',
      active: b.active,
    });
  }

  protected gameName(d: Draft): string {
    const tag = d.clanId ? (this.clans().find((c) => c.id === d.clanId)?.tag ?? '') : '';
    return tag + d.name.trim();
  }

  /** The list plus the current value if the list does not have it (e.g. typed on a server). */
  protected withCurrent(list: readonly { name: string; label: string }[] | undefined, cur: string) {
    const l = [...(list ?? [])];
    if (cur && !l.some((x) => x.name.toLowerCase() === cur.toLowerCase()))
      l.push({ name: cur, label: cur.split('.').pop() ?? cur });
    return l;
  }

  protected setClass(d: Draft, cls: string) {
    d.botClass = cls;
    // Another body: skin and face of the old one do not fit.
    const pkg = skinPackage(this.assets(), { botClass: cls, skin: null });
    if (pkg && d.skin && !d.skin.toLowerCase().startsWith(pkg.toLowerCase() + '.')) {
      d.skin = this.skinsFor(d)[0]?.name ?? '';
      d.face = '';
    }
  }

  protected skinsFor(d: Draft) {
    const pkg = skinPackage(this.assets(), { botClass: d.botClass || null, skin: null });
    const all = this.assets()?.skins ?? [];
    const list = pkg
      ? all.filter((s) => s.name.toLowerCase().startsWith(pkg.toLowerCase() + '.'))
      : all;
    return this.withCurrent(list.length ? list : all, d.skin);
  }

  protected facesFor(d: Draft) {
    const pkg = (d.skin.split('.')[0] ?? '').toLowerCase();
    const all = this.assets()?.faces ?? [];
    const list = pkg ? all.filter((f) => f.pkg.toLowerCase() === pkg) : [];
    return this.withCurrent(list, d.face);
  }

  protected trait(d: Draft, k: TraitKey): number {
    return d[k];
  }

  protected setTrait(d: Draft, k: TraitKey, v: number | string) {
    d[k] = Number(v);
  }

  protected signed(v: number): string {
    return (v > 0 ? '+' : '') + v.toFixed(2);
  }

  protected lineCount(d: Draft): number {
    return BOT_LINE_KINDS.reduce((n, k) => n + d.lines[k].filter((l) => l.trim()).length, 0);
  }

  protected hasRival(d: Draft, kind: 'user' | 'bot', id: string): boolean {
    return d.rivals.some((r) => r.kind === kind && r.id === id);
  }

  protected rivalName(r: BotRival): string {
    if (r.kind === 'user') return this.users().find((u) => u.id === r.id)?.displayName ?? r.id;
    return this.bots().find((b) => b.id === r.id)?.gameName ?? r.id;
  }

  protected addRival(d: Draft) {
    const [kind, id] = this.newRival.split(':') as ['user' | 'bot', string];
    if (!id || this.hasRival(d, kind, id)) return;
    d.rivals.push({ kind, id, level: 'rival' });
    this.newRival = '';
  }

  protected async saveBot(d: Draft) {
    const body = {
      name: d.name.trim(),
      clanId: d.clanId,
      skill: d.skill,
      botClass: d.botClass,
      skin: d.skin,
      face: d.face,
      traits: {
        accuracy: d.accuracy,
        alertness: d.alertness,
        combatStyle: d.combatStyle,
        camping: d.camping,
        strafing: d.strafing,
        jumpy: d.jumpy,
        ...(d.favoriteWeapon ? { favoriteWeapon: d.favoriteWeapon } : {}),
        ...(d.voice ? { voice: d.voice } : {}),
      },
      personality: {
        talk: Math.round(Number(d.talk)),
        lines: BOT_LINE_KINDS.flatMap((kind) =>
          d.lines[kind]
            .map((text) => text.trim())
            .filter(Boolean)
            .map((text) => ({ kind, text })),
        ),
        rivals: d.rivals,
      },
      bio: d.bio.trim() || null,
      color: d.color || null,
      active: d.active,
    };
    const ok = await this.run(() =>
      d.id ? this.api.updateBot(d.id, body) : this.api.createBot(body),
    );
    if (ok) this.draft.set(null);
  }

  // --- clans --------------------------------------------------------------------------------

  protected editClan(c: BotClan) {
    this.clanDraft = {
      id: c.id,
      name: c.name,
      tag: c.tag,
      color: c.color ?? '#58a6ff',
      description: c.description ?? '',
    };
  }

  protected resetClan() {
    this.clanDraft = emptyClan();
  }

  protected async saveClan() {
    const c = this.clanDraft;
    const body = {
      name: c.name.trim(),
      tag: c.tag.trim(),
      color: c.color || null,
      description: c.description.trim() || null,
    };
    const ok = await this.run(() =>
      c.id ? this.api.updateClan(c.id, body) : this.api.createClan(body),
    );
    if (ok) this.resetClan();
  }

  protected removeClan(c: BotClan) {
    if (!confirm(this.i18n.t('bots.deleteClanConfirm', { name: c.name }))) return;
    void this.run(() => this.api.deleteClan(c.id));
  }

  // --- team names ---------------------------------------------------------------------------

  protected async saveTeamNames() {
    const names = this.teamNames
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean);
    this.savedTeams.set(false);
    const ok = await this.run(async () => {
      const s = await this.api.setTeamNames(names);
      this.teamNames = s.teamNames.join('\n');
    });
    this.savedTeams.set(ok);
  }
}

type TraitKey = 'accuracy' | 'alertness' | 'strafing' | 'camping';

function emptyClan(): ClanDraft {
  return { id: null, name: '', tag: '', color: '#58a6ff', description: '' };
}
