import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { I18n, TPipe } from '../core/i18n';
import type { UdtAcademy, UdtMentor, UdtPupil, UdtRosterBot } from '../core/types';
import { UdtCard, type CardBot } from '../core/udt';

type LessonKey = 'accuracy' | 'alertness' | 'strafing' | 'combatStyle' | 'camping';

/**
 * The academy's mentor panel: the running apprenticeships (with the XP bonus), then a new one in
 * three steps - a mentor that can teach (skill 6+, level 3+, none this season), an apprentice
 * that can learn from it (made by the team, lower skill, never taught), what it learns. Bots
 * that cannot be chosen are not offered; a fold explains why.
 */
@Component({
  selector: 'udt-mentor-panel',
  imports: [TPipe, UdtCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let v = academy();
    <section class="card mp">
      <div class="mp-head">
        <h2>{{ 'udt.academy.mentors' | t }}</h2>
        <div class="mp-rules">
          <span class="udt-mark">{{
            'udt.mentor.ruleMentor'
              | t: { skill: skillLabel(v.mentorSkill ?? 6), lv: v.mentorLevel }
          }}</span>
          <span class="udt-mark">{{ 'udt.mentor.rulePupil' | t }}</span>
          <span class="udt-mark star">{{ 'udt.mentor.ruleXp' | t: { xp: xp() } }}</span>
        </div>
      </div>
      <p class="muted small">{{ 'udt.mentor.intro' | t }}</p>

      @if (v.mentorships.length) {
        <h3>{{ 'udt.mentor.running' | t }}</h3>
        <div class="mp-pairs">
          @for (x of v.mentorships; track x.apprentice.botId) {
            <div class="mp-pair" [class.on]="x.active">
              <div class="mp-who">
                @if (cardOf(x.mentor.botId); as c) {
                  <udt-card [bot]="c" [small]="true" />
                } @else {
                  <span class="mp-away">{{ x.mentor.name }}</span>
                }
                <span class="mp-arrow" aria-hidden="true">→</span>
                @if (cardOf(x.apprentice.botId); as c) {
                  <udt-card [bot]="c" [small]="true" />
                } @else {
                  <span class="mp-away">{{ x.apprentice.name }}</span>
                }
              </div>
              <div class="mp-state">
                @if (x.active) {
                  <b class="up">{{ 'udt.mentor.active' | t: { xp: xp() } }}</b>
                  <span class="muted small">{{
                    'udt.mentor.activeText' | t: { mentor: x.mentor.name, pupil: x.apprentice.name }
                  }}</span>
                } @else if (!x.mentor.here) {
                  <b>{{ 'udt.mentor.paused' | t }}</b>
                  <span class="muted small">{{
                    'udt.mentor.mentorGone' | t: { mentor: x.mentor.name }
                  }}</span>
                } @else {
                  <b>{{ 'udt.mentor.done' | t }}</b>
                  <span class="muted small">{{
                    'udt.mentor.pupilGone' | t: { pupil: x.apprentice.name }
                  }}</span>
                }
              </div>
            </div>
          }
        </div>
      }

      <h3>{{ 'udt.mentor.new' | t }}</h3>
      @if (!ready().length) {
        <div class="mp-empty">
          <p>
            {{
              'udt.mentor.noMentor'
                | t: { skill: skillLabel(v.mentorSkill ?? 6), lv: v.mentorLevel }
            }}
          </p>
          @if (closest().length) {
            <p class="muted small">{{ 'udt.mentor.closest' | t }}</p>
            <ul class="mp-why small">
              @for (m of closest(); track m.botId) {
                <li>{{ mentorWhy(m) }}</li>
              }
            </ul>
          }
        </div>
      } @else {
        <div class="mp-step"><span class="n">1</span>{{ 'udt.mentor.step1' | t }}</div>
        <div class="mp-pick">
          @for (m of ready(); track m.botId) {
            <button
              type="button"
              class="mp-pb"
              [class.on]="mentor()?.botId === m.botId"
              [attr.aria-pressed]="mentor()?.botId === m.botId"
              (click)="pickMentor(m.botId)"
            >
              <udt-card [bot]="cardOf(m.botId)!" [small]="true" />
            </button>
          }
        </div>
        @if (mentor(); as m) {
          <div class="mp-step">
            <span class="n">2</span>{{ 'udt.mentor.step2' | t: { mentor: m.name } }}
          </div>
          @if (m.pupils.length) {
            <div class="mp-pick">
              @for (p of m.pupils; track p.botId) {
                <button
                  type="button"
                  class="mp-pb"
                  [class.on]="pupil()?.botId === p.botId"
                  [attr.aria-pressed]="pupil()?.botId === p.botId"
                  (click)="pupilId.set(p.botId)"
                >
                  <udt-card [bot]="cardOf(p.botId)!" [small]="true" />
                </button>
              }
            </div>
          } @else {
            <p class="muted small">{{ 'udt.mentor.noPupil' | t: { mentor: m.name } }}</p>
          }
          @if (pupil(); as p) {
            <div class="mp-step">
              <span class="n">3</span>{{ 'udt.mentor.step3' | t: { pupil: p.name } }}
            </div>
            <div class="mp-lesson">
              @for (k of keys; track k) {
                <div class="mp-row" [class.same]="p.after[k] === p.before[k]">
                  <span class="lbl">{{ 'udt.academy.lesson.' + k | t }}</span>
                  <span class="bar" aria-hidden="true">
                    <i class="base" [style.width.%]="lo(p, k)"></i>
                    <i
                      class="gain"
                      [class.down]="p.after[k] < p.before[k]"
                      [style.left.%]="lo(p, k)"
                      [style.width.%]="hi(p, k) - lo(p, k)"
                    ></i>
                  </span>
                  <span class="num mono">
                    {{ pct(p.before[k], k) }}
                    @if (p.after[k] !== p.before[k]) {
                      → <b>{{ pct(p.after[k], k) }}</b>
                    }
                  </span>
                </div>
              }
            </div>
            <ul class="mp-why small">
              <li>{{ 'udt.mentor.xpFor' | t: { xp: xp(), mentor: m.name } }}</li>
              <li>
                @if (m.traits.length) {
                  {{
                    'udt.mentor.trait'
                      | t: { pct: m.inheritChance * 100, list: traitNames(m.traits) }
                  }}
                } @else {
                  {{ 'udt.mentor.noTrait' | t: { mentor: m.name } }}
                }
              </li>
              <li>{{ 'udt.mentor.once' | t: { pupil: p.name, mentor: m.name } }}</li>
            </ul>
            <button
              type="button"
              class="primary udt"
              [disabled]="busy()"
              (click)="teach.emit({ mentor: m, pupil: p })"
            >
              {{ 'udt.mentor.go' | t: { mentor: m.name, pupil: p.name } }}
            </button>
          }
        }
      }

      @if (mentorNot().length || pupilNot().length) {
        <details class="mp-more">
          <summary class="small">{{ 'udt.mentor.whyNot' | t }}</summary>
          @if (mentorNot().length) {
            <p class="small mp-sub">{{ 'udt.mentor.whyMentor' | t }}</p>
            <ul class="mp-why small">
              @for (w of mentorNot(); track w) {
                <li>{{ w }}</li>
              }
            </ul>
          }
          @if (pupilNot().length) {
            <p class="small mp-sub">
              {{ 'udt.mentor.whyPupil' | t: { mentor: mentor()?.name ?? '' } }}
            </p>
            <ul class="mp-why small">
              @for (w of pupilNot(); track w) {
                <li>{{ w }}</li>
              }
            </ul>
          }
        </details>
      }
    </section>
  `,
  styles: `
    .mp-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .mp-head h2 {
      margin: 0;
    }
    .mp-rules {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    h3 {
      margin: 18px 0 8px;
      font-size: 0.95rem;
    }
    .mp-pairs {
      display: grid;
      gap: 10px;
    }
    .mp-pair {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 14px;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--panel-2);
    }
    .mp-pair.on {
      border-color: rgba(74, 222, 128, 0.45);
    }
    .mp-who {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .mp-arrow {
      font-size: 1.4rem;
      color: var(--udt);
    }
    .mp-away {
      padding: 6px 10px;
      border: 1px dashed var(--line);
      border-radius: var(--radius-sm);
      color: var(--muted);
    }
    .mp-state {
      display: grid;
      gap: 2px;
      flex: 1;
      min-width: 180px;
    }
    .mp-state .up {
      color: var(--live);
    }
    .mp-step {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 14px 0 8px;
      font-weight: 600;
    }
    .mp-step .n {
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--udt);
      color: #fff;
      font-size: 0.8rem;
    }
    .mp-pick {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    .mp-pb {
      position: relative;
      padding: 3px;
      min-height: 0;
      border-radius: 18px;
      border: 2px solid transparent;
      background: transparent;
      transition:
        transform 0.15s,
        border-color 0.15s;
    }
    .mp-pb:hover {
      border-color: var(--line);
    }
    .mp-pb.on {
      border-color: var(--udt);
      box-shadow: 0 0 0 4px rgba(178, 107, 255, 0.18);
      transform: translateY(-3px);
    }
    .mp-lesson {
      display: grid;
      gap: 6px;
      max-width: 520px;
    }
    .mp-row {
      display: grid;
      grid-template-columns: 96px 1fr auto;
      align-items: center;
      gap: 10px;
      font-size: 0.85rem;
    }
    .mp-row.same {
      color: var(--muted);
    }
    .bar {
      position: relative;
      height: 8px;
      border-radius: 4px;
      background: var(--panel-3);
      overflow: hidden;
    }
    .bar i {
      position: absolute;
      top: 0;
      bottom: 0;
    }
    .bar .base {
      left: 0;
      background: var(--line);
    }
    .bar .gain {
      background: var(--live);
    }
    .bar .gain.down {
      background: var(--info);
    }
    .num b {
      color: var(--text);
    }
    .mp-why {
      margin: 8px 0;
      padding-left: 18px;
      color: var(--text-2);
    }
    .mp-empty {
      padding: 10px 12px;
      border: 1px dashed var(--line);
      border-radius: var(--radius);
    }
    .mp-empty p {
      margin: 0 0 6px;
    }
    .mp-more {
      margin-top: 14px;
    }
    .mp-sub {
      margin: 10px 0 0;
      color: var(--text-2);
      font-weight: 600;
    }
    .num {
      min-width: 76px;
      text-align: right;
    }
    .mp-more summary {
      cursor: pointer;
      color: var(--muted);
    }
  `,
})
export class UdtMentorPanel {
  private readonly i18n = inject(I18n);
  readonly academy = input.required<UdtAcademy>();
  readonly busy = input(false);
  /** Card data of the roster bots (with the team's tag). */
  readonly cards = input.required<ReadonlyMap<string, CardBot>>();
  readonly teach = output<{ mentor: UdtMentor; pupil: UdtPupil }>();

  protected readonly keys: readonly LessonKey[] = [
    'accuracy',
    'alertness',
    'strafing',
    'combatStyle',
    'camping',
  ];
  protected readonly mentorId = signal<string | null>(null);
  protected readonly pupilId = signal<string | null>(null);

  /** Mentors that can teach now. */
  protected readonly ready = computed(() => this.academy().mentors.filter((m) => m.ready));
  protected readonly mentor = computed((): UdtMentor | null => {
    const list = this.ready();
    return list.find((m) => m.botId === this.mentorId()) ?? list[0] ?? null;
  });
  protected readonly pupil = computed((): UdtPupil | null => {
    const list = this.mentor()?.pupils ?? [];
    return list.find((p) => p.botId === this.pupilId()) ?? list[0] ?? null;
  });
  /** Without a mentor: the strongest bots and what they still need. */
  protected readonly closest = computed(() =>
    [...this.academy().mentors]
      .filter((m) => !m.ready)
      .sort((a, b) => b.skill - a.skill || b.level - a.level)
      .slice(0, 3),
  );
  protected readonly xp = computed(() =>
    Math.round(((this.academy().apprenticeXp ?? 1.5) - 1) * 100),
  );
  /** Why the other bots cannot be mentors (only when some can: else the empty state says it). */
  protected readonly mentorNot = computed(() =>
    this.ready().length
      ? this.academy()
          .mentors.filter((m) => !m.ready)
          .map((m) => this.mentorWhy(m))
      : [],
  );
  /** Why the other bots cannot learn from the chosen mentor. */
  protected readonly pupilNot = computed(() => {
    const m = this.mentor();
    const roster = this.academy().roster ?? [];
    return (m?.notPupils ?? []).flatMap((n) => {
      const b = roster.find((r) => r.botId === n.botId);
      return b && m ? [this.pupilWhy(b, n.why, m)] : [];
    });
  });

  protected pickMentor(id: string) {
    this.mentorId.set(id);
    this.pupilId.set(null);
  }

  protected cardOf(id: string): CardBot | null {
    return this.cards().get(id) ?? null;
  }

  protected skillLabel(skill: number): string {
    const s = Math.max(0, Math.min(7, Math.round(skill)));
    return `${s} (${this.i18n.t(`skill.${s}`)})`;
  }

  protected mentorWhy(m: UdtMentor): string {
    const v = this.academy();
    if (m.why === 'used' || m.used)
      return this.i18n.t('udt.mentor.why.used', {
        name: m.name,
        pupil: m.apprentice?.name ?? '?',
      });
    if (m.why === 'skill')
      return this.i18n.t('udt.mentor.why.skill', {
        name: m.name,
        skill: this.skillLabel(m.skill),
        need: this.skillLabel(v.mentorSkill ?? 6),
      });
    return this.i18n.t('udt.mentor.why.level', { name: m.name, level: m.level, lv: v.mentorLevel });
  }

  private pupilWhy(b: UdtRosterBot, why: string, m: UdtMentor): string {
    return this.i18n.t(`udt.mentor.not.${why}`, {
      name: b.name,
      skill: this.skillLabel(b.skill),
      mentor: m.name,
      by: b.own?.mentor?.name ?? '?',
    });
  }

  protected traitNames(codes: readonly string[]): string {
    return codes.map((c) => this.i18n.t(`udt.trait.${c}`)).join(', ');
  }

  /** A value on the 0..100 scale (camping 0..1). */
  protected pct(v: number, k: LessonKey): number {
    return Math.round(k === 'camping' ? v * 100 : (v + 1) * 50);
  }

  protected lo(p: UdtPupil, k: LessonKey): number {
    return Math.min(this.pct(p.before[k], k), this.pct(p.after[k], k));
  }

  protected hi(p: UdtPupil, k: LessonKey): number {
    return Math.max(this.pct(p.before[k], k), this.pct(p.after[k], k));
  }
}
