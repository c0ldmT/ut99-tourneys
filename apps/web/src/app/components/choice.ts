import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  untracked,
} from '@angular/core';
import { Icon } from '../core/brand';
import { I18n, TPipe } from '../core/i18n';

/**
 * One option of a tab row or a segment (decision 317). `label` is an i18n key unless `text` is
 * set; `badge` shows a count after the label, `dot` a small marker (unsaved changes).
 */
export interface Choice<T extends string | number = string> {
  value: T;
  label?: string;
  /** Parameters of the label (`{n}` …). */
  params?: Record<string, string | number>;
  /** Plain text instead of an i18n key. */
  text?: string;
  /** i18n key of the tooltip. */
  title?: string;
  /** Language of a plain text (the language picker names each language in itself). */
  lang?: string;
  icon?: string;
  badge?: number | string | null;
  dot?: boolean;
  /** i18n key that names the dot (tooltip and screen readers). */
  dotLabel?: string;
  /** A pulsing live marker after the label. */
  live?: boolean;
  disabled?: boolean;
}

/** Arrow keys, Home and End: the index of the next enabled option (null for other keys). */
function moveTo(
  from: number,
  key: string,
  count: number,
  ok: (i: number) => boolean,
): number | null {
  const step =
    key === 'ArrowRight' || key === 'ArrowDown'
      ? 1
      : key === 'ArrowLeft' || key === 'ArrowUp'
        ? -1
        : 0;
  let i: number;
  let dir = step;
  if (key === 'Home') [i, dir] = [-1, 1];
  else if (key === 'End') [i, dir] = [count, -1];
  else if (step) i = from;
  else return null;
  for (let n = 0; n < count; n++) {
    i = (i + dir + count) % count;
    if (ok(i)) return i;
  }
  return null;
}

/**
 * When the focus is in the row and the value changed, the focus moves to the chosen option.
 * The parent decides: a refused change (unsaved settings kept) leaves the focus where it was.
 */
function followFocus(host: ElementRef<HTMLElement>, index: () => number): void {
  effect(() => {
    const i = index();
    untracked(() =>
      setTimeout(() => {
        const el = host.nativeElement;
        if (!el.contains(document.activeElement)) return;
        el.querySelectorAll<HTMLButtonElement>(':scope > button')[i]?.focus();
      }),
    );
  });
}

/**
 * Two ways to choose (UX audit B2, decision 317). `na-tabs` switches what a page or panel shows
 * (tab row with underline, `role=tablist`); `na-segment` picks a value, a view or a filter
 * (`role=radiogroup`, joined buttons, `variant="chips"` for the rounded filter row). The element
 * itself is the row (`.tabs`, `.seg`, `.pills`), so a page places it with its own classes.
 * Both are stateless: `[value]` in, `(valueChange)` out – `[(value)]="signal"` works, and a
 * parent may refuse a change. Keyboard: one tab stop, arrow keys, Home and End.
 */
@Component({
  selector: 'na-tabs',
  imports: [TPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'tabs',
    role: 'tablist',
    '[attr.aria-label]': 'label() ? i18n.t(label()) : null',
  },
  template: `
    @for (o of options(); track o.value; let i = $index) {
      <button
        type="button"
        role="tab"
        [id]="ids() ? ids() + '-' + o.value : null"
        [class.active]="o.value === value()"
        [attr.aria-selected]="o.value === value()"
        [attr.aria-controls]="panel() && o.value === value() ? panel() : null"
        [attr.aria-disabled]="o.disabled || null"
        [attr.tabindex]="i === focusIndex() ? 0 : -1"
        [title]="o.title ? (o.title | t) : ''"
        (click)="pick(o)"
        (keydown)="key($event, i)"
      >
        @if (o.icon) {
          <na-icon [name]="o.icon" [size]="15" />
        }
        {{ o.text ?? (o.label! | t: o.params) }}
        @if (o.badge !== undefined && o.badge !== null && o.badge !== 0) {
          <span class="badge season">{{ o.badge }}</span>
        }
        @if (o.live) {
          <span class="live-dot"></span>
        }
        @if (o.dot) {
          <span class="dot" [title]="o.dotLabel ? (o.dotLabel | t) : ''">
            @if (o.dotLabel) {
              <span class="sr">{{ o.dotLabel | t }}</span>
            }
          </span>
        }
      </button>
    }
  `,
})
export class Tabs<T extends string | number = string> {
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly i18n = inject(I18n);
  readonly options = input.required<readonly Choice<T>[]>();
  readonly value = input<T | null | undefined>();
  readonly valueChange = output<T>();
  /** i18n key of the row's accessible name. */
  readonly label = input<string>('');
  /** Id of the panel the selected tab controls. */
  readonly panel = input<string>('');
  /** Prefix for the tab ids (`<ids>-<value>`), e.g. for `aria-labelledby` on the panel. */
  readonly ids = input<string>('');

