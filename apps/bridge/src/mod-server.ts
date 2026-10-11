import { EventEmitter } from 'node:events';
import net from 'node:net';
import {
  decodeModToBridge,
  encodeModLine,
  LineSplitter,
  MOD_PROTOCOL_VERSION,
  ModLineError,
  type BridgeToMod,
  type ModToBridge,
} from '@tourney/protocol';
import type { Logger } from './log.js';

export type ModHello = Extract<ModToBridge, { t: 'hello' }>;

/** What the match director needs from the connection to the mod. */
export interface ModLink {
  readonly connected: boolean;
  send(messages: readonly BridgeToMod[]): void;
  on(event: 'hello', listener: (hello: ModHello) => void): this;
  on(event: 'message', listener: (msg: Exclude<ModToBridge, ModHello>) => void): this;
  on(event: 'close', listener: () => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(event: 'hello' | 'message' | 'close', listener: (...args: any[]) => void): this;
}

export interface ModServerOptions {
  host: string;
  port: number;
  sharedKey: string;
  log: Logger;
  /** Drop the connection when the mod is silent this long (it sends a heartbeat every 5 s). */
  idleTimeoutMs?: number;
}

/**
 * TCP server for the UT mod. Exactly one mod connection is active; a new connection replaces the
 * old one (after a map change the old socket may linger for a moment).
 */
export class ModServer extends EventEmitter implements ModLink {
  private server?: net.Server;
  private active?: net.Socket;
  private lastRejectLog = 0;

  constructor(private readonly opts: ModServerOptions) {
    super();
  }

  get connected(): boolean {
    return this.active !== undefined;
  }

  get address(): net.AddressInfo | undefined {
    const a = this.server?.address();
    return a && typeof a === 'object' ? a : undefined;
  }

  listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.accept(socket));
      server.once('error', reject);
      server.listen(this.opts.port, this.opts.host, () => {
        server.off('error', reject);
        this.server = server;
        this.opts.log.info(`mod server listening on ${this.opts.host}:${this.address?.port}`);
        resolve();
      });
    });
  }

  close(): Promise<void> {
    this.active?.destroy();
    this.active = undefined;
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  send(messages: readonly BridgeToMod[]): void {
    const socket = this.active;
    if (!socket) {
      this.opts.log.debug(`mod not connected, dropped ${messages.length} line(s)`);
      return;
    }
    let payload = '';
    for (const m of messages) {
      try {
        payload += encodeModLine(m);
      } catch (e) {
        this.opts.log.error(`cannot encode ${m.t}: ${(e as Error).message}`);
      }
    }
    if (payload) socket.write(payload, 'latin1');
  }

  private accept(socket: net.Socket): void {
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    const splitter = new LineSplitter();
    let authed = false;
    const rejectHint = (why: string) => {
      // The mod retries every few seconds; do not flood the log with the same message.
      const now = Date.now();
      if (now - this.lastRejectLog < 60_000) return this.opts.log.debug(`mod ${peer}: ${why}`);
      this.lastRejectLog = now;
      this.opts.log.warn(`mod ${peer} rejected: ${why} (repeats are logged once per minute)`);
    };
    socket.setEncoding('latin1');
    socket.setNoDelay(true);
    socket.setTimeout(this.opts.idleTimeoutMs ?? 20_000);
    socket.on('timeout', () => {
      this.opts.log.warn(`mod ${peer} idle, closing`);
      socket.destroy();
    });

    socket.on('data', (chunk: string) => {
      let lines: string[];
      try {
        lines = splitter.push(chunk);
      } catch (e) {
        this.opts.log.warn(`mod ${peer}: ${(e as Error).message}`);
        socket.destroy();
        return;
      }
      for (const line of lines) {
        let msg: ModToBridge;
        try {
          msg = decodeModToBridge(line);
        } catch (e) {
          const text = e instanceof ModLineError ? e.message : String(e);
          this.opts.log.warn(`mod ${peer}: bad line (${text})`);
          continue;
        }
        if (!authed) {
          if (msg.t !== 'hello') {
            rejectHint(`expected hello, got ${msg.t}`);
            socket.destroy();
            return;
          }
          if (msg.key !== this.opts.sharedKey) {
            rejectHint(
              msg.key === ''
                ? 'SharedKey is empty. Set it in [UTTourney_v1.TournamentConfig] of the server ini'
                : 'wrong shared key. SharedKey in the server ini must equal mod.sharedKey in bridge.json',
            );
            socket.destroy();
            return;
          }
          if (msg.pv !== MOD_PROTOCOL_VERSION) {
            this.opts.log.warn(
              `mod ${peer}: protocol ${msg.pv}, bridge speaks ${MOD_PROTOCOL_VERSION}`,
            );
          }
          authed = true;
          if (this.active && this.active !== socket) this.active.destroy();
          this.active = socket;
          this.opts.log.info(
            `mod connected from ${peer} (mod ${msg.mv}, engine ${msg.eng}, level ${msg.lvl})`,
          );
          this.emit('hello', msg);
          continue;
        }
        if (socket !== this.active) return;
        this.emit('message', msg);
      }
    });

    socket.on('close', () => {
      if (this.active === socket) {
        this.active = undefined;
        this.opts.log.info('mod disconnected');
        this.emit('close');
      }
    });
    socket.on('error', (e) => this.opts.log.debug(`mod socket ${peer}: ${e.message}`));
  }
}
