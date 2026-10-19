import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { skinPackage } from '../core/bots';
import { TPipe } from '../core/i18n';
import type { AssetItem, BotAssets, LibraryBot } from '../core/types';

/** The occasions a manager writes lines for (no rivals, no bets in the Dream Team). */
export const UDT_LINE_KINDS = ['start', 'kill', 'death', 'win', 'loss'] as const;
export type UdtLineKind = (typeof UDT_LINE_KINDS)[number];

/** What a manager chooses for an own bot: model (where allowed), skin, face, voice, lines. */
export interface LookDraft {
  botClass: string;
  skin: string;
  face: string;
  voice: string;
  talk: number;
  lines: Record<UdtLineKind, string[]>;
}

export type UdtLooks = Pick<BotAssets, 'botClasses' | 'skins' | 'faces' | 'voices' | 'packages'>;

export function emptyLook(): LookDraft {
  return {
    botClass: '',
    skin: '',
    face: '',
    voice: '',
    talk: 30,
    lines: { start: [], kill: [], death: [], win: [], loss: [] },
  };
}

export function lookFromBot(b: LibraryBot): LookDraft {
  const d = emptyLook();
  d.botClass = b.botClass ?? '';
  d.skin = b.skin ?? '';
  d.face = b.face ?? '';
  d.voice = b.traits.voice ?? '';
  d.talk = b.personality.talk;
  for (const l of b.personality.lines)
    if ((UDT_LINE_KINDS as readonly string[]).includes(l.kind))
      d.lines[l.kind as UdtLineKind].push(l.text);
  return d;
}

/** The API body (skin, face, voice, chat chance and lines). */
export function lookBody(d: LookDraft) {
  return {
    skin: d.skin.trim(),
    face: d.face.trim(),
    voice: d.voice.trim(),
    personality: {
      talk: Number(d.talk),
      lines: UDT_LINE_KINDS.flatMap((kind) =>
        d.lines[kind]
          .map((t) => t.trim())
          .filter(Boolean)
          .map((text) => ({ kind, text })),
      ),
    },
  };
}

let nextId = 0;

/** Look (model, skin, face, voice) and chat lines of a manager's own bot. */
@Component({
  selector: 'app-udt-bot-look',
  imports: [FormsModule, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = draft();
    <div class="fields">
      @if (allowClass()) {
        <div class="field">
          <label [for]="id + 'c'">{{ 'bots.class' | t }}</label>
          <input
            [id]="id + 'c'"
            [name]="id + 'c'"
            [attr.list]="id + 'cl'"
            [placeholder]="'bots.default' | t"
            [ngModel]="d.botClass"
            (change)="setClass($any($event.target).value.trim())"
          />
          <datalist [id]="id + 'cl'">
            @for (c of looks()?.botClasses ?? []; track c.name) {
              <option [value]="c.name">{{ c.label }}</option>
            }
          </datalist>
        </div>
      }
      <div class="field">
        <label [for]="id + 's'">{{ 'bots.skin' | t }}</label>
        <input
          [id]="id + 's'"
          [name]="id + 's'"
          [attr.list]="id + 'sl'"
          [placeholder]="'bots.default' | t"
          [(ngModel)]="d.skin"
        />
        <datalist [id]="id + 'sl'">
          @for (s of skins(); track s.name) {
            <option [value]="s.name">{{ s.label }}</option>
          }
        </datalist>
      </div>
      <div class="field">
        <label [for]="id + 'f'">{{ 'bots.face' | t }}</label>
        <input
          [id]="id + 'f'"
          [name]="id + 'f'"
          [attr.list]="id + 'fl'"
          [placeholder]="'bots.default' | t"
          [(ngModel)]="d.face"
        />
        <datalist [id]="id + 'fl'">
          @for (f of faces(); track f.name) {
            <option [value]="f.name">{{ f.label }}</option>
          }
        </datalist>
      </div>
      <div class="field">
        <label [for]="id + 'v'">{{ 'bots.voice' | t }}</label>
        <select [id]="id + 'v'" [name]="id + 'v'" [(ngModel)]="d.voice">
          <option value="">{{ 'bots.default' | t }}</option>
          @for (v of looks()?.voices ?? []; track v.name) {
            <option [value]="v.name">{{ v.label }}</option>
          }
        </select>
      </div>
    </div>
    <label class="slider"
      ><span>{{ 'bots.talk' | t }}</span>
      <input type="range" [name]="id + 't'" min="0" max="100" step="5" [(ngModel)]="d.talk" />
      <span class="mono val">{{ d.talk }} %</span>
    </label>
    <p class="muted small">{{ 'bots.linesHint' | t }}</p>
    @for (k of kinds; track k) {
      <div class="kind">
        <div class="spread">
          <b class="small">{{ 'bots.kind.' + k | t }}</b>
          @if (count() < 64) {
            <button type="button" class="link" (click)="d.lines[k].push('')">
              + {{ 'bots.addLine' | t }}
            </button>
          }
        </div>
        @for (l of d.lines[k]; track $index) {
          <div class="row line">
            <input
              [name]="id + k + $index"
              [(ngModel)]="d.lines[k][$index]"
              maxlength="120"
              [placeholder]="'bots.linePlaceholder.' + k | t"
            />
            <button type="button" class="link" (click)="d.lines[k].splice($index, 1)">✕</button>
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: 10px;
    }
    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 10px;
    }
    .field {
      display: grid;
      gap: 4px;
    }
    .slider {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .slider input {
      flex: 1;
    }
    .line input {
      flex: 1;
    }
    .kind {
      display: grid;
      gap: 4px;
    }
  `,
})
export class UdtBotLook {
  readonly draft = input.required<LookDraft>();
  readonly looks = input<UdtLooks | null>(null);
  /** The model can be chosen (founding, rare blueprints). */
  readonly allowClass = input(false);
  protected readonly id = `ul${nextId++}`;
  protected readonly kinds = UDT_LINE_KINDS;

  protected count(): number {
    const d = this.draft();
    return UDT_LINE_KINDS.reduce((n, k) => n + d.lines[k].length, 0);
  }

  protected setClass(cls: string) {
    const d = this.draft();
    d.botClass = cls;
    const pkg = skinPackage(this.assets(), { botClass: cls || null, skin: null });
    if (pkg && d.skin && !d.skin.toLowerCase().startsWith(pkg.toLowerCase() + '.')) {
      d.skin = '';
      d.face = '';
    }
  }

  protected skins(): AssetItem[] {
    const d = this.draft();
    const all = this.looks()?.skins ?? [];
    const pkg = skinPackage(this.assets(), { botClass: d.botClass || null, skin: null });
    const list = pkg
      ? all.filter((s) => s.name.toLowerCase().startsWith(pkg.toLowerCase() + '.'))
      : all;
    return list.length ? list : all;
  }

  protected faces(): AssetItem[] {
    const pkg = (this.draft().skin.split('.')[0] ?? '').toLowerCase();
    return (this.looks()?.faces ?? []).filter((f) => !pkg || f.pkg.toLowerCase() === pkg);
  }

  private assets(): BotAssets | null {
    const l = this.looks();
    return l ? { ...l, textures: [], weapons: [] } : null;
  }
}
