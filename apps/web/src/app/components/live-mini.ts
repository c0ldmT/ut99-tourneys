import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TPipe } from '../core/i18n';
import { hpColor } from '../core/live';
import { NameTag } from '../core/looks';
import type { LivePlayer } from '../core/types';

export interface MiniSide {
  id: string;
  name: string;
  /** Deathmatch: frags; Monster Hunt: the run's time (final, running or a dash). */
  score: string;
  /** Monster Hunt: raw time, deaths, penalty. */
  detail?: string;
  running?: boolean;
}

/** Most players a side lists (the match page has all of them). */
const MAX_ROWS = 5;

/**
 * The match being played on the tournament page, in the match page's look: a scorebar in the
 * side colours with clock and limits, below it each side's players with health and frags (mod
 * 0.16.0). The whole panel links to the match page.
 */
@Component({
  selector: 'app-live-mini',
  imports: [RouterLink, TPipe, NameTag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="lm" [routerLink]="link()" [attr.aria-label]="label()">
      <div class="lm-top">
        <span class="lm-badge" [class.on]="live()">{{ 'live.badge' | t }}</span>
        <b class="lm-id">{{ matchId() }}</b>
        @if (gameText()) {
          <span class="muted small">{{ gameText() }}</span>
        }
        <span class="lm-go small">{{ 'tp.toMatch' | t }} →</span>
      </div>
      @let s = sides();
      @if (s.length === 2) {
        <div class="lm-bar" [class.race]="race()">
          @for (x of s; track x.id; let i = $index) {
            @if (i === 1) {
              <div class="lm-mid">
                @if (race()) {
                  <span class="lm-vs">vs</span>
                } @else {
                  <span class="lm-sc"
                    ><b class="lm-a">{{ s[0]!.score }}</b
                    ><i>:</i><b class="lm-b">{{ s[1]!.score }}</b></span
                  >
                }
                @if (clock() || limits()) {
                  <span class="lm-clk small">
                    @if (clock(); as c) {
                      <b class="mono">{{ c }}</b>
                    }
                    @if (clock() && limits()) {
                      ·
                    }
                    {{ limits() }}
                  </span>
                }
              </div>
            }
            <div class="lm-side" [class.b]="i === 1">
              <span class="lm-nm">{{ x.name }}</span>
              @if (x.running) {
                <span class="badge running">{{ 'race.running' | t }}</span>
              }
              @if (race()) {
                <span class="lm-time mono">{{ x.score }}</span>
                @if (x.detail) {
                  <span class="muted small">{{ x.detail }}</span>
                }
              }
            </div>
          }
        </div>
      }
      <p class="lm-status small">
        <span>{{ status() }}</span>
        @if (delayed() > 0) {
          <span class="lm-delay">{{ 'live.delayed' | t: { n: delayed() } }}</span>
        }
      </p>
      @if (rows().length) {
        <div class="lm-teams" [class.one]="rows().length === 1">
          @for (r of rows(); track r.id) {
            <div class="lm-team" [class.b]="r.index === 1">
              @for (p of r.players; track $index) {
                <div class="lm-p" [class.dead]="!p.alive">
                  <span class="lm-pn"
                    ><na-name [name]="p.name" />
                    @if (p.bot) {
                      <span class="badge bot">BOT</span>
                    }
                  </span>
                  <span
                    class="lm-hp"
                    [title]="('live.health' | t) + ' ' + (p.alive ? p.health : '–')"
                    ><span [style.width.%]="hpW(p)" [style.background]="hp(p)"></span
                  ></span>
                  <span
                    class="lm-kd mono"
                    [title]="(race() ? 'live.monstersDeaths' : 'live.kd') | t"
                    ><b>{{ p.kills }}</b> / {{ p.deaths }}</span
                  >
                </div>
              }
              @if (r.more) {
                <span class="muted small">+{{ r.more }}</span>
              }
            </div>
          }
        </div>
      }
    </a>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .lm {
      display: grid;
      gap: 8px;
      padding: 14px 16px;
      border-radius: var(--radius);
      border: 1px solid var(--live);
      color: inherit;
      text-decoration: none;
      background:
        linear-gradient(
          90deg,
          rgba(255, 77, 94, 0.1),
          transparent 35%,
          transparent 65%,
          rgba(76, 141, 255, 0.1)
        ),
        var(--panel);
      transition:
        border-color 0.15s,
        transform 0.15s;
    }
    .lm:hover,
    .lm:focus-visible {
      border-color: var(--accent);
      transform: translateY(-1px);
    }
    .lm:hover .lm-go,
    .lm:focus-visible .lm-go {
      color: var(--accent-hover);
    }
    .lm-top {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .lm-badge {
      font-size: 0.66rem;
      font-weight: 800;
      letter-spacing: 0.1em;
      padding: 1px 6px;
      border-radius: 4px;
      color: var(--muted);
      border: 1px solid var(--line);
    }
    .lm-badge.on {
      color: var(--bg);
      background: var(--live);
      border-color: var(--live);
      animation: lm-pulse 1.6s ease-in-out infinite;
    }
    @keyframes lm-pulse {
      50% {
        opacity: 0.55;
      }
    }
    .lm-go {
      margin-left: auto;
      color: var(--accent);
      font-weight: 600;
    }
    .lm-bar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
      gap: 14px;
    }
    .lm-side {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      min-width: 0;
      gap: 2px;
    }
    .lm-side.b {
      align-items: flex-end;
      text-align: right;
    }
    .lm-nm {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--font-display);
      font-weight: 800;
      font-style: italic;
      text-transform: uppercase;
      font-size: 1.4rem;
      color: var(--side-a);
    }
    .lm-side.b .lm-nm {
      color: var(--side-b);
    }
    .lm-time {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text);
    }
    .lm-mid {
      display: grid;
      justify-items: center;
    }
    .lm-sc {
      font-family: var(--font-display);
      font-weight: 800;
      font-size: 2.8rem;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .lm-sc i {
      color: var(--muted);
      font-style: normal;
      padding: 0 8px;
    }
    .lm-a {
      color: var(--side-a);
    }
    .lm-b {
      color: var(--side-b);
    }
    .lm-vs {
      color: var(--muted);
      font-family: var(--font-display);
      font-size: 1.2rem;
    }
    .lm-clk {
      color: var(--muted);
      white-space: nowrap;
    }
    .lm-clk b {
      color: var(--text);
    }
    .lm-status {
      margin: 0;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: center;
      color: var(--text-2);
    }
    .lm-delay {
      color: var(--neuro-text);
    }
    .lm-teams {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 8px 16px;
      padding-top: 8px;
      border-top: 1px solid var(--border);
    }
    .lm-teams.one {
      grid-template-columns: minmax(0, 1fr);
    }
    .lm-team {
      display: grid;
      gap: 4px;
      align-content: start;
      padding-left: 8px;
      box-shadow: inset 2px 0 0 var(--side-a);
    }
    .lm-team.b {
      box-shadow: inset 2px 0 0 var(--side-b);
    }
    .lm-p {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 72px auto;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
    }
    .lm-p.dead {
      opacity: 0.45;
    }
    .lm-pn {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .lm-hp {
      height: 6px;
      border-radius: 3px;
      background: var(--panel-3);
      overflow: hidden;
    }
    .lm-hp span {
      display: block;
      height: 100%;
      transition: width 0.4s;
    }
    .lm-kd {
      min-width: 44px;
      text-align: right;
      color: var(--text-2);
    }
    .lm-kd b {
      color: var(--text);
    }
    @media (max-width: 600px) {
      .lm {
        padding: 12px;
      }
      .lm-bar {
        gap: 8px;
      }
      .lm-nm {
        font-size: 1rem;
      }
      .lm-sc {
        font-size: 2.2rem;
      }
      .lm-time {
        font-size: 1.1rem;
      }
      .lm-teams {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class LiveMini {
  readonly link = input.required<unknown[]>();
  readonly matchId = input.required<string>();
  readonly gameText = input('');
  readonly sides = input.required<MiniSide[]>();
  readonly status = input('');
  readonly clock = input<string | null>(null);
  readonly limits = input('');
  readonly players = input<LivePlayer[] | null>(null);
  readonly race = input(false);
  /** The game runs (the badge pulses); before it the panel shows the call and the vote. */
  readonly live = input(false);
  readonly delayed = input(0);

  protected readonly label = computed(() =>
    this.sides()
      .map((s) => `${s.name} ${s.score}`)
      .join(' – '),
  );

  /** Each side's players, most frags first; a race only the team that runs. */
  protected readonly rows = computed(() => {
    const ps = this.players() ?? [];
    if (!ps.length) return [];
    const sides = this.sides();
    const shown = this.race() ? sides.filter((s) => s.running) : sides;
    return shown
      .map((s) => {
        const list = ps
          .filter((p) => p.side === s.id)
          .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name));
        return {
          id: s.id,
          index: sides.indexOf(s),
          players: list.slice(0, MAX_ROWS),
          more: Math.max(0, list.length - MAX_ROWS),
        };
      })
      .filter((r) => r.players.length);
  });

  protected hp(p: LivePlayer) {
    return hpColor(p.health);
  }

  protected hpW(p: LivePlayer) {
    return p.alive ? Math.min(100, Math.max(0, p.health)) : 0;
  }
}
