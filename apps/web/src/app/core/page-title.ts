import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { type RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { Auth } from './auth';
import { I18n } from './i18n';

/**
 * Browser tab title: "<page> · <site name>". Routes give an i18n key as `title`; pages with
 * their own name (tournament, match, player, bot) set it with `set()`.
 */
@Injectable({ providedIn: 'root' })
export class PageTitle extends TitleStrategy {
  private readonly auth = inject(Auth);
  private readonly i18n = inject(I18n);
  private readonly key = signal('');
  private readonly text = signal('');
  private readonly part = computed(
    () => this.text() || (this.key() ? this.i18n.t(this.key()) : ''),
  );

  constructor() {
    super();
    effect(() => {
      const site = this.auth.config().siteName;
      const p = this.part();
      document.title = p ? `${p} · ${site}` : site;
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.text.set('');
    this.key.set(this.buildTitle(snapshot) ?? '');
  }

  /** A page's own name (null/empty: back to the route's title). */
  set(name: string | null | undefined): void {
    this.text.set(name ?? '');
  }
}
