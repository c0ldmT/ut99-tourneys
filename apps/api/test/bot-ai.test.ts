import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { Client, startApi } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe('bot AI help setting', () => {
  it('defaults to failsafe and duel mode, admins change it, players cannot', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    expect((await admin.get('/settings')).body.botAi).toEqual({ level: 2, skillCurve: true });
    const put = await admin.req('PUT', '/settings/bot-ai', { level: 1 });
    expect(put.status).toBe(200);
    expect((put.body as { botAi: unknown }).botAi).toEqual({ level: 1, skillCurve: true });
    expect((await admin.req('PUT', '/settings/bot-ai', { level: 3 })).status).toBe(400);
    expect((await mario.req('PUT', '/settings/bot-ai', { level: 0 })).status).toBe(403);
    expect((await admin.get('/settings')).body.botAi).toEqual({ level: 1, skillCurve: true });
  });

  it('switches the skill curve off and on', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const off = await admin.req('PUT', '/settings/bot-ai', { skillCurve: false });
    expect(off.status).toBe(200);
    expect((off.body as { botAi: unknown }).botAi).toEqual({ level: 2, skillCurve: false });
    expect((await admin.req('PUT', '/settings/bot-ai', { skillCurve: 'no' })).status).toBe(400);
    const on = await admin.req('PUT', '/settings/bot-ai', { skillCurve: true });
    expect((on.body as { botAi: unknown }).botAi).toEqual({ level: 2, skillCurve: true });
  });
});
