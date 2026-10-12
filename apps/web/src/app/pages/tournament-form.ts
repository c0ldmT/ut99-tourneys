import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api, errorText } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import type { AgentView, BotSpec, TournamentDetail } from '../core/types';

const STOCK_POOL = [
  'DM-Deck16][',
  'DM-Morpheus',
  'DM-Phobos',
  'DM-Codex',
  'DM-Pressure',
  'DM-Curse][',
];
const DEFAULT_BOTS: BotSpec[] = [
  'Xan',
  'Loque',
  'Malcolm',
  'Brock',
  'Lauren',
  'Visse',
  'Tamika',
  'Dominator',
].map((name, i) => ({ name, skill: [6, 5, 5, 4, 4, 3, 3, 2][i] ?? 3 }));

interface Model {
  name: string;
  agentId: string;
  profileId: string;
  connectAddress: string;
  scheduledAt: string;
  registrationOpen: boolean;
  format: 'single' | 'double';
  size: number;
  grandFinalReset: boolean;
  boDefault: number;
  boSemi: number;
  boFinal: number;
  boLbFinal: number;
  boGrand: number;
  checkInWindowMin: number;
  noShowSec: number;
  reconnectGraceSec: number;
  maxReconnects: number;
  botMatchMode: 'watch' | 'simulate';
  botPlacement: 'byes' | 'random';
  postTournamentShutdownSec: number;
  fragLimit: number;
  timeLimitMin: number;
  mapMode: 'vote' | 'random';
  voteTimeoutSec: number;
  countdownSec: number;
  smartStockBots: boolean;
  mapPool: string[];
  botPool: BotSpec[];
}

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

