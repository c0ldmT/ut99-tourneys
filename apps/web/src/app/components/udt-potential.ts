import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18n, TPipe } from '../core/i18n';
import { potLine, potNames, potState, potText, SKILL_NAMES } from '../core/udt';

type Step = 'on' | 'reach' | 'maybe' | 'lock' | 'lock bt';

/**
 * A bot's potential as a skill ladder (Novice to Godlike): the skill it has, the steps it can
 * surely reach, the uncertain ones (the potential shows as a range until level 5) and the locked
 * ones, with a line on what is left. Own bots, talents and blueprints.
 */
@Component({
  selector: 'udt-potential',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let st = state();
    <div class="udt-pot" [class.reached]="st.kind === 'reached'" [class.compact]="compact()">
      <div class="udt-pot-head">
        <span class="udt-pot-lbl">{{ 'udt.pot.label' | t }}</span>
        <b class="udt-pot-val" [title]="names()">{{ text() }}</b>
        @if (!compact()) {
          <span class="udt-pot-st">
            @switch (st.kind) {
              @case ('reached') {
                {{ (next() !== null ? 'udt.pot.reachedBt' : 'udt.pot.reached') | t }}
              }
              @case ('maybe') {
                {{ 'udt.pot.maybe' | t: { n: st.b } }}
              }
              @default {
                {{ (st.a === st.b ? 'udt.pot.left1' : 'udt.pot.left') | t: { a: st.a, b: st.b } }}
              }
            }
          </span>
        }
      </div>
      <div class="udt-pot-lad" role="img" [attr.aria-label]="aria()">
        @for (s of steps(); track $index; let i = $index) {
          <span class="udt-pot-s {{ s }}" [title]="i + ' ' + skillName(i)"
            ><i>{{ i }}</i></span
          >
        }
      </div>
    </div>
  `,
})
export class UdtPotential {
  readonly skill = input.required<number>();
  readonly potential = input.required<readonly [number, number]>();
  /** One line without the explanation (cards in lists). */
  readonly compact = input(false);
  /** The step a breakthrough would open (marked on the ladder), null: none. */
  readonly next = input<number | null>(null);

  protected readonly state = computed(() => potState(this.skill(), this.potential()));
  protected readonly text = computed(() => potText(this.potential()));
  protected readonly names = computed(() => potNames(this.potential()));
  protected readonly steps = computed<Step[]>(() => {
    const s = Math.round(this.skill());
    const [lo, hi] = this.potential();
    return Array.from({ length: 8 }, (_, i) =>
      i <= s
        ? 'on'
        : i <= lo
          ? 'reach'
          : i <= hi
            ? 'maybe'
            : i === this.next()
              ? 'lock bt'
              : 'lock',
    );
  });
  private readonly i18n = inject(I18n);
  protected readonly aria = computed(() => potLine(this.i18n, this.skill(), this.potential()));

  protected skillName(i: number) {
    return SKILL_NAMES[i] ?? '';
  }
}
