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
