import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { NeuroPipe } from '../core/neuro';
import type { UdtEvent, UdtTableRow } from '../core/types';
import { UdtNav } from '../core/udt';

/** Dream Team tournaments: sign the team up, see which lineup would play (and why not). */
@Component({
  selector: 'app-udt-events',
  imports: [RouterLink, TPipe, NeuroPipe, UdtNav],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    <h1 class="disp">{{ 'udt.events.title' | t }}</h1>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    <div class="evs">
      @for (e of events(); track e.id) {
        <section class="card ev" [class.done]="e.phase === 'finished'">
          <div class="row between">
            <div>
              <a [routerLink]="['/t', e.id]" class="disp name">{{ e.name }}</a>
              <div class="muted small">
                {{ e.teamSize === 1 ? '1v1' : e.teamSize + 'v' + e.teamSize }} ·
                {{ e.game === 'mh' ? 'Monster Hunt' : 'Deathmatch' }} · {{ e.entries }}/{{ e.size }}
                @if (e.scheduledAt) {
                  · {{ when(e.scheduledAt) }}
                }
              </div>
            </div>
            <span class="badge {{ e.phase }}">{{ 'phase.' + e.phase | t }}</span>
          </div>
          <div class="rules">
            @if (e.valueCapNow !== null) {
              <span class="udt-mark">{{ 'udt.events.cap' | t }} {{ e.valueCapNow | neuro }}</span>
            }
            @if (e.rules.starLimit !== null) {
              <span class="udt-mark star">{{
                'udt.events.stars' | t: { n: e.rules.starLimit }
              }}</span>
            }
            @if (e.rules.finale) {
              <span class="udt-mark hs">{{ 'udt.events.finale' | t }}</span>
            }
            @if (e.ticketNow) {
              <span class="udt-mark hs"
                >{{ 'udt.events.highStakes' | t }} · {{ 'udt.events.ticket' | t }}
                {{ e.ticketNow | neuro }}</span
              >
              <span class="udt-mark">{{ 'udt.events.pot' | t }} {{ e.pot | neuro }}</span>
              <span class="udt-mark">{{
                'udt.events.minTeams' | t: { n: e.rules.minTeams ?? 4 }
              }}</span>
            }
            @if (e.entered) {
              <span class="udt-mark own">{{ 'udt.events.entered' | t }}</span>
            }
          </div>
          @if (e.qualified; as q) {
            <p class="small muted">
              {{ 'udt.events.qualified' | t: { n: q.length } }}
              @if (q.includes(myId())) {
                <b class="up">{{ 'udt.events.youQualified' | t }}</b>
              }
            </p>
          }
          @if (e.lineup; as l) {
            @if (l.problems.length) {
              <p class="small" style="color: var(--danger)">{{ l.problems.join(' · ') }}</p>
            } @else if (e.open) {
              <p class="small muted">
                {{ 'udt.events.plays' | t }}: {{ l.bots.join(', ') }} ({{ l.value | neuro }})
              </p>
            }
          }
          <div class="row">
            @if (e.open && !e.entered) {
              <button
                type="button"
                class="primary"
                [disabled]="busy() || !!e.lineup?.problems?.length"
                (click)="enter(e)"
              >
                {{ 'udt.events.enter' | t }}
                @if (e.ticketNow) {
                  · {{ e.ticketNow | neuro }}
                }
              </button>
            }
            @if (e.open && e.entered) {
              <button type="button" [disabled]="busy()" (click)="leave(e)">
                {{ 'udt.events.leave' | t }}
              </button>
            }
            @if (testMode() && e.phase !== 'finished') {
              <button type="button" [disabled]="busy()" (click)="simulate(e)">
                {{ 'udt.test.simulate' | t }}
              </button>
            }
          </div>
        </section>
      } @empty {
        <p class="muted">{{ 'udt.events.none' | t }}</p>
      }
    </div>
  `,
  styles: `
    .evs {
      display: grid;
      gap: 14px;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    }
    .ev {
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .ev.done {
      opacity: 0.7;
    }
    .between {
      justify-content: space-between;
      align-items: flex-start;
    }
    .name {
      font-size: 1.3rem;
      font-weight: 700;
    }
    .up {
      color: var(--live);
    }
    .hs {
      color: #f5c75e;
      border-color: rgba(245, 199, 94, 0.45);
    }
    .rules {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
  `,
})
export class UdtEventsPage {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly i18n = inject(I18n);
  protected readonly events = signal<UdtEvent[]>([]);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly myId = computed(() => this.auth.me()?.id ?? '');
  protected readonly testMode = computed(
    () => !!this.auth.config().testMode && !!this.auth.me()?.isAdmin,
  );

  constructor() {
    void this.load();
  }

  async load() {
    try {
      this.events.set(await this.api.udtEvents());
      this.error.set('');
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  protected when(iso: string) {
    return this.i18n.date(iso);
  }

  protected enter(e: UdtEvent) {
    void this.act(async () => this.events.set(await this.api.udtEnter(e.id)));
  }

  protected leave(e: UdtEvent) {
    void this.act(async () => this.events.set(await this.api.udtLeave(e.id)));
  }

  protected simulate(e: UdtEvent) {
    void this.act(async () => {
      await this.api.udtTestDo(`simulate/${encodeURIComponent(e.id)}`);
      await this.load();
    });
  }

  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set('');
    try {
      await fn();
    } catch (err) {
      this.error.set(errorText(err));
    } finally {
      this.busy.set(false);
    }
  }
}

/** Dream Team season table. */
@Component({
  selector: 'app-udt-table',
  imports: [TPipe, UdtNav],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    <h1 class="disp">{{ 'udt.table.title' | t }}</h1>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    <div class="tablepanel">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>{{ 'udt.table.team' | t }}</th>
            <th class="num">{{ 'udt.table.points' | t }}</th>
            <th class="num">{{ 'udt.table.titles' | t }}</th>
            <th class="num">{{ 'udt.table.events' | t }}</th>
          </tr>
        </thead>
        <tbody>
          @for (r of rows(); track r.userId; let i = $index) {
            <tr>
              <td class="mono">{{ i + 1 }}.</td>
              <td>
                <b style="color: var(--hot-text)">[{{ r.tag }}]</b> {{ r.name }}
                @if (r.ai) {
                  <span class="udt-mark">{{ 'udt.ai' | t }}</span>
                }
              </td>
              <td class="num mono">{{ r.points }}</td>
              <td class="num mono">{{ r.titles }}</td>
              <td class="num mono">{{ r.events }}</td>
            </tr>
          } @empty {
            <tr>
              <td colspan="5" class="muted">{{ 'udt.table.empty' | t }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class UdtTablePage {
  private readonly api = inject(Api);
  protected readonly rows = signal<UdtTableRow[]>([]);
  protected readonly error = signal('');

  constructor() {
    void this.load();
  }

  async load() {
    try {
      this.rows.set(await this.api.udtTable());
      this.error.set('');
    } catch (e) {
      this.error.set(errorText(e));
    }
  }
}
