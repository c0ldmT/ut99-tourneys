import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../core/brand';
import { copyText, selectText } from '../core/clipboard';
import { TPipe } from '../core/i18n';
import type { LiveListItem } from './live-list';
import type { MiniSide } from './live-mini';

/**
 * The live bar of the tournament page (decision 322): once the live row has scrolled away, a
 * slim bar under the site header keeps the match in view – live badge, pairing and score, clock,
 * the parallel matches to switch between, the player's own connect command and a way back up.
 * Only reads what the page already has (nothing new from the API).
 */
@Component({
  selector: 'na-live-bar',
  imports: [RouterLink, TPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="lb"
      [class.on]="shown()"
      [style.top.px]="top()"
      role="region"
      [attr.aria-label]="'tp.bar.label' | t"
    >
      <div class="lb-in">
        <span class="lb-live" [class.on]="live()">{{ 'live.badge' | t }}</span>
        <b class="lb-id mono">{{ matchId() }}</b>
        @let s = sides();
        @if (s.length === 2) {
          <span class="lb-sc" [class.solo]="items().length < 2">
            <span class="lb-n a">{{ s[0]!.name }}</span>
            <b class="mono">{{ race() ? 'vs' : s[0]!.score + ':' + s[1]!.score }}</b>
            <span class="lb-n b">{{ s[1]!.name }}</span>
          </span>
        }
        @if (clock(); as c) {
          <span class="lb-clk mono">{{ c }}</span>
        }
        @if (items().length > 1) {
          <span class="lb-ms" [attr.role]="linked() ? null : 'tablist'" [attr.aria-label]="label()">
            @for (it of items(); track it.key) {
              @if (it.link) {
                <a class="lb-m" [class.on]="it.key === selected()" [routerLink]="it.link">
                  {{ it.names[0] }}–{{ it.names[1] }}
                  @if (it.score) {
                    <b class="mono">{{ it.score }}</b>
                  }
                </a>
              } @else {
                <button
                  type="button"
                  role="tab"
                  class="lb-m"
                  [class.on]="it.key === selected()"
                  [attr.aria-selected]="it.key === selected()"
                  (click)="pick.emit(it.key)"
                >
                  {{ it.names[0] }}–{{ it.names[1] }}
                  @if (it.score) {
                    <b class="mono">{{ it.score }}</b>
                  }
                </button>
              }
            }
          </span>
        }
        <span class="lb-grow"></span>
        @if (connect(); as cmd) {
          @if (copied() === 'manual') {
            <code class="lb-cmd">{{ cmd }}</code>
          }
          <button
            type="button"
            class="lb-btn"
            [title]="cmd"
            [attr.aria-label]="'tp.bar.connect' | t"
            (click)="copy(cmd)"
          >
            <na-icon [name]="copied() === 'ok' ? 'check' : 'copy'" [size]="16" />
            <span class="lb-wide">{{
              (copied() === 'ok' ? 'common.copied' : 'tp.bar.connect') | t
            }}</span>
          </button>
        }
        <button type="button" class="lb-btn" (click)="up()">{{ 'tp.bar.up' | t }}</button>
      </div>
    </div>
  `,
  styles: `
    .lb {
      position: fixed;
      left: 0;
      right: 0;
      z-index: 19;
      background: color-mix(in srgb, var(--bg-2) 94%, transparent);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--line);
      transform: translateY(-100%);
      visibility: hidden;
      transition:
        transform 0.22s ease,
        visibility 0s linear 0.22s;
    }
    .lb.on {
      transform: none;
      visibility: visible;
      transition: transform 0.22s ease;
    }
    .lb-in {
      max-width: 1240px;
      margin: 0 auto;
      padding: 7px 20px;
      min-height: 50px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .lb-live {
      flex: none;
      font-size: var(--fs-2xs);
      font-weight: 800;
      letter-spacing: 0.1em;
      padding: 1px 6px;
      border-radius: var(--radius-xs);
      color: var(--muted);
      border: 1px solid var(--line);
    }
    .lb-live.on {
      color: var(--bg);
      background: var(--live);
      border-color: var(--live);
    }
    .lb-id,
    .lb-clk {
      flex: none;
      font-size: var(--fs-sm);
    }
    .lb-id {
      color: var(--text-2);
    }
    .lb-sc {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
      flex: 0 1 auto;
      font-weight: 600;
    }
    .lb-sc b {
      flex: none;
      font-size: var(--fs-lg);
    }
    .lb-n {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .lb-n.a {
      color: var(--side-a);
    }
    .lb-n.b {
      color: var(--side-b);
    }
    .lb-ms {
      display: flex;
      gap: 6px;
      min-width: 0;
      flex: 0 1 auto;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .lb-m {
      flex: none;
      min-height: 32px;
      padding: 2px 10px;
      gap: 6px;
      border-radius: var(--radius-pill);
      border: 1px solid var(--line);
      background: transparent;
      color: var(--text-2);
      font-size: var(--fs-sm);
      font-weight: 500;
      white-space: nowrap;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
    }
    .lb-m.on {
      border-color: var(--accent);
      color: var(--text);
    }
    .lb-grow {
      flex: 1;
    }
    .lb-btn {
      flex: none;
      min-height: 40px;
      padding: 4px 12px;
      font-size: var(--fs-sm);
    }
    .lb-cmd {
      min-width: 0;
      max-width: 40%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: var(--fs-xs);
    }
    /* With chips, the chosen one names the match: the score in front only where there is room. */
    @media (max-width: 1000px) {
      .lb-sc:not(.solo) {
        display: none;
      }
    }
    @media (max-width: 640px) {
      .lb-in {
        padding: 6px 14px;
        gap: 8px;
      }
      .lb-id,
      .lb-clk,
      .lb-wide {
        display: none;
      }
      .lb-btn {
        padding: 4px 10px;
      }
      /* More chips than room: they scroll, the edge fades out. */
      .lb-ms {
        mask-image: linear-gradient(90deg, black calc(100% - 24px), transparent);
      }
    }
  `,
})
export class LiveBar {
  /** The live row: the bar shows once it has scrolled up under the site header. */
  readonly target = input<HTMLElement | null>(null);
  readonly matchId = input('');
  readonly sides = input<MiniSide[]>([]);
  readonly race = input(false);
  /** A game is live right now (the badge lights up). */
  readonly live = input(false);
  readonly clock = input<string | null>(null);
  /** Parallel matches or the games of a league evening (chips when there are two or more). */
  readonly items = input<LiveListItem[]>([]);
  readonly selected = input<string | null>(null);
  /** Accessible name of the chips. */
  readonly label = input('');
  /** The viewer plays in the match shown: their console command for its server. */
  readonly connect = input<string | null>(null);
  readonly pick = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly shown = signal(false);
  protected readonly top = signal(64);
  protected readonly copied = signal<'' | 'ok' | 'manual'>('');

  constructor() {
    let io: IntersectionObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watch = (el: HTMLElement | null) => {
      io?.disconnect();
      io = null;
      if (!el) {
        this.shown.set(false);
        return;
      }
      // The site header is sticky: the bar sits right under it.
      const head = Math.round(
        document.querySelector('header.site')?.getBoundingClientRect().bottom ?? 64,
      );
      this.top.set(head);
      io = new IntersectionObserver(
        ([e]) => this.shown.set(!!e && !e.isIntersecting && e.boundingClientRect.top < head),
        { rootMargin: `-${head}px 0px 0px 0px` },
      );
      io.observe(el);
    };
    effect(() => watch(this.target()));
    const resize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => watch(this.target()), 200);
    };
    window.addEventListener('resize', resize);
    inject(DestroyRef).onDestroy(() => {
      io?.disconnect();
      clearTimeout(timer);
      window.removeEventListener('resize', resize);
    });
  }

  protected linked(): boolean {
    return this.items().some((i) => !!i.link);
  }

  protected up(): void {
    this.target()?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected async copy(cmd: string): Promise<void> {
    const ok = await copyText(cmd);
    this.copied.set(ok ? 'ok' : 'manual');
    // Without a clipboard the command shows next to the button, selected for Ctrl+C.
    if (!ok) setTimeout(() => selectText(this.host.nativeElement.querySelector('.lb-cmd')));
    setTimeout(() => this.copied.set(''), ok ? 1500 : 8000);
  }
}
