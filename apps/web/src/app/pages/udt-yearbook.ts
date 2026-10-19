import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api, errorText } from '../core/api';
import { Auth } from '../core/auth';
import { I18n, TPipe } from '../core/i18n';
import { NeuroPipe } from '../core/neuro';
import type {
  UdtBreeder,
  UdtHall,
  UdtHallEntry,
  UdtYearbook,
  UdtYearbookEntry,
} from '../core/types';
import { botRarity, UdtCard, UdtNav, type CardBot } from '../core/udt';

/**
 * Dream Team yearbook: the class of a season (every bot the managers made, graduates first with
 * their badge), the best breeders, and for admins the graduations waiting for approval.
 */
@Component({
  selector: 'app-udt-yearbook',
  imports: [FormsModule, TPipe, NeuroPipe, UdtCard, UdtNav],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    @if (isAdmin() && nominations().length) {
      <section class="card">
        <h2>{{ 'udt.yearbook.nominations' | t }} ({{ nominations().length }})</h2>
        <p class="muted small">{{ 'udt.yearbook.nominationsText' | t }}</p>
        @for (n of nominations(); track n.botId) {
          <div class="nrow">
            <span class="grow"
              ><b>{{ n.name }}</b>
              <span class="muted small"
                >[{{ n.tag }}] {{ n.team }} · {{ n.breeder }} · {{ 'udt.level' | t }}
                {{ n.level }} · {{ n.games }} {{ 'udt.academy.games' | t }}</span
              >
              @if (n.honours) {
                <span class="udt-mark star">{{ 'udt.yearbook.honours' | t }}</span>
              }
            </span>
            <input
              type="text"
              maxlength="20"
              [name]="'r' + n.botId"
              [placeholder]="'udt.yearbook.rename' | t"
              [ngModel]="renames()[n.botId] ?? ''"
              (ngModelChange)="setRename(n.botId, $event)"
            />
            <button type="button" [disabled]="busy()" (click)="reject(n)">
              {{ 'udt.trades.decline' | t }}
            </button>
            <button type="button" class="primary" [disabled]="busy()" (click)="approve(n)">
              {{ 'udt.yearbook.approve' | t }}
            </button>
          </div>
        }
      </section>
    }
    @if (book(); as y) {
      <div class="udt-head">
        <div>
          <h1 class="disp">{{ 'udt.yearbook.title' | t }}</h1>
          <p class="muted">{{ 'udt.yearbook.intro' | t }}</p>
        </div>
        @if (y.seasons.length > 1) {
          <label
            >{{ 'udt.yearbook.season' | t }}
            <select [ngModel]="y.season" (ngModelChange)="pick($event)" name="season">
              @for (s of y.seasons; track s) {
                <option [ngValue]="s">{{ s }}</option>
              }
            </select>
          </label>
        }
      </div>
      <div class="class">
        @for (b of y.bots; track b.botId) {
          <figure class="entry" [class.grad]="b.status === 'graduated'">
            <udt-card [bot]="card(b)" [small]="true" />
            <figcaption>
              @if (b.status === 'graduated') {
                <span class="udt-mark star">{{
                  (b.honours ? 'udt.yearbook.withHonours' : 'udt.yearbook.graduated') | t
                }}</span>
              }
              <div class="small">[{{ b.tag }}] {{ b.team }}</div>
              <div class="muted small">
                {{ 'udt.yearbook.breeder' | t }} {{ b.breeder }} ·
                {{ 'udt.academy.origin.' + b.origin | t }}
              </div>
              <div class="muted small">
                {{ 'udt.level' | t }} {{ b.level }} · {{ b.games }} {{ 'udt.academy.games' | t }}
              </div>
            </figcaption>
          </figure>
        } @empty {
          <p class="muted">{{ 'udt.yearbook.empty' | t }}</p>
        }
      </div>
    }
    @if (hall(); as h) {
      <section class="card">
        <h2>{{ 'udt.hall.title' | t }}</h2>
        <p class="muted small">{{ 'udt.hall.intro' | t }}</p>
        <div class="class">
          @for (r of h.retired; track r.botId) {
            <figure class="entry grad">
              <udt-card [bot]="hallCard(r)" [small]="true" />
              <figcaption>
                @if (r.homegrown) {
                  <span class="udt-mark star">{{ 'udt.market.homegrown' | t }}</span>
                }
                @if (r.career; as c) {
                  <div class="muted small">
                    {{ 'udt.career.seasons' | t: { n: c.age } }} · {{ 'udt.career.level' | t }}
                    {{ c.level }}
                  </div>
                  <div class="muted small">
                    {{ c.games }} {{ 'udt.career.games' | t }} · {{ c.wins }}
                    {{ 'udt.career.wins' | t }}
                  </div>
                }
              </figcaption>
            </figure>
          } @empty {
            <p class="muted small">{{ 'udt.hall.empty' | t }}</p>
          }
        </div>
        @if (h.candidates.length) {
          <h3>{{ 'udt.hall.candidates' | t }}</h3>
          @for (c of h.candidates; track c.botId) {
            <div class="nrow">
              <span class="grow"
                ><b>{{ c.name }}</b>
                <span class="muted small"
                  >{{ 'udt.career.seasons' | t: { n: c.career.age } }} · {{ c.career.games }}
                  {{ 'udt.career.games' | t }}</span
                ></span
              >
              <button type="button" [disabled]="busy()" (click)="retire(c.botId)">
                {{ 'udt.hall.retire' | t }}
              </button>
            </div>
          }
        }
      </section>
    }
    <section class="card">
      <h2>{{ 'udt.yearbook.breeders' | t }}</h2>
      <div class="tablepanel">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>{{ 'udt.yearbook.manager' | t }}</th>
              <th class="num">{{ 'udt.yearbook.graduates' | t }}</th>
              <th class="num">{{ 'udt.yearbook.honoursCol' | t }}</th>
              <th class="num">{{ 'udt.yearbook.bonus' | t }}</th>
            </tr>
          </thead>
          <tbody>
            @for (r of breeders(); track r.userId; let i = $index) {
              <tr>
                <td class="mono">{{ i + 1 }}.</td>
                <td>{{ r.name }}</td>
                <td class="num mono">{{ r.graduates }}</td>
                <td class="num mono">{{ r.honours }}</td>
                <td class="num mono">{{ r.bonus | neuro }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="muted">{{ 'udt.yearbook.noBreeders' | t }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: `
    .class {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 16px;
      margin-bottom: 18px;
    }
    .entry {
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-items: flex-start;
      opacity: 0.8;
    }
    .entry.grad {
      opacity: 1;
    }
    .nrow {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 0;
      border-top: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .grow {
      flex: 1 1 220px;
      min-width: 0;
    }
  `,
})
export class UdtYearbookPage {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly i18n = inject(I18n);
  protected readonly book = signal<UdtYearbook | null>(null);
  protected readonly breeders = signal<UdtBreeder[]>([]);
  protected readonly nominations = signal<UdtYearbookEntry[]>([]);
  protected readonly hall = signal<UdtHall | null>(null);
  protected readonly renames = signal<Partial<Record<string, string>>>({});
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly isAdmin = computed(() => !!this.auth.me()?.isAdmin);

  constructor() {
    void this.load();
  }

  async load(season?: number) {
    try {
      const [y, b, h] = await Promise.all([
        this.api.udtYearbook(season),
        this.api.udtBreeders(),
        this.api.udtHall(),
      ]);
      this.book.set(y);
      this.breeders.set(b);
      this.hall.set(h);
      if (this.isAdmin()) this.nominations.set(await this.api.udtNominations());
      this.error.set('');
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  protected pick(s: number) {
    void this.load(Number(s));
  }

  protected card(b: UdtYearbookEntry): CardBot {
    return {
      name: b.name,
      skill: b.skill,
      rarity: botRarity(b.skill),
      traits: b.traits,
      tag: b.tag,
    };
  }

  protected hallCard(r: UdtHallEntry): CardBot {
    return {
      name: r.name,
      skill: r.skill,
      rarity: botRarity(r.skill),
      traits: r.traits,
      career: r.career,
    };
  }

  protected async retire(id: string) {
    if (!confirm(this.i18n.t('udt.hall.retireConfirm'))) return;
    await this.act(async () => {
      await this.api.udtRetire(id);
      this.hall.set(await this.api.udtHall());
    });
  }

  protected setRename(id: string, v: string) {
    this.renames.update((r) => ({ ...r, [id]: v }));
  }

  protected async approve(n: UdtYearbookEntry) {
    const name = (this.renames()[n.botId] ?? '').trim();
    await this.act(async () => {
      this.nominations.set(await this.api.udtApprove(n.botId, name || undefined));
      await this.load(this.book()?.season);
    });
  }

  protected async reject(n: UdtYearbookEntry) {
    await this.act(async () => this.nominations.set(await this.api.udtReject(n.botId)));
  }

  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    this.error.set('');
    try {
      await fn();
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }
}
