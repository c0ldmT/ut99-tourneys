import path from 'node:path';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { bootstrapFromFile, TournamentFileSchema } from './bootstrap.js';
import { realClock } from './clock.js';
import { BridgeConfigSchema, EXAMPLE_CONFIG, EXAMPLE_TOURNAMENT, readJsonFile } from './config.js';
import { MatchDirector } from './director.js';
import { LocalEventStore } from './event-store.js';
import { consoleLogger } from './log.js';
import { ModServer } from './mod-server.js';

const HELP = `tourney-bridge <command>

Commands:
  run --config <bridge.json> --tournament <tournament.json>
        Run a tournament defined in a file (standalone mode, no website).
        Console commands while running: start (force start), pause, resume, status, quit
  example
        Print example bridge.json and tournament.json
`;

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      tournament: { type: 'string', short: 't' },
    },
  });
  const cmd = positionals[0];

  if (cmd === 'example') {
    console.log('// bridge.json');
    console.log(JSON.stringify(EXAMPLE_CONFIG, null, 2));
    console.log('\n// tournament.json');
    console.log(JSON.stringify(EXAMPLE_TOURNAMENT, null, 2));
    return;
  }
  if (cmd !== 'run' || !values.config || !values.tournament) {
    console.log(HELP);
    process.exitCode = cmd ? 1 : 0;
    return;
  }

  const config = readJsonFile(values.config, BridgeConfigSchema);
  const tournament = readJsonFile(values.tournament, TournamentFileSchema);
  const log = consoleLogger(config.logLevel);
  const store = new LocalEventStore(
    realClock,
    path.resolve(path.dirname(values.config), config.dataDir, 'tournaments'),
  );
  const boot = await bootstrapFromFile(store, tournament);
  log.info(
    boot.created
      ? `created tournament ${tournament.tournamentId}`
      : `resuming tournament ${tournament.tournamentId}`,
  );

  const mod = new ModServer({ ...config.mod, log });
  await mod.listen();
  const director = new MatchDirector({
    tournamentId: tournament.tournamentId,
    agentId: config.agentId,
    store,
    mod,
    clock: realClock,
    log,
    access: boot.access,
    botPool: boot.botPool,
  });
  director.on('live', (info) => log.debug(`live ${JSON.stringify(info)}`));
  director.on('finished', (champion: string) =>
    log.info(`tournament finished, champion ${champion}`),
  );
  director.on('shutdown', () => log.info('post-tournament time is over'));
  await director.start();

  const shutdown = async () => {
    log.info('shutting down');
    await mod.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      const [c, ...rest] = line.trim().split(/\s+/);
      if (c === 'start') void director.forceStart();
      else if (c === 'pause') void director.pause(rest.join(' ') || 'paused by admin');
      else if (c === 'resume') void director.resume();
      else if (c === 'status') {
        const p = director.projection;
        log.info(
          `phase=${p.phase} stage=${director.stageKind} current=${p.currentMatch?.matchId ?? '-'} results=${p.results.length}`,
        );
      } else if (c === 'quit') void shutdown();
      else if (c) log.info('commands: start, pause [reason], resume, status, quit');
    });
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
