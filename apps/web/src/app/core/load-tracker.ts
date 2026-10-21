import { computed, signal } from '@angular/core';

/** The loader shows only when a page, once in place, loads longer than this (ms). */
export const LOADER_DELAY = 150;
/** Once shown, the loader stays at least this long (ms), so it does not flicker. */
export const LOADER_MIN = 400;
/** A page counts as loaded when no call ran for this long (ms): chained loads are one. */
export const SETTLE_GRACE = 60;
/** A page that still loads after this long (ms) shows anyway (a call that hangs). */
export const LOAD_CAP = 10_000;
/** The thin bar shows for calls after the page loaded, the page code or a reused page loading longer than this (ms). */
export const BAR_DELAY = 250;

/** What a call is, for the loading display. */
export interface CallKind {
  /** A GET (reads count towards the page's loading). */
  get: boolean;
  /** Previews, decoration and background refreshes: no display. */
  background: boolean;
}

/**
 * The loading state, without Angular: a page loads from its navigation until all calls it
 * started are answered; meanwhile its content is hidden and, after `LOADER_DELAY`, the loader
 * shows. Calls after that (filters, tabs, actions) only show the thin bar.
 */
export class LoadTracker {
  /** A page is loading (its content stays hidden). */
  readonly settling = signal(true);
  /** The loader is shown (in the page area). */
  readonly spinner = signal(false);
  /** The thin bar under the header is shown. */
  readonly bar = signal(false);
  /** The page content is hidden: still loading, or the loader keeps its minimum time. */
  readonly hidden = computed(() => this.settling() || this.spinner());

  private navigating = true;
  /** A new page component was put in place during this navigation (else it was reused). */
  private fresh = false;
  /** No page shown yet (the app starts): the loader instead of the bar. */
  private first = true;
  private pageCalls = 0;
  /** The navigation a page call belongs to (calls of a page left meanwhile do not count). */
  private nav = 0;
  private activatedAt = 0;
  private capTimer?: ReturnType<typeof setTimeout>;
  private barCalls = 0;
  private navBar = false;
  private barDue = false;
  private since = 0;
  private navTimer?: ReturnType<typeof setTimeout>;
  private spinTimer?: ReturnType<typeof setTimeout>;
  private settleTimer?: ReturnType<typeof setTimeout>;
  private hideTimer?: ReturnType<typeof setTimeout>;
  private barTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly now: () => number = Date.now) {
    this.armNav();
    this.capTimer = setTimeout(() => this.finish(), LOAD_CAP);
  }

  /** A navigation to another page began (the old page stays until the new one is in place). */
  navStart(): void {
    this.navigating = true;
    this.fresh = false;
    this.nav++;
    this.pageCalls = 0;
    clearTimeout(this.settleTimer);
    clearTimeout(this.hideTimer);
    clearTimeout(this.spinTimer);
    this.settling.set(true);
    this.armNav();
    clearTimeout(this.capTimer);
    this.capTimer = setTimeout(() => this.finish(), LOAD_CAP);
  }

  /** The new page's component is in place (the old page is gone): the loader may follow. */
  activated(): void {
    this.fresh = true;
    this.first = false;
    this.activatedAt = this.now();
    clearTimeout(this.navTimer);
    this.setNavBar(false);
    if (this.spinner()) return;
    clearTimeout(this.spinTimer);
    this.spinTimer = setTimeout(() => {
      // Only while calls run (not in the short wait for a chained call).
      if (this.settling() && this.pageCalls > 0) this.showSpinner();
    }, LOADER_DELAY);
  }

  /** The navigation ended (also cancelled, failed or skipped). */
  navEnd(): void {
    this.navigating = false;
    this.maybeSettle();
  }

  /** A call starts; the returned function ends it. */
  track(kind: CallKind): () => void {
    if (kind.background) return () => undefined;
    if (this.settling() && kind.get) {
      const nav = this.nav;
      this.pageCalls++;
      clearTimeout(this.settleTimer);
      // A chained call after the loader's moment (the first check found no call running).
      if (this.fresh && this.now() - this.activatedAt >= LOADER_DELAY) this.showSpinner();
      return once(() => {
        if (nav !== this.nav) return;
        this.pageCalls--;
        this.maybeSettle();
      });
    }
    if (this.barCalls++ === 0)
      this.barTimer = setTimeout(() => {
        this.barDue = true;
        this.syncBar();
      }, BAR_DELAY);
    return once(() => {
      if (--this.barCalls > 0) return;
      clearTimeout(this.barTimer);
      this.barDue = false;
      this.syncBar();
    });
  }

  /** While the page code loads, or for a reused page (content stays): the thin bar (at the start the loader). */
  private armNav() {
    clearTimeout(this.navTimer);
    this.navTimer = setTimeout(() => {
      if (!this.settling() || this.fresh) return;
      if (this.first) this.showSpinner();
      else this.setNavBar(true);
    }, BAR_DELAY);
  }

  private showSpinner() {
    if (this.spinner()) return;
    this.since = this.now();
    this.spinner.set(true);
  }

  private maybeSettle() {
    if (this.navigating || this.pageCalls > 0) return;
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      if (!this.navigating && this.pageCalls === 0) this.finish();
    }, SETTLE_GRACE);
  }

  private finish() {
    clearTimeout(this.spinTimer);
    clearTimeout(this.capTimer);
    clearTimeout(this.settleTimer);
    this.pageCalls = 0;
    this.nav++;
    clearTimeout(this.navTimer);
    this.settling.set(false);
    this.setNavBar(false);
    if (!this.spinner()) return;
    const left = this.since + LOADER_MIN - this.now();
    if (left <= 0) this.spinner.set(false);
    else this.hideTimer = setTimeout(() => this.spinner.set(false), left);
  }

  private setNavBar(on: boolean) {
    this.navBar = on;
    this.syncBar();
  }

  private syncBar() {
    this.bar.set(this.navBar || (this.barCalls > 0 && this.barDue));
  }
}

function once(fn: () => void): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}
