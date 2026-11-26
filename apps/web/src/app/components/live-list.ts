import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

/** A row of the live list: a match of a tournament or a game of a league evening. */
export interface LiveListItem {
  key: string;
  /** Match id ("W1-4") or the game's kind ("Spieltag 5"). */
  label: string;
  names: [string, string];
  /** Frags ("12:9"), null: none yet. */
  score: string | null;
  /** The server playing it. */
  server: string;
  /** A game is live right now (the dot). */
  live: boolean;
  /** What happens when nothing is live (vote, ready check, check-in). */
  status?: string;
  /** Opens another page (league games); without: the row is picked (`pick`). */
  link?: unknown[];
  /** The user's own game. */
  mine?: boolean;
}

/**
 * The matches being played at the same time (decision 294): the parallel matches of a tournament
 * (picked in place) and the games of a league evening (each its own page) look the same on the
 * tournament page, the league page and the overview.
 */
@Component({
  selector: 'na-live-list',
  imports: [RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (title()) {
      <div class="ll-title">
        <span class="badge running">Live</span>
        <span>{{ title() }}</span>
      </div>
    }
    <div
      class="ll-rows"
      [attr.role]="linked() || still() ? null : 'tablist'"
      [attr.aria-label]="label()"
    >
      @for (it of items(); track it.key) {
        @if (still()) {
          <div class="ll-row still">
            <ng-container *ngTemplateOutlet="row; context: { $implicit: it }" />
          </div>
        } @else if (it.link) {
          <a
            class="ll-row"
            [class.on]="it.key === selected()"
            [class.me]="it.mine"
            [routerLink]="it.link"
          >
            <ng-container *ngTemplateOutlet="row; context: { $implicit: it }" />
          </a>
        } @else {
          <button
            type="button"
            role="tab"
            class="ll-row"
            [class.on]="it.key === selected()"
            [class.me]="it.mine"
            [attr.aria-selected]="it.key === selected()"
            (click)="pick.emit(it.key)"
          >
            <ng-container *ngTemplateOutlet="row; context: { $implicit: it }" />
          </button>
        }
      }
    </div>
    <ng-template #row let-it>
      <span class="ll-top">
        @if (labels()) {
          <span class="mono">{{ it.label }}</span>
        }
        <span class="ll-srv"><span class="dot" [class.on]="it.live"></span>{{ it.server }}</span>
      </span>
      <span class="ll-vs">
        <span class="ll-n">{{ it.names[0] }}</span>
        <b class="mono">{{ it.score ?? 'vs' }}</b>
        <span class="ll-n r">{{ it.names[1] }}</span>
      </span>
      @if (!it.live && it.status) {
        <span class="ll-st">{{ it.status }}</span>
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }
    .ll-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      margin-bottom: 10px;
    }
    /* One column in a narrow box, more side by side where there is room (no scrollbar). */
    .ll-rows {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
      gap: 6px;
    }
    .ll-row {
      display: grid;
      justify-content: stretch;
      gap: 4px;
      width: 100%;
      min-height: 0;
      padding: 8px 10px;
      border-radius: var(--radius);
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text);
      text-align: left;
      font: inherit;
      font-weight: 400;
      text-decoration: none;
      cursor: pointer;
    }
    .ll-row:hover:not(.still) {
      border-color: #3a4558;
    }
    .ll-row.still {
      cursor: inherit;
    }
    .ll-row.on {
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px var(--accent);
    }
    .ll-row.me .ll-n {
      color: var(--accent);
    }
    .ll-top {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: var(--fs-xs);
      color: var(--text-2);
    }
    .ll-srv {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ll-vs {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      gap: 8px;
      align-items: baseline;
    }
    .ll-n {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ll-n.r {
      text-align: right;
    }
    .ll-st {
      font-size: var(--fs-xs);
      color: var(--text-2);
    }
  `,
})
export class LiveList {
  readonly items = input.required<LiveListItem[]>();
  /** The highlighted row (the match shown, the game's own page). */
  readonly selected = input<string | null>(null);
  /** Heading next to the live badge (empty: none). */
  readonly title = input('');
  /** Accessible name of the list. */
  readonly label = input('');
  /** Rows only to read (inside a link, e.g. an overview tile). */
  readonly still = input(false);
  readonly pick = output<string>();

  /** Labels only where they tell the rows apart (one league evening: all the same matchday). */
  protected labels(): boolean {
    return new Set(this.items().map((i) => i.label)).size > 1;
  }

  protected linked(): boolean {
    return this.items().some((i) => !!i.link);
  }
}
