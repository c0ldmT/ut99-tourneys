import {
  CdkDrag,
  CdkDragPlaceholder,
  CdkDropList,
  CdkDropListGroup,
  type CdkDrag as CdkDragT,
  type CdkDragDrop,
  type CdkDropList as CdkDropListT,
} from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { I18n, TPipe } from '../core/i18n';
import type { UdtInventoryCard, UdtRosterBot } from '../core/types';
import { rosterCard, UdtCard, type CardBot } from '../core/udt';
import {
  placeBot,
  positionOf,
  sameDraft,
  type LineupDraft,
  type LineupMode,
  type LineupPos,
} from '../core/udt-lineup';

/** What is dragged (or picked by tapping). */
/** `from`: the place the card was taken from (a bench bot may also hold a slot of the mode). */
type Item =
  { kind: 'bot'; id: string; from?: LineupPos } | { kind: 'trait'; card: UdtInventoryCard };
/** Where it can go. */
type Target = LineupPos | { kind: 'roster'; id: string } | { kind: 'traits' };

/** A trait put on a bot (the favourite weapon chosen when the trait needs one). */
export interface TraitDrop {
  cardId: string;
  botId: string;
  weapon?: string;
}

/**
 * The lineup board of My team: the five places of the mode and the bench, the roster and the
 * trait inventory. Cards are dragged (mouse; on touch after a short hold) or picked by a tap and
 * put by a second tap: between places (they swap), from the roster into the lineup and back,
 * traits onto bots. Every change goes out at once (`changed`), the page saves it.
 */
