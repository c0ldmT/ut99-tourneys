import {
  emptyLook,
  lookBody,
  lookFromBot,
  UdtBotLook,
  type LookDraft,
  type UdtLooks,
} from '../components/udt-bot-look';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { Coin } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { NeuroPipe } from '../core/neuro';
import type { UdtLedgerEntry, UdtPacks, UdtRosterBot, UdtTraitOnBot, UdtView } from '../core/types';
import {
  baseValue,
  botRarity,
  bracketOf,
  salaryOf,
  SCRAP,
  rosterCard,
  staminaColor,
  UdtCard,
  UdtNav,
  valueScore,
  type CardBot,
} from '../core/udt';

type Mode = 'dm' | 'mh';

/** Dream Team: founding the team (starter bot), the lineups, the roster and the ledger. */
@Component({
  selector: 'app-udt-team',
  imports: [FormsModule, RouterLink, TPipe, NeuroPipe, Coin, UdtCard, UdtNav, UdtBotLook],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (view(); as v) {
      @if (!v.enabled) {
        <div class="card">
          <p class="muted">{{ 'udt.off' | t }}</p>
        </div>
      } @else if (v.season === null) {
        <div class="card">
          <p class="muted">{{ 'udt.noSeason' | t }}</p>
        </div>
      } @else if (!v.team) {
        <div class="udt-head">
          <div>
            <div class="kpi" style="color: var(--udt)">{{ 'udt.season' | t: { n: v.season } }}</div>
            <h1 class="disp">{{ 'udt.found.title' | t }}</h1>
            <p class="muted">{{ 'udt.found.intro' | t }}</p>
          </div>
        </div>
        <form class="card found" (ngSubmit)="found()">
          <div class="cols">
            <div class="fields">
              <div class="row gap">
                <label
                  >{{ 'udt.found.name' | t }}
                  <input name="tname" [(ngModel)]="teamName" maxlength="32" required />
                </label>
                <label
                  >{{ 'udt.found.tag' | t }}
                  <input
                    name="ttag"
                    [(ngModel)]="teamTag"
                    maxlength="8"
                    placeholder="[TD]"
                    class="narrow"
                    required
                  />
                </label>
              </div>
              <label
                >{{ 'udt.found.bot' | t }}
                <input name="bname" [(ngModel)]="botName" maxlength="17" required />
              </label>
              <label
                >{{ 'udt.found.skill' | t }}: <b>{{ skill }}</b>
                <input
                  type="range"
                  name="skill"
                  min="0"
                  max="7"
                  step="1"
                  [(ngModel)]="skill"
                  (ngModelChange)="tick()"
                />
              </label>
              @for (k of keys; track k) {
                <label
                  >{{ 'udt.value.' + k | t }}: <b>{{ pctOf(k) }}</b>
                  <input
                    type="range"
                    [name]="k"
                    min="-1"
                    max="1"
                    step="0.1"
                    [ngModel]="values[k]"
                    (ngModelChange)="setValue(k, $event)"
                  />
                </label>
              }
              <p [class.error]="cost() > budget()" class="small">
                {{ 'udt.found.cost' | t: { cost: cost(), budget: budget() } }}
              </p>
            </div>
            <udt-card [bot]="preview()" />
          </div>
          <app-udt-bot-look [draft]="foundLook" [looks]="looks()" />
          <div class="row submit">
            <button type="submit" class="primary" [disabled]="busy() || cost() > budget()">
              {{ 'udt.found.submit' | t }}
            </button>
            <span class="muted small">{{ 'udt.look.later' | t }}</span>
          </div>
        </form>
      } @else {
        <div class="udt-head">
          <div>
            <div class="kpi" style="color: var(--udt)">{{ 'udt.season' | t: { n: v.season } }}</div>
            <h1 class="disp">
              <span style="color: var(--hot-text)">{{ v.team.tag }}</span> {{ v.team.name }}
            </h1>
          </div>
          <div class="udt-kpis">
            <div>
              <div class="kpi">{{ 'udt.spendable' | t }}</div>
              <div class="v neuro">
                <na-coin [size]="16" /> {{ v.wallet?.spendable ?? 0 | neuro: false }}
              </div>
            </div>
            <div>
              <div class="kpi">{{ 'udt.teamValue' | t }}</div>
              <div class="v">{{ teamValue() | neuro }}</div>
            </div>
            <div>
              <div class="kpi">{{ 'udt.salary' | t }}</div>
              <div class="v" style="color: var(--danger)">−{{ salary() | neuro }}</div>
            </div>
            <div>
              <div class="kpi">{{ 'udt.index' | t }}</div>
              <div class="v">{{ v.index.toFixed(2) }}</div>
            </div>
          </div>
        </div>

        <section class="card">
          <div class="row between">
            <h2>{{ 'udt.lineup' | t }}</h2>
            <div class="seg">
              <button type="button" [class.on]="mode() === 'dm'" (click)="mode.set('dm')">
                Deathmatch
              </button>
              <button type="button" [class.on]="mode() === 'mh'" (click)="mode.set('mh')">
                Monster Hunt
              </button>
            </div>
          </div>
          <div class="udt-arena">
            @for (s of slots; track s) {
              @if (inSlot(s); as b) {
                <udt-card [bot]="card(b)" [small]="true" />
              } @else {
                <div class="empty">#{{ s }}</div>
              }
            }
          </div>
          <div class="slots">
            @for (s of slots; track s) {
              <label
                >#{{ s }}
                <select
                  [ngModel]="slotValue(s)"
                  (ngModelChange)="setSlot(s, $event)"
                  [name]="'s' + s"
                >
                  <option [ngValue]="null">–</option>
                  @for (b of v.roster; track b.botId) {
                    <option [ngValue]="b.botId">{{ b.name }} ({{ b.skill }})</option>
                  }
                </select>
              </label>
            }
            @for (s of [1, 2]; track s) {
              <label
                >{{ 'udt.bench' | t }} {{ s }}
                <select
                  [ngModel]="benchValue(s)"
                  (ngModelChange)="setBench(s, $event)"
                  [name]="'b' + s"
                >
                  <option [ngValue]="null">–</option>
                  @for (b of v.roster; track b.botId) {
                    <option [ngValue]="b.botId">{{ b.name }}</option>
                  }
                </select>
              </label>
            }
          </div>
          <div class="row">
            <button
              type="button"
              class="primary"
              [disabled]="busy() || !dirty()"
              (click)="saveLineup()"
            >
              {{ 'common.save' | t }}
            </button>
            <span class="muted small">{{ 'udt.lineupHint' | t }}</span>
          </div>
          <details class="help small">
            <summary>{{ 'udt.staminaHelp.title' | t }}</summary>
            <ul>
              @for (k of ['loss', 'rest', 'tired', 'bench', 'traits', 'buy']; track k) {
                <li>{{ 'udt.staminaHelp.' + k | t }}</li>
              }
            </ul>
          </details>
        </section>

        <section class="card">
          <div class="row between">
            <h2>{{ 'udt.roster' | t: { n: v.roster.length } }}</h2>
            <a routerLink="/udt/market">{{ 'udt.toMarket' | t }}</a>
          </div>
          <div class="roster">
            @for (b of v.roster; track b.botId) {
              <div class="rrow">
                <span class="udt-chip r-{{ b.rarity }}"
                  ><span>{{ b.effective.skill }}{{ b.effective.overflow ? '+' : '' }}</span></span
                >
                <span class="grow">
                  <b>{{ b.gameName }}</b>
                  @if (b.starter) {
                    <span class="udt-mark own">{{ 'udt.starter' | t }}</span>
                  } @else if (b.own) {
                    <span class="udt-mark own">{{ 'udt.academy.origin.' + b.own.origin | t }}</span>
                  }
                  @if (b.own && b.own.points > 0) {
                    <a routerLink="/udt/academy" class="udt-mark star">{{
                      'udt.academy.pointsFree' | t: { n: b.own.points }
                    }}</a>
                  }
                  @if (b.striking) {
                    <span class="udt-mark strike">{{ 'udt.strike' | t }}</span>
                  }
                  @if (b.stamina < 40) {
                    <span class="udt-mark tired">{{ 'udt.tired' | t }}</span>
                  }
                  @if (star(b)) {
                    <span class="udt-mark star">Star</span>
                  }
                  <span class="muted small block"
                    >{{ 'udt.level' | t }} {{ b.level }} · XP {{ b.xp }} · {{ 'udt.paid' | t }}
                    {{ b.price | neuro }}</span
                  >
                  <span class="udt-traits tline">
                    @for (tr of b.udtTraits; track tr.id) {
                      <span
                        class="udt-trait r-{{ tr.rarity }}"
                        [title]="'udt.traitE.' + tr.code | t"
                        >{{ 'udt.trait.' + tr.code | t }}
                        <button
                          type="button"
                          class="x"
                          [attr.aria-label]="'udt.traits.remove' | t"
                          [disabled]="busy()"
                          (click)="unassign(tr)"
                        >
                          ×
                        </button></span
                      >
                    }
                    @if (b.udtTraits.length < b.slots) {
                      <button
                        type="button"
                        class="udt-trait slot add"
                        [disabled]="busy()"
                        (click)="openAssign(b)"
                      >
                        + {{ 'udt.traits.add' | t }} ({{
                          'udt.traits.free' | t: { n: b.slots - b.udtTraits.length }
                        }})
                      </button>
                    }
                  </span>
                  @if (assignFor() === b.botId) {
                    <span class="assign">
                      @if (inventory().length) {
                        <select [(ngModel)]="pickCard" name="pick" (ngModelChange)="tick()">
                          @for (c of inventory(); track c.id) {
                            <option [ngValue]="c.id">
                              {{ 'udt.trait.' + c.code | t }} – {{ 'udt.traitE.' + c.code | t }}
                            </option>
                          }
                        </select>
                        @if (needsWeapon()) {
                          <select
                            [(ngModel)]="pickWeapon"
                            name="weapon"
                            [attr.aria-label]="'udt.traits.weapon' | t"
                          >
                            @for (w of weapons(); track w.name) {
                              <option [ngValue]="w.name">{{ w.label }}</option>
                            }
                          </select>
                        }
                        <button
                          type="button"
                          class="primary"
                          [disabled]="busy() || !pickCard"
                          (click)="assign(b)"
                        >
                          {{ 'udt.traits.put' | t }}
                        </button>
                      } @else {
                        <span class="muted small"
                          >{{ 'udt.traits.none' | t }}
                          <a routerLink="/udt/packs">{{ 'udt.nav.packs' | t }}</a></span
                        >
                      }
                      <button type="button" (click)="assignFor.set(null)">
                        {{ 'common.cancel' | t }}
                      </button>
                    </span>
                  }
                </span>
                <span class="stam"
                  ><span class="udt-bar"
                    ><i [style.width.%]="b.stamina" [style.background]="color(b.stamina)"></i></span
                  ><span class="mono small">{{ b.stamina }}</span></span
                >
                <span class="neuro mono">{{ b.value | neuro }}</span>
                @if (!b.starter && !b.own) {
                  <button type="button" (click)="sell(b)" [disabled]="busy()">
                    {{ 'udt.sell' | t }}
                  </button>
                }
                @if (b.stamina < 100) {
                  <button
                    type="button"
                    [disabled]="busy()"
                    (click)="openRest(b)"
                    [title]="'udt.rest.hint' | t"
                  >
                    {{ 'udt.rest.button' | t }}
                  </button>
                }
                @if (b.own) {
                  <button
                    type="button"
                    [disabled]="busy()"
                    (click)="openLook(b)"
                    [title]="'udt.look.edit' | t"
                  >
                    {{ 'udt.look.button' | t }}
                  </button>
                }
              </div>
              @if (restFor() === b.botId) {
                <div class="restbox">
                  <label class="restslider"
                    ><span>{{ 'udt.rest.points' | t }}</span>
                    <input
                      type="range"
                      name="rest"
                      min="1"
                      [max]="100 - b.stamina"
                      step="1"
                      [ngModel]="restPoints()"
                      (ngModelChange)="restPoints.set(+$event)"
                    />
                    <span class="mono">+{{ restPoints() }}</span>
                  </label>
                  <span class="small muted">
                    {{ 'udt.stamina' | t }} {{ b.stamina }} → {{ b.stamina + restPoints() }}
                  </span>
                  <span class="row">
                    <button
                      type="button"
                      class="primary"
                      [disabled]="busy() || restPoints() * restPrice > (v.wallet?.spendable ?? 0)"
                      (click)="rest(b)"
                    >
                      {{ 'udt.rest.buy' | t }} · {{ restPoints() * restPrice | neuro }}
                    </button>
                    <button type="button" (click)="restFor.set(null)">
                      {{ 'common.cancel' | t }}
                    </button>
                  </span>
                </div>
              }
              @if (lookFor() === b.botId) {
                @if (lookDraft(); as ld) {
                  <div class="lookedit">
                    <app-udt-bot-look [draft]="ld" [looks]="looks()" />
                    <span class="row">
                      <button
                        type="button"
                        class="primary"
                        [disabled]="busy()"
                        (click)="saveLook(b)"
                      >
                        {{ 'common.save' | t }}
                      </button>
                      <button type="button" (click)="lookFor.set(null)">
                        {{ 'common.cancel' | t }}
                      </button>
                    </span>
                  </div>
                }
              }
            }
          </div>
        </section>

        <section class="card">
          <h2>{{ 'udt.ledger' | t }}</h2>
          @for (l of ledger(); track l.id) {
            <div class="lrow">
              <span class="grow">{{ 'udt.kind.' + l.kind | t }}</span>
              <span class="muted small">{{ l.at.slice(0, 16).replace('T', ' ') }}</span>
              <span class="mono" [class.up]="l.amount > 0" [class.down]="l.amount < 0"
                >{{ l.amount > 0 ? '+' : '' }}{{ l.amount | neuro }}</span
              >
            </div>
          } @empty {
            <p class="muted small">{{ 'udt.ledgerEmpty' | t }}</p>
          }
        </section>
      }
    }
  `,
  styles: `
    .found .cols {
      display: flex;
      flex-wrap: wrap;
      gap: 28px;
      align-items: flex-start;
      margin-bottom: 18px;
    }
    .found .submit {
      margin-top: 16px;
    }
    .found .fields {
      flex: 1 1 320px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .between {
      justify-content: space-between;
      align-items: center;
    }
    .empty {
      width: var(--slot-w, 150px);
      min-height: 150px;
      border: 2px dashed var(--line);
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
    }
    .slots {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 10px;
      margin: 14px 0;
    }
    .roster .rrow,
    .lrow {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-top: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .grow {
      flex: 1 1 200px;
      min-width: 0;
    }
    .block {
      display: block;
    }
    .stam {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: 120px;
    }
    .stam .udt-bar {
      flex: 1;
    }
    .tline {
      margin-top: 6px;
    }
    .udt-trait .x {
      min-height: 0;
      height: 16px;
      padding: 0 2px;
      border: 0;
      background: transparent;
      color: inherit;
      line-height: 1;
    }
    .udt-trait.add {
      cursor: pointer;
      min-height: 0;
      font: inherit;
      font-size: 0.68rem;
    }
    .assign {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-top: 8px;
    }
    .assign select {
      max-width: 100%;
    }
    .up {
      color: var(--live);
    }
    .down {
      color: var(--danger);
    }
  `,
})
export class UdtTeamPage {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  protected readonly view = signal<UdtView | null>(null);
  protected readonly ledger = signal<UdtLedgerEntry[]>([]);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly mode = signal<Mode>('dm');
  protected readonly slots = [1, 2, 3, 4, 5];
  protected readonly keys = ['accuracy', 'alertness', 'strafing'] as const;
  // Founding form
  protected teamName = '';
  protected teamTag = '';
  protected botName = '';
  protected skill = 3;
  protected values: Record<'accuracy' | 'alertness' | 'strafing', number> = {
    accuracy: 0,
    alertness: 0,
    strafing: 0,
  };
  private readonly rev = signal(0);
  // Look and chat lines: of the starter (founding) and of an own bot (editing)
  protected readonly foundLook = emptyLook();
  protected readonly looks = signal<UdtLooks | null>(null);
  protected readonly lookFor = signal<string | null>(null);
  protected readonly lookDraft = signal<LookDraft | null>(null);
  // Rest with Neuro
  protected readonly restFor = signal<string | null>(null);
  protected readonly restPoints = signal(1);
  protected readonly restPrice = 2;
  // Lineup draft (bot ids per slot) and whether it differs from the saved one
  private readonly draft = signal<{
    dm: (string | null)[];
    mh: (string | null)[];
    bench: (string | null)[];
  }>({
    dm: [],
    mh: [],
    bench: [],
  });
  protected readonly dirty = signal(false);
  protected readonly assignFor = signal<string | null>(null);
  private readonly packs = signal<UdtPacks | null>(null);
  protected readonly inventory = computed(() => this.packs()?.inventory ?? []);
  protected readonly weapons = computed(() => this.packs()?.weapons ?? []);
  protected pickCard: string | null = null;
  protected pickWeapon: string | null = null;
  protected readonly needsWeapon = computed(() => {
    this.rev();
    return !!this.inventory().find((c) => c.id === this.pickCard)?.needsWeapon;
  });

  protected readonly budget = computed(() => this.view()?.starterBudget ?? 1500);
  protected readonly cost = computed(() => {
    this.rev();
    return Math.round(baseValue(Number(this.skill), valueScore(this.values)));
  });
  protected readonly preview = computed<CardBot>(() => {
    this.rev();
    return {
      name: this.botName || '?',
      skill: Number(this.skill),
      rarity: botRarity(Number(this.skill)),
      traits: { ...this.values },
      tag: this.teamTag || undefined,
      value: this.cost(),
    };
  });
  protected readonly teamValue = computed(() =>
    (this.view()?.roster ?? []).reduce((s, b) => s + b.value, 0),
  );
  protected readonly salary = computed(() =>
    (this.view()?.roster ?? []).filter((b) => !b.starter).reduce((s, b) => s + salaryOf(b), 0),
  );

  constructor() {
    void this.load();
  }

  async load() {
    try {
      const v = await this.api.udt();
      this.view.set(v);
      this.resetDraft(v);
      if (v.enabled && v.season !== null && !this.looks())
        this.looks.set(await this.api.udtLooks().catch(() => null));
      if (v.team) this.ledger.set(await this.api.udtLedger());
      this.error.set('');
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  private resetDraft(v: UdtView) {
    const at = (key: 'dmSlot' | 'mhSlot' | 'bench', n: number) =>
      Array.from({ length: n }, (_, i) => v.roster.find((b) => b[key] === i + 1)?.botId ?? null);
    this.draft.set({ dm: at('dmSlot', 5), mh: at('mhSlot', 5), bench: at('bench', 2) });
    this.dirty.set(false);
  }

  protected tick() {
    this.rev.update((n) => n + 1);
  }

  protected pctOf(k: 'accuracy' | 'alertness' | 'strafing') {
    return Math.round((this.values[k] + 1) * 50);
  }

  protected setValue(k: 'accuracy' | 'alertness' | 'strafing', v: number) {
    this.values = { ...this.values, [k]: Number(v) };
    this.tick();
  }

  protected card(b: UdtRosterBot): CardBot {
    return rosterCard(b, this.view()?.team?.tag);
  }

  protected star(b: UdtRosterBot) {
    return bracketOf(b.effective.skill) === 'strong';
  }

  protected async openAssign(b: UdtRosterBot) {
    await this.act(async () => {
      const p = await this.api.udtPacks();
      this.packs.set(p);
      this.pickCard = p.inventory[0]?.id ?? null;
      this.pickWeapon = p.weapons[0]?.name ?? null;
      this.assignFor.set(b.botId);
      this.tick();
    });
  }

  protected async assign(b: UdtRosterBot) {
    const card = this.pickCard;
    if (!card) return;
    await this.act(async () => {
      const v = await this.api.udtAssign(
        card,
        b.botId,
        this.needsWeapon() ? (this.pickWeapon ?? undefined) : undefined,
      );
      this.view.set(v);
      this.assignFor.set(null);
    });
  }

  protected async unassign(t: UdtTraitOnBot) {
    const name = this.i18n.t(`udt.trait.${t.code}`);
    const n = SCRAP[t.rarity];
    if (!confirm(this.i18n.t('udt.traits.removeConfirm', { name, n }))) return;
    await this.act(async () => {
      this.view.set(await this.api.udtUnassign(t.id));
    });
  }

  protected color(s: number) {
    return staminaColor(s);
  }

  protected slotValue(s: number) {
    return this.draft()[this.mode()][s - 1] ?? null;
  }

  protected benchValue(s: number) {
    return this.draft().bench[s - 1] ?? null;
  }

  protected inSlot(s: number): UdtRosterBot | undefined {
    const id = this.slotValue(s);
    return id ? this.view()?.roster.find((b) => b.botId === id) : undefined;
  }

  protected setSlot(s: number, id: string | null) {
    const d = structuredClone(this.draft());
    const list = d[this.mode()];
    while (list.length < 5) list.push(null);
    // A bot in one slot only: move it.
    for (let i = 0; i < list.length; i++) if (id && list[i] === id) list[i] = null;
    list[s - 1] = id;
    this.draft.set(d);
    this.dirty.set(true);
  }

  protected setBench(s: number, id: string | null) {
    const d = structuredClone(this.draft());
    while (d.bench.length < 2) d.bench.push(null);
    for (let i = 0; i < d.bench.length; i++) if (id && d.bench[i] === id) d.bench[i] = null;
    d.bench[s - 1] = id;
    this.draft.set(d);
    this.dirty.set(true);
  }

  protected async saveLineup() {
    await this.act(async () => {
      await this.api.udtLineup(this.draft());
      await this.load();
    });
  }

  protected async found() {
    await this.act(async () => {
      const v = await this.api.udtCreateTeam({
        name: this.teamName.trim(),
        tag: this.teamTag.trim(),
        starter: {
          name: this.botName.trim(),
          skill: Number(this.skill),
          ...(this.foundLook.botClass.trim() ? { botClass: this.foundLook.botClass.trim() } : {}),
          ...(this.foundLook.skin.trim() ? { skin: this.foundLook.skin.trim() } : {}),
          ...(this.foundLook.face.trim() ? { face: this.foundLook.face.trim() } : {}),
          traits: {
            ...this.values,
            ...(this.foundLook.voice ? { voice: this.foundLook.voice } : {}),
          },
          personality: lookBody(this.foundLook).personality,
        },
      });
      this.view.set(v);
      this.resetDraft(v);
    });
  }

  /** Opens the look and lines of an own bot (its current values from the library). */
  protected async openLook(b: UdtRosterBot) {
    if (this.lookFor() === b.botId) {
      this.lookFor.set(null);
      return;
    }
    await this.act(async () => {
      const bot = await this.api.botProfile(b.botId);
      this.lookDraft.set(lookFromBot(bot));
      this.lookFor.set(b.botId);
    });
  }

  protected openRest(b: UdtRosterBot) {
    if (this.restFor() === b.botId) {
      this.restFor.set(null);
      return;
    }
    this.restPoints.set(100 - b.stamina);
    this.restFor.set(b.botId);
  }

  protected async rest(b: UdtRosterBot) {
    await this.act(async () => {
      const v = await this.api.udtRest(b.botId, this.restPoints());
      this.view.set(v);
      this.resetDraft(v);
      this.restFor.set(null);
      this.ledger.set(await this.api.udtLedger());
    });
  }

  protected async saveLook(b: UdtRosterBot) {
    const d = this.lookDraft();
    if (!d) return;
    await this.act(async () => {
      await this.api.udtEditBot(b.botId, lookBody(d));
      this.lookFor.set(null);
      await this.load();
    });
  }

  protected async sell(b: UdtRosterBot) {
    if (!confirm(this.i18n.t('udt.sellConfirm', { name: b.name }))) return;
    await this.act(async () => {
      await this.api.udtSell(b.botId);
      await this.load();
    });
  }

  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set('');
    try {
      await fn();
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }
}
