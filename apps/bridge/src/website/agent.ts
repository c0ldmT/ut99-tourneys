import os from 'node:os';
import path from 'node:path';
import { parseRules, validateAgainstInventory } from '@tourney/adapter-ut99';
import type {
  AccessEntry,
  AgentCommand,
  AgentProfile,
  BotSpec,
  MapInfo,
  WebsiteToBridge,
} from '@tourney/protocol';
import type { Clock } from '../clock.js';
import type { BridgeConfig } from '../config.js';
import { MatchDirector, type DirectorTiming, type LiveInfo } from '../director.js';
import type { Logger } from '../log.js';
import type { ModHello, ModServer } from '../mod-server.js';
import { scanInventory } from '../ut99/inventory.js';
import { prepareServer } from '../ut99/prepare.js';
import { ServerProcess } from '../ut99/server-process.js';
import { WebsiteLink } from './link.js';
import { RemoteEventStore } from './remote-store.js';

export const AGENT_VERSION = '0.2.0';

export interface WebsiteAgentOptions {
  config: BridgeConfig & { website: NonNullable<BridgeConfig['website']> };
  /** Directory of bridge.json; dataDir is relative to it. */
  baseDir: string;
  mod: ModServer;
  clock: Clock;
  log: Logger;
  timing?: Partial<DirectorTiming>;
  /** Tests: keep the mirror in memory. */
  memoryOnly?: boolean;
}

interface Runtime {
  tournamentId: string;
  director: MatchDirector;
  server?: ServerProcess;
  cleanup: () => void;
}

/**
 * Website mode: takes commands from the website, runs one tournament at a time on the local
 * game server and reports status, inventory and live match data back.
 */
export class WebsiteAgent {
  readonly link: WebsiteLink;
  readonly store: RemoteEventStore;
  private access = new Map<string, AccessEntry[]>();
  private runtime?: Runtime;
  private level?: string;
  private statusTimer?: NodeJS.Timeout;
  private maps: MapInfo[] = [];

  constructor(private readonly o: WebsiteAgentOptions) {
    const { config, log } = o;
    this.link = new WebsiteLink({
      url: config.website.url,
      token: config.website.token,
      log,
      hello: () => ({
        agentId: config.agentId,
        agentVersion: AGENT_VERSION,
        os: process.platform === 'win32' ? 'windows' : 'linux',
        arch: os.arch(),
        adapters: ['ut99-dm'],
        knownSeq: this.store.knownSeq(),
        profiles: this.profiles(),
        ...(this.runtime ? { activeTournamentId: this.runtime.tournamentId } : {}),
      }),
    });
    this.store = new RemoteEventStore(
      this.link,
      log,
      o.memoryOnly ? undefined : path.resolve(o.baseDir, config.dataDir, 'website'),
    );
    this.link.on('message', (m: WebsiteToBridge) => void this.onMessage(m));
    this.link.on('connected', () => this.sendStatus());
    o.mod.on('hello', (h: ModHello) => {
      this.level = h.lvl;
      this.sendStatus();
    });
    o.mod.on('close', () => this.sendStatus());
  }

  get active(): string | undefined {
    return this.runtime?.tournamentId;
  }

  get director(): MatchDirector | undefined {
    return this.runtime?.director;
  }

  start(): void {
    this.link.start();
    this.statusTimer = setInterval(() => this.sendStatus(), 15_000);
    this.statusTimer.unref?.();
  }

  async stop(): Promise<void> {
    clearInterval(this.statusTimer);
    await this.dispose();
    this.link.stop();
  }

  private profiles(): AgentProfile[] {
    const s = this.o.config.server;
    if (!s) return [];
    return [
      {
        id: s.id,
        name: s.name,
        os: s.os,
        port: s.port,
        lobbyMap: s.lobbyMap,
        ...(s.serverName ? { serverName: s.serverName } : {}),
        ...(s.publicAddress ? { publicAddress: s.publicAddress } : {}),
        manage: s.manage,
      },
    ];
  }

