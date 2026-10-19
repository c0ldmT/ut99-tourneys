import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  signal,
  type OnDestroy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18n, TPipe } from '../core/i18n';
import type { UdtBox, UdtCatalogTrait, UdtPull, UdtRarity } from '../core/types';
import { RARITIES } from '../core/udt';

type Phase = 'idle' | 'charge' | 'burst' | 'reveal';

interface Particle {
  a: string;
  r: string;
  dl: string;
}

/** Colour of sparks, glow and rings per rarity (legendary: magenta, the holo runs over it). */
const SPARK: Record<UdtRarity, string> = {
  common: '#9aa4b6',
  uncommon: '#4fd18b',
  rare: '#4f9dff',
  epic: '#b26bff',
  legendary: '#f0468c',
};
export const BOX_STROKE: Record<UdtBox, string> = {
  standard: '#9aa4b6',
  premium: '#b26bff',
  elite: '#ecdcff',
};
/** Icons per trait category (values, body, manager). */
const ICON = {
  values: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0',
  body: 'M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  manager: 'M3 7h18v13H3zM9 7V5h6v2M3 12h18',
} as const;

const rnd = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};
/** Particles on a ring: angle, distance, delay (the same each time: no layout jumps). */
function ring(count: number, rMin: number, rMax: number, seed: number, delayMax: number) {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++)
    out.push({
      a: `${Math.round((i * 360) / count + rnd(seed + i) * 14)}deg`,
      r: `${Math.round(rMin + rnd(seed + i * 3) * (rMax - rMin))}px`,
      dl: `${(rnd(seed + i * 7) * delayMax).toFixed(2)}s`,
    });
  return out;
}

/**
 * The pack opening (design board "Packs"): the box charges up (glow in the colour of the best
 * card, particles, cracks), bursts (flash, rings, halves, sparks, the stage shakes) and deals the
 * cards face down; epic and legendary backs glow, a legendary darkens the stage with rays and a
 * banner. Cards flip one by one or all; a single box flips by itself.
 */
