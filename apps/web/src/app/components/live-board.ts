import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18n, TPipe } from '../core/i18n';
import { hpColor, pingClass, PU_AMP, PU_BELT, PU_BOOTS, PU_INVIS, sideSum } from '../core/live';
import { NameTag } from '../core/looks';
import type { LivePlayer } from '../core/types';

export interface LiveSide {
  id: string;
  name: string;
  /** 0 = red (a), 1 = blue (b). */
  index: number;
}

interface Chip {
  cls: string;
  label: string;
}

/** Armour shown as a full bar (shield belt 150 plus body armour 100). */
const ARMOR_FULL = 250;

/**
 * The players of the game in progress (mod 0.16.0): one big card per side in a duel, a table
 * per side from two players on (scales to 5on5; two lines per player when narrow). Health and
 * armour bars, weapon, powerups, counters and the players' ping.
 */
@Component({
  selector: 'app-live-board',
  imports: [TPipe, NameTag],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (duel()) {
      <div class="duel">
        @for (s of rows(); track s.side.id) {
          @for (p of s.players; track $index) {
            <div class="pcard" [class.b]="s.side.index === 1" [class.dead]="!p.alive">
              <div class="ptop">
                <span class="pname"><na-name [name]="p.name" /></span>
                @if (p.bot) {
                  <span class="badge bot">BOT</span>
                }
                @if (p.ping !== undefined) {
                  <span [class]="pingCls(p.ping)">{{ p.ping }} ms</span>
                }
              </div>
              <div class="blabel">
                <span>{{ 'live.health' | t }}</span
                ><b>{{ p.alive ? p.health : '–' }}</b>
              </div>
              <div class="lc-bar">
                <span [style.width.%]="hpW(p)" [style.background]="hp(p)"></span>
              </div>
              <div class="blabel">
                <span>{{ 'live.armor' | t }}</span
                ><b>{{ p.armor }}</b>
              </div>
              <div class="lc-bar thin"><span class="lc-ar" [style.width.%]="arW(p)"></span></div>
              <div class="prow">
                @if (p.weapon) {
                  <span class="lc-chip">{{ p.weapon }}</span>
                }
                @for (c of chips(p); track c.label) {
                  <span [class]="c.cls">{{ c.label }}</span>
                }
              </div>
              <div class="pstats">
                <span
                  >{{ 'live.damage' | t }} <b>{{ p.damageDealt }}</b></span
                >
                <span
                  >{{ 'live.taken' | t }} <b>{{ p.damageTaken }}</b></span
                >
                <span
                  >K/D <b>{{ p.kills }} / {{ p.deaths }}</b></span
                >
              </div>
            </div>
          }
        }
      </div>
    } @else {
      <div class="board" [class.one]="rows().length === 1">
        @for (s of rows(); track s.side.id) {
          <div class="card team" [class.b]="s.side.index === 1">
            <div class="lc-head">
              <h3>{{ s.side.name }}</h3>
              <span class="muted small">{{
                'live.teamSum' | t: { alive: s.sum.alive, n: s.sum.count, dmg: s.sum.damage }
              }}</span>
            </div>
            <div class="trow th">
              <span class="tn">{{ 'live.player' | t }}</span>
              <span class="tb">{{ 'live.healthArmor' | t }}</span>
              <span class="tw">{{ 'live.weapon' | t }}</span>
              <span class="tk">{{ (race() ? 'live.monstersDeaths' : 'live.kd') | t }}</span>
              <span class="td">{{ 'live.damage' | t }}</span>
              <span class="tp">Ping</span>
            </div>
            @for (p of s.players; track $index) {
              <div class="trow" [class.dead]="!p.alive">
                <span class="tn">
                  <span class="nm"><na-name [name]="p.name" /></span>
                  @if (p.bot) {
                    <span class="badge bot">BOT</span>
                  }
                </span>
                <span class="tb">
                  <span class="lc-bar"
                    ><span [style.width.%]="hpW(p)" [style.background]="hp(p)"></span
                  ></span>
                  <span class="lc-bar thin"
                    ><span class="lc-ar" [style.width.%]="arW(p)"></span
                  ></span>
                </span>
                <span class="tw">
                  @if (p.weapon) {
                    <span class="lc-chip">{{ p.weapon }}</span>
                  }
                  @for (c of chips(p); track c.label) {
                    <span [class]="c.cls">{{ c.label }}</span>
                  }
                </span>
                <span class="tk mono" [title]="(race() ? 'live.monstersDeaths' : 'live.kd') | t">
                  <b>{{ p.kills }}</b> / {{ p.deaths }}
                </span>
                <span class="td mono" [title]="'live.damage' | t">{{ p.damageDealt }}</span>
                <span class="tp">
                  @if (p.ping !== undefined) {
                    <span [class]="pingCls(p.ping)">{{ p.ping }}</span>
                  }
                </span>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      container-type: inline-size;
    }
    .duel,
    .board {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 10px;
      margin-bottom: 10px;
    }
    .board.one {
      grid-template-columns: minmax(0, 1fr);
    }
    .pcard,
    .team {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px 16px;
      margin: 0;
      min-width: 0;
      box-shadow: inset 0 3px 0 var(--side-a);
      transition: opacity 0.3s;
    }
    .pcard.b,
    .team.b {
      box-shadow: inset 0 3px 0 var(--side-b);
    }
    .pcard.dead {
      opacity: 0.55;
    }
    .ptop {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      min-width: 0;
    }
    .ptop .lc-ping {
      margin-left: auto;
    }
    .pname {
      font-family: var(--font-display);
      font-weight: 800;
      font-style: italic;
      text-transform: uppercase;
      font-size: 1.5rem;
      line-height: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--side-a);
    }
    .b .pname {
      color: var(--side-b);
    }
    .blabel {
      display: flex;
      justify-content: space-between;
      font-size: 0.78rem;
      color: var(--text-2);
      margin: 2px 0 3px;
    }
    .blabel b {
      font-family: var(--font-mono);
      color: var(--text);
      font-weight: 600;
    }
    .pcard .lc-bar {
      margin-bottom: 8px;
    }
    .prow {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      min-height: 22px;
    }
    .pstats {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 14px;
      margin-top: 8px;
      font-size: 0.8rem;
      color: var(--text-2);
    }
    .pstats b {
      font-family: var(--font-mono);
      color: var(--text);
      font-weight: 600;
    }
    .trow {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(60px, 1fr) minmax(0, 1.6fr) 64px 58px 40px;
      grid-template-areas: 'n b w k d p';
      gap: 4px 10px;
      align-items: center;
      padding: 6px 0;
      border-top: 1px solid var(--border);
      min-height: 42px;
    }
    .trow.th {
      min-height: 0;
      padding: 0 0 6px;
      border-top: 0;
      font-size: 0.7rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 700;
    }
    .trow.th > span {
      white-space: normal;
      line-height: 1.15;
    }
    .trow.dead {
      opacity: 0.5;
    }
    .tn {
      grid-area: n;
      display: flex;
      align-items: center;
      gap: 2px;
      min-width: 0;
      font-weight: 700;
    }
    .tn .nm {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tb {
      grid-area: b;
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    .tb .lc-bar {
      height: 8px;
    }
    .tb .lc-bar.thin {
      height: 4px;
    }
    .tw {
      grid-area: w;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      align-items: center;
      min-width: 0;
    }
    .tk,
    .td,
    .tp {
      text-align: right;
      font-size: 0.8rem;
      color: var(--text-2);
      white-space: nowrap;
    }
    .tk {
      grid-area: k;
    }
    .td {
      grid-area: d;
    }
    .tp {
      grid-area: p;
    }
    .tk b {
      color: var(--text);
    }
    @container (max-width: 1060px) {
      .board:not(.one) .trow {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) 46px 50px 36px;
        grid-template-areas: 'n n k d p' 'b w w w w';
        gap: 4px 8px;
      }
      .board:not(.one) .trow.th {
        display: none;
      }
    }
    @container (max-width: 640px) {
      .duel,
      .board {
        grid-template-columns: minmax(0, 1fr);
      }
      .trow {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) 46px 50px 36px;
        grid-template-areas: 'n n k d p' 'b w w w w';
        gap: 4px 8px;
      }
      .trow.th {
        display: none;
      }
      .pname {
        font-size: 1.15rem;
      }
    }
  `,
})
export class LiveBoard {
  private readonly i18n = inject(I18n);
  readonly players = input.required<readonly LivePlayer[]>();
  /** The sides on the server (a race: only the running team). */
  readonly sides = input.required<readonly LiveSide[]>();
  /** Monster Hunt: kills are monsters. */
  readonly race = input(false);

  protected readonly rows = computed(() =>
    this.sides().map((side) => ({
      side,
      players: this.players().filter((p) => p.side === side.id),
      sum: sideSum(this.players(), side.id),
    })),
  );
  /** One player against one: the big cards. */
  protected readonly duel = computed(
    () => this.rows().length === 2 && this.rows().every((r) => r.players.length === 1),
  );

  protected hp(p: LivePlayer): string {
    return hpColor(p.health);
  }
  protected hpW(p: LivePlayer): number {
    return p.alive ? Math.min(100, Math.max(0, p.health)) : 0;
  }
  protected arW(p: LivePlayer): number {
    return Math.min(100, Math.round((p.armor / ARMOR_FULL) * 100));
  }
  protected pingCls(ping: number): string {
    return pingClass(ping);
  }

  protected chips(p: LivePlayer): Chip[] {
    const t = (k: string, v?: Record<string, string | number>) => this.i18n.t(k, v);
    if (!p.alive) return [{ cls: 'lc-pu dead', label: t('live.dead') }];
    const out: Chip[] = [];
    if (p.powerups & PU_AMP)
      out.push({
        cls: 'lc-pu amp',
        label: p.ampSec ? t('live.pu.ampSec', { n: p.ampSec }) : t('live.pu.amp'),
      });
    if (p.powerups & PU_BELT) out.push({ cls: 'lc-pu belt', label: t('live.pu.belt') });
    if (p.powerups & PU_INVIS) out.push({ cls: 'lc-pu', label: t('live.pu.invis') });
    if (p.powerups & PU_BOOTS) out.push({ cls: 'lc-pu', label: t('live.pu.boots') });
    return out;
  }
}
