import { describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import { checkText } from '../src/moderation/filter.js';
import { BUILTIN_BLOCK, BUILTIN_FLAG } from '../src/moderation/word-lists.js';
import { eq } from 'drizzle-orm';
import { DB, type Db } from '../src/db/database.js';
import { users } from '../src/db/schema.js';
import { Client, startApi, tournamentBody } from './helpers.js';

const lists = { block: BUILTIN_BLOCK, flag: BUILTIN_FLAG, allow: [] as string[] };
const level = (t: string, l = lists) => checkText(t, l)?.level ?? null;

describe('word filter (decision 283)', () => {
  it('blocks slurs and Nazi words also when disguised', () => {
    expect(level('Hitler')).toBe('block');
    expect(level('h1tl3r')).toBe('block');
    expect(level('N.i.g.g.e.r')).toBe('block');
    expect(level('Sieg  Heil!')).toBe('block');
    expect(level('Clan1488')).toBe('block');
    expect(level('Hurensöhn')).toBe('block');
  });

  it('flags swearing and leaves harmless words alone', () => {
    expect(level('fuuuck you')).toBe('flag');
    expect(level('Moby Dick')).toBe('flag');
    expect(level('Scunthorpe')).toBeNull();
    expect(level('Classic Assassin')).toBeNull();
    expect(level('Bot88')).toBeNull();
    expect(level('Shitstorm')).toBeNull();
    expect(level('Torpedo')).toBeNull();
    expect(level('Grape Escape')).toBeNull();
    expect(level('Xan')).toBeNull();
  });

  it('takes own entries and the allow list', () => {
    const own = { block: ['=quark'], flag: ['banane'], allow: ['bananenrepublik'] };
    expect(level('Quark', own)).toBe('block');
    expect(level('Quarkbrot', own)).toBeNull();
    expect(level('Die Banane', own)).toBe('flag');
    expect(level('Bananenrepublik', own)).toBeNull();
  });
});

describe('moderation (decision 283)', () => {
  it('refuses, queues, resets, reports and sanctions', async () => {
    const clock = new FakeClock(Date.parse('2026-11-25T12:00:00Z'));
    const { api } = await startApi({}, { clock });
    try {
      const admin = await Client.login(api, 'Boss', true);
      const mario = await Client.login(api, 'Mario');
      const luigi = await Client.login(api, 'Luigi');
      const marioId = (await mario.get('/me')).body.id as string;
      const luigiId = (await luigi.get('/me')).body.id as string;

      // A blocked name is refused without telling the word; a flagged one is saved and queued.
      const blocked = await mario.patch('/me', { displayName: 'H1tler' });
      expect(blocked.status).toBe(400);
      expect(blocked.body.key).toBe('this text is not allowed here');
      expect((await mario.patch('/me', { displayName: 'FuckBot' })).status).toBe(200);

      // Players are no moderators; an admin makes Luigi one.
      expect((await mario.get('/moderation/queue')).status).toBe(403);
      expect((await luigi.get('/moderation/queue')).status).toBe(403);
      expect((await admin.patch(`/users/${luigiId}`, { isModerator: true })).status).toBe(200);
      expect((await luigi.get('/me')).body.isModerator).toBe(true);

      const queue = (await luigi.get('/moderation/queue')).body as {
        id: string;
        kind: string;
        text: string;
        source: string;
      }[];
      expect(queue).toMatchObject([{ kind: 'name', text: 'FuckBot', source: 'filter' }]);

      // Reset: a neutral name, Mario gets a notice.
      expect(
        (await luigi.post(`/moderation/items/${queue[0]!.id}`, { action: 'reset' })).status,
      ).toBe(204);
      const me = (await mario.get('/me')).body as {
        displayName: string;
        notices: { kind: string }[];
      };
      expect(me.displayName).toMatch(/^Player\d{4}$/);
      expect(me.notices.map((n) => n.kind)).toContain('mod-reset');

      // A report of a harmless-looking name lands in the queue with its reason.
      expect(
        (
          await mario.post('/moderation/reports', {
            kind: 'name',
            ref: luigiId,
            reason: 'insult',
          })
        ).status,
      ).toBe(204);
      const own = await luigi.post('/moderation/reports', {
        kind: 'name',
        ref: luigiId,
        reason: 'x',
      });
      expect(own.status).toBe(409);
      const open = (await admin.get('/moderation/queue')).body as {
        kind: string;
        reports: number;
        reasons: { reason: string }[];
      }[];
      expect(open).toMatchObject([{ kind: 'name', reports: 1, reasons: [{ reason: 'insult' }] }]);

      // Text ban: no new names for three days.
      const ban = await luigi.post(`/moderation/users/${marioId}`, {
        action: 'text-ban',
        days: 3,
        reason: 'names',
      });
      expect(ban.status).toBe(200);
      const later = await mario.patch('/me', { displayName: 'Mario2' });
      expect(later.status).toBe(403);
      expect(later.body).toMatchObject({
        key: 'you cannot change names and texts until {until}',
        params: { until: '2026-11-28' },
      });
      clock.advance(3 * 86_400_000 + 1000);
      expect((await mario.patch('/me', { displayName: 'Mario2' })).status).toBe(200);

      // A moderator cannot ban another moderator; an admin can. Login ban ends the session.
      const bossId = (await admin.get('/me')).body.id as string;
      expect(
        (await luigi.post(`/moderation/users/${bossId}`, { action: 'ban', days: 1 })).status,
      ).toBe(403);
      expect(
        (await luigi.post(`/moderation/users/${marioId}`, { action: 'ban', days: 0 })).status,
      ).toBe(200);
      expect((await mario.get('/me')).status).toBe(401);
      const again = await new Client(api).post('/auth/dev-login', { name: 'Mario' });
      expect(again.status).toBe(403);
      expect(again.body.key).toBe('your account is blocked until {until}');
      expect((await luigi.post(`/moderation/users/${marioId}`, { action: 'unban' })).status).toBe(
        200,
      );
      expect((await Client.login(api, 'Mario')).cookie).not.toBe('');

      // A new player with a blocked name from Discord gets a neutral one.
      const nazi = await Client.login(api, 'Hitler');
      expect((await nazi.get('/me')).body.displayName).toMatch(/^Player\d{4}$/);

      // The log has every step.
      const log = (await admin.get('/moderation/log')).body as { action: string }[];
      expect(log.map((l) => l.action)).toEqual(
        expect.arrayContaining(['reset', 'moderator', 'text-ban', 'ban', 'unban']),
      );
    } finally {
      await api.close();
    }
  });

  it('screens team names and finds old texts with a check', async () => {
    const { api } = await startApi();
    try {
      const admin = await Client.login(api, 'Boss', true);
      const mario = await Client.login(api, 'Mario');
      await admin.post('/agents', { id: 'pi', name: 'Pi' });
      const t = await admin.post(
        '/tournaments',
        tournamentBody({ name: 'Team Cup' }, { size: 4, format: 'single', teamSize: 2 }),
      );
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      const id = t.body.id as string;
      const bad = await mario.post(`/tournaments/${id}/teams`, { name: 'Neger Squad', tag: 'NS' });
      expect(bad.status).toBe(400);
      const ok = await mario.post(`/tournaments/${id}/teams`, { name: 'Shit Happens', tag: 'SH' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      const queue = (await admin.get('/moderation/queue')).body as { kind: string; text: string }[];
      expect(queue).toMatchObject([{ kind: 'team', text: 'SH Shit Happens' }]);

      // An old name from before the filter: the check puts it into the queue.
      const db = api.app.get<Db>(DB);
      db.update(users)
        .set({ displayName: 'Arschloch', displayKey: 'arschloch' })
        .where(eq(users.displayName, 'Mario'))
        .run();
      const scan = await admin.post('/moderation/scan');
      expect(scan.body).toMatchObject({ queued: 1 });
      const after = (await admin.get('/moderation/queue')).body as {
        kind: string;
        source: string;
      }[];
      expect(after.map((i) => `${i.kind}/${i.source}`).sort()).toEqual([
        'name/scan',
        'team/filter',
      ]);
    } finally {
      await api.close();
    }
  });
});
