import type { KillFeedEntry, LiveState } from '@tourney/protocol';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BotLog } from '../src/bot-log.js';
import { FakeClock } from '../src/clock.js';
import { LiveBoard, type LiveContext } from '../src/live-board.js';
import { memoryLogger } from '../src/log.js';
import { setup, tournamentFile } from './harness.js';

type Env = Awaited<ReturnType<typeof setup>>;
let env: Env | undefined;
afterEach(async () => {
  await env?.close();
  env = undefined;
});

const events = (e: Env, type: string) =>
  (e.director as any).events.filter((x: { type: string }) => x.type === type) as any[];

function record(e: Env) {
  const feed: KillFeedEntry[] = [];
  const states: LiveState[] = [];
  e.director.on('feed', (x: KillFeedEntry) => feed.push(x));
  e.director.on('state', (x: LiveState) => states.push(x));
  return { feed, states };
}

describe('live data (mod 0.16.0)', () => {
  it('turns the live lines into one state per second, items and thoughts into the feed', async () => {
    env = await setup({});
    const { feed, states } = record(env);
    await env.run(() => events(env!, 'match.gameFinished').length > 0);
    const started = events(env, 'match.started')[0].data;
    expect(states.length).toBeGreaterThan(0);
    const first = states.filter((s) => s.matchId === started.matchId).at(-1)!;
    expect(first.run).toBeUndefined();
    expect(first.players.length).toBeGreaterThanOrEqual(2);
    // Players by display name and user id, bots by name; sides are entrant ids.
    const human = first.players.find((p) => !p.bot);
    if (human) expect(human.userId).toBeTruthy();
    const ids = new Set(Object.keys(env.director.projection.entrants));
    for (const p of first.players) expect(ids.has(p.side!)).toBe(true);
    // At most one state per second.
    for (let i = 1; i < states.length; i++)
      expect(states[i]!.at - states[i - 1]!.at).toBeGreaterThanOrEqual(1000);
    const last = states.filter((s) => s.matchId === started.matchId).at(-1)!;
    expect(last.players[0]).toMatchObject({ alive: true, armor: 150 });
    expect(last.players[0]!.items.amp).toBe(1);
    expect(last.players[0]!.damageDealt).toBeGreaterThan(0);

    const game = feed.filter((f) => f.matchId === started.matchId && f.game === 1);
    const item = game.find((f) => f.kind === 'item');
    expect(item).toMatchObject({ item: 'amp', killer: last.players[0]!.name });
    const kill = game.find((f) => f.kind === 'kill');
    expect(kill?.killerHealth).toBeGreaterThan(0);
    expect(kill?.distance).toBeGreaterThanOrEqual(0);
    expect(kill?.sec).toBeGreaterThanOrEqual(0);
    if (first.players.some((p) => p.bot)) {
      const thought = game.find((f) => f.kind === 'thought');
      expect(thought?.thought?.state).toMatch(/atk|item/);
    }
    // Damage and items go into the statistics.
    const stats = events(env, 'match.playerStats')[0].data.players;
    expect(stats[0]).toMatchObject({ damageDealt: expect.any(Number), items: { belt: 1, keg: 2 } });
  });

  it('Monster Hunt: feed and state carry the run, times start with each run', async () => {
    env = await setup({
      file: tournamentFile(
        {
          teams: [
            { name: 'Red', members: ['mario', 'anna'] },
            { name: 'Blue', members: ['jonas', 'lea', 'tim'], captain: 'lea' },
          ],
          humanOrder: 'seeded',
        },
        {
          format: 'single',
          size: 4,
          teamSize: 2,
          adapter: 'ut99-mh',
          rules: { mapPool: ['MH-NaliVillage', 'MH-Egypt'], timeLimitMin: 20, fragLimit: 0 },
        },
      ),
    });
    const { feed, states } = record(env);
    await env.run(() => events(env!, 'match.gameFinished').length > 0);
    const matchId = events(env, 'match.started')[0].data.matchId;
    const runs = events(env, 'match.runFinished').filter((r) => r.data.matchId === matchId);
    expect(runs).toHaveLength(2);
    const kills = feed.filter((f) => f.matchId === matchId && f.kind === 'kill' && f.monster);
    expect(kills.some((f) => f.run === 1)).toBe(true);
    expect(kills.some((f) => f.run === 2)).toBe(true);
    // Run 2's first kill is early in run 2, not after run 1's time.
    const firstOf2 = kills.find((f) => f.run === 2)!;
    expect(firstOf2.sec).toBeLessThan(10);
    expect(firstOf2.killerSide).toBe(runs[1].data.entrantId);
    const s2 = states.filter((s) => s.matchId === matchId && s.run === 2);
    expect(s2.length).toBeGreaterThan(0);
    expect(s2.at(-1)!.monsters).toMatchObject({ total: 40 });
    expect(s2.at(-1)!.players.every((p) => p.side === runs[1].data.entrantId)).toBe(true);
  });
});

