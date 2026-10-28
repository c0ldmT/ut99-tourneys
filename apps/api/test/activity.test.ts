import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import {
  BUSY_BLOCK_MS,
  ServerActivity,
  STRIKE_WINDOW_MS,
  type ActivityState,
} from '../src/common/activity.js';
import type { ApiLogger } from '../src/common/logger.js';
import { Client, startApi } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe('server activity (decision 227)', () => {
  it('reports jobs with their progress and the end', async () => {
    const a = new ServerActivity();
    const seen: ActivityState[] = [];
    a.subscribe((s) => seen.push(s));
    await a.run('leagueEvening', 3, async (h) => {
      expect(a.state().jobs).toMatchObject([{ key: 'leagueEvening', done: 0, total: 3 }]);
      h.step(2);
      expect(a.state().jobs[0]!.done).toBe(2);
    });
    expect(a.state().jobs).toEqual([]);
    expect(seen[0]!.jobs).toHaveLength(1);
    expect(seen.at(-1)!.jobs).toHaveLength(0);
    a.markBusy();
    expect(a.state().busy).toBe(true);
  });

  it('logs each long block with the slow work around it, busy only on the second (decision 229)', async () => {
    const lines: string[] = [];
    const log = { warn: (m: string) => lines.push(m) } as unknown as ApiLogger;
    const a = new ServerActivity(log);
    const now = Date.now();
    a.track('POST /api/udt/league/test')();
    const running = a.track('GET /api/tournaments');
    await a.task('autoStart', () => new Promise((r) => setTimeout(r, 250)));
    a.blocked(BUSY_BLOCK_MS + 100, now + 300);
    expect(a.state().busy).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/blocked 1600 ms; work: .*task autoStart \d+ ms/);
    // Short work is not listed; work still running long enough is.
    expect(lines[0]).not.toContain('POST /api/udt/league/test');
    a.blocked(BUSY_BLOCK_MS, now + 300 + STRIKE_WINDOW_MS);
    expect(a.state().busy).toBe(false);
    a.blocked(BUSY_BLOCK_MS, now + 400 + STRIKE_WINDOW_MS);
    expect(a.state().busy).toBe(true);
    expect(lines[2]).toContain('GET /api/tournaments');
    expect(lines[2]).toContain('(running)');
    running();
    // A failing timer task is logged, not thrown.
    const errors: string[] = [];
    const b = new ServerActivity({ error: (m: string) => errors.push(m) } as unknown as ApiLogger);
    await b.task('market', () => {
      throw new Error('boom');
    });
    expect(errors).toEqual(['task market: boom']);
  });

  it('sends the activity over the own stream', async () => {
    ({ api } = await startApi());
    const mario = await Client.login(api, 'Mario');
    const ctrl = new AbortController();
    const res = await fetch(`${api.url}/api/me/stream`, {
      headers: { Cookie: mario.cookie },
      signal: ctrl.signal,
    });
    const reader = res.body!.getReader();
    let text = '';
    const read = async (until: string) => {
      while (!text.includes(until)) text += new TextDecoder().decode((await reader.read()).value);
    };
    await read('event: activity');
    await read('\n\n');
    api.app.get(ServerActivity).markBusy();
    await read('"busy":true');
    ctrl.abort();
    expect(text).toContain('"jobs":[]');
  });
});
