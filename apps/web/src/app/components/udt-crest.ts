import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { UdtCrest } from '../core/types';

/** Outlines of the crest shapes (decision 266). */
const CLIP: Record<string, string> = {
  shield: 'polygon(50% 0, 100% 15%, 100% 60%, 50% 100%, 0 60%, 0 15%)',
  round: 'circle(50% at 50% 50%)',
  diamond: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)',
  star: 'polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
};

/**
 * A team's crest from the trophy room (design "Trophäenraum"): the shape in its colour with the
 * tag's letters. Decorative next to the team name (the name stays readable text).
 */
@Component({
  selector: 'udt-crest',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span
    class="crest"
    aria-hidden="true"
    [style.width.px]="size()"
    [style.height.px]="height()"
    [style.font-size.px]="font()"
    [style.background]="crest().color"
    [style.clip-path]="clip()"
    >{{ letters() }}</span
  >`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      vertical-align: middle;
    }
    .crest {
      display: inline-grid;
      place-items: center;
      color: #07080c;
      font-family: var(--font-display);
      font-weight: 800;
      line-height: 1;
      letter-spacing: 0;
    }
  `,
})
export class UdtCrestMark {
  readonly crest = input.required<UdtCrest>();
  /** The team's tag ("[NX]"): its letters, at most two (three from 40 px). */
  readonly tag = input('');
  readonly size = input(22);

  protected readonly height = computed(() => Math.round(this.size() * 1.1));
  protected readonly font = computed(() => Math.max(8, Math.round(this.size() * 0.38)));
  protected readonly clip = computed(() => CLIP[this.crest().shape] ?? CLIP['shield']);
  protected readonly letters = computed(() =>
    this.tag()
      .replace(/[^\p{L}\p{N}]/gu, '')
      .slice(0, this.size() >= 40 ? 3 : 2)
      .toUpperCase(),
  );
}
