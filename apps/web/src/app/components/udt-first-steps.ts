import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstSteps } from '../core/for-you';
import { TPipe } from '../core/i18n';
import type { UdtHub } from '../core/types';

/** Remembered per browser and season: "done" (all steps were done once) or "hidden". */
const KEY = 'tourney.firstSteps.';

/**
 * "First steps" on the Dream Team hub for managers new this season (decision 312): five steps
 * ticked off from real data - team, lineup, a cup, a market buy, a box - with the next one marked.
 * Replaces the help dialog that opened by itself; once all are done (or hidden) it stays away for
 * the season, even if the lineup gets incomplete again ("For you" says that then).
 */
@Component({
  selector: 'udt-first-steps',
  imports: [RouterLink, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (steps(); as s) {
      <section class="fs" aria-labelledby="fs-t">
        <div class="fs-top">
          <div>
            <h2 id="fs-t">{{ 'udt.fs.title' | t }}</h2>
            <p>{{ 'udt.fs.lead' | t }}</p>
          </div>
          <div class="fs-prog">
            <div
              class="bar"
              role="progressbar"
              aria-valuemin="0"
              [attr.aria-valuemax]="s.length"
              [attr.aria-valuenow]="done()"
              [attr.aria-labelledby]="'fs-t'"
            >
              <i [style.width.%]="(done() / s.length) * 100"></i>
            </div>
            <div class="fs-bl">
              <span>{{ 'udt.fs.progress' | t: { n: done(), of: s.length } }}</span>
              <button type="button" class="link" (click)="hide()">{{ 'udt.fs.hide' | t }}</button>
            </div>
          </div>
        </div>
        <ol class="fs-steps">
          @for (x of s; track x.id; let i = $index) {
            <li [class.ok]="x.done" [class.next]="i === next()">
              <span class="ck" aria-hidden="true">{{ x.done ? '✓' : i + 1 }}</span>
              <span class="tx"
                ><b>{{ 'udt.fs.step.' + x.id | t }}</b
                ><span>{{ 'udt.fs.text.' + x.id | t }}</span>
                @if (x.done) {
                  <span class="sr">{{ 'udt.fs.doneSr' | t }}</span>
                }
              </span>
              @if (i === next()) {
                <a class="btn primary" [routerLink]="x.link">{{ 'udt.fs.go' | t }}</a>
              }
            </li>
          }
        </ol>
      </section>
    }
  `,
  styles: `
    .fs {
      margin: 14px 0 6px;
      padding: 18px 20px;
      border-radius: var(--radius-lg);
      border: 1px solid color-mix(in srgb, var(--udt) 40%, transparent);
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--udt) 9%, var(--panel)),
        color-mix(in srgb, var(--accent) 5%, var(--panel))
      );
    }
    .fs-top {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 300px);
      gap: 8px 32px;
      align-items: end;
      margin-bottom: 14px;
    }
    .fs h2 {
      margin: 0;
      font-size: var(--fs-xl);
    }
    .fs p {
      margin: 4px 0 0;
      color: var(--text-2);
      font-size: var(--fs-sm);
    }
    .bar {
      height: 8px;
      border-radius: var(--radius-pill);
      background: var(--panel-3);
      overflow: hidden;
    }
    .bar i {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, var(--udt), var(--accent));
      transition: width 0.4s;
    }
    .fs-bl {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: var(--muted);
      font-size: var(--fs-sm);
      margin-top: 4px;
    }
    .fs-bl .link {
      color: var(--muted);
    }
    .fs-steps {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
    }
    .fs-steps li {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      padding: 12px;
      border-radius: var(--radius);
      background: var(--panel);
    }
    .fs-steps li.ok {
      opacity: 0.62;
    }
    .fs-steps li.ok b {
      text-decoration: line-through;
      text-decoration-color: var(--muted);
    }
    .fs-steps li.next {
      outline: 1px solid var(--accent);
      background: color-mix(in srgb, var(--accent) 6%, var(--panel));
    }
    .fs-steps li .btn {
      margin-top: auto;
    }
    .ck {
      width: 24px;
      height: 24px;
      flex: none;
      border-radius: 50%;
      border: 2px solid var(--line);
      display: grid;
      place-items: center;
      font-size: var(--fs-xs);
      font-weight: 700;
      color: var(--muted);
    }
    .ok .ck {
      background: var(--live);
      border-color: var(--live);
      color: var(--bg);
    }
    .tx {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .tx span {
      color: var(--muted);
      font-size: var(--fs-sm);
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
    @media (max-width: 900px) {
      .fs {
        padding: 16px 14px;
      }
      .fs-top {
        grid-template-columns: minmax(0, 1fr);
      }
      .fs-steps {
        grid-template-columns: minmax(0, 1fr);
        gap: 6px;
      }
      .fs-steps li {
        flex-direction: row;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
      }
      .fs-steps li .tx {
        flex: 1;
      }
      .fs-steps li .btn {
        margin-top: 0;
      }
    }
  `,
})
export class UdtFirstSteps {
  readonly hub = input.required<UdtHub>();
  private readonly gone = signal(false);

  private readonly all = computed(() => firstSteps(this.hub()));
  protected readonly steps = computed(() => {
    const h = this.hub();
    if (this.gone() || h.season === null || read(h.season)) return null;
    return this.all();
  });
  protected readonly done = computed(() => this.steps()?.filter((s) => s.done).length ?? 0);
  protected readonly next = computed(() => this.steps()?.findIndex((s) => !s.done) ?? -1);

  constructor() {
    // All done once: remembered, so the list does not come back (a lineup can drop again).
    effect(() => {
      const h = this.hub();
      if (h.season !== null && h.onboarding && this.all() === null) write(h.season, 'done');
    });
  }

  protected hide() {
    const s = this.hub().season;
    if (s !== null) write(s, 'hidden');
    this.gone.set(true);
  }
}

function read(season: number): string | null {
  try {
    return localStorage.getItem(KEY + season);
  } catch {
    return null;
  }
}

function write(season: number, v: string) {
  try {
    localStorage.setItem(KEY + season, v);
  } catch {
    // storage unavailable
  }
}
