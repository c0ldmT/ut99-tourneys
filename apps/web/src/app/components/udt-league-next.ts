import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import type { LeagueView } from '../core/types';

/**
 * "Next league game" on My team (design "MeinTeam"): the game, its kick-off and opponent and,
 * with home advantage, the map choice. Shows nothing without a league game.
 */
@Component({
  selector: 'app-udt-league-next',
  imports: [TPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (next(); as n) {
      <section class="card lg-mynext" aria-labelledby="lg-mynext">
        <div class="lg-mynext-head">
          <div>
            <div class="kpi">{{ 'league.nextShort' | t }} · {{ tierName() }} · 5v5</div>
            <h2 id="lg-mynext">{{ title() }} · {{ n.home.name }} vs {{ n.away.name }}</h2>
          </div>
          @if (n.canPickMap) {
            <label class="lg-mynext-map small">
              {{ 'league.mapHome' | t }}
              <select #sel (change)="pick(sel)">
                @if (!n.map) {
                  <option value="" selected>{{ 'league.mapRandom' | t }}</option>
                }
                @for (m of pool(); track m) {
                  <option [value]="m" [selected]="m === n.map">{{ m }}</option>
                }
              </select>
            </label>
          } @else if (n.map) {
            <span class="muted small lg-mynext-map">{{ 'league.mapIs' | t: { map: n.map } }}</span>
          }
        </div>
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
  protected readonly next = computed(() => this.view()?.next ?? null);
  protected readonly pool = computed(() => this.view()?.mapPool ?? []);

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      this.view.set(await this.api.udtLeague(undefined, true));
    } catch {
      this.view.set(null);
    }
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
