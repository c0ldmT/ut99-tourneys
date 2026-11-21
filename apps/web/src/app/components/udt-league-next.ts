import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import type { LeagueView, UdtAnalysis } from '../core/types';
import { UdtCrestMark } from './udt-crest';

/** A map's record counts for the recommendation from this many games on. */
const MIN_GAMES = 5;

/**
 * "Next league game" on My team (design "MeinTeam"): the game, its kick-off and opponent and,
 * with home advantage, the map choice. With the analysis room (decisions 266, 268; design
 * "Analyse-Raum") also the opponent's lineup, both sides' strength in the game model and the
 * club's record per map with a recommended home map. Shows nothing without a league game.
 */
@Component({
  selector: 'app-udt-league-next',
  imports: [TPipe, RouterLink, NgTemplateOutlet, UdtCrestMark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (next(); as n) {
      <section class="card lg-mynext" aria-labelledby="lg-mynext">
        <div class="lg-mynext-head">
          <div>
            <div class="kpi">
              {{ 'league.nextShort' | t }} · {{ tierName() }} · 5v5
              @if (an()?.next; as a) {
                · {{ (a.home ? 'league.an.home' : 'league.an.away') | t }}
              }
            </div>
            <h2 id="lg-mynext">
              {{ title() }} ·
              @if (n.home.crest; as c) {
                <udt-crest [crest]="c" [tag]="n.home.tag" [size]="22" />
              }
              {{ n.home.name }} vs
              @if (n.away.crest; as c) {
                <udt-crest [crest]="c" [tag]="n.away.tag" [size]="22" />
              }
              {{ n.away.name }}
            </h2>
          </div>
          @if (an()?.next) {
            <span class="lg-an-chip">{{ 'udt.club.k.analysis' | t }}</span>
          } @else if (n.canPickMap) {
            <label class="lg-mynext-map small">
              {{ 'league.mapHome' | t }}
              <ng-container [ngTemplateOutlet]="mapSelect" />
            </label>
          } @else if (n.map) {
            <span class="muted small lg-mynext-map">{{ 'league.mapIs' | t: { map: n.map } }}</span>
          }
        </div>
        <ng-template #mapSelect>
          <select #sel (change)="pick(sel)">
            @if (!n.map) {
              <option value="" selected>{{ 'league.mapRandom' | t }}</option>
            }
            @for (m of pool(); track m) {
              <option [value]="m" [selected]="m === n.map">
                {{ m }}{{ m === best() ? ' (' + ('league.an.rec' | t) + ')' : '' }}
              </option>
            }
          </select>
        </ng-template>
        @if (an()?.next; as a) {
          <div class="lg-an">
            <div class="lg-an-main">
              <h3>
                {{
                  (a.opponent.ai ? 'league.an.oppAi' : 'league.an.opp')
                    | t: { name: a.opponent.name }
                }}
              </h3>
              <div class="lg-an-scroll">
                <table class="lg-an-table">
                  <thead>
                    <tr>
                      <th scope="col">{{ 'league.an.bot' | t }}</th>
                      <th scope="col">Skill</th>
                      <th scope="col">ACC / ALT / STR</th>
                      <th scope="col">{{ 'league.an.traits' | t }}</th>
                      <th scope="col">{{ 'league.an.prestige' | t }}</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (b of a.bots; track $index) {
                      <tr>
                        <td class="nm">{{ b.name }}</td>
                        <td>{{ b.skill }}</td>
                        <td class="mono">
                          {{ pct(b.accuracy) }} / {{ pct(b.alertness) }} / {{ pct(b.strafing) }}
                        </td>
                        <td class="muted">{{ traits(b.traits) }}</td>
                        <td class="pres">{{ b.prestige || '–' }}</td>
                      </tr>
                    } @empty {
                      <tr>
                        <td colspan="5" class="muted">{{ 'league.an.noBots' | t }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <div class="lg-an-str">
                <div class="lg-an-strhead">
                  <b>{{ 'league.an.strength' | t }}</b>
                  <span class="muted">{{
                    'league.an.share'
                      | t: { ours: share().ours, name: a.opponent.name, theirs: share().theirs }
                  }}</span>
                </div>
                <div class="lg-an-bar" role="img" [attr.aria-label]="'league.an.strength' | t">
                  <div class="ours" [style.width.%]="share().ours"></div>
                  <div class="theirs" [style.width.%]="share().theirs"></div>
                </div>
                <span class="muted small">{{
                  'league.an.model' | t: { chance: chancePct() }
                }}</span>
              </div>
            </div>
            <div class="lg-an-side">
              <h3>{{ 'league.an.maps' | t }}</h3>
              <div class="lg-an-maps">
                @for (m of an()?.maps ?? []; track m.map) {
                  <div class="lg-an-map" [class.best]="m.map === best()">
                    <span class="nm">{{ m.map }}</span>
                    <span class="mono muted">{{ record(m) }}</span>
                  </div>
                } @empty {
                  <span class="muted small">{{ 'league.an.noMaps' | t }}</span>
                }
              </div>
              @if (n.canPickMap) {
                <label class="lg-an-pick small">
                  {{ 'league.mapHome' | t }}
                  <ng-container [ngTemplateOutlet]="mapSelect" />
                </label>
                <span class="muted small">{{ 'league.an.recHint' | t: { n: minGames } }}</span>
              } @else if (n.map) {
                <span class="muted small">{{ 'league.mapIs' | t: { map: n.map } }}</span>
              }
            </div>
          </div>
        }
        <p class="muted small">
          {{ 'league.myNextHint' | t }}
          <a routerLink="/udt/league">{{ 'league.toTable' | t }}</a>
        </p>
      </section>
    }
  `,
})
export class UdtLeagueNext {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  private readonly view = signal<LeagueView | null>(null);
  private readonly analysis = signal<UdtAnalysis | null>(null);
  protected readonly next = computed(() => this.view()?.next ?? null);
  protected readonly pool = computed(() => this.view()?.mapPool ?? []);
  protected readonly minGames = MIN_GAMES;

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      const v = await this.api.udtLeague(undefined, true);
      this.view.set(v);
      // The analysis room (refused without it: then nothing more shows).
      if (v.next) this.analysis.set(await this.api.udtLeagueAnalysis().catch(() => null));
    } catch {
      this.view.set(null);
    }
  }

  /** The analysis of the game shown (the API picks the same next game). */
  protected readonly an = computed(() => {
    const a = this.analysis();
    const n = this.next();
    return a && n && (!a.next || a.next.fixtureId === n.id) ? a : null;
  });

  /** Both sides' share of the strength sum (percent, ours first). */
  protected readonly share = computed(() => {
    const s = this.an()?.next?.strength;
    if (!s || s.ours + s.theirs <= 0) return { ours: 50, theirs: 50 };
    const ours = Math.round((100 * s.ours) / (s.ours + s.theirs));
    return { ours, theirs: 100 - ours };
  });

  protected readonly chancePct = computed(() => Math.round(100 * (this.an()?.next?.chance ?? 0.5)));

  /** The recommended home map: the best record from MIN_GAMES games on that is in the pool. */
  protected readonly best = computed(() => {
    const pool = new Set(this.pool());
    let best: { map: string; rate: number; games: number } | null = null;
    for (const m of this.an()?.maps ?? []) {
      const games = m.won + m.lost;
      // Only a winning record is a recommendation.
      if (games < MIN_GAMES || m.won <= m.lost || !pool.has(m.map)) continue;
      const rate = m.won / games;
      if (!best || rate > best.rate || (rate === best.rate && games > best.games))
        best = { map: m.map, rate, games };
    }
    return best?.map ?? null;
  });

  protected pct(v: number): number {
    return Math.round((v + 1) * 50);
  }

  protected traits(codes: string[]): string {
    return codes.length ? codes.map((c) => this.i18n.t(`udt.trait.${c}`)).join(', ') : '–';
  }

  protected record(m: { won: number; lost: number }): string {
    const games = m.won + m.lost;
    if (games < MIN_GAMES)
      return this.i18n.t(games === 1 ? 'league.an.game' : 'league.an.games', { n: games });
    return `${m.won}–${m.lost} (${Math.round((100 * m.won) / games)} %)`;
  }

  protected tierName(): string {
    const t = this.view()?.myClub?.tier ?? 0;
    return t === 0 ? 'Pro Series' : this.i18n.t('league.division', { n: t });
  }

  protected title(): string {
    const n = this.next();
    if (!n) return '';
    const at = new Date(n.scheduledAt).toLocaleString(
      this.i18n.lang() === 'de' ? 'de-DE' : 'en-GB',
      {
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      },
    );
    const what =
      n.kind === 'league'
        ? this.i18n.t('league.matchday', { n: n.matchday })
        : this.i18n.t(`league.kind.${n.kind}`);
    return `${what} · ${at}`;
  }

  protected async pick(sel: HTMLSelectElement) {
    const n = this.next();
    if (!n || !sel.value) return;
    try {
      this.view.set(await this.api.udtLeagueMap(n.id, sel.value));
    } catch {
      // Refused: the select shows the saved map again.
      sel.value = n.map ?? '';
    }
  }
}