@Component({
  selector: 'udt-lineup-board',
  imports: [
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    CdkDragPlaceholder,
    FormsModule,
    RouterLink,
    TPipe,
    UdtCard,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="board" cdkDropListGroup [class.picking]="picked() !== null">
      <div class="row between">
        <h2>{{ 'udt.lineup' | t }}</h2>
        <div class="seg">
          <button type="button" [class.on]="mode() === 'dm'" (click)="mode.set('dm')">
            Deathmatch
          </button>
          <button type="button" [class.on]="mode() === 'mh'" (click)="mode.set('mh')">
            Monster Hunt
          </button>
        </div>
      </div>
      <p class="muted small hint">{{ 'udt.board.hint' | t }}</p>

      <div class="udt-arena field">
        @for (pos of slotPos; track pos.i) {
          <div
            class="place"
            cdkDropList
            cdkDropListSortingDisabled
            [cdkDropListData]="pos"
            [cdkDropListEnterPredicate]="acceptPlace"
            (cdkDropListDropped)="dropped($event)"
            [class.target]="picked() !== null"
            [attr.tabindex]="picked() !== null ? 0 : null"
            [attr.role]="picked() !== null ? 'button' : null"
            [attr.aria-label]="picked() !== null ? placeName(pos) : null"
            (click)="tapTarget(pos)"
            (keydown.enter)="tapTarget(pos, $event)"
            (keydown.space)="tapTarget(pos, $event)"
          >
            <span class="pno">#{{ pos.i + 1 }}</span>
            @if (botAt(pos); as b) {
              <div
                class="dcard"
                cdkDrag
                [cdkDragData]="botItem(b.botId, pos)"
                [cdkDragStartDelay]="delay"
                (cdkDragEnded)="dragEnded()"
                [class.sel]="isPicked(b.botId)"
                [class.dup]="dupNote(b.botId, pos) !== ''"
                [title]="dupNote(b.botId, pos)"
                tabindex="0"
                role="button"
                [attr.aria-label]="b.name + ' · ' + (placeLabel(b.botId, pos) ?? '')"
                [attr.aria-pressed]="isPicked(b.botId)"
                (click)="tapBot(b.botId, pos, $event)"
                (keydown.enter)="tapBot(b.botId, pos, $event)"
                (keydown.space)="tapBot(b.botId, pos, $event)"
              >
                <udt-card
                  [bot]="card(b)"
                  [small]="true"
                  [points]="b.own?.points ?? 0"
                  (pointsClick)="open.emit(b.botId)"
                />
                <div class="ph" *cdkDragPlaceholder></div>
              </div>
            } @else {
              <div class="empty">{{ 'udt.board.free' | t }}</div>
            }
          </div>
        }
      </div>
      <div class="benchrow">
        <span class="kpi">{{ 'udt.bench' | t }}</span>
        @for (pos of benchPos; track pos.i) {
          <div
            class="place bench"
            cdkDropList
            cdkDropListSortingDisabled
            [cdkDropListData]="pos"
            [cdkDropListEnterPredicate]="acceptPlace"
            (cdkDropListDropped)="dropped($event)"
            [class.target]="picked() !== null"
            [attr.tabindex]="picked() !== null ? 0 : null"
            [attr.role]="picked() !== null ? 'button' : null"
            [attr.aria-label]="picked() !== null ? placeName(pos) : null"
            (click)="tapTarget(pos)"
            (keydown.enter)="tapTarget(pos, $event)"
            (keydown.space)="tapTarget(pos, $event)"
          >
            @if (botAt(pos); as b) {
              <div
                class="dcard"
                cdkDrag
                [cdkDragData]="botItem(b.botId, pos)"
                [cdkDragStartDelay]="delay"
                (cdkDragEnded)="dragEnded()"
                [class.sel]="isPicked(b.botId)"
                [class.dup]="dupNote(b.botId, pos) !== ''"
                [title]="dupNote(b.botId, pos)"
                tabindex="0"
                role="button"
                [attr.aria-label]="b.name + ' · ' + (placeLabel(b.botId, pos) ?? '')"
                [attr.aria-pressed]="isPicked(b.botId)"
                (click)="tapBot(b.botId, pos, $event)"
                (keydown.enter)="tapBot(b.botId, pos, $event)"
                (keydown.space)="tapBot(b.botId, pos, $event)"
              >
                <udt-card
                  [bot]="card(b)"
                  [small]="true"
                  [points]="b.own?.points ?? 0"
                  (pointsClick)="open.emit(b.botId)"
                />
                <div class="ph" *cdkDragPlaceholder></div>
              </div>
            } @else {
              <div class="empty">{{ 'udt.bench' | t }} {{ pos.i + 1 }}</div>
            }
          </div>
        }
      </div>

      @if (picked(); as p) {
        <div class="pickbar" role="status">
          @if (p.kind === 'bot') {
            <span
              ><b>{{ nameOf(p.id) }}</b> · {{ 'udt.board.pickedBot' | t }}</span
            >
            <button type="button" (click)="open.emit(p.id); picked.set(null)">
              {{ 'udt.board.details' | t }}
            </button>
            @if (inLineup(p.id)) {
              <button type="button" (click)="tapTarget(out)">
                {{ 'udt.board.out' | t }}
              </button>
            }
          } @else {
            <span
              ><b>{{ 'udt.trait.' + p.card.code | t }}</b> · {{ 'udt.board.pickedTrait' | t }}</span
            >
          }
          <button type="button" class="link" (click)="picked.set(null)">
            {{ 'common.cancel' | t }}
          </button>
        </div>
      }

      @if (weaponFor(); as w) {
        <div class="pickbar weapon" role="dialog" [attr.aria-label]="'udt.traits.weapon' | t">
          <span
            >{{ 'udt.trait.' + w.card.code | t }} → <b>{{ nameOf(w.botId) }}</b
            >: {{ 'udt.traits.weapon' | t }}</span
          >
          <select [(ngModel)]="weapon" name="weapon" [attr.aria-label]="'udt.traits.weapon' | t">
            @for (x of weapons(); track x.name) {
              <option [ngValue]="x.name">{{ x.label }}</option>
            }
          </select>
          <button type="button" class="primary" [disabled]="!weapon" (click)="confirmWeapon()">
            {{ 'udt.traits.put' | t }}
          </button>
          <button type="button" class="link" (click)="weaponFor.set(null)">
            {{ 'common.cancel' | t }}
          </button>
        </div>
      }

      <div class="trays">
        <div class="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="tray() === 'roster'"
            [class.on]="tray() === 'roster'"
            (click)="tray.set('roster')"
          >
            {{ 'udt.roster' | t: { n: roster().length } }}
          </button>
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="tray() === 'traits'"
            [class.on]="tray() === 'traits'"
            (click)="tray.set('traits')"
          >
            {{ 'udt.board.traits' | t: { n: inventory().length } }}
          </button>
        </div>
        <div class="tray" [class.hide]="tray() !== 'roster'">
          <div
            class="outzone"
            cdkDropList
            cdkDropListSortingDisabled
            [cdkDropListData]="out"
            [cdkDropListEnterPredicate]="acceptBot"
            (cdkDropListDropped)="dropped($event)"
            [class.target]="picked()?.kind === 'bot'"
            [attr.tabindex]="picked()?.kind === 'bot' ? 0 : null"
            [attr.role]="picked()?.kind === 'bot' ? 'button' : null"
            (click)="tapTarget(out)"
            (keydown.enter)="tapTarget(out, $event)"
            (keydown.space)="tapTarget(out, $event)"
          >
            {{ 'udt.board.outZone' | t }}
          </div>
          <div class="cards">
            @for (b of roster(); track b.botId) {
              @let rpos = rosterPos(b.botId);
              <div
                class="rslot"
                cdkDropList
                cdkDropListSortingDisabled
                [cdkDropListData]="rpos"
                [cdkDropListEnterPredicate]="acceptRoster"
                (cdkDropListDropped)="dropped($event)"
                [class.target]="picked() !== null"
                (click)="tapTarget(rpos)"
              >
                <div
                  class="dcard"
                  cdkDrag
                  [cdkDragData]="botItem(b.botId)"
                  [cdkDragStartDelay]="delay"
                  (cdkDragEnded)="dragEnded()"
                  [class.sel]="isPicked(b.botId)"
                  [class.used]="inLineup(b.botId)"
                  tabindex="0"
                  role="button"
                  [attr.aria-label]="
                    b.name + ' · ' + (placeLabel(b.botId) ?? ('udt.board.outZone' | t))
                  "
                  [attr.aria-pressed]="isPicked(b.botId)"
                  (click)="tapBot(b.botId, null, $event)"
                  (keydown.enter)="tapBot(b.botId, null, $event)"
                  (keydown.space)="tapBot(b.botId, null, $event)"
                >
                  <udt-card
                    class="full"
                    [bot]="card(b)"
                    [small]="true"
                    [note]="placeLabel(b.botId)"
                    [points]="b.own?.points ?? 0"
                    (pointsClick)="open.emit(b.botId)"
                  />
                  <!-- Phones: a compact strip instead of full cards (the field stays in view). -->
                  <span class="mini">
                    <span class="udt-chip r-{{ b.rarity }}"
                      ><span>{{ b.effective.skill }}</span></span
                    >
                    <span class="mtxt"
                      ><b>{{ b.name }}</b
                      ><small class="muted">{{ placeLabel(b.botId) ?? '–' }}</small></span
                    >
                    @if ((b.own?.points ?? 0) > 0) {
                      <button
                        type="button"
                        class="udt-plaque inline"
                        [attr.aria-label]="'udt.points.plaque' | t: { n: b.own!.points }"
                        (click)="$event.stopPropagation(); open.emit(b.botId)"
                      >
                        +{{ b.own!.points }}
                      </button>
                    }
                  </span>
                  <div class="ph" *cdkDragPlaceholder></div>
                </div>
              </div>
            }
          </div>
          <a class="small" routerLink="/udt/market">{{ 'udt.toMarket' | t }}</a>
        </div>
        <div class="tray" [class.hide]="tray() !== 'traits'">
          <div
            class="chips"
            cdkDropList
            cdkDropListSortingDisabled
            [cdkDropListData]="traitsPos"
            [cdkDropListEnterPredicate]="acceptTraitBack"
            (cdkDropListDropped)="dropped($event)"
          >
            @for (c of inventory(); track c.id) {
              <span
                class="udt-trait r-{{ c.rarity }} chip"
                cdkDrag
                [cdkDragData]="traitItem(c)"
                [cdkDragStartDelay]="delay"
                (cdkDragEnded)="dragEnded()"
                [class.sel]="picked()?.kind === 'trait' && pickedCard() === c.id"
                [title]="'udt.traitE.' + c.code | t"
                tabindex="0"
                role="button"
                [attr.aria-pressed]="picked()?.kind === 'trait' && pickedCard() === c.id"
                (click)="tapTrait(c, $event)"
                (keydown.enter)="tapTrait(c, $event)"
                (keydown.space)="tapTrait(c, $event)"
                >{{ 'udt.trait.' + c.code | t }}
                <small class="muted">{{ 'udt.traitE.' + c.code | t }}</small>
              </span>
            } @empty {
              <span class="muted small"
                >{{ 'udt.traits.none' | t }}
                <a routerLink="/udt/packs">{{ 'udt.nav.packs' | t }}</a></span
              >
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    .dcard.dup {
      opacity: 0.55;
      outline: 1px dashed var(--muted);
      outline-offset: 2px;
    }
    .dcard:focus-visible,
    .chip:focus-visible,
    .place:focus-visible,
    .outzone:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .board {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .between {
      justify-content: space-between;
      align-items: center;
    }
    .hint {
      margin: -4px 0 0;
    }
    .field {
      display: grid;
      grid-template-columns: repeat(5, var(--slot-w, 150px));
      justify-content: center;
    }
    .place {
      position: relative;
      min-height: 150px;
      border-radius: 16px;
      transition:
        box-shadow 0.15s,
        background 0.15s;
    }
    .pno {
      position: absolute;
      left: 6px;
      bottom: -18px;
      font-size: 0.7rem;
      color: var(--muted);
    }
    .empty {
      width: var(--slot-w, 150px);
      height: 100%;
      min-height: 150px;
      border: 2px dashed var(--line);
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      font-size: 0.85rem;
    }
    .benchrow {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: center;
      justify-content: center;
      padding: 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: #090b11;
    }
    /* Places that take what is dragged or picked. */
    .cdk-drop-list-receiving,
    .picking .target {
      box-shadow: 0 0 0 2px rgba(178, 107, 255, 0.55);
      cursor: pointer;
    }
    .picking .target .empty,
    .cdk-drop-list-receiving .empty {
      border-color: var(--udt);
      color: var(--udt);
    }
    .cdk-drop-list-dragging {
      box-shadow:
        0 0 0 3px var(--udt),
        0 0 24px rgba(178, 107, 255, 0.45);
      background: rgba(178, 107, 255, 0.08);
    }
    .dcard {
      cursor: grab;
      touch-action: manipulation;
      border-radius: 16px;
      transition: transform 0.12s;
    }
    .dcard.sel {
      transform: translateY(-6px);
      box-shadow:
        0 0 0 3px var(--udt),
        0 12px 26px rgba(0, 0, 0, 0.5);
    }
    .dcard.used {
      opacity: 0.7;
    }
    .cdk-drag-preview {
      opacity: 0.92;
      transform: rotate(2deg);
    }
    .cdk-drag-animating {
      transition: transform 180ms cubic-bezier(0, 0, 0.2, 1);
    }
    /* Where the card would land: a frame over the place, the layout does not move. */
    .ph {
      position: absolute;
      inset: 0;
      border-radius: 14px;
      border: 2px dashed var(--udt);
      background: rgba(178, 107, 255, 0.08);
      pointer-events: none;
    }
    .pickbar {
      position: sticky;
      bottom: 8px;
      z-index: 5;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--udt);
      background: var(--panel-2);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    }
    .pickbar > span {
      flex: 1 1 200px;
    }
    .trays {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: var(--panel);
    }
    .tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--border);
      padding: 0 8px;
    }
    .tabs button {
      border: none;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      background: none;
      color: var(--text-2);
      font-weight: 600;
    }
    .tabs button.on {
      color: var(--text);
      border-bottom-color: var(--udt);
    }
    .tray {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .tray.hide {
      display: none;
    }
    .outzone {
      border: 2px dashed var(--line);
      border-radius: var(--radius-sm);
      padding: 8px;
      text-align: center;
      color: var(--muted);
      font-size: 0.85rem;
    }
    .cards {
      display: flex;
      gap: 14px;
      overflow-x: auto;
      padding: 10px 4px 6px;
      scroll-snap-type: x proximity;
    }
    .rslot {
      position: relative;
      border-radius: 16px;
      scroll-snap-align: start;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      min-height: 40px;
    }
    .chip {
      height: auto;
      min-height: 30px;
      padding: 4px 10px;
      font-size: 0.8rem;
      cursor: grab;
      white-space: normal;
      touch-action: manipulation;
    }
    .chip small {
      font-weight: 400;
      font-size: 0.72rem;
    }
    .chip.sel {
      box-shadow: 0 0 0 2px var(--udt);
    }
    @media (max-width: 900px) {
      .field {
        grid-template-columns: repeat(3, var(--slot-w, 150px));
      }
    }
    .mini {
      display: none;
    }
    @media (max-width: 560px) {
      .full {
        display: none;
      }
      .mini {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 150px;
        padding: 6px 8px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: #0c0f16;
      }
      .mtxt {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .mtxt b {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .udt-plaque.inline {
        position: static;
        margin-left: auto;
        min-width: 26px;
        height: 26px;
        font-size: 0.8rem;
      }
      .outzone {
        padding: 4px;
        font-size: 0.75rem;
      }
      .tray {
        padding: 8px;
        gap: 6px;
      }
      .cards {
        gap: 8px;
        padding: 4px 2px;
      }
      .field {
        grid-template-columns: repeat(2, var(--slot-w, 150px));
        gap: 26px 12px;
      }
      .trays {
        position: sticky;
        bottom: 0;
        z-index: 4;
        box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.45);
      }
      .cards {
        padding-bottom: 2px;
      }
    }
  `,
})
export class UdtLineupBoard {
  readonly roster = input.required<UdtRosterBot[]>();
  readonly draft = input.required<LineupDraft>();
  readonly tag = input<string | undefined>(undefined);
  readonly inventory = input<UdtInventoryCard[]>([]);
  readonly weapons = input<{ name: string; label: string }[]>([]);
  private readonly i18n = inject(I18n);
  /** The lineup changed (a drop or a second tap): save it. */
  readonly changed = output<LineupDraft>();
  readonly trait = output<TraitDrop>();
  /** Open a bot's details (development, traits, rest, look). */
  readonly open = output<string>();

  protected readonly mode = signal<LineupMode>('dm');
  protected readonly tray = signal<'roster' | 'traits'>('roster');
  protected readonly picked = signal<Item | null>(null);
  protected readonly weaponFor = signal<{ card: UdtInventoryCard; botId: string } | null>(null);
  protected weapon: string | null = null;
  protected readonly slotPos: readonly { kind: 'slot'; i: number }[] = [0, 1, 2, 3, 4].map((i) => ({
    kind: 'slot',
    i,
  }));
  protected readonly benchPos: readonly { kind: 'bench'; i: number }[] = [0, 1].map((i) => ({
    kind: 'bench',
    i,
  }));
  private readonly rosterTargets = new Map<string, Target>();
  /** A drag ended just now: the click that follows is not a tap. */
  private dragEnd = 0;
  protected readonly out: LineupPos = { kind: 'out' };
  protected readonly traitsPos: Target = { kind: 'traits' };
  /** Touch: a short hold starts the drag, so the page still scrolls. */
  protected readonly delay = { touch: 250, mouse: 0 };
  protected readonly pickedCard = computed(() => {
    const p = this.picked();
    return p?.kind === 'trait' ? p.card.id : null;
  });

  private readonly byId = computed(() => new Map(this.roster().map((b) => [b.botId, b])));

  protected card(b: UdtRosterBot): CardBot {
    return rosterCard(b, this.tag());
  }

  protected botAt(pos: LineupPos): UdtRosterBot | undefined {
    const d = this.draft();
    const id =
      pos.kind === 'slot' ? d[this.mode()][pos.i] : pos.kind === 'bench' ? d.bench[pos.i] : null;
    return id ? this.byId().get(id) : undefined;
  }

  protected nameOf(id: string) {
    return this.byId().get(id)?.name ?? '';
  }

  protected inLineup(id: string) {
    return positionOf(this.draft(), this.mode(), id).kind !== 'out';
  }

  protected placeLabel(id: string, at?: LineupPos): string | null {
    const p = at ?? positionOf(this.draft(), this.mode(), id);
    if (p.kind === 'slot') return `#${p.i + 1}`;
    return p.kind === 'bench' ? `${this.i18n.t('udt.bench')} ${p.i + 1}` : null;
  }

  /** A place's name for screen readers (the target of a picked card). */
  protected placeName(pos: LineupPos): string {
    const b = this.botAt(pos);
    const name = this.placeLabel('', pos) ?? '';
    return b ? `${name} · ${b.name}` : `${name} · ${this.i18n.t('udt.board.free')}`;
  }

  /** The slot of the mode a bench bot also holds (then its bench place counts in the other mode). */
  protected dupSlot(id: string): number | null {
    const i = this.draft()[this.mode()].indexOf(id);
    return i >= 0 ? i + 1 : null;
  }

  protected dupNote(id: string, pos: LineupPos): string {
    if (pos.kind !== 'bench') return '';
    const n = this.dupSlot(id);
    return n === null ? '' : this.i18n.t('udt.board.benchDup', { n });
  }

  protected rosterPos(id: string): Target {
    let t = this.rosterTargets.get(id);
    if (!t) this.rosterTargets.set(id, (t = { kind: 'roster', id }));
    return t;
  }

  protected dragEnded() {
    this.dragEnd = Date.now();
  }

  private justDragged() {
    return Date.now() - this.dragEnd < 400;
  }

  protected isPicked(id: string) {
    const p = this.picked();
    return p?.kind === 'bot' && p.id === id;
  }

  protected botItem(id: string, from?: LineupPos): Item {
    return from ? { kind: 'bot', id, from } : { kind: 'bot', id };
  }

  protected traitItem(card: UdtInventoryCard): Item {
    return { kind: 'trait', card };
  }

  // --- what may go where (drag)
  protected readonly acceptPlace = (drag: CdkDragT<Item>, drop: CdkDropListT<Target>) =>
    drag.data.kind === 'bot' || this.botAt(drop.data as LineupPos) !== undefined;
  protected readonly acceptBot = (drag: CdkDragT<Item>) => drag.data.kind === 'bot';
  protected readonly acceptRoster = (drag: CdkDragT<Item>) =>
    drag.data.kind === 'trait' || this.inLineup(drag.data.id);
  protected readonly acceptTraitBack = (drag: CdkDragT<Item>) => drag.data.kind === 'trait';

  protected dropped<T extends Target>(ev: CdkDragDrop<T, unknown, Item>) {
    // Let go outside a place, or back where it came from: nothing happens (the CDK still names
    // the last list the pointer was over).
    if (!ev.isPointerOverContainer || ev.container === ev.previousContainer) return;
    this.apply(ev.item.data, ev.container.data);
  }

  // --- tap, then tap
  protected tapBot(id: string, pos: LineupPos | null, ev: Event) {
    ev.stopPropagation();
    ev.preventDefault();
    if (this.justDragged()) return;
    const p = this.picked();
    if (!p) {
      this.picked.set(this.botItem(id, pos ?? undefined));
      return;
    }
    if (p.kind === 'bot' && p.id === id) {
      this.picked.set(null);
      return;
    }
    this.apply(p, pos ?? { kind: 'roster', id });
  }

  protected tapTrait(card: UdtInventoryCard, ev: Event) {
    ev.stopPropagation();
    ev.preventDefault();
    if (this.justDragged()) return;
    const p = this.picked();
    this.picked.set(p?.kind === 'trait' && p.card.id === card.id ? null : { kind: 'trait', card });
  }

  protected tapTarget(to: Target, ev?: Event) {
    ev?.preventDefault();
    if (this.justDragged()) return;
    const p = this.picked();
    if (p) this.apply(p, to);
  }

  private apply(item: Item, to: Target) {
    this.picked.set(null);
    if (item.kind === 'trait') {
      const botId =
        to.kind === 'roster'
          ? to.id
          : to.kind === 'slot' || to.kind === 'bench'
            ? this.botAt(to)?.botId
            : undefined;
      if (!botId) return;
      if (item.card.needsWeapon) {
        this.weapon = this.weapons()[0]?.name ?? null;
        this.weaponFor.set({ card: item.card, botId });
        return;
      }
      this.trait.emit({ cardId: item.card.id, botId });
      return;
    }
    // A bot dropped on a roster card or the out zone leaves the lineup.
    const pos: LineupPos | null =
      to.kind === 'roster' || to.kind === 'out'
        ? { kind: 'out' }
        : to.kind === 'traits'
          ? null
          : to;
    if (!pos) return;
    const next = placeBot(this.draft(), this.mode(), item.id, pos, item.from);
    if (!sameDraft(next, this.draft())) this.changed.emit(next);
  }

  protected confirmWeapon() {
    const w = this.weaponFor();
    if (!w || !this.weapon) return;
    this.weaponFor.set(null);
    this.trait.emit({ cardId: w.card.id, botId: w.botId, weapon: this.weapon });
  }
}
