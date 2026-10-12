import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  PROTOCOL_VERSION,
  WebsiteToBridgeSchema,
  type BridgeToWebsite,
  type WebsiteToBridge,
} from '@tourney/protocol';
import WebSocket from 'ws';
import type { Logger } from '../log.js';

type HelloPayload = Extract<BridgeToWebsite, { type: 'agent.hello' }>['payload'];
export type OutgoingType = Exclude<BridgeToWebsite['type'], 'agent.hello'>;
type PayloadOf<T extends BridgeToWebsite['type']> = Extract<
  BridgeToWebsite,
  { type: T }
>['payload'];

export interface WebsiteLinkOptions {
  url: string;
  token: string;
  log: Logger;
  /** Built fresh for every (re)connect. */
  hello: () => HelloPayload;
  /** Reconnect delays in ms; the last one repeats. */
  backoffMs?: number[];
}

/**
 * The bridge's connection to the website: one outbound WebSocket, re-opened after every loss.
 * Emits "message" (validated website message), "connected" (after agent.welcome) and
 * "disconnected".
 */
export class WebsiteLink extends EventEmitter {
  private ws?: WebSocket;
  private stopped = false;
  private attempt = 0;
  private retryTimer?: NodeJS.Timeout;
  private ready = false;
  private waiters: (() => void)[] = [];
  private replies = new Map<string, (msg: WebsiteToBridge) => void>();

  constructor(private readonly o: WebsiteLinkOptions) {
    super();
  }

  get connected(): boolean {
    return this.ready;
  }

  start(): void {
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.ws?.close(1000, 'bridge stopping');
    this.ws = undefined;
    this.ready = false;
  }

  /** Resolves once the website has welcomed us (immediately if it already has). */
  waitConnected(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  send<T extends OutgoingType>(type: T, payload: PayloadOf<T>, re?: string): string {
    if (!this.ws || !this.ready) throw new Error('not connected to the website');
    return this.raw(type, payload, re);
  }

  /** Sends and waits for the message that answers it (matched by `re`). */
  request<T extends OutgoingType>(
    type: T,
    payload: PayloadOf<T>,
    timeoutMs: number,
  ): Promise<WebsiteToBridge> {
    return new Promise((resolve, reject) => {
      let id: string;
      try {
        id = this.send(type, payload);
      } catch (e) {
        reject(e as Error);
        return;
      }
      const timer = setTimeout(() => {
        this.replies.delete(id);
        reject(new Error(`no answer to ${type} within ${timeoutMs} ms`));
      }, timeoutMs);
      const onDown = () => {
        clearTimeout(timer);
        this.replies.delete(id);
        reject(new Error('connection to the website lost'));
      };
      this.once('disconnected', onDown);
      this.replies.set(id, (msg) => {
        clearTimeout(timer);
        this.off('disconnected', onDown);
        resolve(msg);
      });
    });
  }

  private raw(type: string, payload: unknown, re?: string): string {
    const id = crypto.randomUUID();
    this.ws!.send(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        id,
        type,
        ts: Date.now(),
        ...(re ? { re } : {}),
        payload,
      }),
    );
    return id;
  }

  private open(): void {
    if (this.stopped) return;
    const ws = new WebSocket(this.o.url, {
      headers: { Authorization: `Bearer ${this.o.token}` },
      handshakeTimeout: 15_000,
      maxPayload: 16 * 1024 * 1024,
    });
    this.ws = ws;
    let helloId: string | undefined;
    ws.on('open', () => {
      this.o.log.info(`connected to ${this.o.url}, saying hello`);
      helloId = this.raw('agent.hello', this.o.hello());
    });
    ws.on('unexpected-response', (_req, res) => {
      this.o.log.warn(
        res.statusCode === 401
          ? 'the website rejected the agent token (check website.token in bridge.json)'
          : `website answered ${res.statusCode} instead of opening the connection`,
      );
    });
    ws.on('message', (data) => {
      let msg: WebsiteToBridge;
      try {
        const parsed = WebsiteToBridgeSchema.safeParse(JSON.parse(String(data)));
        if (!parsed.success) {
          this.o.log.warn(
            `invalid message from the website: ${parsed.error.message.slice(0, 300)}`,
          );
          return;
        }
        msg = parsed.data;
      } catch {
        this.o.log.warn('message from the website is not JSON');
        return;
      }
      if (msg.type === 'agent.welcome' && (!msg.re || msg.re === helloId)) {
        this.ready = true;
        this.attempt = 0;
        this.emit('connected');
        for (const w of this.waiters.splice(0)) w();
        return;
      }
      if (msg.re) {
        const reply = this.replies.get(msg.re);
        if (reply) {
          this.replies.delete(msg.re);
          reply(msg);
          return;
        }
      }
      this.emit('message', msg);
    });
    ws.on('close', (code, reason) => {
      const was = this.ready;
      this.ready = false;
      if (this.ws === ws) this.ws = undefined;
      if (was) {
        this.o.log.warn(
          `connection to the website closed (${code}${reason.length ? ` ${reason}` : ''})`,
        );
        this.emit('disconnected');
      }
      this.scheduleReconnect();
    });
    ws.on('error', (e) => this.o.log.debug(`website connection: ${e.message}`));
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delays = this.o.backoffMs ?? [1_000, 2_000, 5_000, 10_000, 30_000];
    const delay = delays[Math.min(this.attempt, delays.length - 1)] as number;
    this.attempt++;
    if (this.attempt === 3)
      this.o.log.warn(`cannot reach the website, retrying every ${delays.at(-1)! / 1000} s`);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), delay);
  }
}
