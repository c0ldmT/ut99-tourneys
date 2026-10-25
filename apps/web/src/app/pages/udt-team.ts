import { emptyLook, lookBody, UdtBotLook, type UdtLooks } from '../components/udt-bot-look';
import { UdtBotPanel } from '../components/udt-bot-panel';
import { UdtLineupBoard, type TraitDrop } from '../components/udt-lineup-board';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Api } from '../core/api';
import { Coin } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';
import { NeuroPipe, NeuroStore } from '../core/neuro';
import { Toasts } from '../core/toast';
import type { UdtLedgerEntry, UdtPacks, UdtView } from '../core/types';
import type { LineupDraft } from '../core/udt-lineup';
import {
  baseValue,
  botRarity,
  rosterSalary,
  SKILL_NAMES,
  UdtCard,
  UdtNav,
  valueScore,
  type CardBot,
} from '../core/udt';
import { DEFAULT_ECONOMY, STARTER_SKILL } from '@tourney/udt';

/** Dream Team: founding the team (starter bot), the lineups, the roster and the ledger. */
@Component({
  selector: 'app-udt-team',
  imports: [
    FormsModule,
    TPipe,
    NeuroPipe,
    Coin,
    UdtCard,
    UdtNav,
    UdtBotLook,
    UdtLineupBoard,
    UdtBotPanel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <udt-nav (changed)="load()" />
    @if (view(); as v) {
      @if (!v.enabled) {
        <div class="card">
          <p class="muted">{{ 'udt.off' | t }}</p>
        </div>
      } @else if (v.season === null) {
        <div class="card">
          <p class="muted">{{ 'udt.noSeason' | t }}</p>
        </div>
      } @else if (!v.team) {
        <div class="udt-head">
          <div>
            <div class="kpi" style="color: var(--udt)">{{ 'udt.season' | t: { n: v.season } }}</div>
            <h1 class="disp">{{ 'udt.found.title' | t }}</h1>
            <p class="muted">{{ 'udt.found.intro' | t }}</p>
          </div>
        </div>
        <form class="card found" (ngSubmit)="found()">
          <div class="cols">
            <div class="fields">
              <div class="row gap">
                <label
                  >{{ 'udt.found.name' | t }}
                  <input name="tname" [(ngModel)]="teamName" maxlength="32" required />
                </label>
                <label
                  >{{ 'udt.found.tag' | t }}
                  <input
                    name="ttag"
                    [(ngModel)]="teamTag"
                    maxlength="8"
                    placeholder="[TD]"
                    class="narrow"
                    required
                  />
                </label>
              </div>
              <label
                >{{ 'udt.found.bot' | t }}
                <input name="bname" [(ngModel)]="botName" maxlength="17" required />
              </label>
              <p class="small">
                {{ 'udt.found.skill' | t: { skill: skill, name: skillName } }}
              </p>
              @for (k of keys; track k) {
                <label
                  >{{ 'udt.value.' + k | t }}: <b>{{ pctOf(k) }}</b>
                  <input
                    type="range"
                    [name]="k"
                    min="-1"
                    max="1"
                    step="0.1"
                    [ngModel]="values[k]"
                    (ngModelChange)="setValue(k, $event)"
                  />
                </label>
              }
              <p [class.error]="cost() > budget()" class="small">
                {{ 'udt.found.cost' | t: { cost: cost(), budget: budget() } }}
              </p>
              @if (extra() > 0) {
                <p class="small" [class.error]="cost() > budget()" [class.ok]="cost() <= budget()">
                  {{ 'udt.found.extra' | t: { free: budget() - cost(), extra: extra() } }}
                </p>
              }
            </div>
            <udt-card [bot]="preview()" />
          </div>
          <app-udt-bot-look [draft]="foundLook" [looks]="looks()" />
          <div class="row submit">
            <button type="submit" class="primary" [disabled]="busy() || cost() > budget()">
              {{ 'udt.found.submit' | t }}
            </button>
            <span class="muted small">{{ 'udt.look.later' | t }}</span>
          </div>
        </form>
      } @else {
        <div class="udt-head">
          <div>
            <div class="kpi" style="color: var(--udt)">{{ 'udt.season' | t: { n: v.season } }}</div>
            <h1 class="disp">
              <span style="color: var(--hot-text)">{{ v.team.tag }}</span> {{ v.team.name }}
            </h1>
          </div>
          <div class="udt-kpis">
            <div>
              <div class="kpi">{{ 'udt.spendable' | t }}</div>
              <div class="v neuro">
                <na-coin [size]="16" /> {{ spendable() ?? v.wallet?.spendable ?? 0 | neuro: false }}
              </div>
            </div>
            <div>
              <div class="kpi">{{ 'udt.teamValue' | t }}</div>
              <div class="v">{{ teamValue() | neuro }}</div>
            </div>
            <div>
              <div class="kpi">{{ 'udt.salary' | t }}</div>
              <div class="v" style="color: var(--danger)">−{{ salary() | neuro }}</div>
            </div>
            <div>
              <div class="kpi">{{ 'udt.index' | t }}</div>
              <div class="v">{{ v.index.toFixed(2) }}</div>
            </div>
          </div>
        </div>

        <section class="card">
          <udt-lineup-board
            [roster]="v.roster"
            [draft]="draft()"
            [tag]="v.team.tag"
            [inventory]="inventory()"
            [weapons]="weapons()"
            (changed)="saveLineup($event)"
            (trait)="assign($event)"
            (open)="openBot($event)"
          />
          <details class="help small">
            <summary>{{ 'udt.staminaHelp.title' | t }}</summary>
            <ul>
              @for (k of ['loss', 'rest', 'tired', 'bench', 'traits', 'buy']; track k) {
                <li>{{ 'udt.staminaHelp.' + k | t: { n: restPrice } }}</li>
              }
            </ul>
          </details>
        </section>
        <udt-bot-panel
          [bot]="panelBot()"
          [tag]="v.team.tag"
          [spendable]="spendable() ?? v.wallet?.spendable ?? null"
          [looks]="looks()"
          (changed)="load()"
          (closed)="panelId.set(null)"
        />

        <section class="card">
          <h2>{{ 'udt.ledger' | t }}</h2>
          @for (l of ledger(); track l.id) {
            <div class="lrow">
              <span class="grow">{{ 'udt.kind.' + l.kind | t }}</span>
              <span class="muted small">{{ l.at.slice(0, 16).replace('T', ' ') }}</span>
              <span class="mono" [class.up]="l.amount > 0" [class.down]="l.amount < 0"
                >{{ l.amount > 0 ? '+' : '' }}{{ l.amount | neuro }}</span
              >
            </div>
          } @empty {
            <p class="muted small">{{ 'udt.ledgerEmpty' | t }}</p>
          }
        </section>
      }
    }
  `,
  styles: `
    .found .cols {
      display: flex;
      flex-wrap: wrap;
      gap: 28px;
      align-items: flex-start;
      margin-bottom: 18px;
    }
    .ok {
      color: var(--live);
    }
    .found .submit {
      margin-top: 16px;
    }
    .found .fields {
      flex: 1 1 320px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .lrow {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      border-top: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .grow {
      flex: 1 1 200px;
      min-width: 0;
    }
    .up {
      color: var(--live);
    }
    .down {
      color: var(--danger);
    }
  `,
})
export class UdtTeamPage {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  private readonly toasts = inject(Toasts);
  protected readonly view = signal<UdtView | null>(null);
  protected readonly ledger = signal<UdtLedgerEntry[]>([]);
  /** The shared Neuro state (the same as in the navbar). */
  protected readonly spendable = inject(NeuroStore).spendable;
  protected readonly busy = signal(false);
  protected readonly keys = ['accuracy', 'alertness', 'strafing'] as const;
  // Founding form
  protected teamName = '';
  protected teamTag = '';
  protected botName = '';
  /** Every starter has skill 3 (like the blueprints); the points go into the values. */
  protected readonly skill = STARTER_SKILL;
  protected readonly skillName = SKILL_NAMES[STARTER_SKILL];
  protected values: Record<'accuracy' | 'alertness' | 'strafing', number> = {
    accuracy: 0,
    alertness: 0,
    strafing: 0,
  };
  private readonly rev = signal(0);
  // Look and chat lines of the starter (founding); the bot panel edits own bots
  protected readonly foundLook = emptyLook();
  protected readonly looks = signal<UdtLooks | null>(null);
  /** Neuro per stamina point (rest with Neuro). */
  protected readonly restPrice = DEFAULT_ECONOMY.restPrice;
  /** The saved lineups (bot ids per slot); the board changes and saves them at once. */
  protected readonly draft = signal<LineupDraft>({ dm: [], mh: [], bench: [] });
  private readonly packs = signal<UdtPacks | null>(null);
  protected readonly inventory = computed(() => this.packs()?.inventory ?? []);
  protected readonly weapons = computed(() => this.packs()?.weapons ?? []);
  /** The bot whose details are open (bot panel). */
  protected readonly panelId = signal<string | null>(null);
  protected readonly panelBot = computed(
    () => this.view()?.roster.find((b) => b.botId === this.panelId()) ?? null,
  );
  /** Saves one after the other (fast drops). */
  private saving: Promise<void> = Promise.resolve();
  /** Lineup saves not yet answered; a failed one reloads once all are answered. */
  private pending = 0;
  private failed = false;

  /** Extra points to allocate on top of the default starter (skill 3, average values). */
  protected readonly extra = computed(() => this.view()?.starterExtra ?? 0);
  protected readonly budget = computed(() => (this.view()?.starterBudget ?? 1500) + this.extra());
  protected readonly cost = computed(() => {
    this.rev();
    return Math.round(baseValue(this.skill, valueScore(this.values)));
  });
  protected readonly preview = computed<CardBot>(() => {
    this.rev();
    return {
      name: this.botName || '?',
      skill: this.skill,
      rarity: botRarity(this.skill),
      traits: { ...this.values },
      tag: this.teamTag || undefined,
      value: this.cost(),
    };
  });
  protected readonly teamValue = computed(() =>
    (this.view()?.roster ?? []).reduce((s, b) => s + b.value, 0),
  );
  protected readonly salary = computed(() =>
    // Bots a team made draw none, blueprint bots a share (also traded ones).
    (this.view()?.roster ?? []).reduce((s, b) => s + rosterSalary(b), 0),
  );

  constructor() {
    // ?bot=<id> (e.g. from the academy) opens that bot's details.
    const bot = inject(ActivatedRoute).snapshot.queryParamMap.get('bot');
    if (bot) this.panelId.set(bot);
    void this.load();
  }

  async load() {
    try {
      const v = await this.api.udt();
      this.view.set(v);
      // While lineup saves run, the board shows the newest change (synced when they are done).
      if (!this.pending) this.resetDraft(v);
      if (v.enabled && v.season !== null && !this.looks())
        this.looks.set(await this.api.udtLooks().catch(() => null));
      if (v.team) {
        this.ledger.set(await this.api.udtLedger());
        this.packs.set(await this.api.udtPacks());
      }
    } catch {
      // the toast shows the error
    }
  }

  private resetDraft(v: UdtView) {
    const at = (key: 'dmSlot' | 'mhSlot' | 'bench', n: number) =>
      Array.from({ length: n }, (_, i) => v.roster.find((b) => b[key] === i + 1)?.botId ?? null);
    this.draft.set({ dm: at('dmSlot', 5), mh: at('mhSlot', 5), bench: at('bench', 2) });
  }

  protected tick() {
    this.rev.update((n) => n + 1);
  }

  protected pctOf(k: 'accuracy' | 'alertness' | 'strafing') {
    return Math.round((this.values[k] + 1) * 50);
  }

  protected setValue(k: 'accuracy' | 'alertness' | 'strafing', v: number) {
    this.values = { ...this.values, [k]: Number(v) };
    this.tick();
  }

  protected openBot(id: string) {
    this.panelId.set(id);
  }

  /** A drop on the board: shown at once, saved, with "undo" in the toast. */
  protected saveLineup(next: LineupDraft, undo = true) {
    const before = this.draft();
    this.draft.set(next);
    this.pending++;
    this.saving = this.saving.then(async () => {
      try {
        const roster = await this.api.udtLineup(next);
        const v = this.view();
        if (v) this.view.set({ ...v, roster });
        this.toasts.success(
          this.i18n.t('ok.udt.lineup'),
          undo
            ? { label: this.i18n.t('udt.board.undo'), run: () => this.saveLineup(before, false) }
            : undefined,
        );
      } catch {
        // the toast shows the error; back to what the server has once all saves are answered
        this.failed = true;
      }
      if (--this.pending) return;
      const v = this.view();
      if (this.failed) {
        this.failed = false;
        await this.load();
      } else if (v) this.resetDraft(v);
    });
  }

  protected async assign(t: TraitDrop) {
    await this.act(async () => {
      this.view.set(await this.api.udtAssign(t.cardId, t.botId, t.weapon));
      this.packs.set(await this.api.udtPacks());
    });
  }

  protected async found() {
    await this.act(async () => {
      const v = await this.api.udtCreateTeam({
        name: this.teamName.trim(),
        tag: this.teamTag.trim(),
        starter: {
          name: this.botName.trim(),
          skill: this.skill,
          ...(this.foundLook.botClass.trim() ? { botClass: this.foundLook.botClass.trim() } : {}),
          ...(this.foundLook.skin.trim() ? { skin: this.foundLook.skin.trim() } : {}),
          ...(this.foundLook.face.trim() ? { face: this.foundLook.face.trim() } : {}),
          traits: {
            ...this.values,
            ...(this.foundLook.voice ? { voice: this.foundLook.voice } : {}),
          },
          personality: lookBody(this.foundLook).personality,
        },
      });
      this.view.set(v);
      this.resetDraft(v);
    });
  }

  private async act(fn: () => Promise<void>) {
    this.busy.set(true);
    try {
      await fn();
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }
}
