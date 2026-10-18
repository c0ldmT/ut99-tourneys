import { TournamentFileSchema, bootstrapFromFile, type TournamentFile } from '../src/bootstrap.js';
import { FakeClock } from '../src/clock.js';
import type { MapRecords } from '@tourney/protocol';
import { MatchDirector, type DirectorTiming } from '../src/director.js';
import { LocalEventStore } from '../src/event-store.js';
import { memoryLogger } from '../src/log.js';
import { ModServer } from '../src/mod-server.js';
import { ModSimulator, type SimBehaviour } from '../src/sim/mod-simulator.js';

export const KEY = 'test-shared-key';

export const players = ['Mario', 'Anna', 'Jonas', 'Lea', 'Tim'].map((name) => ({
  userId: name.toLowerCase(),
  displayName: name,
  token: `${name.toLowerCase()}-token`,
}));

export function tournamentFile(
  over: Record<string, unknown> = {},
  settings: Record<string, unknown> = {},
) {
  return TournamentFileSchema.parse({
    tournamentId: 'test-cup',
    name: 'Test Cup',
    rngSeed: 'seed-1',
    players,
    spectators: [{ userId: 'guest', displayName: 'Guest', token: 'guest-token' }],
    botPool: [
      'Xan',
      'Loque',
      'Malcolm',
      'Brock',
      'Lauren',
      'Visse',
      'Tamika',
      'Dominator',
      'Rankin',
    ].map((name, i) => ({ name, skill: 7 - (i % 7) })),
    settings: {
      format: 'double',
      size: 8,
      checkInWindowMin: 1,
      noShowSec: 60,
      reconnectGraceSec: 60,
      postTournamentShutdownSec: 30,
      ...settings,
      game: {
        adapter: (settings['adapter'] as string | undefined) ?? 'ut99-dm',
        rules: {
          mapPool: ['DM-Deck16][', 'DM-Morpheus', 'DM-Phobos', 'DM-Codex'],
          voteTimeoutSec: 15,
          ...((settings['rules'] as object) ?? {}),
        },
      },
    },
    ...over,
  });
}

export async function setup(opts: {
  file?: TournamentFile;
  behaviour?: Partial<SimBehaviour>;
  timing?: Partial<DirectorTiming>;
  mapRecords?: MapRecords;
  betWindowSec?: number;
}) {
  const clock = new FakeClock();
  const log = memoryLogger();
  const store = new LocalEventStore(clock);
  const file = opts.file ?? tournamentFile();
  const boot = await bootstrapFromFile(store, file);
  const mod = new ModServer({
    host: '127.0.0.1',
    port: 0,
    sharedKey: KEY,
    log,
    idleTimeoutMs: 600_000,
  });
  await mod.listen();
  const makeDirector = () =>
    new MatchDirector({
      tournamentId: file.tournamentId,
      agentId: 'test-agent',
      store,
      mod,
      clock,
      log,
      access: boot.access,
      botPool: boot.botPool,
      ...(opts.mapRecords ? { mapRecords: opts.mapRecords } : {}),
      ...(opts.betWindowSec ? { betWindowSec: opts.betWindowSec } : {}),
      timing: {
        postGameDelayMs: 2_000,
        simulateDelayMs: 1_000,
        loadingTimeoutMs: 30_000,
        ...opts.timing,
      },
    });
  let director = makeDirector();
  await director.start();
  const sim = new ModSimulator({
    host: '127.0.0.1',
    port: mod.address!.port,
    sharedKey: KEY,
    players: [...file.players, ...file.spectators].map((p) => ({
      token: p.token,
      name: p.displayName,
    })),
    clock,
    log,
    behaviour: { gameDurationMs: 10_000, scoreIntervalMs: 3_000, ...opts.behaviour },
  });
  sim.start();

  const settle = async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 1));
    await director.idle();
  };

  return {
    clock,
    log,
    store,
    mod,
    sim,
    file,
    get director() {
      return director;
    },
    settle,
    /** Advances fake time in 500 ms steps until `until` is true. */
    async run(until: () => boolean, maxSteps = 6_000) {
      for (let i = 0; i < maxSteps; i++) {
        await settle();
        if (until()) return;
        clock.advance(500);
      }
      throw new Error(
        `condition not reached; stage=${director.stageKind}\n${log.lines.slice(-30).join('\n')}`,
      );
    },
    async restartDirector() {
      await director.stop();
      director = makeDirector();
      await director.start();
    },
    async close() {
      sim.stop();
      await director.stop();
      await mod.close();
    },
  };
}
