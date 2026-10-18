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
