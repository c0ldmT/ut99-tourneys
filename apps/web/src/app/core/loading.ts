import { DestroyRef, inject, Injectable } from '@angular/core';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationSkipped,
  NavigationStart,
  type Router,
} from '@angular/router';
import { LoadTracker } from './load-tracker';

export type { CallKind } from './load-tracker';

/** The app's loading state, fed by the router (see `watch`) and every `Api` call. */
@Injectable({ providedIn: 'root' })
export class Loading extends LoadTracker {
  private bg = 0;
  /** The last navigation went to another page (not only another query). */
  pageChanged = true;
  private readonly destroy = inject(DestroyRef);

  constructor() {
    super();
  }

  /**
   * Follows the router (called once by the app shell: the router needs the Api, which needs
   * this service, so it cannot be injected here).
   */
  watch(router: Router): void {
    const path = (url: string) => url.split(/[?#]/)[0];
    const sub = router.events.subscribe((e) => {
      if (e instanceof NavigationStart) {
        // Only the query (e.g. a panel or a filter) changes: no page load.
        this.pageChanged = path(e.url) !== path(router.url) || !router.navigated;
        if (this.pageChanged) this.navStart();
      } else if (
        e instanceof NavigationEnd ||
        e instanceof NavigationCancel ||
        e instanceof NavigationError ||
        e instanceof NavigationSkipped
      )
        this.navEnd();
    });
    this.destroy.onDestroy(() => sub.unsubscribe());
  }

  /** Runs a refresh in the background (timers, live updates): its first call shows nothing. */
  background<T>(fn: () => T): T {
    this.bg++;
    try {
      return fn();
    } finally {
      this.bg--;
    }
  }

  /** Whether calls started now belong to a background refresh. */
  get inBackground(): boolean {
    return this.bg > 0;
  }
}
