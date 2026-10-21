import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TPipe } from '../core/i18n';
import { LookPicker } from './look-picker';
import type { BotAssets, LibraryBot } from '../core/types';

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

export type UdtLooks = Pick<
  BotAssets,
  'botClasses' | 'skins' | 'faces' | 'voices' | 'packages' | 'models'
>;

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

/** The API body (model, skin, face, voice, chat chance and lines). */
export function lookBody(d: LookDraft) {
  return {
    botClass: d.botClass.trim(),
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
  imports: [FormsModule, TPipe, LookPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = draft();
    <fieldset>
      <legend>{{ 'bots.sec.look' | t }}</legend>
      <app-look-picker [draft]="d" [models]="looks()?.models ?? []" />
      <p class="muted small hint">{{ 'bots.lookHint' | t }}</p>
    </fieldset>
    <fieldset>
      <legend>{{ 'bots.sec.personality' | t }}</legend>
      <label class="slider"
        ><span>{{ 'bots.talk' | t }}</span>
        <input type="range" [name]="id + 't'" min="0" max="100" step="5" [(ngModel)]="d.talk" />
        <span class="mono val">{{ d.talk }} %</span>
      </label>
      <p class="muted small">{{ 'udt.look.linesHint' | t }}</p>
      @for (k of kinds; track k) {
        <div class="kind">
          <div class="spread">
            <b>{{ 'bots.kind.' + k | t }}</b>
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
      <p class="muted small">{{ count() }}/64 {{ 'bots.linesCount' | t }}</p>
    </fieldset>
  `,
  styles: `
    :host {
      display: block;
    }
    fieldset:last-of-type {
      margin-bottom: 0;
    }
    .hint {
      margin: 0 0 4px;
    }
    label.slider {
      display: grid;
      grid-template-columns: 120px 1fr 48px;
      align-items: center;
      gap: 8px;
      margin: 4px 0 8px;
    }
    label.slider input {
      padding: 0;
    }
    .val {
      text-align: right;
    }
    .kind {
      margin: 10px 0;
    }
    .line {
      margin: 4px 0;
      flex-wrap: nowrap;
    }
    .line input {
      flex: 1;
      min-width: 0;
    }
    @media (max-width: 560px) {
      label.slider {
        grid-template-columns: 1fr 48px;
      }
      label.slider span:first-child {
        grid-column: 1 / -1;
      }
    }
  `,
})
export class UdtBotLook {
  readonly draft = input.required<LookDraft>();
  readonly looks = input<UdtLooks | null>(null);
  protected readonly id = `ul${nextId++}`;
  protected readonly kinds = UDT_LINE_KINDS;

  protected count(): number {
    const d = this.draft();
    return UDT_LINE_KINDS.reduce((n, k) => n + d.lines[k].length, 0);
  }
}
