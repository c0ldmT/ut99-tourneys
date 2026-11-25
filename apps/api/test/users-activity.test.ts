import { describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import { UsersService } from '../src/auth/users.service.js';
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
      // Dream Team AI managers never log in: no login data, marked as AI (decision 292).
      api.app.get(UsersService).login({ discordId: 'ai:1', username: 'AI 1', displayName: 'AI 1' });
      const ai = ((await admin.get('/users')).body as Record<string, unknown>[]).find(
        (u) => u['displayName'] === 'AI 1',
      )!;
      expect(ai['ai']).toBe(true);
      expect(ai).not.toHaveProperty('lastLoginAt');
      expect(ai).not.toHaveProperty('lastSeenAt');
    } finally {
      await api.close();
    }
  });
});
