import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '@tourney/bridge';
import { eq } from 'drizzle-orm';
import type { RunningApi } from '../src/app.js';
import { DB, type Db } from '../src/db/database.js';
import { tournaments } from '../src/db/schema.js';
import { baseName } from '../src/series/series-time.js';
import { Client, startApi, tournamentBody } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

interface Summary {
  id: string;
  name: string;
  phase: string;
  seriesId: string | null;
}
interface Archive {
  items: Summary[];
  total: number;
  aborted: number;
  next: string | null;
}

/** Tournaments in all phases (the phase set directly: playing them out is not the point). */
async function setup() {
  const clock = new FakeClock(Date.parse('2026-10-19T10:00:00Z'));
  ({ api } = await startApi({}, { clock }));
  const admin = await Client.login(api, 'Boss', true);
  const mario = await Client.login(api, 'Mario');
  await admin.post('/agents', { id: 'pi', name: 'Pi' });
  const make = async (name: string, day: number, settings: Record<string, unknown> = {}) => {
    const at = `2026-10-${String(day).padStart(2, '0')}T18:00:00.000Z`;
    const r = await admin.post('/tournaments', tournamentBody({ name, scheduledAt: at }, settings));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  const ids = {
    old: await make('Old Cup', 1),
    team: await make('Team Clash', 2, { size: 4, teamSize: 2, format: 'single' }),
    mine: await make('Mario Cup', 3),
    dropped: await make('Dropped Cup', 4),
    last: await make('Last Cup', 5),
    open: await make('Open Cup', 25),
  };
  await mario.post(`/tournaments/${ids.mine}/registration`);
  const db = api.app.get(DB) as Db;
  const phase = (id: string, p: string) =>
    db.update(tournaments).set({ phase: p }).where(eq(tournaments.id, id)).run();
  for (const id of [ids.old, ids.team, ids.mine, ids.last]) phase(id, 'finished');
  phase(ids.dropped, 'aborted');
  return { admin, mario, ids, phase };
}

describe('tournament overview and archive', () => {
  it('lists the active tournaments, or all as before', async () => {
    const { mario, ids } = await setup();
    const active = (await mario.get('/tournaments?scope=active')).body as Summary[];
    expect(active.map((t) => t.id)).toEqual([ids.open]);
    expect((await mario.get('/tournaments')).body).toHaveLength(6);
  });

  it('pages the finished and aborted tournaments, newest first, with filters', async () => {
    const { mario, ids } = await setup();
    const get = async (q: string) =>
      (await mario.get(`/tournaments?scope=done&${q}`)).body as Archive;
    const first = await get('limit=2');
    expect(first.total).toBe(5);
    expect(first.aborted).toBe(1);
    expect(first.items.map((t) => t.id)).toEqual([ids.last, ids.dropped]);
    expect(first.next).not.toBeNull();
    const second = await get(`limit=2&before=${encodeURIComponent(first.next!)}`);
    expect(second.items.map((t) => t.id)).toEqual([ids.mine, ids.team]);
    const third = await get(`limit=2&before=${encodeURIComponent(second.next!)}`);
    expect(third.items.map((t) => t.id)).toEqual([ids.old]);
    expect(third.next).toBeNull();

    expect((await get('status=aborted')).items.map((t) => t.id)).toEqual([ids.dropped]);
    expect((await get('mode=team')).items.map((t) => t.id)).toEqual([ids.team]);
    expect((await get('mode=1v1')).total).toBe(4);
    expect((await get('mine=true')).items.map((t) => t.id)).toEqual([ids.mine]);
    expect((await get('q=mario')).items.map((t) => t.id)).toEqual([ids.mine]);
    expect((await get('kind=udt')).total).toBe(0);
    expect((await get('kind=classic')).total).toBe(5);
    expect((await mario.get('/tournaments?scope=done&limit=500')).status).toBe(400);
  });

  it('shows the series to every player: schedule, next tournament, last results', async () => {
    const { admin, mario, phase } = await setup();
    const t = await admin.post('/tournaments', tournamentBody({ name: 'Template' }));
    const s = await admin.post('/series', {
      fromTournament: t.body.id,
      name: 'Friday Cup #{n}',
      days: [5],
      times: ['20:00'],
      leadMinutes: 7 * 1440,
    });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    let view = (await mario.get('/series/overview')).body as any[];
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({
      name: 'Friday Cup',
      days: [5],
      times: ['20:00'],
      game: 'dm',
      finished: 0,
      aborted: 0,
      next: { name: 'Friday Cup #1', at: '2026-10-23T18:00:00.000Z' },
      recent: [],
    });
    const firstId = view[0].next.id as string;
    expect(firstId).toBeTruthy();
    phase(firstId, 'finished');
    view = (await mario.get('/series/overview')).body as any[];
    expect(view[0]).toMatchObject({
      finished: 1,
      recent: [{ id: firstId, name: 'Friday Cup #1', phase: 'finished', champion: null }],
    });
    // Not created yet: the planned start.
    expect(view[0].next).toMatchObject({ id: null, name: 'Friday Cup #2' });
    const active = (await mario.get('/tournaments?scope=active')).body as Summary[];
    expect(active.every((x) => x.id !== firstId)).toBe(true);
  });
});

describe('series names', () => {
  it('drops the placeholders', () => {
    expect(baseName('Friday Cup #{n}')).toBe('Friday Cup');
    expect(baseName('Daily {date} {time}')).toBe('Daily');
    expect(baseName('Bot Brawl – {time}')).toBe('Bot Brawl');
    expect(baseName('{n}')).toBe('{n}');
    expect(baseName('Techno {n}')).toBe('Techno');
    expect(baseName('Cup Nr. {n}')).toBe('Cup');
  });
});
