import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { mmss, momentumBars, racePath } from '../core/live';

/** A line of a race chart: a run's `[sec, points, ...]` samples; `dashed` for the finished run. */
export interface RaceLine {
  samples: readonly number[][];
  side: 'a' | 'b';
  dashed?: boolean;
}

/**
 * Momentum of a game: deathmatch the frag difference over time as bars (side a up, side b down),
 * Monster Hunt the points of both runs over the run time as lines. A dashed line marks "now".
 */
@Component({
  selector: 'app-momentum-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 600 150" preserveAspectRatio="none" role="img" [attr.aria-label]="label()">
      <line
        class="zero"
        x1="0"
        x2="600"
        [attr.y1]="lines() ? 145 : 75"
        [attr.y2]="lines() ? 145 : 75"
      />
      @for (b of bars(); track b.x) {
        <rect
          [attr.x]="b.x"
          [attr.y]="b.y"
          [attr.width]="b.w"
          [attr.height]="b.h"
          [class]="b.side"
          rx="1"
        />
      }
      @for (l of paths(); track $index) {
        <path [attr.d]="l.d" [class]="'ln ' + l.side" [class.dashed]="l.dashed" />
      }
      @if (now() !== null) {
        <line class="now" [attr.x1]="nowX()" [attr.x2]="nowX()" y1="0" y2="150" />
      }
    </svg>
    <div class="axis mono">
      <span>0:00</span><span>{{ mid() }}</span
      ><span>{{ end() }}</span>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    svg {
      display: block;
      width: 100%;
      height: 150px;
    }
    .zero {
      stroke: var(--line);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    rect.a {
      fill: var(--side-a);
    }
    rect.b {
      fill: var(--side-b);
    }
    rect.even {
      fill: var(--line);
    }
    .ln {
      fill: none;
      stroke-width: 3;
      vector-effect: non-scaling-stroke;
      stroke-linejoin: round;
    }
    .ln.a {
      stroke: var(--side-a);
    }
    .ln.b {
      stroke: var(--side-b);
    }
    .ln.dashed {
      stroke-width: 2;
      stroke-dasharray: 6 5;
    }
    .now {
      stroke: var(--live);
      stroke-width: 1.5;
      stroke-dasharray: 3 4;
      vector-effect: non-scaling-stroke;
    }
    .axis {
      display: flex;
      justify-content: space-between;
      font-size: 0.75rem;
      color: var(--muted);
      margin-top: 4px;
    }
  `,
})
export class MomentumChart {
  /** Deathmatch: `[sec, scoreA, scoreB]`. */
  readonly samples = input<readonly number[][]>([]);
  /** Monster Hunt: one line per run. */
  readonly race = input<readonly RaceLine[] | null>(null);
  /** Length of the time axis in seconds. */
  readonly duration = input.required<number>();
  /** Seconds of the game so far (live), null after the game. */
  readonly now = input<number | null>(null);
  readonly label = input('');

  protected readonly lines = computed(() => this.race() !== null);
  protected readonly bars = computed(() =>
    this.lines() ? [] : momentumBars(this.samples(), this.duration()),
  );
  protected readonly paths = computed(() => {
    const race = this.race();
    if (!race) return [];
    const max = Math.max(100, ...race.flatMap((l) => l.samples.map((s) => s[1] ?? 0))) * 1.08;
    return race.map((l) => ({
      d: racePath(l.samples, this.duration(), max),
      side: l.side,
      dashed: !!l.dashed,
    }));
  });
  protected readonly nowX = computed(() =>
    Math.round((Math.min(this.now() ?? 0, this.duration()) / this.duration()) * 600),
  );
  protected readonly mid = computed(() => mmss(this.duration() / 2));
  protected readonly end = computed(() => mmss(this.duration()));
}
