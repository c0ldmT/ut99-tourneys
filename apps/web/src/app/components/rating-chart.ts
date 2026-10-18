import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

export interface RatingPoint {
  at: string;
  before?: number;
  after: number;
  delta: number;
  tournamentId: string;
  tournamentName?: string;
  matchId: string;
  game: number;
}

const W = 760;
const H = 230;
const PAD = { l: 44, r: 14, t: 14, b: 26 };

/**
 * A player's rating over the games of a season (one mode): a 2px line, a dot per game
 * (green up, red down), the 1500 start as a dashed line, faint marks where a new tournament
 * starts, a crosshair with tooltip on hover.
 */
@Component({
  selector: 'app-rating-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (geo(); as g) {
      <div class="wrap">
        <svg
          [attr.viewBox]="'0 0 ' + w + ' ' + h"
          role="img"
          [attr.aria-label]="label()"
          (pointermove)="hover($event)"
          (pointerleave)="active.set(null)"
        >
          @for (y of g.ticks; track y.v) {
            <line
              class="grid"
              [attr.x1]="pad.l"
              [attr.x2]="w - pad.r"
              [attr.y1]="y.y"
              [attr.y2]="y.y"
            />
            <text class="tick" [attr.x]="pad.l - 8" [attr.y]="y.y + 4" text-anchor="end">
              {{ y.v }}
            </text>
          }
          @if (g.base !== null) {
            <line
              class="base"
              [attr.x1]="pad.l"
              [attr.x2]="w - pad.r"
              [attr.y1]="g.base"
              [attr.y2]="g.base"
            />
          }
          @for (s of g.starts; track s.x) {
            <line
              class="start"
              [attr.x1]="s.x"
              [attr.x2]="s.x"
              [attr.y1]="pad.t"
              [attr.y2]="h - pad.b"
            />
          }
          <path class="line" [attr.d]="g.path" />
          @if (active(); as i) {
            <line
              class="cross"
              [attr.x1]="g.pts[i]!.x"
              [attr.x2]="g.pts[i]!.x"
              [attr.y1]="pad.t"
              [attr.y2]="h - pad.b"
            />
          }
          @for (p of g.pts; track $index; let i = $index) {
            @if (i > 0) {
              <circle
                class="dot"
                [class.up]="p.d > 0"
                [class.down]="p.d < 0"
                [class.on]="active() === i"
                [attr.cx]="p.x"
                [attr.cy]="p.y"
                [attr.r]="active() === i ? 5.5 : 3.5"
              />
            }
          }
          <text class="axis" [attr.x]="pad.l" [attr.y]="h - 8">{{ g.first }}</text>
          <text class="axis" [attr.x]="w - pad.r" [attr.y]="h - 8" text-anchor="end">
            {{ g.last }}
          </text>
        </svg>
        @if (active(); as i) {
          <div
            class="tip"
            [style.left.%]="(g.pts[i]!.x / w) * 100"
            [class.flip]="g.pts[i]!.x > w * 0.6"
          >
            <b class="mono">{{ g.pts[i]!.v }}</b>
            <span class="mono" [class.up]="g.pts[i]!.d > 0" [class.down]="g.pts[i]!.d < 0">{{
              signed(g.pts[i]!.d)
            }}</span>
            <div class="muted">{{ g.pts[i]!.label }}</div>
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .wrap {
      position: relative;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      touch-action: pan-y;
      font-family: var(--font);
    }
    .grid {
      stroke: var(--border);
      stroke-width: 1;
    }
    .base {
      stroke: var(--line);
      stroke-dasharray: 4 4;
    }
    .start {
      stroke: rgba(240, 70, 140, 0.25);
      stroke-width: 1;
    }
    .tick,
    .axis {
      fill: var(--muted);
      font-size: 11px;
    }
    .line {
      fill: none;
      stroke: var(--accent);
      stroke-width: 2;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .cross {
      stroke: var(--text-2);
      stroke-width: 1;
    }
    .dot {
      fill: var(--muted);
      stroke: var(--panel);
      stroke-width: 2;
    }
    .dot.up {
      fill: var(--live);
    }
    .dot.down {
      fill: var(--danger);
    }
    .tip {
      position: absolute;
      top: 6px;
      transform: translateX(12px);
      background: var(--panel-3);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 0.82rem;
      pointer-events: none;
      white-space: nowrap;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
    }
    .tip.flip {
      transform: translateX(calc(-100% - 12px));
    }
    .tip b {
      margin-right: 6px;
    }
    .up {
      color: var(--live);
    }
    .down {
      color: var(--danger);
    }
  `,
})
export class RatingChart {
  /** The games of one mode, oldest first. */
  readonly points = input.required<RatingPoint[]>();
  readonly label = input('Rating');
  readonly locale = input('de-DE');
  protected readonly w = W;
  protected readonly h = H;
  protected readonly pad = PAD;
  protected readonly active = signal<number | null>(null);

  protected readonly geo = computed(() => {
    const pts = this.points();
    if (!pts.length) return null;
    // The rating before the first game is the start of the line.
    const first = pts[0]!;
    const values = [first.before ?? first.after - first.delta, ...pts.map((p) => p.after)];
    let lo = Math.min(...values, 1500);
    let hi = Math.max(...values, 1500);
    const span = Math.max(40, hi - lo);
    lo = Math.floor((lo - span * 0.1) / 10) * 10;
    hi = Math.ceil((hi + span * 0.1) / 10) * 10;
    const n = values.length;
    const x = (i: number) => PAD.l + (n === 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r));
    const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * (H - PAD.t - PAD.b);
    const date = (iso: string) =>
      new Date(iso).toLocaleDateString(this.locale(), { day: '2-digit', month: '2-digit' });
    const xy = values.map((v, i) => ({
      x: x(i),
      y: y(v),
      v,
      d: i === 0 ? 0 : pts[i - 1]!.delta,
      label:
        i === 0
          ? ''
          : `${pts[i - 1]!.tournamentName ?? pts[i - 1]!.tournamentId} · ${pts[i - 1]!.matchId} G${pts[i - 1]!.game} · ${date(pts[i - 1]!.at)}`,
    }));
    const step = niceStep((hi - lo) / 4);
    const ticks: { v: number; y: number }[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push({ v, y: y(v) });
    const starts = pts
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i > 0 && p.tournamentId !== pts[i - 1]!.tournamentId)
      .map(({ i }) => ({ x: (x(i) + x(i + 1)) / 2 }));
    return {
      pts: xy,
      path: xy.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(''),
      ticks,
      base: 1500 >= lo && 1500 <= hi ? y(1500) : null,
      starts,
      first: date(first.at),
      last: date(pts.at(-1)!.at),
    };
  });

  protected hover(ev: PointerEvent) {
    const g = this.geo();
    if (!g || g.pts.length < 2) return;
    const svg = ev.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let best = 1;
    for (let i = 1; i < g.pts.length; i++)
      if (Math.abs(g.pts[i]!.x - px) < Math.abs(g.pts[best]!.x - px)) best = i;
    this.active.set(best);
  }

  protected signed(n: number): string {
    return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0';
  }
}

function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}