describe('LiveBoard', () => {
  const ctx = (over: Partial<LiveContext> = {}): LiveContext => ({
    tournamentId: 't',
    matchId: 'm1',
    game: 1,
    sideEntrant: (n) => (n === 0 ? 'ea' : n === 1 ? 'eb' : null),
    player: (tk) => (tk === 'tok' ? { userId: 'u1', name: 'Mario' } : undefined),
    sec: () => 12,
    ...over,
  });

  it('knows humans, ignores lines without roster, starts over with a new game', () => {
    const clock = new FakeClock();
    const states: LiveState[] = [];
    const feed: KillFeedEntry[] = [];
    const board = new LiveBoard(
      clock,
      (s) => states.push(s),
      (f) => feed.push(f),
    );
    const base = { mid: 'm1', g: 1, n: 0 };
    board.handle({ t: 'st', ...base, i: 3, al: true, h: 90, a: 0, w: 'x', pu: 0, ut: 0 }, ctx());
    expect(states).toHaveLength(0);
    board.handle({ t: 'lr', ...base, i: 0, nm: 'Bot', sd: 1, b: true, tk: '' }, ctx());
    expect(board.humans).toBe(false);
    board.handle({ t: 'lr', ...base, i: 1, nm: 'mario', sd: 0, b: false, tk: 'tok' }, ctx());
    expect(board.humans).toBe(true);
    clock.advance(1000);
    expect(states.at(-1)!.players.map((p) => [p.name, p.side, p.userId])).toEqual([
      ['Bot', 'eb', undefined],
      ['Mario', 'ea', 'u1'],
    ]);
    board.handle({ t: 'pk', ...base, i: 1, it: 'keg' }, ctx());
    expect(feed.at(-1)).toMatchObject({ kind: 'item', item: 'keg', humans: true, sec: 12 });
    board.handle(
      { t: 'lr', mid: 'm1', g: 2, n: 0, i: 0, nm: 'Bot', sd: 1, b: true, tk: '' },
      ctx(),
    );
    expect(board.humans).toBe(false);
  });

  it('Monster Hunt: counts monster kills from the feed until the counters carry them', () => {
    const clock = new FakeClock();
    const states: LiveState[] = [];
    const board = new LiveBoard(
      clock,
      (s) => states.push(s),
      () => {},
    );
    const base = { mid: 'm1', g: 1, n: 1 };
    const c = ctx({ run: 1 });
    board.handle({ t: 'lr', ...base, i: 0, nm: 'Mira', sd: 0, b: true, tk: '' }, c);
    board.handle({ t: 'lr', ...base, i: 1, nm: 'mario', sd: 0, b: false, tk: 'tok' }, c);
    board.monsterKill('Mira', 1);
    board.monsterKill('MARIO', 1);
    board.monsterKill('mira', 1);
    board.monsterKill('Mira', 2); // another game: not this board's
    clock.advance(1000);
    expect(states.at(-1)!.players.map((p) => [p.name, p.monsters])).toEqual([
      ['Mira', 2],
      ['Mario', 1],
    ]);
    // Mod 0.17.0: the counters line has the monsters, the feed no longer counts.
    const sx = { t: 'sx' as const, ...base, k: 0, d: 1, su: 0, dd: 50, dt: 0, pg: 0, pl: 0 };
    board.handle({ ...sx, i: 0, mk: 5 }, c);
    board.monsterKill('Mira', 1);
    clock.advance(1000);
    expect(states.at(-1)!.players[0]!.monsters).toBe(5);
  });
});

describe('BotLog', () => {
  it('writes one line per thought into a file per day and drops old days', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botlog-'));
    fs.writeFileSync(path.join(dir, 'bot-thoughts-2020-01-01.jsonl'), '{}\n');
    const log = new BotLog(dir, memoryLogger());
    const t = {
      at: Date.parse('2026-10-22T10:00:00Z'),
      matchId: 'm1',
      game: 1,
      bot: 'Xan',
      state: 'atk',
      target: 'Mario',
      health: 80,
      armor: 0,
      weapon: 'Shock Rifle',
    };
    log.add(t);
    log.add({ ...t, state: 'ret' });
    await log.flush();
    const files = fs.readdirSync(dir);
    expect(files).toEqual(['bot-thoughts-2026-10-22.jsonl']);
    const lines = fs.readFileSync(path.join(dir, files[0]!), 'utf8').trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).state)).toEqual(['atk', 'ret']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
