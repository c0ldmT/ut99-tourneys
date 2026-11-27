import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';
import type { TournamentPreset, TournamentPresetBody } from '../core/types';
import { Confirm } from './confirm-dialog';
import { MAX_PRESETS, presetHint } from '../core/presets';

/**
 * The admin's presets above the tournament form (decision 325): a chip per preset applies it
 * (the form keeps name and date), × deletes it after asking, "Save as preset" asks for a name in
 * place. A chip is lit while the form still equals what it applied or saved.
 */
@Component({
  selector: 'na-form-presets',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="pl" id="fpresets">{{ 'form.presets' | t }}</span>
    @for (p of list(); track p.id) {
      <span class="pc" [class.on]="p.id === active()">
        <button type="button" class="link pa" [disabled]="disabled()" (click)="use(p)">
          {{ p.name }}<small>{{ hint(p) }}</small>
        </button>
        <button
          type="button"
          class="icon px"
          [disabled]="disabled()"
          (click)="remove(p)"
          [attr.aria-label]="'form.presetDelete' | t: { name: p.name }"
          [title]="'form.presetDelete' | t: { name: p.name }"
        >
          ×
        </button>
      </span>
    } @empty {
      <span class="muted small">{{ 'form.presetsNone' | t }}</span>
    }
    @if (naming()) {
      <span class="pn">
        <input
          #name
          maxlength="40"
          [value]="suggest()"
          [attr.aria-label]="'form.presetName' | t"
          [placeholder]="'form.presetName' | t"
          (keydown.enter)="$event.preventDefault(); save(name.value)"
          (keydown.escape)="naming.set(false)"
        />
        <button type="button" class="primary" [disabled]="busy()" (click)="save(name.value)">
          {{ 'common.save' | t }}
        </button>
        <button type="button" (click)="naming.set(false)">{{ 'common.cancel' | t }}</button>
      </span>
    } @else {
      <button
        type="button"
        class="link padd"
        [disabled]="disabled() || list().length >= max"
        [title]="list().length >= max ? ('form.presetsFull' | t: { n: max }) : ''"
        (click)="startNaming()"
      >
        + {{ 'form.presetSave' | t }}
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin: 0 0 16px;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      background: var(--panel);
    }
    .pl {
      font-weight: 600;
      color: var(--text-2);
      margin-right: 4px;
    }
    .pc {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: var(--radius-pill);
      background: var(--panel-2);
    }
    .pc.on {
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
    }
    .pa {
      gap: 6px;
      min-height: 36px;
      padding: 4px 4px 4px 12px;
      color: var(--text);
      font-weight: 600;
    }
    .pa small {
      color: var(--muted);
      font-weight: 500;
    }
    .px {
      width: 32px;
      min-height: 32px;
      font-size: var(--fs-lg);
    }
    .padd {
      min-height: 36px;
      padding: 4px 12px;
      border: 1px dashed var(--line);
      border-radius: var(--radius-pill);
    }
    .pn {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .pn input {
      width: 220px;
    }
  `,
})
export class FormPresets {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  private readonly confirm = inject(Confirm);
  /** What the form would save now. */
  readonly body = input.required<TournamentPresetBody>();
  /** The name suggested for a new preset (the tournament's name). */
  readonly suggest = input('');
  readonly disabled = input(false);
  /** A preset to apply (the form keeps name and date). */
  readonly apply = output<TournamentPreset>();

  protected readonly max = MAX_PRESETS;
  protected readonly list = signal<TournamentPreset[]>([]);
  protected readonly naming = signal(false);
  protected readonly busy = signal(false);
  /** The preset applied or saved last and the form as it was then. */
  private readonly last = signal<{ id: string; json: string } | null>(null);
  protected readonly active = computed(() => {
    const l = this.last();
    return l && l.json === JSON.stringify(this.body()) ? l.id : null;
  });
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('name');

  constructor() {
    void this.load();
  }

  private async load() {
    try {
      this.list.set(await this.api.presets());
    } catch {
      // no presets shown
    }
  }

  protected hint(p: TournamentPreset): string {
    return presetHint(p.body, (k) => this.i18n.t(k));
  }

  protected use(p: TournamentPreset) {
    this.apply.emit(p);
    // The form changes after this turn: remember it as it is then.
    setTimeout(() => this.last.set({ id: p.id, json: JSON.stringify(this.body()) }));
  }

  protected startNaming() {
    this.naming.set(true);
    setTimeout(() => this.nameInput()?.nativeElement.select());
  }

  protected async save(raw: string) {
    const name = raw.trim().slice(0, 40);
    if (!name) {
      this.nameInput()?.nativeElement.focus();
      return;
    }
    const same = this.list().find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (
      same &&
      !(await this.confirm.ask(this.i18n.t('form.presetReplace', { name: same.name }), {
        ok: 'form.presetReplaceOk',
      }))
    )
      return;
    this.busy.set(true);
    try {
      const body = this.body();
      const list = await this.api.savePreset(name, body, !!same);
      this.list.set(list);
      const saved = list.find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (saved) this.last.set({ id: saved.id, json: JSON.stringify(body) });
      this.naming.set(false);
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(p: TournamentPreset) {
    if (
      !(await this.confirm.ask(this.i18n.t('form.presetDeleteAsk', { name: p.name }), {
        danger: true,
        ok: 'common.delete',
      }))
    )
      return;
    try {
      await this.api.deletePreset(p.id);
      this.list.update((l) => l.filter((x) => x.id !== p.id));
    } catch {
      // the toast shows the error
    }
  }
}
