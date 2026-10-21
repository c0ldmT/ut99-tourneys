import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BAR_DELAY,
  LOADER_DELAY,
  LOAD_CAP,
  LOADER_MIN,
  LoadTracker,
  SETTLE_GRACE,
} from '../src/app/core/load-tracker';

const get = { get: true, background: false };

/** A tracker after the first page loaded (nothing running). */
function loaded(): LoadTracker {
  const t = new LoadTracker();
  t.navStart();
  t.activated();
  t.navEnd();
  vi.advanceTimersByTime(SETTLE_GRACE);
  return t;
}

describe('loading display', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a fast page never shows the loader', () => {
    const t = loaded();
    t.navStart();
    t.activated();
    const done = t.track(get);
    t.navEnd();
    vi.advanceTimersByTime(80);
    done();
    expect(t.hidden()).toBe(true);
    vi.advanceTimersByTime(SETTLE_GRACE);
    expect(t.hidden()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(t.spinner()).toBe(false);
    expect(t.bar()).toBe(false);
  });

  it('the time before the page is in place (fade out, page code) does not count', () => {
    const t = loaded();
    t.navStart();
    vi.advanceTimersByTime(200);
    t.activated();
    const done = t.track(get);
    t.navEnd();
    vi.advanceTimersByTime(LOADER_DELAY - 20);
    done();
    vi.advanceTimersByTime(SETTLE_GRACE + LOADER_MIN);
    expect(t.spinner()).toBe(false);
    expect(t.bar()).toBe(false);
    expect(t.hidden()).toBe(false);
  });

  it('a slow page shows the loader after the delay, at least its minimum time', () => {
    const t = loaded();
    t.navStart();
    t.activated();
    const done = t.track(get);
    t.navEnd();
    vi.advanceTimersByTime(LOADER_DELAY - 1);
    expect(t.spinner()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.spinner()).toBe(true);
    vi.advanceTimersByTime(50);
    done();
    vi.advanceTimersByTime(SETTLE_GRACE);
    expect(t.settling()).toBe(false);
    expect(t.hidden()).toBe(true);
    vi.advanceTimersByTime(LOADER_MIN);
    expect(t.spinner()).toBe(false);
    expect(t.hidden()).toBe(false);
  });

  it('chained calls are one load', () => {
    const t = loaded();
    t.navStart();
    t.activated();
    const first = t.track(get);
    t.navEnd();
    vi.advanceTimersByTime(30);
    first();
    vi.advanceTimersByTime(10);
    const second = t.track(get);
    vi.advanceTimersByTime(SETTLE_GRACE * 2);
    expect(t.settling()).toBe(true);
    second();
    vi.advanceTimersByTime(SETTLE_GRACE);
    expect(t.settling()).toBe(false);
  });

  it('later calls show the thin bar after its delay; background ones nothing', () => {
    const t = loaded();
    const done = t.track(get);
    vi.advanceTimersByTime(BAR_DELAY - 1);
    expect(t.bar()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(t.bar()).toBe(true);
    expect(t.hidden()).toBe(false);
    done();
    expect(t.bar()).toBe(false);
    const quiet = t.track({ get: true, background: true });
    vi.advanceTimersByTime(BAR_DELAY * 2);
    expect(t.bar()).toBe(false);
    quiet();
  });

  it('while the page code loads the bar shows; the loader once the page is in place and slow', () => {
    const t = loaded();
    t.navStart();
    vi.advanceTimersByTime(BAR_DELAY);
    expect(t.bar()).toBe(true);
    expect(t.spinner()).toBe(false);
    t.activated();
    expect(t.bar()).toBe(false);
    t.track(get);
    vi.advanceTimersByTime(LOADER_DELAY);
    expect(t.spinner()).toBe(true);
  });

  it('while the app starts (no page yet) the loader shows, not the bar', () => {
    const t = new LoadTracker();
    t.track(get);
    vi.advanceTimersByTime(BAR_DELAY);
    expect(t.spinner()).toBe(true);
    expect(t.bar()).toBe(false);
  });

  it('a call of the page left does not hold the next page', () => {
    const t = loaded();
    t.navStart();
    t.activated();
    t.track(get); // page A, never answered
    t.navEnd();
    t.navStart();
    t.activated();
    const b = t.track(get);
    t.navEnd();
    vi.advanceTimersByTime(50);
    b();
    vi.advanceTimersByTime(SETTLE_GRACE + LOADER_MIN);
    expect(t.hidden()).toBe(false);
  });

  it('a chained call after the loader moment still shows the loader', () => {
    const t = loaded();
    t.navStart();
    t.activated();
    const first = t.track(get);
    t.navEnd();
    vi.advanceTimersByTime(LOADER_DELAY - 10);
    first();
    vi.advanceTimersByTime(20);
    expect(t.spinner()).toBe(false);
    t.track(get);
    expect(t.spinner()).toBe(true);
  });

  it('a call that hangs does not hide the page for ever', () => {
    const t = loaded();
    t.navStart();
    t.activated();
    t.track(get);
    t.navEnd();
    vi.advanceTimersByTime(LOAD_CAP + LOADER_MIN);
    expect(t.hidden()).toBe(false);
  });

  it('a reused page (no new component) keeps its content and shows the bar', () => {
    const t = loaded();
    t.navStart();
    const done = t.track(get);
    t.navEnd();
    vi.advanceTimersByTime(BAR_DELAY);
    expect(t.spinner()).toBe(false);
    expect(t.bar()).toBe(true);
    done();
    vi.advanceTimersByTime(SETTLE_GRACE);
    expect(t.bar()).toBe(false);
    expect(t.hidden()).toBe(false);
  });
});
