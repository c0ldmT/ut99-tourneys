import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { traitByMod, traitLogKind, type TraitLogKind } from '@tourney/udt';
import { TPipe } from '../core/i18n';
import { mmss } from '../core/live';
import type { MatchPlayerView, TraitGameStats } from '../core/types';

interface TraitRow {
  key: string;
  /** Dictionary keys of the name and effect; the mod code when the trait is unknown. */
  name: string;
  rarity: string;
  kind: TraitLogKind;
  /** Dictionary key of what a use is and its parameters. */
  uses: { key: string; n: number };
  /** Dictionary key of the effect (counter traits) and its numbers. */
  effect: { key: string; v: number; w: number } | null;
  sec: number;
  kills: number;
  deaths: number;
  episodes: { time: string; sec: number; kills: number; died: boolean }[];
  /** Episode traits: how they ended - with a kill, the bot's death, or quietly. */
  outcome: { kill: number; died: number; quiet: number } | null;
}

/** What a use of each counter trait is, and its effect text (dictionary `trait.log.*`). */
const COUNTER: Record<string, { uses: string; effect: string }> = {
  kamikaze: { uses: 'trait.log.flakKills', effect: '' },
  'shuffle-dancer': { uses: 'trait.log.dodges', effect: '' },
  'starter-armour': { uses: 'trait.log.spawns', effect: 'trait.log.armour' },
  'thick-skin': { uses: 'trait.log.hits', effect: 'trait.log.prevented' },
  'glass-cannon': { uses: 'trait.log.hits', effect: 'trait.log.glass' },
  vampire: { uses: 'trait.log.heals', effect: 'trait.log.healed' },
};

/**
 * The trait log of a game (mod 0.17.0, decision 237): per bot what each Dream Team trait did -
 * episodes (when it switched on, how long, kills while on, how it ended), counted effects
 * (healed, damage prevented, dodges ...) and the passive values traits.
 */
@Component({
  selector: 'app-trait-log',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (bots().length) {
      <section class="card tl-log">
        <h3>{{ 'trait.log.title' | t }}</h3>
        <p class="muted small">{{ 'trait.log.hint' | t }}</p>
        @for (b of bots(); track b.key) {
          <div class="tl-bot" [class.b]="b.side === 'b'">
            <div class="tl-name">
              <b>{{ b.name }}</b>
              <span class="muted small">
                @if (race()) {
                  {{ 'match.monsters' | t }} {{ b.kills }} ·
                } @else {
                  {{ b.kills }} / {{ b.deaths }} ·
                }
                @if (b.run) {
                  {{ 'match.run' | t: { n: b.run } }}
                }
              </span>
            </div>
            @for (r of b.rows; track r.key) {
              <div class="tl-row">
                <span class="udt-trait r-{{ r.rarity }}">{{ r.name | t }}</span>
                <span class="tl-what small">
                  @switch (r.kind) {
                    @case ('passive') {
                      <span class="muted">{{ 'trait.log.passive' | t }}</span>
                    }
                    @case ('counter') {
                      {{ r.uses.key | t: { n: r.uses.n } }}
                      @if (r.effect; as e) {
                        · <b>{{ e.key | t: { v: e.v, w: e.w } }}</b>
                      }
                    }
                    @default {
                      @if (r.uses.n) {
                        {{ 'trait.log.episodes' | t: { n: r.uses.n, s: r.sec } }}
                        @if (r.outcome; as o) {
                          ·
                          <span class="ok">{{ 'trait.log.withKill' | t: { n: o.kill } }}</span>
                          · <span class="bad">{{ 'trait.log.died' | t: { n: o.died } }}</span> ·
                          <span class="muted">{{ 'trait.log.quiet' | t: { n: o.quiet } }}</span>
                        } @else {
                          · {{ 'trait.log.kd' | t: { k: r.kills, d: r.deaths } }}
                        }
                      } @else {
                        <span class="muted">{{ 'trait.log.never' | t }}</span>
                      }
                    }
                  }
                </span>
                @if (r.episodes.length) {
                  <ol class="tl-eps small">
                    @for (e of r.episodes; track $index) {
                      <li [class.died]="e.died" [class.kill]="!e.died && e.kills > 0">
                        <span class="mono">{{ e.time }}</span> · {{ e.sec }} s
                        @if (e.kills) {
                          · {{ 'feed.traitKills' | t: { n: e.kills } }}
                        }
                        @if (e.died) {
                          · †
                        }
                      </li>
                    }
                  </ol>
                }
              </div>
            }
          </div>
        }
      </section>
    }
  `,
  styles: `
    .tl-log h3 {
      margin: 0 0 4px;
    }
    .tl-bot {
      border-top: 1px solid var(--border);
      padding: 10px 0 6px;
      box-shadow: inset 3px 0 0 var(--side-a);
      padding-left: 10px;
    }
    .tl-bot.b {
      box-shadow: inset 3px 0 0 var(--side-b);
    }
    .tl-name {
      display: flex;
      gap: 8px;
      align-items: baseline;
      flex-wrap: wrap;
      margin-bottom: 4px;
    }
    .tl-row {
      display: flex;
      gap: 8px 10px;
      align-items: center;
      flex-wrap: wrap;
      padding: 3px 0;
    }
    .tl-what {
      flex: 1 1 220px;
      min-width: 0;
    }
    .ok {
      color: var(--ok, #4fd18b);
    }
    .bad {
      color: var(--danger);
    }
    .tl-eps {
      flex-basis: 100%;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 6px;
      list-style: none;
      margin: 2px 0 0;
      padding: 0;
    }
    .tl-eps li {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 1px 8px;
      color: var(--text-2);
    }
    .tl-eps li.kill {
      border-color: rgba(79, 209, 139, 0.6);
    }
    .tl-eps li.died {
      border-color: rgba(255, 90, 90, 0.6);
    }
  `,
})
export class TraitLog {
  readonly players = input.required<readonly MatchPlayerView[]>();
  /** Entrant id of side A (red); side B is blue. */
  readonly sideA = input.required<string>();
  /** Monster Hunt: kills are monsters. */
  readonly race = input(false);

  protected readonly bots = computed(() =>
    this.players()
      .filter((p) => p.traits?.length)
      .map((p) => ({
        key: `${p.name}/${p.run ?? 0}`,
        name: p.name,
        run: p.run,
        side: p.entrantId === this.sideA() ? 'a' : 'b',
        kills: this.race() ? p.monsters : p.kills,
        deaths: p.deaths,
        rows: (p.traits ?? []).map((t) => row(t)),
      })),
  );
}

function row(t: TraitGameStats): TraitRow {
  const def = traitByMod(t.code);
  const code = def?.code ?? t.code;
  const kind: TraitLogKind = def ? traitLogKind(def.code) : 'episode';
  const counter = COUNTER[code];
  const eps = t.episodes ?? [];
  return {
    key: t.code,
    name: def ? `udt.trait.${code}` : t.code,
    rarity: def?.rarity ?? 'common',
    kind,
    uses: { key: counter?.uses ?? 'trait.log.uses', n: t.uses },
    effect: counter?.effect ? { key: counter.effect, v: t.value, w: t.value2 } : null,
    sec: t.sec,
    kills: t.kills,
    deaths: t.deaths,
    episodes: eps.map((e) => ({ time: mmss(e.at), sec: e.sec, kills: e.kills, died: e.died })),
    outcome: eps.length
      ? {
          kill: eps.filter((e) => !e.died && e.kills > 0).length,
          died: eps.filter((e) => e.died).length,
          quiet: eps.filter((e) => !e.died && !e.kills).length,
        }
      : null,
  };
}
