import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { TPipe } from '../core/i18n';

export interface TocItem {
  /** Id of the heading the link jumps to. */
  id: string;
  text: string;
}

/**
 * "On this page" (decisions 310, 332): the sections of a long page in the free column on the
 * right, the one the reader is in marked. Only on wide screens (from 1100 px) and from two
 * sections on; sticky below the site header.
 */
@Component({
  selector: 'na-toc',
  imports: [TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length > 1) {
      <nav class="toc" [attr.aria-label]="'settings.toc' | t">
        <span class="kpi">{{ 'settings.toc' | t }}</span>
        @for (s of items(); track s.id; let i = $index) {
          <a
            [href]="'#' + s.id"
            [class.on]="i === current()"
            [attr.aria-current]="i === current() || null"
            (click)="jump($event, s.id)"
            >{{ s.text }}</a
          >
        }
      </nav>
    }
  `,
  styles: `
    :host {
      display: none;
    }
    @media (min-width: 1100px) {
      :host {
        display: block;
        position: sticky;
        top: 84px;
      }
    }
    .toc {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding-left: 14px;
      border-left: 1px solid var(--border);
    }
    .kpi {
      margin-bottom: 6px;
    }
    a {
      color: var(--muted);
      font-size: var(--fs-sm);
      padding: 5px 0;
      text-decoration: none;
      line-height: 1.3;
    }
    a:hover {
      color: var(--text);
    }
    a.on {
      color: var(--accent);
      font-weight: 600;
    }
  `,
})
export class PageToc {
  readonly items = input.required<TocItem[]>();
  /** The section the reader is in (index into `items`). */
  protected readonly current = signal(0);

  constructor() {
    const onScroll = () => this.track();
    window.addEventListener('scroll', onScroll, { passive: true });
    inject(DestroyRef).onDestroy(() => window.removeEventListener('scroll', onScroll));
    effect(() => {
      this.items();
      queueMicrotask(() => this.track());
    });
  }

  /** The last heading above the upper quarter of the window is the current section. */
  private track() {
    const items = this.items();
    if (items.length < 2) return;
    let at = 0;
    items.forEach((s, i) => {
      const el = document.getElementById(s.id);
      if (el && el.getBoundingClientRect().top < window.innerHeight * 0.25) at = i;
    });
    // At the bottom of the page the last section counts (it may be too short to reach the line).
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4)
      at = items.length - 1;
    this.current.set(at);
  }

  protected jump(e: Event, id: string) {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
