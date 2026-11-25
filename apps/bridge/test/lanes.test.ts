import { afterEach, describe, expect, it } from 'vitest';
import type { NewTournamentEvent, TournamentEvent } from '@tourney/protocol';
import { bootstrapFromFile } from '../src/bootstrap.js';
import { FakeClock } from '../src/clock.js';
import { MatchDirector } from '../src/director.js';
import { LocalEventStore, type AppendResult } from '../src/event-store.js';
import { memoryLogger } from '../src/log.js';
import { ModServer } from '../src/mod-server.js';
import { ModSimulator } from '../src/sim/mod-simulator.js';
import { KEY, players, tournamentFile } from './harness.js';

/** A store that tells the other servers about every append (the website's tournament.sync). */
class SharedStore extends LocalEventStore {
  listeners: ((by: string) => void)[] = [];
  by = '';
  override async append(
    tournamentId: string,
    baseSeq: number,
    events: readonly NewTournamentEvent[],
  ): Promise<AppendResult> {
    const res = await super.append(tournamentId, baseSeq, events);
    const actor = (events[0] as { actor?: { id: string } } | undefined)?.actor?.id ?? '';
    if (res.accepted) for (const fn of this.listeners) fn(actor);
    return res;
  }
}

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const s of stops.splice(0)) await s();
});

async function server(
  agentId: string,
  o: {
    store: SharedStore;
    clock: FakeClock;
    file: ReturnType<typeof tournamentFile>;
    access: Awaited<ReturnType<typeof bootstrapFromFile>>;
    lane?: boolean;
    lanes?: number;
    sim: boolean;
  },
) {
  const log = memoryLogger();
  const mod = new ModServer({
    host: '127.0.0.1',
    port: 0,
    sharedKey: KEY,
    log,
    idleTimeoutMs: 600_000,
  });
  await mod.listen();
  const director = new MatchDirector({
    tournamentId: o.file.tournamentId,
    agentId,
    store: o.store,
    mod,
    clock: o.clock,
    log,
    access: o.access.access,
    botPool: o.access.botPool,
    ...(o.lane ? { lane: true } : { lanes: o.lanes ?? 0 }),
    timing: { postGameDelayMs: 2_000, simulateDelayMs: 1_000, loadingTimeoutMs: 30_000 },
  });
  o.store.listeners.push((by) => {
    if (by !== agentId) void director.refresh();
  });
  await director.start();
  const sim = new ModSimulator({
    host: '127.0.0.1',
    port: mod.address!.port,
    sharedKey: KEY,
    players: o.sim
      ? [...o.file.players, ...o.file.spectators].map((p) => ({
          token: p.token,
          name: p.displayName,
        }))
      : [],
    clock: o.clock,
    log,
    behaviour: { gameDurationMs: 10_000, scoreIntervalMs: 3_000 },
  });
  sim.start();
  stops.push(async () => {
    sim.stop();
    await director.stop();
    await mod.close();
  });
  return { director, log, sim };
}

describe('parallel matches on extra servers (decision 291)', () => {
  it('plays bot matches on two extra servers while the player plays on the main server', async () => {
    const clock = new FakeClock();
    const store = new SharedStore(clock);
    const file = tournamentFile({ players: players.slice(0, 1) }, { format: 'single', size: 8 });
    const access = await bootstrapFromFile(store, file);
    const base = { store, clock, file, access };
    const main = await server('main', { ...base, lanes: 2, sim: true });
    await main.director.openCheckIn('local');
    const lanes = [
      await server('lane-1', { ...base, lane: true, sim: false }),
      await server('lane-2', { ...base, lane: true, sim: false }),
    ];
    const all = [main, ...lanes];
    const settle = async () => {
      for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 1));
      for (const s of all) await s.director.idle();
    };
    let maxLive = 0;
    const t0 = clock.now();
    for (let i = 0; i < 6_000 && main.director.projection.phase !== 'finished'; i++) {
      await settle();
      maxLive = Math.max(maxLive, Object.keys(main.director.projection.liveMatches).length);
      clock.advance(500);
    }
    await settle();
    const p = main.director.projection;
    expect(p.phase, main.log.lines.slice(-20).join('\n')).toBe('finished');
    expect(p.championId).toBeDefined();
    expect(p.results).toHaveLength(7);
    expect(p.results.every((r) => r.outcome === 'played')).toBe(true);
    const log = (await store.load(file.tournamentId)) as TournamentEvent[];
    const called = log.filter((e) => e.type === 'match.called') as Extract<
      TournamentEvent,
      { type: 'match.called' }
    >[];
    // Every match was called once; the player's matches only on the main server.
    expect(new Set(called.map((e) => e.data.matchId)).size).toBe(7);
    expect(called).toHaveLength(7);
    for (const e of called) {
      if (e.data.entrants.includes('p1')) expect(e.data.server).toBeUndefined();
      if (e.data.server) expect(e.actor.id).toBe(e.data.server);
    }
    // Round one ran on three servers at once; both extra servers played.
    expect(maxLive).toBe(3);
    expect(new Set(called.map((e) => e.data.server ?? 'main'))).toEqual(
      new Set(['main', 'lane-1', 'lane-2']),
    );
    // Faster than one server alone (7 matches of ~25 s one after the other).
    expect(clock.now() - t0).toBeLessThan(5 * 30_000);
    // Each game was loaded on the server that played it.
    const games = Object.values(p.games).flat().length;
    expect(all.reduce((n, s) => n + s.sim.travels.length, 0)).toBe(games);
    for (const s of all) expect(s.log.lines.filter((l) => /^(warn|error):/.test(l))).toEqual([]);
    // The extra servers know the tournament is over.
    for (const l of lanes) expect(l.director.stageKind).toBe('finished');
  });

  it('extra servers follow a pause of the main server', async () => {
    const clock = new FakeClock();
    const store = new SharedStore(clock);
    const file = tournamentFile({ players: players.slice(0, 1) }, { format: 'single', size: 4 });
    const access = await bootstrapFromFile(store, file);
    const base = { store, clock, file, access };
    const main = await server('main', { ...base, lanes: 1, sim: true });
    await main.director.openCheckIn('local');
    const lane = await server('lane-1', { ...base, lane: true, sim: false });
    const settle = async () => {
      for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 1));
      await main.director.idle();
      await lane.director.idle();
    };
    for (let i = 0; i < 400 && lane.director.stageKind !== 'live'; i++) {
      await settle();
      clock.advance(500);
    }
    expect(lane.director.stageKind).toBe('live');
    await main.director.pause('break');
    await settle();
    expect(lane.director.projection.phase).toBe('paused');
    expect(lane.sim.received.some((m) => m.t === 'pause' && m.on)).toBe(true);
    await main.director.resume();
    await settle();
    expect(lane.sim.received.some((m) => m.t === 'pause' && !m.on)).toBe(true);
    for (let i = 0; i < 4_000 && main.director.projection.phase !== 'finished'; i++) {
      await settle();
      clock.advance(500);
    }
    expect(main.director.projection.phase).toBe('finished');
  });
});
