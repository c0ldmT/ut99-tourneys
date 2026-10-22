import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18n, TPipe } from '../core/i18n';
import type { AssetItem, ModelChoice, SkinChoice } from '../core/types';
import { LookViewer } from './look-viewer';

/** What the picker edits (both editors' drafts have these fields). */
export interface LookFields {
  botClass: string;
  skin: string;
  face: string;
  voice: string;
}

/** The class UT spawns when none is set (TourneyCore.SpawnSideBot). */
const DEFAULT_CLASS = 'botpack.tmale1bot';

let nextId = 0;

/**
 * Model, skin, face and voice as UT's own setup menu offers them (decision 172), with a 3D
 * preview of the look (decision 176; above the fields on phones, beside them on wider screens): the skins of
 * the model, the faces of the skin, the voices of the model; a new model starts with its first
 * skin and face and its own voice. Native selects with the readable names (they work on every phone).
 * `free`: admins may type a skin or face for models the website does not know yet.
 */
@Component({
  selector: 'app-look-picker',
  imports: [FormsModule, TPipe, LookViewer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = draft();
    @let m = model();
    <div class="look-pick">
      <div class="look-pick-in">
        <app-look-viewer [cls]="d.botClass" [skin]="d.skin" [face]="m?.multi ? d.face : ''" />
        <div class="fields">
          <div class="field">
            <label [for]="id + 'c'">{{ 'bots.class' | t }}</label>
            <select
              [id]="id + 'c'"
              [name]="id + 'c'"
              [ngModel]="canon(modelList(), d.botClass)"
              (ngModelChange)="setModel($event)"
            >
              <option value="">{{ 'bots.defaultIs' | t: { name: defaultLabel() } }}</option>
              @for (c of modelList(); track c.name) {
                <option [value]="c.name">{{ c.label }}</option>
              }
            </select>
          </div>
          <div class="field">
            <label [for]="id + 's'">{{ 'bots.skin' | t }}</label>
            @if (m?.known || !free()) {
              <select
                [id]="id + 's'"
                [name]="id + 's'"
                [ngModel]="canon(m?.skins ?? [], d.skin)"
                (ngModelChange)="setSkin($event)"
                [disabled]="!m?.skins?.length && !d.skin"
              >
                <option value="">{{ standard(m?.defaults?.skin, m?.skins) }}</option>
                @for (s of withCurrent(m?.skins ?? [], d.skin); track s.name) {
                  <option [value]="s.name">{{ s.label }}</option>
                }
              </select>
            } @else {
              <input
                [id]="id + 's'"
                [name]="id + 's'"
                [placeholder]="'bots.default' | t"
                [(ngModel)]="d.skin"
              />
            }
          </div>
          @if (m?.multi || (free() && !m?.known)) {
            <div class="field">
              <label [for]="id + 'f'">{{ 'bots.face' | t }}</label>
              @if (m?.known || !free()) {
                <select
                  [id]="id + 'f'"
                  [name]="id + 'f'"
                  [ngModel]="canon(faces(), d.face)"
                  (ngModelChange)="d.face = $event"
                  [disabled]="!faces().length && !d.face"
                >
                  <option value="">{{ 'bots.default' | t }}</option>
                  @for (f of withCurrent(faces(), d.face); track f.name) {
                    <option [value]="f.name">{{ f.label }}</option>
                  }
                </select>
              } @else {
                <input
                  [id]="id + 'f'"
                  [name]="id + 'f'"
                  [placeholder]="'bots.default' | t"
                  [(ngModel)]="d.face"
                />
              }
            </div>
          }
          <div class="field">
            <label [for]="id + 'v'">{{ 'bots.voice' | t }}</label>
            <select
              [id]="id + 'v'"
              [name]="id + 'v'"
              [ngModel]="canon(m?.voices ?? [], d.voice)"
              (ngModelChange)="d.voice = $event"
            >
              <option value="">{{ standard(m?.defaults?.voice, m?.voices) }}</option>
              @for (v of withCurrent(m?.voices ?? [], d.voice); track v.name) {
                <option [value]="v.name">{{ v.label }}</option>
              }
            </select>
          </div>
        </div>
      </div>
    </div>
    @if (m && !m.known) {
      <p class="muted small">{{ 'bots.unknownModel' | t }}</p>
    }
  `,
})
export class LookPicker {
  readonly draft = input.required<LookFields>();
  readonly models = input<readonly ModelChoice[]>([]);
  readonly free = input(false);
  protected readonly id = `lp${nextId++}`;
  private readonly i18n = inject(I18n);

  /** The models (the current class too, if no server reports it). */
  protected modelList(): AssetItem[] {
    const list: AssetItem[] = this.models().map((m) => ({ name: m.name, label: m.label }));
    return this.withCurrent(list, this.draft().botClass);
  }

  /** The model the look belongs to (no class: UT's default class). */
  protected model(): ModelChoice | undefined {
    const cls = (this.draft().botClass || DEFAULT_CLASS).toLowerCase();
    return this.models().find((m) => m.name.toLowerCase() === cls);
  }

  protected defaultLabel(): string {
    return (
      this.models().find((m) => m.name.toLowerCase() === DEFAULT_CLASS)?.label ?? 'Male Commando'
    );
  }

  /** The faces of the chosen skin (no skin: of the model's own skin). */
  protected faces(): AssetItem[] {
    return this.skinOf(this.draft().skin || this.model()?.defaults.skin)?.faces ?? [];
  }

  /** "Default (Arena Warrior)": what the empty choice means for this model. */
  protected standard(name: string | undefined, list: readonly AssetItem[] | undefined): string {
    const hit = name ? list?.find((x) => x.name.toLowerCase() === name.toLowerCase()) : undefined;
    const std = this.i18n.t('bots.default');
    return hit ? `${std} (${hit.label})` : std;
  }

  protected setModel(cls: string) {
    const d = this.draft();
    if (d.botClass === cls) return;
    d.botClass = cls;
    // As UT's menu (UMenuPlayerSetupClient.ClassChanged): the first skin with its first face, the
    // model's own voice; no model: the server's default for everything.
    const m = cls ? this.model() : undefined;
    const first = m?.skins[0];
    d.skin = first?.name ?? '';
    d.face = first?.faces[0]?.name ?? '';
    d.voice = m?.defaults.voice ?? '';
  }

  protected setSkin(skin: string) {
    const d = this.draft();
    d.skin = skin;
    // As UT: another skin starts with its first face.
    if (!this.faces().some((f) => f.name.toLowerCase() === d.face.toLowerCase()))
      d.face = skin ? (this.faces()[0]?.name ?? '') : '';
  }

  /** The value as the list spells it (UT's names are case-insensitive). */
  protected canon(list: readonly AssetItem[], cur: string): string {
    return list.find((x) => x.name.toLowerCase() === cur.toLowerCase())?.name ?? cur;
  }

  /** The list plus the current value if the list does not have it (set elsewhere). */
  protected withCurrent<T extends AssetItem>(list: readonly T[], cur: string): AssetItem[] {
    const l: AssetItem[] = [...list];
    if (cur && !l.some((x) => x.name.toLowerCase() === cur.toLowerCase()))
      l.push({ name: cur, label: cur.split('.').pop() ?? cur });
    return l;
  }

  private skinOf(name: string | undefined): SkinChoice | undefined {
    if (!name) return undefined;
    return this.model()?.skins.find((s) => s.name.toLowerCase() === name.toLowerCase());
  }
}