@Component({
  selector: 'app-tournament-form',
  imports: [FormsModule, RouterLink, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ (editing() ? 'form.editTitle' : 'form.newTitle') | t }}</h1>
    @if (locked()) {
      <p class="notice">{{ 'form.locked' | t }}</p>
    }
    @if (m(); as f) {
      <form (ngSubmit)="save()">
        <fieldset>
          <legend>{{ 'form.general' | t }}</legend>
          <div class="fields">
            <div class="field wide">
              <label>{{ 'form.name' | t }}</label>
              <input name="name" [(ngModel)]="f.name" required maxlength="100" />
            </div>
            <div class="field">
              <label>{{ 'form.scheduledAt' | t }}</label>
              <input name="sched" type="datetime-local" [(ngModel)]="f.scheduledAt" />
            </div>
            <div class="field">
              <label>&nbsp;</label>
              <label class="row"
                ><input type="checkbox" name="reg" [(ngModel)]="f.registrationOpen" />
                {{ 'form.registrationOpen' | t }}</label
              >
            </div>
          </div>
        </fieldset>

        <fieldset [disabled]="locked()">
          <legend>{{ 'form.server' | t }}</legend>
          @if (!agents().length) {
            <p class="notice">
              {{ 'form.noAgents' | t }} <a routerLink="/admin/agents">{{ 'nav.agents' | t }}</a>
            </p>
          }
          <div class="fields">
            <div class="field">
              <label>{{ 'form.agent' | t }}</label>
              <select name="agent" [(ngModel)]="f.agentId" (ngModelChange)="onAgent()">
                @for (a of agents(); track a.id) {
                  <option [value]="a.id">
                    {{ a.name }} ({{ a.online ? ('agents.online' | t) : ('agents.offline' | t) }})
                  </option>
                }
              </select>
            </div>
            <div class="field">
              <label>{{ 'form.profile' | t }}</label>
              <select name="profile" [(ngModel)]="f.profileId">
                @for (p of profiles(); track p.id) {
                  <option [value]="p.id">{{ p.name }}</option>
                }
              </select>
            </div>
          </div>
        </fieldset>
        <div class="field">
          <label>{{ 'form.connectAddress' | t }}</label>
          <input
            name="addr"
            [(ngModel)]="f.connectAddress"
            [placeholder]="profileAddress() || 'ut.example.com:7777'"
          />
          <p class="muted small">{{ 'form.connectHint' | t }}</p>
        </div>

        <fieldset [disabled]="locked()">
          <legend>{{ 'form.bracket' | t }}</legend>
          <div class="fields">
            <div class="field">
              <label>{{ 'form.format' | t }}</label>
              <select name="format" [(ngModel)]="f.format">
                <option value="single">{{ 'format.single' | t }}</option>
                <option value="double">{{ 'format.double' | t }}</option>
              </select>
            </div>
            <div class="field">
              <label>{{ 'form.size' | t }}</label>
              <select name="size" [(ngModel)]="f.size">
                @for (s of [8, 16, 32]; track s) {
                  <option [ngValue]="s">{{ s }}</option>
                }
              </select>
            </div>
            @if (f.format === 'double') {
              <div class="field">
                <label>&nbsp;</label>
                <label class="row"
                  ><input type="checkbox" name="gfr" [(ngModel)]="f.grandFinalReset" />
                  {{ 'form.gfReset' | t }}</label
                >
              </div>
            }
          </div>
          <div class="fields">
            <div class="field">
              <label>{{ 'form.boDefault' | t }}</label>
              <select name="bod" [(ngModel)]="f.boDefault">
                @for (b of bestOf; track b) {
                  <option [ngValue]="b">Bo{{ b }}</option>
                }
              </select>
            </div>
            @for (k of boKeys(); track k.key) {
              <div class="field">
                <label>{{ k.label | t }}</label>
                <select [name]="k.key" [(ngModel)]="f[k.key]">
                  <option [ngValue]="0">{{ 'form.boSame' | t }}</option>
                  @for (b of bestOf; track b) {
                    <option [ngValue]="b">Bo{{ b }}</option>
                  }
                </select>
              </div>
            }
          </div>
        </fieldset>

        <fieldset [disabled]="locked()">
          <legend>{{ 'form.rules' | t }}</legend>
          <div class="fields">
            <div class="field">
              <label>{{ 'form.fragLimit' | t }}</label
              ><input type="number" name="fl" min="0" max="200" [(ngModel)]="f.fragLimit" />
            </div>
            <div class="field">
              <label>{{ 'form.timeLimit' | t }}</label
              ><input type="number" name="tl" min="0" max="60" [(ngModel)]="f.timeLimitMin" />
            </div>
            <div class="field">
              <label>{{ 'form.mapMode' | t }}</label>
              <select name="mm" [(ngModel)]="f.mapMode">
                <option value="vote">{{ 'form.mapVote' | t }}</option>
                <option value="random">{{ 'form.mapRandom' | t }}</option>
              </select>
            </div>
            <div class="field">
              <label>{{ 'form.voteTimeout' | t }}</label
              ><input type="number" name="vt" min="10" max="120" [(ngModel)]="f.voteTimeoutSec" />
            </div>
            <div class="field">
              <label>{{ 'form.countdown' | t }}</label
              ><input type="number" name="cd" min="3" max="30" [(ngModel)]="f.countdownSec" />
            </div>
          </div>
          <label class="row"
            ><input type="checkbox" name="ssb" [(ngModel)]="f.smartStockBots" />
            {{ 'form.smartStockBots' | t }}</label
          >
          <p class="muted small">
            {{ 'form.smartStockBotsHint' | t }}
            @switch (ssbInstalled()) {
              @case (true) {
                <span class="ok">{{ 'form.ssbInstalled' | t }}</span>
              }
              @case (false) {
                <span class="error-text">{{ 'form.ssbMissing' | t }}</span>
              }
              @default {
                {{ 'form.ssbUnknown' | t }}
              }
            }
          </p>
          <label>{{ 'form.mapPool' | t: { n: f.mapPool.length } }}</label>
          <div class="chips">
            @for (map of mapChoices(); track map.id) {
              <label class="chip" [class.on]="f.mapPool.includes(map.id)" [title]="map.title || ''">
                <input
                  type="checkbox"
                  [checked]="f.mapPool.includes(map.id)"
                  (change)="toggleMap(map.id)"
                />
                {{ map.id }}
                @if (map.stock === false) {
                  <span class="muted">*</span>
                }
              </label>
            }
          </div>
          <div class="row add">
            <input name="newmap" [(ngModel)]="newMap" placeholder="DM-Example" />
            <button type="button" (click)="addMap()" [disabled]="!newMap.trim()">
              {{ 'form.addMap' | t }}
            </button>
          </div>
          @if (!inventoryMaps().length) {
            <p class="muted small">{{ 'form.noInventory' | t }}</p>
          }
          <p class="muted small">{{ 'form.customMapHint' | t }}</p>
        </fieldset>

        <fieldset [disabled]="locked()">
          <legend>{{ 'form.flow' | t }}</legend>
          <div class="fields">
            <div class="field">
              <label>{{ 'form.checkIn' | t }}</label
              ><input type="number" name="ci" min="1" max="120" [(ngModel)]="f.checkInWindowMin" />
            </div>
            <div class="field">
              <label>{{ 'form.noShow' | t }}</label
              ><input type="number" name="ns" min="30" max="1800" [(ngModel)]="f.noShowSec" />
            </div>
            <div class="field">
              <label>{{ 'form.reconnectGrace' | t }}</label
              ><input
                type="number"
                name="rg"
                min="30"
                max="1800"
                [(ngModel)]="f.reconnectGraceSec"
              />
            </div>
            <div class="field">
              <label>{{ 'form.maxReconnects' | t }}</label
              ><input type="number" name="mr" min="0" max="10" [(ngModel)]="f.maxReconnects" />
            </div>
            <div class="field">
              <label>{{ 'form.shutdown' | t }}</label
              ><input
                type="number"
                name="sd"
                min="0"
                max="7200"
                [(ngModel)]="f.postTournamentShutdownSec"
              />
            </div>
            <div class="field">
              <label>{{ 'form.botMatches' | t }}</label>
              <select name="bmm" [(ngModel)]="f.botMatchMode">
                <option value="watch">{{ 'form.botWatch' | t }}</option>
                <option value="simulate">{{ 'form.botSimulate' | t }}</option>
              </select>
            </div>
            <div class="field">
              <label>{{ 'form.botPlacement' | t }}</label>
              <select name="bp" [(ngModel)]="f.botPlacement">
                <option value="byes">{{ 'form.botByes' | t }}</option>
                <option value="random">{{ 'form.botRandom' | t }}</option>
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset [disabled]="botsLocked()">
          <legend>{{ 'form.botPool' | t: { n: f.botPool.length } }}</legend>
          <p class="muted small">{{ 'form.botPoolHint' | t: { size: f.size } }}</p>
          <table>
            <tbody>
              @for (b of f.botPool; track $index) {
                <tr>
                  <td><input [name]="'bn' + $index" [(ngModel)]="b.name" maxlength="32" /></td>
                  <td class="skill">
                    <select [name]="'bs' + $index" [(ngModel)]="b.skill">
                      @for (s of skills; track s) {
                        <option [ngValue]="s">{{ s }} – {{ 'skill.' + s | t }}</option>
                      }
                    </select>
                  </td>
                  <td>
                    <button type="button" class="link" (click)="f.botPool.splice($index, 1)">
                      ✕
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
          <div class="row add">
            <button
              type="button"
              (click)="f.botPool.push({ name: 'Bot' + (f.botPool.length + 1), skill: 3 })"
            >
              {{ 'form.addBot' | t }}
            </button>
            @if (inventoryBots().length) {
              <button type="button" (click)="useInventoryBots()">
                {{ 'form.useInventoryBots' | t: { n: inventoryBots().length } }}
              </button>
            }
          </div>
        </fieldset>

        @if (error()) {
          <p class="error">{{ error() }}</p>
        }
        <div class="row">
          <button class="primary" type="submit" [disabled]="busy()">
            {{ (editing() ? 'common.save' : 'form.create') | t }}
          </button>
          <a class="btn" [routerLink]="editing() ? ['/t', id()] : ['/']">{{
            'common.cancel' | t
          }}</a>
        </div>
      </form>
    }
  `,
  styles: `
    .wide {
      grid-column: span 2;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }
    .chip {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 3px 10px;
      color: var(--text);
      font-size: 0.85rem;
      cursor: pointer;
    }
    .chip.on {
      border-color: var(--accent);
      background: var(--me-bg);
    }
    .add {
      margin-top: 8px;
    }
    .add input {
      max-width: 260px;
    }
    td.skill {
      width: 220px;
    }
    .ok {
      color: var(--live);
    }
    .error-text {
      color: var(--danger);
    }
  `,
})
export class TournamentFormPage {
  /** Route parameter when editing. */
  readonly id = input<string | undefined>(undefined);
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  protected readonly i18n = inject(I18n);

  protected readonly agents = signal<AgentView[]>([]);
  protected readonly m = signal<Model | null>(null);
  protected readonly detail = signal<TournamentDetail | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly bestOf = [1, 3, 5, 7];
  protected readonly skills = [0, 1, 2, 3, 4, 5, 6, 7];
  protected newMap = '';
  private agentTick = signal(0);

  protected readonly editing = computed(() => !!this.id());
  protected readonly locked = computed(() => !!this.detail() && this.detail()!.phase !== 'draft');
  protected readonly botsLocked = computed(() =>
    ['checkIn', 'running', 'paused'].includes(this.detail()?.phase ?? ''),
  );

  protected readonly profiles = computed(() => {
    this.agentTick();
    const f = this.m();
    return this.agents().find((a) => a.id === f?.agentId)?.profiles ?? [];
  });
  private readonly profile = computed(() => {
    this.agentTick();
    const f = this.m();
    return this.profiles().find((p) => p.id === f?.profileId);
  });
  protected readonly profileAddress = computed(() => this.profile()?.publicAddress ?? '');
  protected readonly inventoryMaps = computed(() => this.profile()?.inventory?.maps ?? []);
  protected readonly inventoryBots = computed(() => this.profile()?.inventory?.bots ?? []);
  /** true/false once the server was scanned, null if unknown. */
  protected readonly ssbInstalled = computed(() => {
    const pk = this.profile()?.inventory?.packages;
    return pk ? pk.some((p) => p.toLowerCase() === 'smartstockbots') : null;
  });
  protected readonly mapChoices = computed(() => {
    this.agentTick();
    const f = this.m();
    const inv = this.inventoryMaps().filter((x) => x.id.toUpperCase().startsWith('DM-'));
    const list = inv.length
      ? [...inv]
      : STOCK_POOL.map(
          (id) => ({ id, stock: true }) as { id: string; title?: string; stock?: boolean },
        );
    for (const id of f?.mapPool ?? []) if (!list.some((x) => x.id === id)) list.push({ id });
    return list.sort((a, b) => a.id.localeCompare(b.id));
  });

  protected boKeys = computed(() => {
    const double = this.m()?.format === 'double';
    const keys: { key: 'boSemi' | 'boFinal' | 'boLbFinal' | 'boGrand'; label: string }[] = [
      { key: 'boSemi', label: 'form.boSemi' },
      { key: 'boFinal', label: double ? 'form.boWbFinal' : 'form.boFinal' },
    ];
    if (double)
      keys.push(
        { key: 'boLbFinal', label: 'form.boLbFinal' },
        { key: 'boGrand', label: 'form.boGrand' },
      );
    return keys;
  });

  constructor() {
    void this.init();
  }

  private async init() {
    try {
      this.agents.set(await this.api.agents());
      const id = this.id();
      if (id) {
        const d = await this.api.tournament(id);
        this.detail.set(d);
        this.m.set(this.fromDetail(d));
      } else {
        const a = this.agents().find((x) => x.online) ?? this.agents()[0];
        this.m.set(this.defaults(a));
      }
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  private defaults(a?: AgentView): Model {
    return {
      name: '',
      agentId: a?.id ?? '',
      profileId: a?.profiles[0]?.id ?? '',
      connectAddress: '',
      scheduledAt: '',
      registrationOpen: true,
      format: 'double',
      size: 8,
      grandFinalReset: true,
      boDefault: 1,
      boSemi: 0,
      boFinal: 0,
      boLbFinal: 0,
      boGrand: 3,
      checkInWindowMin: 10,
      noShowSec: 180,
      reconnectGraceSec: 180,
      maxReconnects: 2,
      botMatchMode: 'watch',
      botPlacement: 'byes',
      postTournamentShutdownSec: 30,
      fragLimit: 20,
      timeLimitMin: 10,
      mapMode: 'vote',
      voteTimeoutSec: 45,
      countdownSec: 5,
      smartStockBots: !!a?.profiles[0]?.inventory?.packages?.some(
        (p) => p.toLowerCase() === 'smartstockbots',
      ),
      mapPool: [...STOCK_POOL],
      botPool: a?.profiles[0]?.inventory?.bots.length
        ? a.profiles[0].inventory.bots.map((b) => ({ name: b.name, skill: b.skill }))
        : DEFAULT_BOTS.map((b) => ({ ...b })),
    };
  }

  private fromDetail(d: TournamentDetail): Model {
    const s = d.settings;
    const r = s.game.rules as Record<string, unknown>;
    const num = (k: string, dflt: number) => (typeof r[k] === 'number' ? (r[k] as number) : dflt);
    return {
      name: d.name,
      agentId: d.agentId,
      profileId: d.profileId,
      connectAddress: d.connectAddressOverride ?? '',
      scheduledAt: toLocalInput(d.scheduledAt),
      registrationOpen: d.registrationOpen,
      format: s.format,
      size: s.size,
      grandFinalReset: s.grandFinalReset,
      boDefault: s.bestOf.default,
      boSemi: s.bestOf.semifinal ?? 0,
      boFinal: s.bestOf.final ?? 0,
      boLbFinal: s.bestOf.lbFinal ?? 0,
      boGrand: s.bestOf.grandFinal ?? 0,
      checkInWindowMin: s.checkInWindowMin,
      noShowSec: s.noShowSec,
      reconnectGraceSec: s.reconnectGraceSec,
      maxReconnects: s.maxReconnects,
      botMatchMode: s.botMatchMode,
      botPlacement: s.botPlacement,
      postTournamentShutdownSec: s.postTournamentShutdownSec,
      fragLimit: num('fragLimit', 20),
      timeLimitMin: num('timeLimitMin', 10),
      mapMode: r['mapMode'] === 'random' ? 'random' : 'vote',
      voteTimeoutSec: num('voteTimeoutSec', 45),
      countdownSec: num('countdownSec', 5),
      smartStockBots: r['smartStockBots'] === true,
      mapPool: Array.isArray(r['mapPool']) ? [...(r['mapPool'] as string[])] : [],
      botPool: d.botPool.map((b) => ({ ...b })),
    };
  }

  protected onAgent() {
    const f = this.m();
    if (!f) return;
    f.profileId = this.agents().find((a) => a.id === f.agentId)?.profiles[0]?.id ?? '';
    this.agentTick.update((n) => n + 1);
  }

  protected toggleMap(id: string) {
    const f = this.m();
    if (!f) return;
    const i = f.mapPool.indexOf(id);
    if (i >= 0) f.mapPool.splice(i, 1);
    else f.mapPool.push(id);
    this.agentTick.update((n) => n + 1);
  }

  protected addMap() {
    const id = this.newMap.trim();
    const f = this.m();
    if (!f || !id) return;
    if (!f.mapPool.includes(id)) f.mapPool.push(id);
    this.newMap = '';
    this.agentTick.update((n) => n + 1);
  }

  protected useInventoryBots() {
    const f = this.m();
    if (!f) return;
    f.botPool = this.inventoryBots().map((b) => ({ name: b.name, skill: b.skill }));
  }

  private body(f: Model) {
    const bestOf: Record<string, number> = { default: f.boDefault };
    if (f.boSemi) bestOf['semifinal'] = f.boSemi;
    if (f.boFinal) bestOf['final'] = f.boFinal;
    if (f.format === 'double' && f.boLbFinal) bestOf['lbFinal'] = f.boLbFinal;
    if (f.format === 'double' && f.boGrand) bestOf['grandFinal'] = f.boGrand;
    return {
      name: f.name.trim(),
      agentId: f.agentId,
      profileId: f.profileId,
      connectAddress: f.connectAddress.trim() || null,
      scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null,
      registrationOpen: f.registrationOpen,
      botPool: f.botPool
        .filter((b) => b.name.trim())
        .map((b) => ({ name: b.name.trim(), skill: b.skill })),
      settings: {
        format: f.format,
        size: f.size,
        grandFinalReset: f.format === 'double' ? f.grandFinalReset : false,
        bestOf,
        checkInWindowMin: f.checkInWindowMin,
        noShowSec: f.noShowSec,
        reconnectGraceSec: f.reconnectGraceSec,
        maxReconnects: f.maxReconnects,
        botMatchMode: f.botMatchMode,
        botPlacement: f.botPlacement,
        postTournamentShutdownSec: f.postTournamentShutdownSec,
        game: {
          adapter: 'ut99-dm',
          rules: {
            fragLimit: f.fragLimit,
            timeLimitMin: f.timeLimitMin,
            mapMode: f.mapMode,
            mapPool: f.mapPool,
            voteTimeoutSec: f.voteTimeoutSec,
            countdownSec: f.countdownSec,
            smartStockBots: f.smartStockBots,
          },
        },
      },
    };
  }

  protected async save() {
    const f = this.m();
    if (!f) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const body = this.body(f);
      const id = this.id();
      if (id) {
        const patch: Record<string, unknown> = {
          name: body.name,
          connectAddress: body.connectAddress,
          scheduledAt: body.scheduledAt,
          registrationOpen: body.registrationOpen,
        };
        if (!this.locked())
          Object.assign(patch, {
            agentId: body.agentId,
            profileId: body.profileId,
            settings: body.settings,
          });
        if (!this.botsLocked()) patch['botPool'] = body.botPool;
        await this.api.updateTournament(id, patch);
        await this.router.navigate(['/t', id]);
      } else {
        const d = await this.api.createTournament(body);
        await this.router.navigate(['/t', d.id]);
      }
    } catch (e) {
      this.error.set(errorText(e));
    } finally {
      this.busy.set(false);
    }
  }
}
