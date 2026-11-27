import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TPipe } from '../core/i18n';

/** A server of the pool as the tempo tiles show it. */
export interface PoolServer {
  id: string;
  name: string;
  online: boolean;
}

/**
 * How many matches a tournament plays at once (decision 324): two tiles, one after the other or
 * parallel with a stepper (2 to `max`), each with the time the bracket takes, the servers of the
 * pool with their state and what to look out for. Stateless: `[(parallel)]`.
 */
@Component({
  selector: 'na-tempo-pick',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="lbl" id="ftempo">{{ 'form.tempo' | t }}</div>
    <div class="tempo" role="radiogroup" aria-labelledby="ftempo">
      <div class="pt" [class.on]="parallel() === 1">
        <button
          type="button"
          role="radio"
          class="pth"
          [attr.aria-checked]="parallel() === 1"
          [disabled]="disabled()"
          (click)="parallelChange.emit(1)"
        >
          <b>{{ 'form.tempoOne' | t }}</b>
          <span class="lanes" aria-hidden="true"><i></i></span>
          <span class="est mono">{{ estimate()(1) }}</span>
          <span class="small muted">{{ 'form.tempoOneHint' | t }}</span>
        </button>
      </div>
      <div class="pt" [class.on]="parallel() > 1">
        <button
          type="button"
          role="radio"
          class="pth"
          [attr.aria-checked]="parallel() > 1"
          [disabled]="disabled()"
          (click)="parallelChange.emit(pick())"
        >
          <b>{{ 'form.tempoPar' | t }}</b>
          <span class="lanes" aria-hidden="true">
            @for (x of lanes(); track x) {
              <i [style.height.%]="100 - x * 9"></i>
            }
          </span>
          <span class="est mono"
            >{{ estimate()(pick()) }}
            @if (online() < pick()) {
              <span class="small muted">{{ 'form.tempoOnline' | t: { n: online() } }}</span>
            }
          </span>
          <span class="small muted">{{ 'form.tempoParHint' | t: { n: pick() } }}</span>
        </button>
        <div class="stp">
          <button
            type="button"
            class="icon"
            [disabled]="disabled() || pick() <= 2"
            (click)="parallelChange.emit(pick() - 1)"
            [attr.aria-label]="'form.tempoLess' | t"
          >
            −
          </button>
          <span class="mono" aria-live="polite">{{ pick() }}</span>
          <button
            type="button"
            class="icon"
            [disabled]="disabled() || pick() >= max()"
            (click)="parallelChange.emit(pick() + 1)"
            [attr.aria-label]="'form.tempoMore' | t"
          >
            +
          </button>
          <span class="small muted">{{ 'form.tempoServers' | t }}</span>
        </div>
      </div>
    </div>
    <div class="pool small">
      <span class="muted">{{ 'form.pool' | t }}</span>
      @for (a of pool(); track a.id) {
        <span class="pchip"
          ><span class="dot" [class.on]="a.online"></span>{{ a.name }}
          @if (!a.online) {
            <span class="muted">· {{ 'agents.offline' | t }}</span>
          }
        </span>
      } @empty {
        <span class="muted">{{ 'form.poolEmpty' | t }}</span>
      }
    </div>
    @if (parallel() > 1) {
      @if (simulated()) {
        <p class="error small">{{ 'form.parallelSimulate' | t }}</p>
      } @else if (online() < parallel()) {
        <p class="notice small">{{ 'form.tempoWait' | t: { n: online(), p: parallel() } }}</p>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .lbl {
      font-size: var(--fs-sm);
      font-weight: 600;
      color: var(--text-2);
      margin: 14px 0 6px;
    }
    .tempo {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .pt {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 14px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel-2);
    }
    .pt.on {
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
    }
    .pth,
    .pth:hover:not(:disabled) {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      padding: 0;
      min-height: 0;
      border: 0;
      background: none;
      text-align: left;
      font-weight: 400;
    }
    .pth b {
      font-family: var(--font-display);
      font-size: var(--fs-lg);
      text-transform: uppercase;
    }
    .lanes {
      display: flex;
      align-items: flex-end;
      gap: 5px;
      height: 34px;
    }
    .lanes i {
      width: 16px;
      height: 100%;
      border-radius: var(--radius-xs);
      background: var(--accent);
    }
    .est {
      font-weight: 700;
      color: var(--text);
    }
    .stp {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .stp button {
      border-color: var(--line);
      font-size: var(--fs-lg);
    }
    .pool {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 8px;
      margin: 10px 0 4px;
    }
    .pchip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      border-radius: var(--radius-pill);
      background: var(--panel-2);
    }
    @media (max-width: 760px) {
      .tempo {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class TempoPick {
  /** Matches at once (1: one after the other). */
  readonly parallel = input.required<number>();
  readonly parallelChange = output<number>();
  /** The servers of the parallel tile while "one after the other" is chosen. */
  readonly remembered = input(2);
  readonly max = input(8);
  /** Servers that could play at once now. */
  readonly online = input(1);
  readonly pool = input<PoolServer[]>([]);
  /** "≈ 2 h 10 min" for a number of servers. */
  readonly estimate = input<(servers: number) => string>(() => '');
  /** Bot matches are simulated: nothing to play side by side. */
  readonly simulated = input(false);
  readonly disabled = input(false);

  protected readonly pick = computed(() =>
    this.parallel() > 1 ? this.parallel() : this.remembered(),
  );
  protected readonly lanes = computed(() => Array.from({ length: this.pick() }, (_, i) => i));
}