@Component({
  selector: 'udt-pack-stage',
  imports: [RouterLink, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stage" [class.lg]="dark()" aria-live="polite">
      <div class="rays" aria-hidden="true">
        <svg viewBox="0 0 200 200">
          <g fill="rgba(178,107,255,.16)">
            @for (ry of rays; track ry) {
              <path d="M100 100 93 0h14z" [attr.transform]="ry"></path>
            }
          </g>
        </svg>
      </div>

      @switch (phase()) {
        @case ('idle') {
          <div class="idle">
            <svg width="72" height="72" viewBox="0 0 64 64" aria-hidden="true">
              <path
                d="M32 4 56 18v28L32 60 8 46V18z"
                fill="none"
                stroke="#2a3242"
                stroke-width="2"
              />
              <path
                d="M32 18l2.6 6 6.4.6-4.9 4.3 1.5 6.3L32 32l-5.6 3.2 1.5-6.3-4.9-4.3 6.4-.6z"
                fill="#2a3242"
              />
            </svg>
            <div class="disp big">{{ 'udt.packs.choose' | t }}</div>
            <div class="muted">{{ 'udt.packs.chooseText' | t }}</div>
          </div>
        }
        @case ('charge') {
          <div class="ov" [style.--tc]="tc()">
            @for (p of conv; track $index) {
              <i class="pc" [style.--a]="p.a" [style.--r]="p.r" [style.--dl]="p.dl"></i>
            }
            <div class="c-rise">
              <div class="c-shake">
                <div class="glow" [class.holo]="best() === 'legendary'"></div>
                <svg width="220" height="220" viewBox="0 0 64 64" aria-hidden="true" class="rel">
                  <path
                    d="M32 4 56 18v28L32 60 8 46V18z"
                    fill="#121624"
                    [attr.stroke]="crate()"
                    stroke-width="2"
                  />
                  <path
                    d="M8 18l24 14 24-14M32 32v28"
                    fill="none"
                    [attr.stroke]="crate()"
                    stroke-width="1.2"
                    opacity=".6"
                  />
                  <path
                    d="M32 14l2.6 6 6.4.6-4.9 4.3 1.5 6.3L32 28l-5.6 3.2 1.5-6.3-4.9-4.3 6.4-.6z"
                    [attr.fill]="crate()"
                  />
                  <path
                    class="crk"
                    d="M32 4l-2 9 3 6-2 8 2 6-1 9 2 8-2 10"
                    fill="none"
                    stroke="#fff"
                    stroke-width="1.1"
                    stroke-linecap="round"
                  />
                </svg>
              </div>
            </div>
            <div class="hint">{{ chargeText() | t }}</div>
          </div>
        }
        @case ('burst') {
          <div class="ov boom" [style.--tc]="tc()">
            <div class="ring"></div>
            <div class="ring two"></div>
            @for (p of expl; track $index) {
              <i class="pb" [style.--a]="p.a" [style.--r]="p.r" [style.--dl]="p.dl"></i>
            }
            <div class="half l">
              <svg width="220" height="220" viewBox="0 0 64 64" aria-hidden="true">
                <path
                  d="M32 4 8 18v28l24 14z"
                  fill="#121624"
                  [attr.stroke]="crate()"
                  stroke-width="2"
                />
              </svg>
            </div>
            <div class="half r">
              <svg width="220" height="220" viewBox="0 0 64 64" aria-hidden="true">
                <path
                  d="M32 4 56 18v28L32 60z"
                  fill="#121624"
                  [attr.stroke]="crate()"
                  stroke-width="2"
                />
              </svg>
            </div>
            <div class="flash"></div>
          </div>
        }
        @case ('reveal') {
          @if (pull(); as p) {
            <div class="disp stitle">
              {{ p.ten ? ('udt.packs.ten' | t) + ' · ' : '' }}{{ 'udt.packs.box.' + p.box | t }}
            </div>
            <div class="cards" [class.one]="!p.ten">
              @for (c of p.cards; track $index; let i = $index) {
                <button
                  type="button"
                  class="fc"
                  [class.up]="isUp(i)"
                  [class.down]="!isUp(i)"
                  [class.t-e]="c.rarity === 'epic'"
                  [class.t-l]="c.rarity === 'legendary'"
                  [style.--dd]="p.ten ? i * 0.07 + 's' : '0s'"
                  [style.--d]="isUp(i) ? up()[i] : '0s'"
                  [style.--sc]="spark(c.rarity)"
                  [attr.aria-label]="
                    isUp(i)
                      ? ('udt.rarity.' + c.rarity | t) + ': ' + ('udt.trait.' + c.code | t)
                      : ('udt.packs.hidden' | t: { n: i + 1 })
                  "
                  (click)="flip([i], 0)"
                >
                  <span class="fc-in">
                    <span class="face back">
                      <svg width="48" height="48" viewBox="0 0 64 64" aria-hidden="true">
                        <path
                          d="M32 3 57 17.5v29L32 61 7 46.5v-29z"
                          fill="none"
                          stroke="#3a4458"
                          stroke-width="3"
                        />
                        <path
                          d="M32 17l3.8 8.7 9.4.8-7.1 6.3 2.1 9.3L32 37.3l-8.2 4.8 2.1-9.3-7.1-6.3 9.4-.8z"
                          fill="#3a4458"
                        />
                      </svg>
                      <span class="kpi tiny">{{ 'udt.packs.tap' | t }}</span>
                    </span>
                    <span class="face front r-{{ c.rarity }}">
                      <span class="front-in" [class.dup]="c.duplicate">
                        <span class="rk">{{ 'udt.rarity.' + c.rarity | t }}</span>
                        <span class="ic">
                          <svg
                            width="52"
                            height="52"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1.8"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            aria-hidden="true"
                          >
                            <path [attr.d]="icon(c.code)" />
                          </svg>
                        </span>
                        <span class="disp tn">{{ 'udt.trait.' + c.code | t }}</span>
                        <span class="muted te">
                          @if (c.duplicate) {
                            {{ 'udt.packs.dup' | t: { n: c.scrap } }}
                          } @else {
                            {{ 'udt.cat.' + category(c.code) | t }} ·
                            {{ 'udt.traitE.' + c.code | t }}
                          }
                        </span>
                      </span>
                    </span>
                  </span>
                  <span class="sp" aria-hidden="true">
                    @for (s of sparks(c.rarity, i); track $index) {
                      <i [style.--a]="s.a" [style.--r]="s.r"></i>
                    }
                  </span>
                </button>
              }
            </div>
            @if (banner()) {
              <div class="banner" aria-hidden="true">{{ 'udt.packs.legendary' | t }}</div>
            }
            <div class="after">
              @if (!allUp()) {
                <button type="button" (click)="revealAll()">
                  {{ 'udt.packs.revealAll' | t }}
                </button>
              } @else {
                <div class="res">
                  <span class="muted">{{ summary() }}</span>
                  <button type="button" (click)="reset()">{{ 'udt.packs.again' | t }}</button>
                  <a class="btn primary" routerLink="/udt">{{ 'udt.packs.toTeam' | t }}</a>
                </div>
              }
            </div>
          }
        }
      }
    </div>
  `,
  styles: `
    .stage {
      position: relative;
      overflow: hidden;
      margin: 22px 0;
      border-radius: 16px;
      border: 1px solid var(--border);
      min-height: 560px;
      padding: 32px 16px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 20px;
      transition: background-color 0.6s;
      background:
        radial-gradient(60% 70% at 50% 45%, rgba(139, 92, 246, 0.12), transparent 70%),
        repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.02) 0 1px, transparent 1px 44px),
        repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.02) 0 1px, transparent 1px 44px),
        #08090e;
    }
    .stage.lg {
      background-color: #030306;
    }
    .idle {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      text-align: center;
      max-width: 460px;
    }
    .big {
      font-size: 1.8rem;
      font-weight: 700;
    }
    .ov {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }
    .rel {
      position: relative;
    }
    .c-rise {
      animation: udt-rise 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) both;
    }
    .c-shake {
      position: relative;
      width: 220px;
      height: 220px;
      animation: udt-shake 1.6s 0.45s ease-in both;
    }
    .glow {
      position: absolute;
      inset: -60px;
      border-radius: 50%;
      background: radial-gradient(circle, var(--tc), transparent 62%);
      animation: udt-glowup 2s ease-in both;
    }
    .glow.holo {
      background: radial-gradient(circle, #f0468c, transparent 62%);
      animation:
        udt-glowup 2s ease-in both,
        udt-hue 1.2s linear infinite;
    }
    .pc {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 6px;
      height: 6px;
      margin: -3px;
      border-radius: 50%;
      background: var(--tc);
      box-shadow: 0 0 12px var(--tc);
      animation: udt-conv 1.1s ease-in infinite both;
      animation-delay: var(--dl);
    }
    .crk {
      animation: udt-cracks 2s ease-in both;
    }
    .hint {
      position: absolute;
      bottom: 40px;
      left: 0;
      right: 0;
      text-align: center;
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 1.4rem;
      letter-spacing: 0.3em;
      text-transform: uppercase;
      color: var(--text-2);
      animation: udt-float 1.2s ease-in-out infinite;
    }
    .flash {
      position: absolute;
      inset: 0;
      background: #fff;
      animation: udt-flash 0.7s ease-out both;
      pointer-events: none;
    }
    .ring {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 120px;
      height: 120px;
      margin: -60px;
      border-radius: 50%;
      border: 5px solid var(--tc);
      box-shadow: 0 0 30px var(--tc);
      animation: udt-ring 0.8s ease-out both;
    }
    .ring.two {
      animation-delay: 0.12s;
      border-width: 2px;
    }
    .half {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 220px;
      height: 220px;
      margin: -110px;
    }
    .half.l {
      animation: udt-flyl 0.7s cubic-bezier(0.2, 0.7, 0.3, 1) both;
    }
    .half.r {
      animation: udt-flyr 0.7s cubic-bezier(0.2, 0.7, 0.3, 1) both;
    }
    .pb {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 8px;
      height: 8px;
      margin: -4px;
      border-radius: 2px;
      background: var(--tc);
      box-shadow: 0 0 14px var(--tc);
      animation: udt-expl 0.9s cubic-bezier(0.1, 0.8, 0.3, 1) both;
      animation-delay: var(--dl);
    }
    .boom {
      animation: udt-stageshake 0.45s ease-out both;
    }
    .stitle {
      position: relative;
      font-size: 1.35rem;
      font-weight: 700;
      color: var(--text-2);
      letter-spacing: 0.14em;
    }
    .cards {
      position: relative;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 150px));
      gap: 18px;
      justify-content: center;
    }
    .cards.one {
      grid-template-columns: minmax(0, 200px);
    }
    .fc {
      position: relative;
      display: block;
      width: 150px;
      height: 206px;
      min-height: 0;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
      perspective: 1000px;
      animation: udt-deal 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) both;
      animation-delay: var(--dd);
      font: inherit;
      color: inherit;
      text-align: left;
    }
    .cards.one .fc {
      width: 200px;
      height: 274px;
    }
    .fc:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 4px;
      border-radius: 14px;
    }
    .fc-in {
      position: absolute;
      inset: 0;
      transform-style: preserve-3d;
      transform: rotateY(180deg);
      transition: transform 0.85s cubic-bezier(0.3, 0.7, 0.2, 1.25);
      transition-delay: var(--d);
    }
    .fc.up .fc-in {
      transform: rotateY(0);
    }
    .fc.down:hover .fc-in {
      transform: rotateY(180deg) translateY(-6px);
    }
    .face {
      position: absolute;
      inset: 0;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
      border-radius: 14px;
    }
    .back {
      transform: rotateY(180deg);
      background: repeating-linear-gradient(45deg, #121624 0 6px, #0e111b 6px 12px);
      border: 2px solid #2a3242;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .tiny {
      font-size: 0.62rem;
    }
    .fc.t-e.down .back {
      border-color: #6b3fa8;
      animation: udt-teaseE 1.3s ease-in-out infinite;
    }
    .fc.t-l.down .back {
      border-color: #8b5cf6;
      animation: udt-teaseL 1.6s linear infinite;
    }
    .fc.t-l.down {
      animation:
        udt-deal 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) both,
        udt-wob 0.6s ease-in-out infinite;
    }
    .front {
      display: block;
      padding: 2px;
      background: var(--rc);
    }
    .fc.up .front {
      animation: udt-pulse 2.4s ease-in-out infinite;
    }
    .front.r-legendary {
      background-size: 200% 200%;
      animation: udt-holo 3s linear infinite;
    }
    .fc.up .front.r-legendary {
      animation:
        udt-holo 3s linear infinite,
        udt-pulse 1.8s ease-in-out infinite;
    }
    .front-in {
      height: 100%;
      box-sizing: border-box;
      border-radius: 12px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: relative;
      overflow: hidden;
      background: radial-gradient(120% 70% at 50% 0%, var(--rg), transparent 70%), #0c0f16;
    }
    .front-in.dup {
      filter: saturate(0.5);
    }
    .front.r-legendary .front-in::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(
        115deg,
        transparent 35%,
        rgba(255, 255, 255, 0.18) 48%,
        transparent 60%
      );
      background-size: 250% 100%;
      animation: udt-holo 2.6s linear infinite;
    }
    .rk {
      font-size: 0.62rem;
      font-weight: 700;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--rt);
    }
    .ic {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--rt);
    }
    .tn {
      font-size: 1.15rem;
      font-weight: 700;
      line-height: 1;
    }
    .te {
      font-size: 0.7rem;
      line-height: 1.3;
    }
    .sp {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 0;
      height: 0;
      pointer-events: none;
    }
    .sp i {
      position: absolute;
      width: 7px;
      height: 7px;
      margin: -3px;
      border-radius: 50%;
      background: var(--sc);
      box-shadow: 0 0 12px var(--sc);
      opacity: 0;
    }
    .fc.up .sp i {
      animation: udt-expl 0.9s cubic-bezier(0.1, 0.8, 0.3, 1) both;
      animation-delay: calc(var(--d) + 0.4s);
    }
    .after {
      position: relative;
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: center;
      min-height: 44px;
    }
    .res {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: center;
      animation: udt-fade 0.5s ease both;
    }
    @media (prefers-reduced-motion: reduce) {
      .c-shake,
      .boom,
      .flash,
      .fc.t-l.down,
      .crate,
      .rays svg {
        animation: none;
      }
    }
  `,
})
export class UdtPackStage implements OnDestroy {
  private readonly i18n = inject(I18n);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly catalog = input<UdtCatalogTrait[]>([]);
  protected readonly phase = signal<Phase>('idle');
  protected readonly pull = signal<UdtPull | null>(null);
  /** Flipped cards: index -> flip delay. */
  protected readonly up = signal<Record<number, string>>({});
  protected readonly dark = signal(false);
  protected readonly banner = signal(false);
  protected readonly conv = ring(28, 160, 300, 3, 1.1);
  protected readonly expl = ring(44, 180, 460, 11, 0.12);
  protected readonly rays = Array.from({ length: 18 }, (_, i) => `rotate(${i * 20} 100 100)`);
  private timers: ReturnType<typeof setTimeout>[] = [];
  private readonly sparkCache = new Map<string, Particle[]>();

  /** Charging or bursting: no new box until the cards are dealt. */
  readonly animating = computed(() => this.phase() === 'charge' || this.phase() === 'burst');
  protected readonly best = computed<UdtRarity>(() =>
    (this.pull()?.cards ?? []).reduce<UdtRarity>(
      (m, c) => (RARITIES.indexOf(c.rarity) > RARITIES.indexOf(m) ? c.rarity : m),
      'common',
    ),
  );
  protected readonly tc = computed(() => SPARK[this.best()]);
  protected readonly crate = computed(() => BOX_STROKE[this.pull()?.box ?? 'standard']);
  protected readonly chargeText = computed(() => {
    const i = RARITIES.indexOf(this.best());
    return i >= 4 ? 'udt.packs.charge4' : i >= 3 ? 'udt.packs.charge3' : 'udt.packs.charge0';
  });
  protected readonly allUp = computed(
    () => Object.keys(this.up()).length >= (this.pull()?.cards.length ?? 0),
  );
  protected readonly summary = computed(() => {
    const count = new Map<UdtRarity, number>();
    for (const c of this.pull()?.cards ?? []) count.set(c.rarity, (count.get(c.rarity) ?? 0) + 1);
    return [...RARITIES]
      .reverse()
      .filter((r) => count.get(r))
      .map((r) => `${count.get(r)}× ${this.i18n.t(`udt.rarity.${r}`)}`)
      .join(' · ');
  });

  ngOnDestroy(): void {
    this.clear();
  }

  private clear() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(setTimeout(fn, ms));
  }

  /** Charge up (2.1 s), burst (0.75 s), deal; a single box flips by itself. */
  play(p: UdtPull) {
    this.clear();
    this.pull.set(p);
    this.up.set({});
    this.dark.set(false);
    this.banner.set(false);
    this.phase.set('charge');
    // On a phone the stage is below the boxes: bring it into view.
    this.host.nativeElement.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    this.later(2100, () => this.phase.set('burst'));
    this.later(2850, () => this.phase.set('reveal'));
    if (!p.ten) this.later(3700, () => this.flip([0], 0));
  }

  protected spark(r: UdtRarity) {
    return SPARK[r];
  }

  protected category(code: string) {
    return this.catalog().find((c) => c.code === code)?.category ?? 'values';
  }

  protected icon(code: string) {
    return ICON[this.category(code)];
  }

  protected sparks(r: UdtRarity, i: number): Particle[] {
    const key = `${r}:${i}`;
    let s = this.sparkCache.get(key);
    if (!s) {
      const n = r === 'legendary' ? 22 : r === 'epic' ? 16 : r === 'rare' ? 10 : 0;
      s = ring(n, 70, r === 'legendary' ? 190 : 120, i * 31 + 5, 0);
      this.sparkCache.set(key, s);
    }
    return s;
  }

  protected isUp(i: number) {
    return this.up()[i] !== undefined;
  }

  /** Flips cards one after another (`step` seconds apart); a legendary darkens the stage. */
  protected flip(idx: number[], step: number) {
    const cards = this.pull()?.cards ?? [];
    const up = { ...this.up() };
    let lgAt = -1;
    idx.forEach((i, n) => {
      if (up[i] !== undefined) return;
      up[i] = `${(n * step).toFixed(2)}s`;
      if (cards[i]?.rarity === 'legendary' && lgAt < 0) lgAt = n * step;
    });
    this.up.set(up);
    if (lgAt >= 0) {
      this.later(Math.round(lgAt * 1000) + 450, () => {
        this.dark.set(true);
        this.banner.set(true);
      });
      this.later(Math.round(lgAt * 1000) + 2700, () => this.banner.set(false));
    }
  }

  protected revealAll() {
    const n = this.pull()?.cards.length ?? 0;
    this.flip(
      Array.from({ length: n }, (_, i) => i).filter((i) => !this.isUp(i)),
      0.22,
    );
  }

  protected reset() {
    this.clear();
    this.phase.set('idle');
    this.pull.set(null);
    this.up.set({});
    this.dark.set(false);
    this.banner.set(false);
  }
}
