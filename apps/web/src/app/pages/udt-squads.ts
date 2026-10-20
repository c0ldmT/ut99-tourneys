import { ChangeDetectionStrategy, Component, inject, input, signal, effect } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { TPipe } from '../core/i18n';
import { NeuroPipe } from '../core/neuro';
import type { UdtRosterBot, UdtSquad, UdtSquadRow } from '../core/types';
import { rosterCard, UdtCard, UdtNav, type CardBot } from '../core/udt';

/** Every team of the Dream Team season (humans first), to look at their squads. */
@Component({
  selector: 'app-udt-squads',
  imports: [RouterLink, TPipe, NeuroPipe, UdtNav],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    <div class="udt-head">
      <div>
        <h1 class="disp">{{ 'udt.squads.title' | t }}</h1>
        <p class="muted">{{ 'udt.squads.intro' | t }}</p>
      </div>
    </div>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    <div class="tablepanel">
      <table>
        <thead>
          <tr>
            <th>{{ 'udt.table.team' | t }}</th>
            <th>{{ 'udt.squads.manager' | t }}</th>
            <th class="num">{{ 'udt.squads.bots' | t }}</th>
            <th class="num">{{ 'udt.teamValue' | t }}</th>
          </tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.userId) {
            <tr [class.mine]="r.mine">
              <td>
                <a [routerLink]="['/udt/squads', r.userId]"
                  ><b style="color: var(--hot-text)">{{ r.tag }}</b> {{ r.name }}</a
                >
                @if (r.ai) {
                  <span class="udt-mark">{{ 'udt.ai' | t }}</span>
                }
                @if (r.mine) {
                  <span class="udt-mark own">{{ 'udt.squads.mine' | t }}</span>
                }
              </td>
              <td>{{ r.manager }}</td>
              <td class="num mono">{{ r.bots }}</td>
              <td class="num mono">{{ r.value | neuro }}</td>
            </tr>
          } @empty {
            <tr>
              <td colspan="4" class="muted">{{ 'udt.squads.empty' | t }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    tr.mine td {
      background: rgba(178, 107, 255, 0.06);
    }
  `,
})
export class UdtSquadsPage {
  private readonly api = inject(Api);
  protected readonly rows = signal<UdtSquadRow[]>([]);
  protected readonly error = signal('');

  constructor() {
    void this.load();
  }

  async load() {
    try {
      this.rows.set(await this.api.udtSquads());
      this.error.set('');
    } catch (e) {
      this.error.set(errorText(e));
    }
  }
}

/** One manager's squad: the bots as cards with level, traits, stamina and value. */
@Component({
  selector: 'app-udt-squad',
  imports: [RouterLink, TPipe, NeuroPipe, UdtNav, UdtCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    <p>
      <a routerLink="/udt/squads">← {{ 'udt.squads.title' | t }}</a>
    </p>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (squad(); as s) {
      <div class="udt-head">
        <div>
          <h1 class="disp">
            <span style="color: var(--hot-text)">{{ s.team.tag }}</span> {{ s.team.name }}
          </h1>
          <p class="muted">
            {{ 'udt.squads.managedBy' | t: { name: s.manager } }}
            @if (s.ai) {
              <span class="udt-mark">{{ 'udt.ai' | t }}</span>
            }
          </p>
        </div>
        <div class="udt-kpis">
          <div>
            <div class="kpi">{{ 'udt.squads.bots' | t }}</div>
            <div class="v">{{ s.roster.length }}</div>
          </div>
          <div>
            <div class="kpi">{{ 'udt.teamValue' | t }}</div>
            <div class="v">{{ value(s) | neuro }}</div>
          </div>
        </div>
      </div>
      <div class="cards">
        @for (b of s.roster; track b.botId) {
          <div class="slot">
            <udt-card [bot]="card(b, s.team.tag)" />
            <div class="small muted tags">
              @if (b.dmSlot) {
                <span class="udt-mark">DM {{ b.dmSlot }}</span>
              }
              @if (b.mhSlot) {
                <span class="udt-mark">MH {{ b.mhSlot }}</span>
              }
              @if (b.starter) {
                <span class="udt-mark own">{{ 'udt.starter' | t }}</span>
              } @else if (b.own) {
                <span class="udt-mark own">{{ 'udt.academy.origin.' + b.own.origin | t }}</span>
              }
              <a [routerLink]="['/bots', b.botId]">{{ 'udt.squads.profile' | t }}</a>
            </div>
          </div>
        }
      </div>
    }
  `,
  styles: `
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    .slot {
      display: grid;
      gap: 6px;
    }
    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
  `,
})
export class UdtSquadPage {
  private readonly api = inject(Api);
  readonly userId = input.required<string>();
  protected readonly squad = signal<UdtSquad | null>(null);
  protected readonly error = signal('');

  constructor() {
    effect(() => {
      this.userId();
      void this.load();
    });
  }

  async load() {
    try {
      this.squad.set(await this.api.udtSquad(this.userId()));
      this.error.set('');
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  protected value(s: UdtSquad): number {
    return s.roster.reduce((n, b) => n + b.value, 0);
  }

  protected card(b: UdtRosterBot, tag: string): CardBot {
    return rosterCard(b, tag);
  }
}
