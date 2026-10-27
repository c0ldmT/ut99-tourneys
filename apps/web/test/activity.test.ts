import { describe, expect, it } from 'vitest';
import { ServerActivity, SLOW_CALL_MS } from '../src/app/core/activity';

describe('activity bar state (decision 227)', () => {
  it('shows busy for a slow call, for a moment after it, and the server jobs', () => {
    const a = new ServerActivity();
    let now = 1000;
    a.now = () => now;
    const end = a.call();
    a.check();
    expect(a.shown()).toBe(false);
    now += SLOW_CALL_MS;
    a.check();
    expect(a.busy()).toBe(true);
    end();
    expect(a.busy()).toBe(true);
    now += 5000;
    a.check();
    expect(a.shown()).toBe(false);
    a.server.set({ jobs: [{ key: 'leagueEvening', done: 2, total: 7, since: '' }], busy: false });
    expect(a.job()?.done).toBe(2);
    expect(a.shown()).toBe(true);
    a.reset();
    expect(a.shown()).toBe(false);
  });
});