  private async onMessage(msg: WebsiteToBridge): Promise<void> {
    switch (msg.type) {
      case 'tournament.sync': {
        const p = msg.payload;
        const changed = this.store.applySync(p);
        const before = JSON.stringify(this.access.get(p.tournamentId) ?? []);
        this.access.set(p.tournamentId, p.access);
        const rt = this.runtime;
        if (rt && rt.tournamentId === p.tournamentId) {
          if (JSON.stringify(p.access) !== before) await rt.director.setAccess(p.access);
          if (changed) await rt.director.refresh();
        }
        return;
      }
      case 'command': {
        const { commandId, command } = msg.payload;
        try {
          await this.handleCommand(command);
          this.reply(commandId, true);
        } catch (e) {
          this.o.log.warn(`command ${command.kind} failed: ${(e as Error).message}`);
          this.reply(commandId, false, (e as Error).message);
        }
        return;
      }
      default:
        return;
    }
  }

  private reply(commandId: string, ok: boolean, error?: string) {
    try {
      this.link.send('command.ack', { commandId, ok, ...(error ? { error } : {}) });
    } catch {
      // connection lost; the website times the command out
    }
  }

  private requireRuntime(tournamentId: string): Runtime {
    const rt = this.runtime;
    if (!rt || rt.tournamentId !== tournamentId)
      throw new Error(`tournament ${tournamentId} is not running here`);
    return rt;
  }

  private async handleCommand(cmd: AgentCommand): Promise<void> {
    switch (cmd.kind) {
      case 'tournament.run':
        return this.run(cmd.tournamentId, cmd.profileId, cmd.botPool);
      case 'tournament.forceStart':
        return this.requireRuntime(cmd.tournamentId).director.forceStart();
      case 'tournament.pause':
        return this.requireRuntime(cmd.tournamentId).director.pause(cmd.reason);
      case 'tournament.resume':
        return this.requireRuntime(cmd.tournamentId).director.resume();
      case 'tournament.abort': {
        const rt = this.requireRuntime(cmd.tournamentId);
        await rt.director.abort(cmd.reason);
        return this.dispose();
      }
      case 'announce': {
        if (!this.runtime) throw new Error('no tournament is running');
        return this.runtime.director.announce(cmd.message);
      }
      case 'access.upsert': {
        const list = [...(this.access.get(cmd.tournamentId) ?? [])];
        for (const e of cmd.entries) {
          const i = list.findIndex((x) => x.userId === e.userId);
          if (i >= 0) list[i] = e;
          else list.push(e);
        }
        this.access.set(cmd.tournamentId, list);
        if (this.runtime?.tournamentId === cmd.tournamentId)
          await this.runtime.director.setAccess(list);
        return;
      }
      case 'access.revoke': {
        const list = (this.access.get(cmd.tournamentId) ?? []).filter(
          (x) => !cmd.userIds.includes(x.userId),
        );
        this.access.set(cmd.tournamentId, list);
        if (this.runtime?.tournamentId === cmd.tournamentId)
          await this.runtime.director.setAccess(list);
        return;
      }
      case 'server.stop':
        await this.runtime?.server?.stop();
        return;
      case 'match.restart':
        throw new Error('match.restart is not supported yet');
      case 'inventory.rescan':
        return this.rescan(cmd.profileId);
    }
  }

  private profileConfig(profileId: string) {
    const s = this.o.config.server;
    if (!s || s.id !== profileId) throw new Error(`no server profile ${profileId} on this bridge`);
    return s;
  }

  private async rescan(profileId: string): Promise<void> {
    const profile = this.profileConfig(profileId);
    const inv = scanInventory(profile, { readMeta: true });
    this.maps = inv.maps;
    this.link.send('agent.inventory', {
      profileId,
      adapter: 'ut99-dm',
      maps: inv.maps,
      bots: inv.bots,
      scannedAt: new Date(this.o.clock.now()).toISOString(),
      warnings: inv.warnings,
    });
  }

