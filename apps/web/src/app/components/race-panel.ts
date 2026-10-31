import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TPipe } from '../core/i18n';
import { finalMs, raceTime } from '../core/race';
import type { LiveInfo, LiveStateView, MatchRunView } from '../core/types';

/**
 * Monster Hunt game in progress: the finished run of the other team and the run on the server
 * (time with the penalty, deaths, points, bosses left) with what is left to beat the first run.
 */
@Component({
  selector: 'app-race-panel',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="runs" [class.one]="!done()">
      @if (done(); as r) {
        <div class="card run">
          <div class="rk">
            {{ 'live.runOf' | t: { n: 1, team: name(r.entrantId) } }} · {{ 'live.runDone' | t }}
          </div>
          <div class="rtime mono">{{ time(total(r)) }}</div>
          <div class="muted small">
            {{ time(r.timeMs) }} + {{ 'match.deaths' | t: { n: r.deaths } }} · {{ r.points }}
            {{ 'match.points' | t }}
            @if (!r.finished) {
              · <span class="lost">{{ 'match.notFinished' | t }}</span>
            }
          </div>
        </div>
      }
      @if (race(); as l) {
        <div class="card run b">
          <div class="rk">
            <span class="live">● {{ 'live.badge' | t }}</span>
            {{ 'live.runOf' | t: { n: l.run, team: name(l.runner) } }}
          </div>
          <!-- the time as it counts: running time plus the penalty for deaths -->
          <div class="rtime mono big">{{ time(l.timeMs + l.penaltyMs) }}</div>
          <div class="muted small">
            {{ time(l.timeMs) }} + {{ time(l.penaltyMs, false) }} ({{
              'match.deaths' | t: { n: l.deaths }
            }})
          </div>
          <div class="boxes">
            <div>
              <span>{{ 'match.deathsShort' | t }}</span
              ><b>{{ l.deaths }}</b>
            </div>
            <div>
              <span>{{ 'live.penalty' | t }}</span
              ><b class="pen">+{{ time(l.penaltyMs, false) }}</b>
            </div>
            <div>
              <span>{{ 'match.points' | t }}</span
              ><b>{{ l.points }}</b>
            </div>
          </div>
          @if (monsters(); as m) {
            <!-- monsters respawn: a count of those alive says nothing, the bosses do -->
            @if (m.bosses > 0) {
              <div class="mon small">
                <span class="muted">{{ 'live.bossesLeft' | t: { n: m.bosses } }}</span>
              </div>
            }
          }
          @if (target(); as tg) {
            <div class="target small">
              @if (tg.ms >= 0) {
                {{ 'live.toBeat' | t }} <b>{{ time(tg.ms, false) }}</b>
              } @else {
                {{ 'live.behind' | t }} <b class="behind">{{ time(-tg.ms, false) }}</b>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .runs {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
      gap: 10px;
      margin-bottom: 10px;
    }
    .runs.one {
      grid-template-columns: minmax(0, 1fr);
    }
    .run {
      margin: 0;
      min-width: 0;
      box-shadow: inset 0 3px 0 var(--side-a);
    }
    .run.b {
      box-shadow: inset 0 3px 0 var(--side-b);
      background: linear-gradient(180deg, rgba(76, 141, 255, 0.07), transparent 60%), var(--panel);
    }
    .rk {
      font-size: 0.8rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 700;
    }
    .live {
      color: var(--live);
      margin-right: 6px;
    }
    .rtime {
      font-size: 2rem;
      font-weight: 600;
      line-height: 1.15;
      margin: 6px 0 2px;
    }
    .rtime.big {
      font-size: 2.6rem;
      color: #cfe0ff;
    }
    .boxes {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-top: 10px;
    }
    .boxes > div {
      background: var(--panel-2);
      border-radius: var(--radius-sm);
      padding: 6px 10px;
      display: grid;
    }
    .boxes span {
      font-size: 0.7rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 700;
    }
    .boxes b {
      font-family: var(--font-mono);
      font-size: 1.1rem;
      font-weight: 600;
    }
    .boxes .pen,
    .lost,
    .behind {
      color: var(--danger);
    }
    .mon {
      margin-top: 12px;
      display: grid;
      gap: 4px;
    }
    .target {
      margin-top: 10px;
      color: var(--text-2);
    }
    .target b {
      font-family: var(--font-mono);
      color: var(--live);
    }
    @media (max-width: 700px) {
      .runs {
        grid-template-columns: minmax(0, 1fr);
      }
      .rtime.big {
        font-size: 2.1rem;
      }
    }
  `,
})
export class RacePanel {
  /** Finished runs of the game. */
  readonly runs = input.required<readonly MatchRunView[]>();
  /** The run on the server (telemetry). */
  readonly race = input<LiveInfo['race'] | null>(null);
  readonly state = input<LiveStateView | null>(null);
  readonly names = input.required<Record<string, string>>();

  protected readonly done = computed(() => {
    const live = this.race();
    return this.runs().find((r) => !live || r.entrantId !== live.runner) ?? null;
  });
  protected readonly monsters = computed(() => this.state()?.monsters ?? null);
  /** Time left to beat the finished run (negative: already slower), penalty included. */
  protected readonly target = computed(() => {
    const d = this.done();
    const l = this.race();
    if (!d || !l || !d.finished) return null;
    return { ms: finalMs(d) - (l.timeMs + l.penaltyMs) };
  });

  protected name(id: string): string {
    return this.names()[id] ?? '?';
  }
  protected total(r: MatchRunView): number {
    return finalMs(r);
  }
  protected time(ms: number, tenths = true): string {
    return raceTime(ms, tenths);
  }
}
