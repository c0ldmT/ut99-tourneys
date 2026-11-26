import { HelpMore } from '../components/help-more';
import { Confirm } from '../components/confirm-dialog';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { UdtMentorPanel } from '../components/udt-mentor-panel';
import { UdtPotential } from '../components/udt-potential';
import { Api } from '../core/api';
import { Coin } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { NeuroPipe } from '../core/neuro';
import type {
  UdtAcademy,
  UdtGraduation,
  UdtMentor,
  UdtPupil,
  UdtRosterBot,
  UdtTalentReport,
} from '../core/types';
import { botRarity, buildCost, SKILL_NAMES, UdtCard, UdtNav, type CardBot } from '../core/udt';
import { ANLAGE_LEVEL } from '@tourney/udt';

/**
 * Dream Team academy: licences, scouting three talents (values and potential as ranges),
 * apprentices of mentors, developing own bots with points, nominating them for graduation.
 */
@Component({
  selector: 'app-udt-academy',
  imports: [
    HelpMore,
    FormsModule,
    RouterLink,
    TPipe,
    NeuroPipe,
    Coin,
    UdtCard,
    UdtNav,
    UdtPotential,
    UdtMentorPanel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    @if (a(); as v) {
      <div class="udt-head">
        <div>
          <div class="kpi udt-kick">{{ 'udt.area.team' | t }}</div>
          <h1 class="disp">{{ 'udt.academy.title' | t }}</h1>
          <p class="muted">{{ 'udt.academy.intro' | t }}</p>
        </div>
        <div class="udt-kpis">
          <div>
            <div class="kpi">{{ 'udt.academy.made' | t }}</div>
            <div class="v">{{ v.licence.made }}</div>
          </div>
          <div>
            <div class="kpi">{{ 'udt.academy.nextLicence' | t }}</div>
            <div class="v neuro">
              @if (v.licence.nextPrice === null) {
                –
              } @else {
                <na-coin [size]="16" /> {{ v.licence.nextPrice | neuro: false }}
              }
            </div>
          </div>
        </div>
      </div>
      @if (!v.hasTeam) {
        <p class="card muted">
          {{ 'udt.packs.noTeam' | t }} <a routerLink="/udt/team">{{ 'udt.nav.team' | t }}</a>
        </p>
      } @else {
        <section class="card scout" aria-labelledby="scout-title">
          <div class="shead">
            <div class="sintro">
              <div class="kpi">
                {{ 'udt.nav.academy' | t }}
                @if (v.scoutLevel) {
                  · {{ 'udt.scout.office' | t: { n: v.scoutLevel } }}
                }
              </div>
              <h2 id="scout-title">{{ 'udt.scout.title' | t }}</h2>
              <p class="muted">{{ 'udt.scout.intro' | t }}</p>
            </div>
            <button type="button" class="sbtn" [disabled]="busy()" (click)="scout()">
              {{ (v.report ? 'udt.scout.again' : 'udt.academy.scout') | t }} ·
              {{ v.scoutPrice | neuro }}
            </button>
          </div>
          @if (v.report; as r) {
            <div class="tgrid">
              @for (t of r; track $index; let i = $index) {
                <div class="talent" [class.anlage]="t.anlage">
                  <div class="thead">
                    <b class="tname">{{ names()[i] ?? t.name }}</b>
                    <span class="tskill"><span class="sr">Skill </span>{{ t.skill }}</span>
                  </div>
                  <span class="tpot">{{
                    'udt.scout.potential' | t: { a: t.potential[0], b: t.potential[1] }
                  }}</span>
                  <div class="tvals">
                    @for (k of keys; track k) {
                      <span class="tval" [title]="'udt.academy.stat.' + k | t"
                        ><i>{{ short[k] }}</i
                        ><b class="mono">{{ t.ranges[k][0] }}–{{ t.ranges[k][1] }}</b></span
                      >
                    }
                  </div>
                  <div class="tchips">
                    <span class="tchip dia">{{ 'udt.scout.diamond' | t }}</span>
                    @if (t.anlage) {
                      <span class="tchip anl">{{
                        'udt.scout.anlage' | t: { n: anlageLevel }
                      }}</span>
                    }
                  </div>
                  <label class="small tlabel"
                    >{{ 'udt.academy.name' | t }}
                    <input
                      type="text"
                      maxlength="20"
                      [name]="'n' + i"
                      [ngModel]="names()[i] ?? t.name"
                      (ngModelChange)="setName(i, $event)"
                    />
                  </label>
                  <button
                    type="button"
                    class="primary"
                    [disabled]="busy() || v.rosterFull || v.licence.nextPrice === null"
                    (click)="sign(i, t)"
                  >
                    {{ 'udt.academy.sign' | t }}
                    @if (talentPrice(v); as p) {
                      · {{ p | neuro }}
                    }
                  </button>
                  @if (talentPrice(v) !== null) {
                    <span class="muted small thalf">{{ 'udt.scout.licence' | t }}</span>
                  }
                </div>
              }
            </div>
          } @else {
            <p class="muted small">{{ 'udt.academy.scoutText' | t }}</p>
          }
          @if (v.rosterFull) {
            <p class="muted small">{{ 'udt.academy.full' | t }}</p>
          }
          <na-help id="academy-scout">{{ 'udt.scout.note' | t }}</na-help>
        </section>

        @if (v.blueprints.length) {
          <section class="card">
            <h2>{{ 'udt.academy.blueprints' | t }}</h2>
            <p class="muted small">{{ 'udt.academy.blueprintText' | t }}</p>
            <div class="build">
              <div class="bfields">
                <label
                  >{{ 'udt.academy.blueprint' | t }}
                  <select
                    name="bp"
                    [ngModel]="blueprint()?.id"
                    (ngModelChange)="pickBlueprint($event)"
                  >
                    @for (b of v.blueprints; track b.id) {
                      <option [ngValue]="b.id">
                        {{ 'udt.bp.' + b.rarity | t }} ({{ 'udt.rarity.' + b.rarity | t }})
                      </option>
                    }
                  </select>
                </label>
                @if (blueprint(); as bp) {
                  <p class="muted small">
                    {{
                      'udt.academy.bpRule'
                        | t
                          : {
                              pts: bp.rule.budget,
                              extra: bp.rule.extra,
                              skill: bp.rule.skill,
                              name: skillName(bp.rule.skill),
                            }
                    }}
                    @if (bp.rule.startTrait) {
                      {{
                        'udt.academy.bpTrait' | t: { r: ('udt.rarity.' + bp.rule.startTrait | t) }
                      }}
                    }
                  </p>
                  <label
                    >{{ 'udt.academy.name' | t }}
                    <input type="text" maxlength="20" name="bpName" [(ngModel)]="bpName" />
                  </label>
                  <udt-potential [skill]="bp.rule.skill" [potential]="bp.rule.potential" />
                  @for (k of keys; track k) {
                    <label
                      >{{ 'udt.academy.stat.' + k | t }} <span class="mono">{{ bpVal()[k] }}</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        [name]="'bp' + k"
                        [ngModel]="bpVal()[k]"
                        (ngModelChange)="setBpVal(k, $event)"
                      />
                    </label>
                  }
                  <div class="rg" [class.over]="bpCost() > bp.rule.budget">
                    <span>{{ 'udt.academy.points2' | t }}</span
                    ><span class="mono">{{ bpCost() }} / {{ bp.rule.budget }}</span>
                  </div>
                  <button
                    type="button"
                    class="primary"
                    [disabled]="
                      busy() ||
                      v.rosterFull ||
                      v.licence.nextPrice === null ||
                      bpCost() > bp.rule.budget ||
                      bpName.trim().length < 2
                    "
                    (click)="build(bp.id)"
                  >
                    {{ 'udt.academy.build' | t }}
                    @if (v.licence.nextPrice) {
                      · {{ v.licence.nextPrice | neuro }}
                    }
                  </button>
                }
              </div>
              <udt-card [bot]="bpCard(v.tag)" />
            </div>
          </section>
        }

        <udt-mentor-panel
          [academy]="v"
          [busy]="busy()"
          [cards]="rosterCards()"
          (teach)="apprentice($event.mentor, $event.pupil)"
        />

        <section class="card">
          <h2>{{ 'udt.academy.own' | t }}</h2>
          @if (grad(); as g) {
            <p class="muted small">
              {{
                'udt.academy.gradText'
                  | t: { games: g.games, lv: g.level, hon: g.honours, n: g.perSeason }
              }}
            </p>
          }
          <div class="own">
            @for (b of v.own; track b.botId) {
              <div class="ob">
                <udt-card
                  [bot]="ownCard(b, v.tag)"
                  [points]="b.own!.maxed ? 0 : b.own!.points"
                  (pointsClick)="toTeam(b.botId)"
                />
                <div class="oinfo">
                  <udt-potential [skill]="b.skill" [potential]="b.own!.potential" />
                  <div class="rg">
                    <span>{{ 'udt.academy.points' | t }}</span
                    ><b class="mono">{{ b.own!.points }}</b>
                  </div>
                  <a
                    class="btn"
                    [class.primary]="b.own!.points > 0 || b.own!.canRename"
                    routerLink="/udt/team"
                    [queryParams]="{ bot: b.botId }"
                    >{{
                      (b.own!.canRename ? 'udt.academy.toPanelRename' : 'udt.academy.toPanel') | t
                    }}</a
                  >
                  @if (gradOf(b.botId); as gb) {
                    <div class="rg">
                      <span>{{ 'udt.academy.games' | t }}</span
                      ><span class="mono">{{ gb.games }}</span>
                    </div>
                    @switch (gb.status) {
                      @case ('own') {
                        @if (gb.keeper) {
                          <span class="muted small">{{ 'udt.keep.noGrad' | t }}</span>
                        } @else {
                          <button
                            type="button"
                            [disabled]="busy() || !gb.ready || grad()!.left <= 0"
                            (click)="nominate(gb.botId)"
                          >
                            {{ 'udt.academy.nominate' | t }}
                          </button>
                        }
                      }
                      @case ('nominated') {
                        <span class="udt-mark own">{{ 'udt.academy.st.nominated' | t }}</span>
                        <button type="button" [disabled]="busy()" (click)="unnominate(gb.botId)">
                          {{ 'udt.trades.withdraw' | t }}
                        </button>
                      }
                      @default {
                        <span class="udt-mark star">{{ 'udt.academy.st.' + gb.status | t }}</span>
                      }
                    }
                  }
                </div>
              </div>
            }
          </div>
        </section>
      }
    }
  `,
  styles: `
    .between {
      justify-content: space-between;
      align-items: center;
    }
    .own {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
      margin-top: 12px;
    }
    .ob {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px;
      border-radius: var(--radius-sm);
      background: var(--panel-2);
    }
    .oinfo {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .rg {
      display: flex;
      justify-content: space-between;
      font-size: var(--fs-sm);
    }
    .build {
      display: flex;
      flex-wrap: wrap;
      gap: 24px;
      align-items: flex-start;
    }
    .bfields {
      flex: 1 1 300px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .over {
      color: var(--danger);
    }
    /* Scout report (decision 268, design "Scout-Bericht neu") */
    .scout {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .shead {
      display: flex;
      align-items: flex-end;
      gap: 12px;
      flex-wrap: wrap;
    }
    .sintro {
      flex: 1 1 420px;
      min-width: 0;
    }
    .sintro h2 {
      margin: 4px 0 0;
    }
    .sintro p {
      margin: 6px 0 0;
      max-width: 760px;
    }
    .sbtn {
      margin-left: auto;
    }
    .tgrid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 14px;
    }
    .talent {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 16px;
      border-radius: var(--radius);
      border: 1px solid var(--line);
      background: var(--bg-2);
    }
    .talent.anlage {
      border-color: color-mix(in srgb, var(--udt) 60%, transparent);
    }
    .thead {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
    }
    .tname {
      font-family: var(--font-display);
      font-size: var(--fs-2xl);
      text-transform: uppercase;
      overflow-wrap: anywhere;
    }
    .tskill {
      font-family: var(--font-display);
      font-weight: 800;
      font-style: italic;
      font-size: var(--fs-3xl);
      line-height: 1;
    }
    .tpot {
      color: var(--accent);
      font-weight: 700;
    }
    .tvals {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }
    .tval {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 4px 0;
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.03);
    }
    .tval i {
      font-style: normal;
      font-size: var(--fs-2xs);
      font-weight: 700;
      color: var(--muted);
    }
    .tval b {
      font-size: var(--fs-sm);
    }
    .tchips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .tchip {
      padding: 2px 9px;
      border-radius: var(--radius-pill);
      font-size: var(--fs-xs);
      font-weight: 700;
    }
    .tchip.dia {
      color: var(--live);
      border: 1px solid color-mix(in srgb, var(--live) 45%, transparent);
    }
    .tchip.anl {
      color: var(--udt);
      border: 1px solid color-mix(in srgb, var(--udt) 50%, transparent);
    }
    .talent label {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .talent .tlabel {
      margin-top: auto;
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .thalf {
      margin-top: -4px;
      text-align: center;
    }
  `,
})
export class UdtAcademyPage {
  private readonly confirm = inject(Confirm);
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  protected readonly a = signal<UdtAcademy | null>(null);
  protected readonly grad = signal<UdtGraduation | null>(null);
  protected readonly busy = signal(false);
  protected readonly names = signal<Partial<Record<number, string>>>({});
  protected readonly keys = ['accuracy', 'alertness', 'strafing'] as const;
  protected readonly short = { accuracy: 'ACC', alertness: 'ALT', strafing: 'STR' } as const;
  /** A hidden trait comes free at this level (decision 267). */
  protected readonly anlageLevel = ANLAGE_LEVEL;
  private readonly router = inject(Router);
  protected readonly bpId = signal<string | null>(null);
  /** Blueprints build one skill (3): the points go into the values. */
  protected readonly bpSkill = computed(() => this.blueprint()?.rule.skill ?? 3);
  protected readonly bpVal = signal({ accuracy: 50, alertness: 50, strafing: 50 });
  protected bpName = '';
  protected readonly blueprint = computed(
    () => this.a()?.blueprints.find((b) => b.id === this.bpId()) ?? this.a()?.blueprints[0] ?? null,
  );
  /** 0..100 on the page, -1..1 for the rules. */
  private readonly bpTraits = computed(() => {
    const v = this.bpVal();
    const f = (x: number) => x / 50 - 1;
    return { accuracy: f(v.accuracy), alertness: f(v.alertness), strafing: f(v.strafing) };
  });
  protected readonly bpCost = computed(() => buildCost(this.bpSkill(), this.bpTraits()));

  constructor() {
    void this.load();
  }

  async load() {
    try {
      const v = await this.api.udtAcademy();
      this.a.set(v);
      if (v.hasTeam) this.grad.set(await this.api.udtGraduation());
    } catch {
      // the toast shows the error
    }
  }

  protected skillName(s: number) {
    return SKILL_NAMES[s] ?? '';
  }

  protected pickBlueprint(id: string) {
    this.bpId.set(id);
  }

  protected setBpVal(k: 'accuracy' | 'alertness' | 'strafing', v: number) {
    this.bpVal.update((x) => ({ ...x, [k]: Number(v) }));
  }

  protected bpCard(tag: string): CardBot {
    return {
      name: this.bpName.trim() || '?',
      skill: this.bpSkill(),
      rarity: botRarity(this.bpSkill()),
      tag,
      traits: this.bpTraits(),
      ...(this.blueprint() ? { potential: this.blueprint()!.rule.potential } : {}),
    };
  }

  protected async build(id: string) {
    await this.act(async () => {
      const v = await this.api.udtBuild({
        blueprintId: id,
        name: this.bpName.trim(),
        skill: this.bpSkill(),
        traits: this.bpTraits(),
      });
      this.a.set(v);
      this.bpId.set(null);
      this.bpName = '';
      this.grad.set(await this.api.udtGraduation());
      if (v.built?.startTrait)
        void this.confirm.tell(
          this.i18n.t('udt.academy.startTrait', {
            trait: this.i18n.t(`udt.trait.${v.built.startTrait}`),
          }),
        );
    });
  }

  /** A talent's licence: half the price (decision 267; null: no licence left). */
  protected talentPrice(v: UdtAcademy): number | null {
    if (v.licence.nextPrice === null) return null;
    return v.licence.talentPrice ?? v.licence.nextPrice;
  }

  protected ownCard(b: UdtRosterBot, tag: string): CardBot {
    return { ...b, tag, ...(b.own ? { potential: b.own.potential } : {}) };
  }

  protected gradOf(id: string) {
    return this.grad()?.bots.find((b) => b.botId === id) ?? null;
  }

  protected setName(i: number, v: string) {
    this.names.update((n) => ({ ...n, [i]: v }));
  }

  protected async scout() {
    await this.act(async () => {
      this.a.set(await this.api.udtScout());
      this.names.set({});
    });
  }

  protected async sign(i: number, t: UdtTalentReport) {
    const name = (this.names()[i] ?? t.name).trim();
    await this.act(async () => {
      this.a.set(await this.api.udtSign(i, name));
      this.grad.set(await this.api.udtGraduation());
    });
  }

  /** Cards of the roster bots for the mentor panel. */
  protected readonly rosterCards = computed(
    () =>
      new Map((this.a()?.roster ?? []).map((b) => [b.botId, this.ownCard(b, this.a()?.tag ?? '')])),
  );

  protected async apprentice(m: UdtMentor, p: UdtPupil) {
    await this.act(async () => {
      const v = await this.api.udtApprentice(m.botId, p.botId);
      this.a.set(v);
      this.grad.set(await this.api.udtGraduation());
      if (v.apprentice?.signature)
        void this.confirm.tell(this.i18n.t('udt.academy.inheritedSig', { mentor: m.name }));
      else if (v.apprentice?.inherited)
        void this.confirm.tell(
          this.i18n.t('udt.academy.inherited', {
            trait: this.i18n.t(`udt.trait.${v.apprentice.inherited}`),
          }),
        );
    });
  }

  /** Development and renaming are on My team (the bot's details). */
  protected toTeam(botId: string) {
    void this.router.navigate(['/udt/team'], { queryParams: { bot: botId } });
  }

  protected async nominate(id: string) {
    await this.act(async () => this.grad.set(await this.api.udtNominate(id)));
  }

  protected async unnominate(id: string) {
    await this.act(async () => this.grad.set(await this.api.udtUnnominate(id)));
  }

  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    try {
      await fn();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
