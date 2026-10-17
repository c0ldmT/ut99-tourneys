import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TPipe } from '../core/i18n';
import type { BotSpec, TournamentDetail } from '../core/types';

interface Option {
  id: string;
  label: string;
}

/**
 * Manual stacking: one select per bracket slot (W1-1 = slots 1+2, ...). Empty slots are filled
 * with random bots from the pool when the seeding is saved.
 */
@Component({
  selector: 'app-seeding-editor',
  imports: [FormsModule, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="muted small">{{ 'seed.hint' | t }}</p>
    <div class="pairs">
      @for (pair of pairs(); track pair) {
        <div class="pair">
          <div class="muted small">W1-{{ pair + 1 }}</div>
          @for (i of [pair * 2, pair * 2 + 1]; track i) {
            <select [ngModel]="slots()[i]" (ngModelChange)="set(i, $event)" [class.dup]="isDup(i)">
              <option [ngValue]="null">
                {{ (teamMode() ? 'seed.botTeam' : 'seed.randomBot') | t }}
              </option>
              <optgroup [label]="(teamMode() ? 'seed.teams' : 'seed.players') | t">
                @for (o of humans(); track o.id) {
                  <option [ngValue]="o.id">{{ o.label }}</option>
                }
              </optgroup>
              @if (!teamMode()) {
                <optgroup [label]="'seed.bots' | t">
                  @for (o of bots(); track o.id) {
                    <option [ngValue]="o.id">{{ o.label }}</option>
                  }
                </optgroup>
              }
            </select>
          }
        </div>
      }
    </div>
    @if (missing().length) {
      <p class="error small">{{ 'seed.missing' | t: { names: missing().join(', ') } }}</p>
    }
    @if (hasDup()) {
      <p class="error small">{{ 'seed.duplicate' | t }}</p>
    }
    @if (solos() > 0) {
      <p class="error small">{{ 'seed.formTeamsFirst' | t: { n: solos() } }}</p>
    }
    <div class="row">
      <button
        class="primary"
        [disabled]="busy() || hasDup() || missing().length > 0 || solos() > 0"
        (click)="saveManual.emit(slots())"
      >
        {{ 'seed.saveManual' | t }}
      </button>
      <button (click)="clear()">{{ 'seed.clear' | t }}</button>
    </div>
  `,
  styles: `
    .pairs {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 10px;
      margin: 10px 0;
    }
    .pair {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 8px;
      display: grid;
      gap: 6px;
    }
    select.dup {
      border-color: var(--danger);
    }
  `,
})
export class SeedingEditor {
  readonly tournament = input.required<TournamentDetail>();
  readonly busy = input(false);
  readonly saveManual = output<(string | null)[]>();

  protected readonly slots = signal<(string | null)[]>([]);

  protected readonly teamMode = computed(() => this.tournament().settings.teamSize > 1);
  /** Players without a team; team tournaments need them in teams before manual seeding. */
  protected readonly solos = computed(() =>
    this.teamMode() ? this.tournament().registrations.filter((r) => !r.teamId).length : 0,
  );
  protected readonly humans = computed<Option[]>(() =>
    this.teamMode()
      ? this.tournament().teams.map((x) => ({ id: x.id, label: x.name }))
      : this.tournament().registrations.map((r) => ({
          id: `u-${r.userId}`,
          label: r.displayName,
        })),
  );
  protected readonly bots = computed<Option[]>(() => {
    const seen = new Set<string>();
    return this.tournament()
      .botPool.map((b) => ({
        // Same id as the website gives the bot entrant (library bots: bot-<id>).
        id: botSpecEntrantId(b),
        label: `${b.name} (${b.skill})`,
      }))
      .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)));
  });
  protected readonly pairs = computed(() =>
    Array.from({ length: this.tournament().settings.size / 2 }, (_, i) => i),
  );
  protected readonly missing = computed(() => {
    const placed = new Set(this.slots());
    return this.humans()
      .filter((h) => !placed.has(h.id))
      .map((h) => h.label);
  });
  protected readonly hasDup = computed(() => this.slots().some((_, i) => this.isDup(i)));

  constructor() {
    effect(() => {
      const t = this.tournament();
      const size = t.settings.size;
      const current = t.projection?.bracketDefinition?.slots;
      if (current && current.length === size) {
        // Bot teams get drawn again on saving, so they show as "bot team".
        const known = new Set([...this.humans(), ...this.bots()].map((o) => o.id));
        this.slots.set(current.map((id) => (known.has(id) ? id : null)));
      } else {
        const s: (string | null)[] = Array(size).fill(null);
        this.humans().forEach((h, i) => (s[i * 2 < size ? i * 2 : ((i * 2) % size) + 1] = h.id));
        this.slots.set(s);
      }
    });
  }

  protected set(i: number, id: string | null) {
    const s = [...this.slots()];
    s[i] = id;
    this.slots.set(s);
  }

  protected isDup(i: number): boolean {
    const v = this.slots()[i];
    return v !== null && v !== undefined && this.slots().indexOf(v) !== i;
  }

  protected clear() {
    this.slots.set(Array(this.tournament().settings.size).fill(null));
  }
}

/** Entrant id of a bot as the website gives it (protocol botSpecEntrantId): library id, else name. */
function botSpecEntrantId(b: BotSpec): string {
  return `bot-${(b.id ?? b.name).replace(/[^A-Za-z0-9_-]/g, '_')}`;
}
