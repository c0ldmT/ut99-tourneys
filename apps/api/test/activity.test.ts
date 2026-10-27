import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { ServerActivity, type ActivityState } from '../src/common/activity.js';
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
