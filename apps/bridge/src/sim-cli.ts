import { parseArgs } from 'node:util';
import { TournamentFileSchema } from './bootstrap.js';
import { realClock } from './clock.js';
import { BridgeConfigSchema, readJsonFile } from './config.js';
import { consoleLogger } from './log.js';
import { ModSimulator } from './sim/mod-simulator.js';

/**
 * Plays a tournament against a running bridge without UT:
 *   tourney-bridge run -c bridge.json -t tournament.json     (terminal 1)
 *   node dist/sim-cli.js -c bridge.json -t tournament.json   (terminal 2)
 */
const { values } = parseArgs({
  options: {
    config: { type: 'string', short: 'c' },
    tournament: { type: 'string', short: 't' },
    game: { type: 'string', default: '20' },
  },
});
if (!values.config || !values.tournament) {
  console.log('usage: sim-cli -c bridge.json -t tournament.json [--game <seconds per game>]');
  process.exit(1);
}
const config = readJsonFile(values.config, BridgeConfigSchema);
const tournament = readJsonFile(values.tournament, TournamentFileSchema);
const log = consoleLogger('debug', 'sim');
const sim = new ModSimulator({
  host: config.mod.host,
  port: config.mod.port,
  sharedKey: config.mod.sharedKey,
  players: [...tournament.players, ...tournament.spectators].map((p) => ({
    token: p.token,
    name: p.displayName,
  })),
  clock: realClock,
  log,
  behaviour: { gameDurationMs: Number(values.game) * 1000, scoreIntervalMs: 3000 },
});
sim.start();
log.info(`simulated UT server connected to ${config.mod.host}:${config.mod.port}`);
