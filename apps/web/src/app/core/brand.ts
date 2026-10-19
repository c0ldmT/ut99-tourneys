import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** The logo mark: a hexagon (cyan) with an N (magenta). */
@Component({
  selector: 'na-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 32 32"
    aria-hidden="true"
  >
    <path
      d="M16 2 28 9v14l-12 7-12-7V9z"
      fill="none"
      stroke="var(--accent)"
      stroke-width="2.2"
      stroke-linejoin="round"
    />
    <path
      d="M11 22V10l10 12V10"
      fill="none"
      stroke="var(--hot)"
      stroke-width="2.6"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
  `,
})
export class Logo {
  readonly size = input(30);
}

/** The site name as a wordmark: the last word in cyan ("NEURO ARENA"). */
@Component({
  selector: 'na-wordmark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ parts()[0] }}
    @if (parts()[1]) {
      <span>{{ parts()[1] }}</span>
    }`,
  styles: `
    :host {
      font-family: var(--font-display);
      font-weight: 800;
      font-style: italic;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text);
      white-space: nowrap;
    }
    span {
      color: var(--accent);
    }
  `,
})
export class Wordmark {
  readonly name = input.required<string>();
  protected readonly parts = computed(() => {
    const n = this.name().trim();
    const i = n.lastIndexOf(' ');
    return i > 0 ? [n.slice(0, i + 1), n.slice(i + 1)] : [n, ''];
  });
}

/** The Neuro coin (gold, with €), shown before Neuro amounts. */
@Component({
  selector: 'na-coin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 16 16"
    aria-hidden="true"
  >
    <circle cx="8" cy="8" r="7.5" fill="var(--neuro)" />
    <circle cx="8" cy="8" r="5.6" fill="none" stroke="#9a6a12" stroke-width="0.9" />
    <text
      x="8"
      y="11.1"
      text-anchor="middle"
      font-size="8.5"
      font-weight="800"
      fill="#3d2a05"
      font-family="Barlow, sans-serif"
    >
      €
    </text>
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      vertical-align: -0.15em;
      flex: none;
    }
  `,
})
export class Coin {
  readonly size = input(16);
}

/** Stroke icons (24px grid), coloured by the text colour. */
const ICONS: Record<string, string> = {
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  delete: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  pause: 'M9 6v12M15 6v12',
  play: 'M8 5l11 7-11 7z',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  check: 'M5 12l5 5 9-10',
  close: 'M6 6l12 12M18 6 6 18',
  key: 'M14 10a4 4 0 1 0-1 2.7L21 21M17 17l2-2M19 19l2-2',
  plus: 'M12 5v14M5 12h14',
  copyToNew: 'M8 8h11v11H8zM4 16V4h12M13.5 11v5M11 13.5h5',
  shop: 'M4 7h16l-1.5 12h-13zM9 7a3 3 0 0 1 6 0',
  logout: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h11',
  // badges (Neuro shop)
  crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  skull:
    'M12 3a8 8 0 0 0-5 14.2V20h10v-2.8A8 8 0 0 0 12 3zM9 11.5h.01M15 11.5h.01M10.5 20v-2M13.5 20v-2',
  dice: 'M5 5h14v14H5zM9 9h.01M15 15h.01M15 9h.01M9 15h.01M12 12h.01',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z',
  flame: 'M12 3c1 4 6 5.5 6 10.5a6 6 0 0 1-12 0c0-3 2-4.5 2-7 2 1 3.5 3 3.5 5.5',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 12h.01',
  ghost:
    'M5 21V11a7 7 0 0 1 14 0v10l-2.3-1.8-2.3 1.8-2.4-1.8-2.4 1.8-2.3-1.8zM9.5 11h.01M14.5 11h.01',
};

@Component({
  selector: 'na-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      [attr.d]="path()"
      [attr.fill]="name() === 'play' ? 'currentColor' : 'none'"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
    }
    /* Keep these styles different from Logo's: two components with identical inline styles
       make "ng build" (Angular 21) hang after writing the output. */
  `,
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(17);
  protected readonly path = computed(() => ICONS[this.name()] ?? '');
}

/**
 * The Dream Team mark: two fanned bot cards (violet) with a dream star on the front one and
 * a rank chevron below it; the star turns and glows on hover of the link around it.
 */
@Component({
  selector: 'na-udt-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg
    [attr.width]="size()"
    [attr.height]="size()"
    viewBox="0 0 32 32"
    aria-hidden="true"
  >
    <rect
      x="6.5"
      y="5"
      width="15"
      height="21"
      rx="2.5"
      transform="rotate(-14 14 15.5)"
      fill="none"
      stroke="var(--udt)"
      stroke-width="1.8"
      opacity="0.55"
    />
    <rect
      x="11"
      y="5.5"
      width="15"
      height="21"
      rx="2.5"
      transform="rotate(8 18.5 16)"
      fill="var(--bg-2)"
      stroke="var(--udt)"
      stroke-width="2.2"
    />
    <g transform="rotate(8 18.5 16)">
      <path
        class="star"
        d="M18.5 8.6l1.75 3.55 3.9.57-2.82 2.75.67 3.88-3.5-1.84-3.5 1.84.67-3.88-2.82-2.75 3.9-.57z"
        fill="var(--neuro)"
      />
      <path
        d="M14.5 23.6l4-2.6 4 2.6"
        fill="none"
        stroke="var(--hot)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
  </svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    .star {
      transform-box: fill-box;
      transform-origin: center;
      transition:
        transform 0.4s ease,
        filter 0.4s ease;
    }
    :host-context(a:hover) .star,
    :host-context(a.active) .star {
      transform: rotate(72deg) scale(1.12);
      filter: drop-shadow(0 0 2px var(--neuro));
    }
  `,
})
export class UdtMark {
  readonly size = input(26);
}
