import path from 'node:path';
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { parseRules, validateAgainstInventory } from '@tourney/adapter-ut99';
import { bootstrapFromFile, TournamentFileSchema } from './bootstrap.js';
import { realClock } from './clock.js';
import {
  BridgeConfigSchema,
  EXAMPLE_CONFIG,
  EXAMPLE_TOURNAMENT,
  readJsonFile,
  type BridgeConfig,
} from './config.js';
import { MatchDirector } from './director.js';
import { LocalEventStore } from './event-store.js';
import { consoleLogger, type Logger } from './log.js';
import { ModServer } from './mod-server.js';
import { scanInventory } from './ut99/inventory.js';
import { prepareServer } from './ut99/prepare.js';
import { ServerProcess } from './ut99/server-process.js';
import { WebsiteAgent } from './website/agent.js';

const HELP = `tourney-bridge <command>

Commands:
  run -c <bridge.json>
        Website mode (needs a "website" section in bridge.json): connect to the website and run
        the tournaments it starts. Keeps running; stop with Ctrl+C.
  run -c <bridge.json> -t <tournament.json>
        Run a tournament defined in a file (standalone mode, no website).
        With a "server" section in bridge.json the bridge starts and supervises the UT server.
        Console commands while running: start (force start), pause [reason], resume, status, quit
  inventory -c <bridge.json> [--fast]
        List the maps and bots of the UT installation from the "server" section (--fast: no map titles)
  example
        Print example bridge.json and tournament.json
`;

function platformOs(): 'linux' | 'windows' | 'other' {
  return process.platform === 'win32'
    ? 'windows'
    : process.platform === 'linux'
      ? 'linux'
      : 'other';
}

function checkServerOs(config: BridgeConfig, log: Logger): void {
  const os = platformOs();
  if (config.server && os !== 'other' && config.server.os !== os) {
    log.warn(`server profile says os=${config.server.os}, but the bridge runs on ${os}`);
  }
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      tournament: { type: 'string', short: 't' },
      fast: { type: 'boolean', default: false },
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

  if (cmd === 'inventory' && values.config) {
    const config = readJsonFile(values.config, BridgeConfigSchema);
    if (!config.server) throw new Error('bridge.json has no "server" section');
    const inv = scanInventory(config.server, { readMeta: !values.fast });
    console.log(JSON.stringify(inv, null, 2));
    console.error(
      `${inv.maps.length} maps, ${inv.bots.length} bots, ${inv.warnings.length} warnings`,
    );
    return;
  }

  if (cmd !== 'run' || !values.config) {
    console.log(HELP);
    process.exitCode = cmd ? 1 : 0;
    return;
  }

  const config = readJsonFile(values.config, BridgeConfigSchema);
  if (!values.tournament) {
    if (!config.website) {
      console.log('bridge.json has no "website" section: pass a tournament file with -t\n');
      console.log(HELP);
      process.exitCode = 1;
      return;
    }
    return runWebsiteMode({ ...config, website: config.website }, path.dirname(values.config));
  }

  const tournament = readJsonFile(values.tournament, TournamentFileSchema);
  const log = consoleLogger(config.logLevel);
  checkServerOs(config, log);
  const rules = parseRules(tournament.settings.game.rules);

  // Fail before anything starts if the map pool does not match the installation.
  if (config.server) {
    const inv = scanInventory(config.server, { readMeta: false });
    for (const w of inv.warnings) log.warn(`inventory: ${w}`);
    const problems = inv.maps.length ? validateAgainstInventory(rules, inv) : [];
    if (problems.length) throw new Error(`tournament cannot run:\n  ${problems.join('\n  ')}`);
  }

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
  await director.start();

  let server: ServerProcess | undefined;
  if (config.server?.manage && director.projection.phase !== 'finished') {
    const prepared = prepareServer(config.server, rules, {
      bridgeHost: config.mod.host,
      bridgePort: config.mod.port,
      sharedKey: config.mod.sharedKey,
    });
    log.info(`wrote ${prepared.iniPath}`);
    server = new ServerProcess({ log, clock: realClock });
    mod.on('hello', () => server?.markRunning());
    server.start({ binary: prepared.binary, args: prepared.args, cwd: prepared.systemDir });
  } else if (config.server && !config.server.manage) {
    log.info('server.manage is false: start the UT server yourself');
  }

  const shutdown = async () => {
    log.info('shutting down');
    await server?.stop();
    await mod.close();
    process.exit(0);
  };

  director.on('shutdown', () => {
    if (server) {
      log.info('post-tournament time is over, stopping the game server and the bridge');
      void shutdown();
    } else {
      log.info('post-tournament time is over (server not managed by the bridge: stop it yourself)');
    }
  });
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
          `phase=${p.phase} stage=${director.stageKind} current=${p.currentMatch?.matchId ?? '-'} ` +
            `results=${p.results.length} server=${server?.state ?? 'external'} mod=${mod.connected ? 'connected' : 'offline'}`,
        );
        const waiting = director.waitingFor();
        if (waiting) log.info(`waiting: ${waiting}`);
      } else if (c === 'quit') void shutdown();
      else if (c) log.info('commands: start, pause [reason], resume, status, quit');
    });
  }
}

async function runWebsiteMode(
  config: BridgeConfig & { website: NonNullable<BridgeConfig['website']> },
  baseDir: string,
): Promise<void> {
  const log = consoleLogger(config.logLevel);
  checkServerOs(config, log);
  const mod = new ModServer({ ...config.mod, log });
  await mod.listen();
  log.info(`mod server listening on ${config.mod.host}:${config.mod.port}`);
  const agent = new WebsiteAgent({ config, baseDir, mod, clock: realClock, log });
  agent.start();
  log.info(`website mode: agent ${config.agentId} -> ${config.website.url}`);

  const shutdown = async () => {
    log.info('shutting down');
    await agent.stop();
    await mod.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
