import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
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

/**
 * Dream Team academy: licences, scouting three talents (values and potential as ranges),
 * apprentices of mentors, developing own bots with points, nominating them for graduation.
 */
@Component({
  selector: 'app-udt-academy',
  imports: [FormsModule, RouterLink, TPipe, NeuroPipe, Coin, UdtCard, UdtNav, UdtPotential],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    @if (a(); as v) {
      <div class="udt-head">
        <div>
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
          {{ 'udt.packs.noTeam' | t }} <a routerLink="/udt">{{ 'udt.nav.team' | t }}</a>
        </p>
      } @else {
        <section class="card">
          <div class="row between">
            <h2>{{ 'udt.academy.scouting' | t }}</h2>
            <button type="button" class="primary" [disabled]="busy()" (click)="scout()">
              {{ 'udt.academy.scout' | t }} · {{ v.scoutPrice | neuro }}
            </button>
          </div>
          <p class="muted small">{{ 'udt.academy.scoutText' | t }}</p>
          @if (v.report; as r) {
            <div class="talents">
              @for (t of r; track $index; let i = $index) {
                <div class="talent">
                  <udt-card [bot]="talentCard(t, v.tag)" [small]="true" />
                  <div class="tinfo">
                    <div class="kpi">{{ 'udt.academy.report' | t }}</div>
                    @for (k of keys; track k) {
                      <div class="rg">
                        <span>{{ 'udt.academy.stat.' + k | t }}</span>
                        <span class="mono">{{ t.ranges[k][0] }}–{{ t.ranges[k][1] }}</span>
                      </div>
                    }
                    <udt-potential [skill]="t.skill" [potential]="t.potential" [compact]="true" />
                    <label
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
                      @if (v.licence.nextPrice) {
                        · {{ v.licence.nextPrice | neuro }}
                      }
                    </button>
                  </div>
                </div>
              }
            </div>
          }
          @if (v.rosterFull) {
            <p class="muted small">{{ 'udt.academy.full' | t }}</p>
          }
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

        <section class="card">
          <h2>{{ 'udt.academy.mentors' | t }}</h2>
          <p class="muted small">
            {{
              'udt.academy.mentorText'
                | t
                  : {
                      lv: v.mentorLevel,
                      skill: skillName(v.mentorSkill ?? 6),
                      xp: xpBonus(v),
                    }
            }}
          </p>
          @if (v.mentors.length) {
            <label class="mpick"
              >{{ 'udt.academy.mentorPick' | t }}
              <select
                name="mentor"
                [ngModel]="mentor()?.botId ?? ''"
                (ngModelChange)="mentorId.set($event)"
              >
                @for (m of v.mentors; track m.botId) {
                  <option [value]="m.botId">
                    {{ m.name }} · {{ skillName(m.skill) }} · {{ 'udt.level' | t }} {{ m.level
                    }}{{ m.ready ? '' : ' – ' + mentorBlocked(m, v) }}
                  </option>
                }
              </select>
            </label>
            @if (mentor(); as m) {
              <div class="mrow">
                <span class="udt-chip r-{{ rarity(m.skill) }}"
                  ><span>{{ m.skill }}</span></span
                >
                <span class="grow"
                  ><b>{{ m.name }}</b>
                  <span class="muted small">{{ 'udt.level' | t }} {{ m.level }}</span>
                  @if (m.mentorTrait) {
                    <span class="udt-mark star">{{ 'udt.trait.mentor' | t }}</span>
                  }
                  @if (m.used) {
                    <span class="udt-mark">{{ 'udt.academy.hasApprentice' | t }}</span>
                  }
                </span>
              </div>
              @if (m.ready && m.pupils.length) {
                <label class="mpick"
                  >{{ 'udt.academy.pupilPick' | t }}
                  <select
                    name="pupil"
                    [ngModel]="pupil()?.botId ?? ''"
                    (ngModelChange)="pupilId.set($event)"
                  >
                    @for (p of m.pupils; track p.botId) {
                      <option [value]="p.botId">
                        {{ p.name }} · {{ skillName(p.skill) }} · {{ 'udt.level' | t }}
                        {{ p.level }}
                      </option>
                    }
                  </select>
                </label>
                @if (pupil(); as p) {
                  <p class="small muted">{{ 'udt.academy.lesson' | t }}</p>
                  <ul class="lesson small">
                    @for (k of lessonKeys; track k) {
                      <li [class.up]="p.after[k] !== p.before[k]">
                        {{ 'udt.academy.lesson.' + k | t }}:
                        <span class="mono">{{ pct(p.before[k], k) }}</span>
                        @if (p.after[k] !== p.before[k]) {
                          → <b class="mono">{{ pct(p.after[k], k) }}</b>
                        }
                      </li>
                    }
                  </ul>
                  <p class="small">
                    {{ 'udt.academy.pupilXp' | t: { xp: xpBonus(v), mentor: m.name } }}
                    @if (m.traits.length) {
                      {{
                        'udt.academy.pupilTrait'
                          | t: { pct: m.inheritChance * 100, list: traitNames(m.traits) }
                      }}
                    } @else {
                      {{ 'udt.academy.pupilNoTrait' | t }}
                    }
                  </p>
                  <button type="button" [disabled]="busy()" (click)="apprentice(m, p)">
                    {{ 'udt.academy.takeApprentice' | t }}
                  </button>
                }
              } @else if (m.ready) {
                <p class="muted small">{{ 'udt.academy.noPupils' | t }}</p>
              } @else {
                <p class="muted small">{{ mentorBlocked(m, v) }}</p>
              }
            }
          } @else {
            <p class="muted small">{{ 'udt.academy.noMentors' | t }}</p>
          }
        </section>

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
                    routerLink="/udt"
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
                        <button
                          type="button"
                          [disabled]="busy() || !gb.ready || grad()!.left <= 0"
                          (click)="nominate(gb.botId)"
                        >
                          {{ 'udt.academy.nominate' | t }}
                        </button>
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
    .talents,
    .own {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
      margin-top: 12px;
    }
    .talent,
    .ob {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      background: #0c0f16;
    }
    .tinfo,
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
      font-size: 0.85rem;
    }
    .lesson {
      margin: 4px 0;
      padding-left: 18px;
    }
    .lesson li.up b {
      color: var(--live);
    }
    .mpick select {
      display: block;
      width: 100%;
      margin-top: 4px;
    }
    .mrow {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-top: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .grow {
      flex: 1 1 180px;
      min-width: 0;
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
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
  `,
})
export class UdtAcademyPage {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  protected readonly a = signal<UdtAcademy | null>(null);
  protected readonly grad = signal<UdtGraduation | null>(null);
  protected readonly busy = signal(false);
  protected readonly names = signal<Partial<Record<number, string>>>({});
  /** The chosen apprentice (default: the first bot that can learn from the mentor). */
  protected readonly pupilId = signal<string | null>(null);
  protected readonly pupil = computed((): UdtPupil | null => {
    const list = this.mentor()?.pupils ?? [];
    return list.find((p) => p.botId === this.pupilId()) ?? list[0] ?? null;
  });
  protected readonly lessonKeys = [
    'accuracy',
    'alertness',
    'strafing',
    'combatStyle',
    'camping',
  ] as const;
  /** The chosen mentor (default: the first that can take an apprentice). */
  protected readonly mentorId = signal<string | null>(null);
  protected readonly mentor = computed((): UdtMentor | null => {
    const list = this.a()?.mentors ?? [];
    return (
      list.find((m) => m.botId === this.mentorId()) ?? list.find((m) => m.ready) ?? list[0] ?? null
    );
  });
  protected readonly keys = ['accuracy', 'alertness', 'strafing'] as const;
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
        alert(
          this.i18n.t('udt.academy.startTrait', {
            trait: this.i18n.t(`udt.trait.${v.built.startTrait}`),
          }),
        );
    });
  }

  protected rarity(skill: number) {
    return botRarity(skill);
  }

  /** The talent as a card: values in the middle of the scout's ranges. */
  protected talentCard(t: UdtTalentReport, tag: string): CardBot {
    const mid = (k: 'accuracy' | 'alertness' | 'strafing') =>
      (t.ranges[k][0] + t.ranges[k][1]) / 100 - 1;
    return {
      name: t.name,
      skill: t.skill,
      rarity: botRarity(t.skill),
      tag,
      traits: { accuracy: mid('accuracy'), alertness: mid('alertness'), strafing: mid('strafing') },
      potential: t.potential,
    };
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

  /** Why a bot cannot take an apprentice now. */
  protected mentorBlocked(m: UdtMentor, v: UdtAcademy): string {
    if (m.used || m.why === 'used') return this.i18n.t('udt.academy.hasApprentice');
    if (m.why === 'skill')
      return this.i18n.t('udt.academy.fromSkill', { skill: this.skillName(v.mentorSkill ?? 6) });
    return this.i18n.t('udt.academy.fromLevel', { lv: v.mentorLevel });
  }

  /** The apprentice's XP bonus in per cent (50). */
  protected xpBonus(v: UdtAcademy): number {
    return Math.round(((v.apprenticeXp ?? 1.5) - 1) * 100);
  }

  protected traitNames(codes: readonly string[]): string {
    return codes.map((c) => this.i18n.t(`udt.trait.${c}`)).join(', ');
  }

  /** A value on the page's 0..100 scale (camping 0..1 as 0..100 too). */
  protected pct(v: number, k: (typeof this.lessonKeys)[number]): number {
    return Math.round(k === 'camping' ? v * 100 : (v + 1) * 50);
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

  protected async apprentice(m: UdtMentor, p: UdtPupil) {
    await this.act(async () => {
      const v = await this.api.udtApprentice(m.botId, p.botId);
      this.a.set(v);
      this.grad.set(await this.api.udtGraduation());
      if (v.apprentice?.inherited)
        alert(
          this.i18n.t('udt.academy.inherited', {
            trait: this.i18n.t(`udt.trait.${v.apprentice.inherited}`),
          }),
        );
    });
  }

  /** Development and renaming are on My team (the bot's details). */
  protected toTeam(botId: string) {
    void this.router.navigate(['/udt'], { queryParams: { bot: botId } });
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
