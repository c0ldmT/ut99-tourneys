import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import readline from 'node:readline';
import type { Clock, TimerHandle } from '../clock.js';
import type { Logger } from '../log.js';

export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

export interface ServerCommand {
  binary: string;
  args: string[];
  cwd: string;
}

export interface ServerProcessOptions {
  log: Logger;
  clock: Clock;
  /** Delays before restarts after a crash; one entry per allowed restart in the window. */
  restartDelaysMs?: number[];
  /** Crashes older than this are forgotten. */
  crashWindowMs?: number;
  /** Graceful stop timeout before the process is killed hard. */
  stopTimeoutMs?: number;
  spawn?: (cmd: string, args: string[], opts: SpawnOptions) => ChildProcess;
}

/**
 * Runs and supervises the UT dedicated server: start, log forwarding, restart after a crash with
 * backoff, stop. The server is started once per tournament and keeps running; map changes happen
 * inside the game, not by restarting the process.
 */
export class ServerProcess extends EventEmitter {
  private child?: ChildProcess;
  private _state: ServerState = 'stopped';
  private crashes: number[] = [];
  private restartTimer?: TimerHandle;
  private command?: ServerCommand;
  private startedAt = 0;
  /** Last log lines of the server, for diagnostics. */
  readonly tail: string[] = [];

  constructor(private readonly o: ServerProcessOptions) {
    super();
  }

  get state(): ServerState {
    return this._state;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get uptimeSec(): number {
    return this._state === 'running' || this._state === 'starting'
      ? Math.round((this.o.clock.now() - this.startedAt) / 1000)
      : 0;
  }

  start(command: ServerCommand): void {
    if (this.child) throw new Error('server already running');
    this.command = command;
    this.crashes = [];
    this.launch();
  }

  /** Marks the server as up (called when the mod connects or the engine reports readiness). */
  markRunning(): void {
    if (this._state === 'starting') this.setState('running');
  }

  async stop(): Promise<void> {
    if (this.restartTimer) this.o.clock.clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
    const child = this.child;
    if (!child) {
      this.setState('stopped');
      return;
    }
    this.setState('stopping');
    await new Promise<void>((resolve) => {
      const hard = this.o.clock.setTimeout(
        () => child.kill('SIGKILL'),
        this.o.stopTimeoutMs ?? 10_000,
      );
      child.once('exit', () => {
        this.o.clock.clearTimeout(hard);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }

  private setState(s: ServerState, detail?: string): void {
    if (s === this._state) return;
    this._state = s;
    this.o.log.info(`game server ${s}${detail ? `: ${detail}` : ''}`);
    this.emit('state', s, detail);
  }

  private launch(): void {
    const cmd = this.command as ServerCommand;
    const spawn = this.o.spawn ?? nodeSpawn;
    this.o.log.info(`starting game server: ${cmd.binary} ${cmd.args.join(' ')}`);
    this.startedAt = this.o.clock.now();
    this.setState('starting');
    let child: ChildProcess;
    try {
      child = spawn(cmd.binary, cmd.args, { cwd: cmd.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      this.onExit(null, `spawn failed: ${(e as Error).message}`);
      return;
    }
    this.child = child;
    const onLine = (line: string) => {
      this.tail.push(line);
      if (this.tail.length > 200) this.tail.shift();
      this.o.log.debug(`[ucc] ${line}`);
      if (/Game engine initialized/i.test(line)) this.markRunning();
    };
    if (child.stdout) readline.createInterface({ input: child.stdout }).on('line', onLine);
    if (child.stderr) readline.createInterface({ input: child.stderr }).on('line', onLine);
    child.once('error', (e) => this.onExit(null, `cannot start: ${e.message}`));
    child.once('exit', (code, signal) =>
      this.onExit(code, signal ? `signal ${signal}` : undefined),
    );
  }

  private onExit(code: number | null, why?: string): void {
    if (!this.child && this._state !== 'starting') return;
    this.child = undefined;
    if (this._state === 'stopping') {
      this.setState('stopped');
      return;
    }
    const now = this.o.clock.now();
    const window = this.o.crashWindowMs ?? 10 * 60_000;
    this.crashes = this.crashes.filter((t) => now - t < window);
    this.crashes.push(now);
    const delays = this.o.restartDelaysMs ?? [3_000, 10_000, 30_000, 60_000];
    const detail = why ?? `exit code ${code}`;
    if (this.crashes.length > delays.length) {
      this.setState('crashed', `${detail}; gave up after ${delays.length} restarts`);
      this.o.log.error(`last server output:\n${this.tail.slice(-20).join('\n')}`);
      return;
    }
    const delay = delays[this.crashes.length - 1] as number;
    this.setState('crashed', `${detail}; restarting in ${Math.round(delay / 1000)}s`);
    this.restartTimer = this.o.clock.setTimeout(() => {
      this.restartTimer = undefined;
      this.launch();
    }, delay);
  }
}
