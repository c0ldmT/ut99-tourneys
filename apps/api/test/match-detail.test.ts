import { afterEach, describe, expect, it } from 'vitest';
import type { RunningApi } from '../src/app.js';
import { EventLogService } from '../src/tournaments/event-log.service.js';
import { Client, startApi, tournamentBody } from './helpers.js';

let api: RunningApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});

const stat = (
  name: string,
  entrantId: string,
  kills: number,
  over: Record<string, unknown> = {},
) => ({
  name,
  entrantId,
  bot: true,
  kills,
  deaths: 5,
  suicides: 0,
  teamKills: 0,
  headshots: 1,
  firstBlood: false,
  bestSpree: 3,
  sprees: 0,
  multi2: 0,
  multi3: 0,
  multi4: 0,
  multi5: 0,
  timeSec: 300,
  monsters: 0,
  monsterPoints: 0,
  weapons: {},
  ...over,
});

describe('match page', () => {
  it('shows the entrants, every game with the players and the series score', async () => {
    ({ api } = await startApi());
    const admin = await Client.login(api, 'Boss', true);
    const mario = await Client.login(api, 'Mario');
    await admin.post('/agents', { id: 'pi', name: 'Pi' });
    const ids: string[] = [];
    for (const name of ['Abe', 'Bea', 'Cid', 'Dot'])
      ids.push((await admin.post('/bots', { name, skill: 4 })).body.id);
    const t = await admin.post('/tournaments', {
      ...tournamentBody({ name: 'Detail Cup' }, { size: 4, format: 'single' }),
      botPool: ids.map((id) => ({ id, name: 'x', skill: 4 })),
    });
    const id = t.body.id as string;
    const seeded = await admin.post(`/tournaments/${id}/seed`, { mode: 'auto', rngSeed: 's' });
    const node = seeded.body.projection.bracket.matches[0];
    const [a, b] = node.entrants as [string, string];
    const nameOf = (e: string) => seeded.body.projection.entrants[e].bot.name as string;
    const log = api!.app.get(EventLogService);
    const append = (events: Record<string, unknown>[]) => {
      const r = log.append(
        id,
        log.load(id).length,
        events.map((e) => ({ actor: { kind: 'bridge' }, ...e })),
      );
      if (!r.accepted) throw new Error(r.reason);
    };
    append([
      { type: 'checkin.opened', data: { serverProfileId: 'local' } },
      { type: 'tournament.started', data: {} },
      { type: 'match.called', data: { matchId: node.id, entrants: [a, b] } },
      {
        type: 'match.mapSelected',
        data: { matchId: node.id, game: 1, map: 'DM-Deck16][', method: 'vote' },
      },
      { type: 'match.started', data: { matchId: node.id, game: 1 } },
    ]);
    // Live: the game shows, without statistics yet.
    const live = (await mario.get(`/tournaments/${id}/matches/${node.id}`)).body;
    expect(live.games).toEqual([{ game: 1, map: 'DM-Deck16][', players: [], live: true }]);
    append([
      {
        type: 'match.playerStats',
        data: {
          matchId: node.id,
          game: 1,
          map: 'DM-Deck16][',
          durationSec: 300,
          players: [stat(nameOf(a), a, 20), stat(nameOf(b), b, 12)],
        },
      },
      {
        type: 'match.gameFinished',
        data: {
          matchId: node.id,
          game: 1,
          map: 'DM-Deck16][',
          scores: { [a]: 20, [b]: 12 },
          winnerId: a,
          endReason: 'fragLimit',
        },
      },
      {
        type: 'match.result',
        data: { result: { matchId: node.id, entrants: [a, b], winnerId: a, outcome: 'played' } },
      },
    ]);
    const res = await mario.get(`/tournaments/${id}/matches/${node.id}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = res.body as any;
    expect(d).toMatchObject({
      matchId: node.id,
      status: 'completed',
      winnerId: a,
      wins: { [a]: 1, [b]: 0 },
    });
    expect(d.entrants.map((s: { id: string }) => s.id)).toEqual([a, b]);
    expect(d.games).toHaveLength(1);
    expect(d.games[0]).toMatchObject({ map: 'DM-Deck16][', winnerId: a, durationSec: 300 });
    expect(d.games[0].live).toBeUndefined();
    const abe = d.games[0].players.find((p: { entrantId: string }) => p.entrantId === a);
    expect(abe.kills).toBe(20);
    expect(ids).toContain(abe.botId); // linked to the bot profile
    // A renamed bot shows its current name.
    await admin.req('PATCH', `/bots/${abe.botId}`, { name: 'Zed' });
    const after = (await mario.get(`/tournaments/${id}/matches/${node.id}`)).body;
    expect(after.games[0].players.find((p: { botId?: string }) => p.botId === abe.botId).name).toBe(
      'Zed',
    );
    expect((await mario.get(`/tournaments/${id}/matches/X9`)).status).toBe(404);
  });
});
