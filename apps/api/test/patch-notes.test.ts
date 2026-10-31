import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { RunningApi } from '../src/app.js';
import { LATEST_PATCH, PATCH_NOTES } from '../src/common/patch-notes.js';
import { DB, type Db } from '../src/db/database.js';
import { users } from '../src/db/schema.js';
import { Client, startApi } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

describe('patch notes (decision 243)', () => {
  it('lists the notes, starts new users at the latest and keeps what a user saw', async () => {
    ({ api } = await startApi());
    // Newest first, ids growing, both languages with items.
    const ids = PATCH_NOTES.map((n) => n.id);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    for (const n of PATCH_NOTES) {
      expect(n.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(n.en.items.length, String(n.id)).toBe(n.de.items.length);
      expect(n.en.items.length).toBeGreaterThan(0);
    }
    const guest = new Client(api);
    expect((await guest.get('/config')).body).toMatchObject({ patchLatest: LATEST_PATCH });
    const list = await guest.get('/patch-notes');
    expect(list.status).toBe(200);
    expect(list.body.latest).toBe(LATEST_PATCH);
    expect(list.body.notes.map((n: { id: number }) => n.id)).toEqual(ids);
    expect((await guest.post('/me/patch-notes/seen', { id: 1 })).status).toBe(401);

    // A new user has nothing to catch up on.
    const mario = await Client.login(api, 'Mario');
    expect((await mario.get('/me')).body).toMatchObject({ patchSeen: LATEST_PATCH });
    // An older user (the migration sets 241): sees the newer notes once, then not again.
    const db = api.app.get<Db>(DB);
    const id = (await mario.get('/me')).body.id as string;
    db.update(users).set({ patchSeen: 241 }).where(eq(users.id, id)).run();
    expect((await mario.get('/me')).body.patchSeen).toBe(241);
    const seen = await mario.post('/me/patch-notes/seen', { id: LATEST_PATCH });
    expect(seen.status, JSON.stringify(seen.body)).toBe(200);
    expect(seen.body).toEqual({ patchSeen: LATEST_PATCH });
    // Never backwards, never above the latest.
    expect((await mario.post('/me/patch-notes/seen', { id: 3 })).body).toEqual({
      patchSeen: LATEST_PATCH,
    });
    expect((await mario.post('/me/patch-notes/seen', { id: 99_999 })).body).toEqual({
      patchSeen: LATEST_PATCH,
    });
    expect((await mario.post('/me/patch-notes/seen', { id: -1 })).status).toBe(400);
  });
});
