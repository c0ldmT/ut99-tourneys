import { describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import { Client, startApi } from './helpers.js';

describe('last activity (decision 290)', () => {
  it('shows last login and last request in the admin list, written at most every 10 minutes', async () => {
    const clock = new FakeClock(Date.parse('2026-11-26T10:00:00Z'));
    const { api } = await startApi({}, { clock });
    try {
      const admin = await Client.login(api, 'Boss', true);
      const mario = await Client.login(api, 'Mario');
      const row = async () =>
        (
          (await admin.get('/users')).body as {
            displayName: string;
            lastLoginAt: string;
            lastSeenAt: string;
          }[]
        ).find((u) => u.displayName === 'Mario')!;
      expect(await row()).toMatchObject({
        lastLoginAt: '2026-11-26T10:00:00.000Z',
        lastSeenAt: '2026-11-26T10:00:00.000Z',
      });
      clock.advance(5 * 60_000);
      await mario.get('/me');
      expect((await row()).lastSeenAt).toBe('2026-11-26T10:00:00.000Z');
      clock.advance(3 * 86_400_000);
      await mario.get('/me');
      expect(await row()).toMatchObject({
        lastLoginAt: '2026-11-26T10:00:00.000Z',
        lastSeenAt: '2026-11-29T10:05:00.000Z',
      });
    } finally {
      await api.close();
    }
  });
});