  protected readonly focusIndex = computed(() => {
    const i = this.options().findIndex((o) => o.value === this.value());
    return i >= 0 ? i : 0;
  });

  constructor() {
    followFocus(this.host, () => this.focusIndex());
  }

  protected pick(o: Choice<T>): void {
    if (!o.disabled && o.value !== this.value()) this.valueChange.emit(o.value);
  }

  protected key(e: KeyboardEvent, i: number): void {
    const opts = this.options();
    const to = moveTo(i, e.key, opts.length, (j) => !opts[j].disabled);
    if (to === null) return;
    e.preventDefault();
    this.pick(opts[to]);
  }
}

@Component({
  selector: 'na-segment',
  imports: [TPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.seg]': "variant() === 'seg'",
    '[class.pills]': "variant() === 'chips'",
    role: 'radiogroup',
    '[attr.aria-label]': 'label() ? i18n.t(label()) : null',
    '[attr.aria-labelledby]': 'labelledby() || null',
  },
  template: `
    @for (o of options(); track o.value; let i = $index) {
      <button
        type="button"
        role="radio"
        [class.on]="o.value === value()"
        [attr.aria-checked]="o.value === value()"
        [attr.tabindex]="i === focusIndex() ? 0 : -1"
        [attr.lang]="o.lang || null"
        [disabled]="o.disabled || disabled()"
        [title]="o.title ? (o.title | t) : ''"
        (click)="pick(o)"
        (keydown)="key($event, i)"
      >
        @if (o.icon) {
          <na-icon [name]="o.icon" [size]="15" />
        }
        {{ o.text ?? (o.label! | t: o.params) }}
        @if (o.badge !== undefined && o.badge !== null && o.badge !== 0) {
          <span class="n">{{ o.badge }}</span>
        }
      </button>
    }
  `,
})
export class Segment<T extends string | number = string> {
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly i18n = inject(I18n);
  readonly options = input.required<readonly Choice<T>[]>();
  readonly value = input<T | null | undefined>();
  readonly valueChange = output<T>();
  /** `seg`: joined buttons (forms, views); `chips`: rounded filter row. */
  readonly variant = input<'seg' | 'chips'>('seg');
  /** i18n key of the group's accessible name. */
  readonly label = input<string>('');
  /** Id of an element that names the group (instead of `label`). */
  readonly labelledby = input<string>('');
  readonly disabled = input(false);

  protected readonly focusIndex = computed(() => {
    const i = this.options().findIndex((o) => o.value === this.value());
    return i >= 0 ? i : 0;
  });

  constructor() {
    followFocus(this.host, () => this.focusIndex());
  }

  protected pick(o: Choice<T>): void {
    if (o.disabled || this.disabled() || o.value === this.value()) return;
    this.valueChange.emit(o.value);
    // Inside a form the group acts like a field: forms that watch "change" see it.
    this.host.nativeElement.dispatchEvent(new Event('change', { bubbles: true }));
  }

  protected key(e: KeyboardEvent, i: number): void {
    const opts = this.options();
    const to = moveTo(i, e.key, opts.length, (j) => !opts[j].disabled);
    if (to === null) return;
    e.preventDefault();
    this.pick(opts[to]);
  }
}
