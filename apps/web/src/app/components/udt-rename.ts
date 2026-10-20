import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { I18n, TPipe } from '../core/i18n';

/**
 * The one free renaming of an own Dream Team bot (the look and lines can change any time, the
 * name only once): a name field and a button; `renamed` after it worked.
 */
@Component({
  selector: 'udt-rename',
  imports: [FormsModule, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="rename" (ngSubmit)="save()">
      <label
        >{{ 'udt.rename.label' | t }}
        <input
          type="text"
          name="name"
          maxlength="20"
          [ngModel]="draft() ?? name()"
          (ngModelChange)="draft.set($event)"
        />
      </label>
      <button type="submit" [disabled]="busy() || !changed()">
        {{ 'udt.rename.button' | t }}
      </button>
      <span class="muted small">{{ 'udt.rename.once' | t }}</span>
    </form>
  `,
  styles: `
    .rename {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 8px;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1 1 140px;
    }
    .small {
      flex-basis: 100%;
    }
  `,
})
export class UdtRename {
  private readonly api = inject(Api);
  private readonly i18n = inject(I18n);
  readonly botId = input.required<string>();
  readonly name = input.required<string>();
  readonly renamed = output<string>();
  protected readonly draft = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected changed(): boolean {
    const d = (this.draft() ?? '').trim();
    return d.length >= 2 && d !== this.name();
  }

  protected async save() {
    const name = (this.draft() ?? '').trim();
    if (!this.changed()) return;
    if (!confirm(this.confirmText(name))) return;
    this.busy.set(true);
    try {
      await this.api.udtRenameBot(this.botId(), name);
      this.draft.set(null);
      this.renamed.emit(name);
    } catch {
      // the toast shows the error
    } finally {
      this.busy.set(false);
    }
  }

  private confirmText(name: string): string {
    return this.i18n.t('udt.rename.confirm', { from: this.name(), to: name });
  }
}
