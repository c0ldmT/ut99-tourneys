import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ServerActivity } from '../core/activity';
import { I18n } from '../core/i18n';

/**
 * The activity bar under the header (decision 227): what the server works on (a league
 * evening being set up, with its progress), or that it is busy and answers take long.
 */
@Component({
  selector: 'na-activity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="act"
      [class.on]="activity.shown()"
      [class.busy]="!activity.job() && activity.busy()"
    >
      <!-- Screen readers hear the state once, not every step of the progress. -->
      <span class="sr" role="status">{{ said() }}</span>
      <div class="clip">
        <div class="in">
          @if (activity.shown()) {
            <svg viewBox="0 0 32 32" width="18" height="18" aria-hidden="true">
              <path class="track" d="M16 2 28 9v14l-12 7-12-7V9z" />
              <path class="trace" pathLength="100" d="M16 2 28 9v14l-12 7-12-7V9z" />
            </svg>
            <span class="txt" aria-hidden="true">{{ text() }}</span>
            @if (pct() !== null) {
              <span
                class="meter"
                role="progressbar"
                [attr.aria-valuenow]="pct()"
                aria-valuemin="0"
                aria-valuemax="100"
                [attr.aria-label]="said()"
                ><span [style.width.%]="pct()"></span
              ></span>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .act {
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 0.3s cubic-bezier(0.22, 1, 0.36, 1);
    }
    .act.on {
      grid-template-rows: 1fr;
      border-top: 1px solid rgba(178, 107, 255, 0.35);
      background: linear-gradient(90deg, rgba(34, 211, 238, 0.08), rgba(178, 107, 255, 0.12));
    }
    .act.on.busy {
      border-top-color: rgba(245, 158, 11, 0.4);
      background: rgba(245, 158, 11, 0.1);
    }
    .clip {
      overflow: hidden;
    }
    .in {
      max-width: 1240px;
      margin: 0 auto;
      padding: 7px 20px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text);
    }
    .busy .in {
      color: #fbbf24;
    }
    .txt {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    svg {
      flex: none;
      overflow: visible;
    }
    path {
      fill: none;
      stroke-linejoin: round;
    }
    .track {
      stroke: var(--line);
      stroke-width: 2.4;
    }
    .trace {
      stroke: var(--udt);
      stroke-width: 2.8;
      stroke-dasharray: 30 70;
      animation: trace 1.2s linear infinite;
    }
    .busy .trace {
      stroke: #f59e0b;
    }
    .meter {
      flex: 0 0 120px;
      height: 4px;
      margin-left: auto;
      border-radius: 2px;
      background: var(--panel-3);
      overflow: hidden;
    }
    .meter span {
      display: block;
      height: 100%;
      background: var(--udt);
      transition: width 0.4s ease;
    }
    @keyframes trace {
      from {
        stroke-dashoffset: 100;
      }
      to {
        stroke-dashoffset: 0;
      }
    }
    @media (max-width: 640px) {
      .in {
        padding: 6px 16px;
        font-size: 0.8rem;
      }
      .meter {
        flex-basis: 60px;
      }
    }
  `,
})
export class ActivityBar {
  protected readonly activity = inject(ServerActivity);
  private readonly i18n = inject(I18n);

  protected readonly text = computed(() => {
    const j = this.activity.job();
    if (!j) return this.i18n.t('activity.busy');
    const p = { done: j.done, total: j.total ?? '?' };
    return j.key === 'leagueEvening'
      ? this.i18n.t('activity.leagueEvening', p)
      : this.i18n.t('activity.working');
  });

  /** The state without numbers (what a screen reader hears). */
  protected readonly said = computed(() => {
    const j = this.activity.job();
    if (j)
      return this.i18n.t(
        j.key === 'leagueEvening' ? 'activity.leagueEveningSr' : 'activity.working',
      );
    return this.activity.busy() ? this.i18n.t('activity.busy') : '';
  });

  protected readonly pct = computed(() => {
    const j = this.activity.job();
    return j?.total ? Math.round((100 * j.done) / j.total) : null;
  });
}
