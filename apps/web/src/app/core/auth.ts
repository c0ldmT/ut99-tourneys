import { inject, Injectable, signal } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { Api, ApiError } from './api';
import type { Me, SiteConfig } from './types';

@Injectable({ providedIn: 'root' })
export class Auth {
  private api = inject(Api);
  readonly me = signal<Me | null>(null);
  readonly config = signal<SiteConfig>({
    siteName: 'UT99 Tournaments',
    discordLogin: false,
    devLogin: false,
  });
  private loaded?: Promise<void>;

  /** Loads site config and the current user once (guards wait for it). */
  ready(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        this.config.set(await this.api.config());
      } catch {
        // keep defaults
      }
      await this.refresh();
    })();
    return this.loaded;
  }

  async refresh(): Promise<void> {
    try {
      this.me.set(await this.api.me());
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) this.me.set(null);
      else throw e;
    }
  }

  async logout(): Promise<void> {
    await this.api.logout();
    this.me.set(null);
  }
}

// inject() only works before the first await, so everything is injected up front.
export const loggedIn: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ready();
  if (auth.me()) return true;
  return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
};

export const adminOnly: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  await auth.ready();
  return auth.me()?.isAdmin ? true : router.createUrlTree(['/']);
};
