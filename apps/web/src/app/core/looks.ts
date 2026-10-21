import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injectable,
  input,
  signal,
} from '@angular/core';
import { Api } from './api';
import { Loading } from './loading';
import { Auth } from './auth';
import { Icon } from './brand';
import type { LookView } from './types';

/**
 * The looks users bought in the Neuro shop (title, name colour, frame, badge, banner), by user id
 * and by in-game name. Loaded after login and every minute; `reload()` after a purchase.
 */
@Injectable({ providedIn: 'root' })
export class Looks {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly loading = inject(Loading);
  private readonly list = signal<{ userId: string; name: string; look: LookView }[]>([]);
  readonly byId = computed(() => new Map(this.list().map((x) => [x.userId, x.look])));
  readonly byName = computed(() => new Map(this.list().map((x) => [x.name.toLowerCase(), x.look])));

  constructor() {
    effect(() => {
      if (this.auth.me()) void this.reload();
      else this.list.set([]);
    });
    setInterval(() => {
      if (this.auth.me()) this.loading.background(() => void this.reload());
    }, 60_000);
  }

  async reload() {
    try {
      this.list.set(await this.api.looks());
    } catch {
      // looks are decoration
    }
  }

  /** A look by user id, else by in-game name (kill feed, bets of bots have none). */
  of(id?: string | null, name?: string | null): LookView | undefined {
    return (
      (id ? this.byId().get(id) : undefined) ??
      (name ? this.byName().get(name.toLowerCase()) : undefined)
    );
  }
}

/** Style of a name in a shop colour (gradients are clipped to the text). */
export function nameStyle(color?: string): Record<string, string> {
  if (!color) return {};
  if (color === 'aurora') return {};
  if (color.startsWith('linear-gradient'))
    return {
      'background-image': color,
      '-webkit-background-clip': 'text',
      'background-clip': 'text',
      color: 'transparent',
    };
  return { color };
}

/**
 * A user's name in their shop look: colour, badge behind it, title below (`withTitle`).
 * `id` is the user id; without it the in-game name is looked up.
 */
@Component({
  selector: 'na-name',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="nm" [class.aurora]="look()?.color === 'aurora'" [style]="style()">{{
      name()
    }}</span>
    @if (look()?.badge; as b) {
      <span class="bdg" [title]="b"><na-icon [name]="b" [size]="badgeSize()" /></span>
    }
    @if (withTitle() && look()?.title; as t) {
      <span class="ttl">{{ t }}</span>
    }`,
  styles: `
    :host {
      display: inline;
    }
    .bdg {
      display: inline-flex;
      vertical-align: -0.12em;
      margin-left: 4px;
      color: var(--neuro);
    }
    .ttl {
      display: block;
      font-family: var(--font-display);
      font-weight: 600;
      font-size: 0.8em;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--hot-text);
      line-height: 1.2;
    }
    .aurora {
      background-image: linear-gradient(90deg, #22d3ee, #a78bfa, #f0468c, #fbbf24, #22d3ee);
      background-size: 300% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      animation: aurora 6s linear infinite;
    }
    @keyframes aurora {
      to {
        background-position: 300% 0;
      }
    }
  `,
})
export class NameTag {
  private readonly looks = inject(Looks);
  readonly name = input.required<string>();
  readonly id = input<string | null | undefined>(undefined);
  readonly withTitle = input(false);
  readonly badgeSize = input(14);
  protected readonly look = computed(() => this.looks.of(this.id(), this.name()));
  protected readonly style = computed(() => nameStyle(this.look()?.color));
}

/** Avatar (picture or initial) with the shop frame. */
@Component({
  selector: 'na-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span
    class="av"
    [class]="'fr-' + (frame() ?? 'none')"
    [style.width.px]="size()"
    [style.height.px]="size()"
  >
    @if (src()) {
      <img [src]="src()" alt="" />
    } @else {
      <span class="ini" [style.font-size.px]="size() * 0.45">{{ initial() }}</span>
    }
  </span>`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    .av {
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--panel-3);
      overflow: hidden;
      box-shadow: 0 0 0 2px var(--line);
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .ini {
      font-family: var(--font-display);
      font-weight: 800;
      color: var(--text-2);
    }
    .fr-bronze {
      box-shadow: 0 0 0 3px #cd7f32;
    }
    .fr-silver {
      box-shadow:
        0 0 0 3px #cbd5e1,
        0 0 10px rgba(203, 213, 225, 0.35);
    }
    .fr-gold {
      box-shadow:
        0 0 0 3px #fbbf24,
        0 0 14px rgba(251, 191, 36, 0.45);
    }
    .fr-neon {
      box-shadow:
        0 0 0 2px #22d3ee,
        0 0 0 5px #f0468c,
        0 0 16px rgba(240, 70, 140, 0.5);
    }
    .fr-champion {
      box-shadow:
        0 0 0 3px #f0468c,
        0 0 0 6px #fbbf24,
        0 0 18px rgba(251, 191, 36, 0.5);
    }
    .fr-dreamteam {
      box-shadow:
        0 0 0 3px #b26bff,
        0 0 0 6px #22d3ee,
        0 0 18px rgba(178, 107, 255, 0.6);
    }
    .fr-throne {
      box-shadow:
        0 0 0 3px #fbbf24,
        0 0 0 6px #7c3aed,
        0 0 0 8px #fbbf24;
      animation: throne 2.4s ease-in-out infinite;
    }
    @keyframes throne {
      50% {
        box-shadow:
          0 0 0 3px #fbbf24,
          0 0 0 6px #7c3aed,
          0 0 0 8px #fbbf24,
          0 0 26px rgba(251, 191, 36, 0.7);
      }
    }
  `,
})
export class Avatar {
  private readonly looks = inject(Looks);
  readonly name = input.required<string>();
  readonly id = input<string | null | undefined>(undefined);
  readonly src = input<string | null | undefined>(undefined);
  readonly size = input(40);
  /** Shows this frame instead of the user's (shop previews). */
  readonly preview = input<string | undefined>(undefined);
  protected readonly frame = computed(
    () => this.preview() ?? this.looks.of(this.id(), this.name())?.frame,
  );
  protected readonly initial = computed(() => this.name().trim().charAt(0).toUpperCase());
}
