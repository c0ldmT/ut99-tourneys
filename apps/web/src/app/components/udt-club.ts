import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * A league club's name (decision 330): a manager's club links to its squad (with the hover card),
 * an AI club stays text. The link keeps the colour of the place it sits in.
 */
@Component({
  selector: 'udt-club',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (club().userId; as u) {
      <a class="cl" [routerLink]="['/udt/squads', u]">{{ club().name }}</a>
    } @else {
      {{ club().name }}
    }`,
  styles: `
    :host {
      display: contents;
    }
    .cl {
      color: inherit;
      text-decoration: underline dotted color-mix(in srgb, currentColor 45%, transparent);
      text-underline-offset: 3px;
    }
    .cl:hover {
      color: var(--accent);
      text-decoration-color: currentColor;
    }
  `,
})
export class UdtClub {
  readonly club = input.required<{ name: string; userId?: string }>();
}