  private async run(tournamentId: string, profileId: string, botPool: BotSpec[]): Promise<void> {
    if (this.runtime?.tournamentId === tournamentId) return; // already running (website resent it)
    if (this.runtime) throw new Error(`busy with tournament ${this.runtime.tournamentId}`);
    const profile = this.profileConfig(profileId);
    const events = await this.store.load(tournamentId);
    const created = events[0];
    if (!created || created.type !== 'tournament.created')
      throw new Error(`no event log for ${tournamentId}`);
    const rules = parseRules(created.data.settings.game.rules);

    let server: ServerProcess | undefined;
    const cleanups: (() => void)[] = [];
    if (profile.manage) {
      const inv = scanInventory(profile, { readMeta: false });
      const problems = inv.maps.length ? validateAgainstInventory(rules, inv) : [];
      if (problems.length) throw new Error(`tournament cannot run: ${problems.join('; ')}`);
      const prepared = prepareServer(profile, rules, {
        bridgeHost: this.o.config.mod.host,
        bridgePort: this.o.config.mod.port,
        sharedKey: this.o.config.mod.sharedKey,
      });
      this.o.log.info(`wrote ${prepared.iniPath}`);
      server = new ServerProcess({ log: this.o.log, clock: this.o.clock });
      const markRunning = () => server?.markRunning();
      this.o.mod.on('hello', markRunning);
      cleanups.push(() => this.o.mod.off('hello', markRunning));
      server.on('state', () => this.sendStatus());
      server.start({ binary: prepared.binary, args: prepared.args, cwd: prepared.systemDir });
    }

    const director = new MatchDirector({
      tournamentId,
      agentId: this.o.config.agentId,
      store: this.store,
      mod: this.o.mod,
      clock: this.o.clock,
      log: this.o.log,
      access: this.access.get(tournamentId) ?? [],
      botPool,
      maps: this.maps,
      ...(this.o.timing ? { timing: this.o.timing } : {}),
    });
    director.on('live', (info: LiveInfo) => {
      try {
        this.link.send('match.live', info);
      } catch {
        // telemetry is best effort
      }
    });
    director.on('finished', (champion: string) =>
      this.o.log.info(`tournament finished, champion ${champion}`),
    );
    director.on('shutdown', () => {
      this.o.log.info('post-tournament time is over, stopping the game server');
      void this.dispose();
    });
    director.on('aborted', () => void this.dispose());
    this.runtime = {
      tournamentId,
      director,
      ...(server ? { server } : {}),
      cleanup: () => cleanups.forEach((f) => f()),
    };
    await director.start();
    await director.openCheckIn(profileId);
    this.o.log.info(`running tournament ${tournamentId}`);
    this.sendStatus();
  }

  private async dispose(): Promise<void> {
    const rt = this.runtime;
    if (!rt) return;
    this.runtime = undefined;
    await rt.director.stop();
    await rt.server?.stop();
    rt.cleanup();
    this.sendStatus();
  }

  sendStatus(): void {
    if (!this.link.connected) return;
    const rt = this.runtime;
    const s = this.o.config.server;
    try {
      this.link.send('server.status', {
        state: rt?.server?.state ?? (this.o.mod.connected ? 'running' : 'stopped'),
        ...(s ? { profileId: s.id, port: s.port } : {}),
        ...(rt ? { tournamentId: rt.tournamentId } : {}),
        ...(rt?.server?.pid ? { pid: rt.server.pid } : {}),
        ...(rt?.server ? { uptimeSec: rt.server.uptimeSec } : {}),
        ...(this.level && this.o.mod.connected ? { map: this.level } : {}),
        modConnected: this.o.mod.connected,
        players: rt?.director.connectedPlayers() ?? [],
      });
    } catch {
      // not connected
    }
  }
}
