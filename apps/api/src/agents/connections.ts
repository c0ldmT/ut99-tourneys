import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  PROTOCOL_VERSION,
  type AgentCommand,
  type BridgeToWebsite,
  type WebsiteToBridge,
} from '@tourney/protocol';
import type { WebSocket } from 'ws';
import { CLOCK, type ApiClock } from '../config.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';

type Outgoing = WebsiteToBridge extends infer M
  ? M extends WebsiteToBridge
    ? Omit<M, 'v' | 'id' | 'ts'>
    : never
  : never;

export class AgentOfflineError extends Error {
  readonly key = 'agent {id} is not connected';
  readonly params: Record<string, string>;
  constructor(agentId: string) {
    super(`agent ${agentId} is not connected`);
    this.params = { id: agentId };
  }
}

/** `key`/`params`: the template of the message for the website (none: the agent's own text). */
export class CommandFailedError extends Error {
  constructor(
    message: string,
    readonly key?: string,
    readonly params?: Record<string, string>,
  ) {
    super(message);
  }
}

interface Pending {
  resolve: () => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/** Live WebSocket connections of bridge agents, plus their last reported status. */
@Injectable()
export class AgentConnections {
  private sockets = new Map<string, WebSocket>();
  private pending = new Map<string, Pending>();
  /** Requests waiting for the message that answers them (`re`). */
  private replies = new Map<
    string,
    {
      agentId: string;
      resolve: (m: BridgeToWebsite) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private statuses = new Map<string, unknown>();
  private listeners = new Set<(agentId: string, online: boolean) => void>();

  constructor(
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(LOGGER) private readonly log: ApiLogger,
  ) {}

  register(agentId: string, ws: WebSocket): void {
    const old = this.sockets.get(agentId);
    if (old && old !== ws) old.close(4000, 'replaced by a new connection');
    this.sockets.set(agentId, ws);
    this.emit(agentId, true);
  }

  unregister(agentId: string, ws: WebSocket): void {
    if (this.sockets.get(agentId) !== ws) return;
    this.sockets.delete(agentId);
    this.statuses.delete(agentId);
    for (const [id, r] of this.replies)
      if (r.agentId === agentId) {
        clearTimeout(r.timer);
        this.replies.delete(id);
        r.reject(new AgentOfflineError(agentId));
      }
    this.emit(agentId, false);
  }

  onChange(fn: (agentId: string, online: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(agentId: string, online: boolean) {
    for (const fn of this.listeners) fn(agentId, online);
  }

  isOnline(agentId: string): boolean {
    return this.sockets.has(agentId);
  }

  send(agentId: string, msg: Outgoing): string {
    const ws = this.sockets.get(agentId);
    if (!ws) throw new AgentOfflineError(agentId);
    const id = crypto.randomUUID();
    ws.send(JSON.stringify({ v: PROTOCOL_VERSION, id, ts: this.clock.now(), ...msg }));
    return id;
  }

  /** Sends a command and waits for its command.ack. */
  command(agentId: string, command: AgentCommand, timeoutMs = 20_000): Promise<void> {
    const commandId = crypto.randomUUID();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        reject(
          new CommandFailedError(
            `agent ${agentId} did not answer ${command.kind}`,
            'agent {id} did not answer {command}',
            { id: agentId, command: command.kind },
          ),
        );
      }, timeoutMs);
      this.pending.set(commandId, { resolve, reject, timer });
      try {
        this.send(agentId, { type: 'command', payload: { commandId, command } });
        this.log.info(`command ${command.kind} -> ${agentId}`);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(commandId);
        reject(e as Error);
      }
    });
  }

  /** Sends a message and waits for the agent's message that answers it (its `re`). */
  request(agentId: string, msg: Outgoing, timeoutMs = 20_000): Promise<BridgeToWebsite> {
    return new Promise((resolve, reject) => {
      let id: string;
      try {
        id = this.send(agentId, msg);
      } catch (e) {
        reject(e as Error);
        return;
      }
      const timer = setTimeout(() => {
        this.replies.delete(id);
        reject(
          new CommandFailedError(
            `agent ${agentId} did not answer ${msg.type}`,
            'agent {id} did not answer {command}',
            { id: agentId, command: msg.type },
          ),
        );
      }, timeoutMs);
      this.replies.set(id, { agentId, resolve, reject, timer });
    });
  }

  /** An agent's answer to a request (false: nobody waits for it). */
  answer(agentId: string, msg: BridgeToWebsite): boolean {
    const r = msg.re ? this.replies.get(msg.re) : undefined;
    if (!r || r.agentId !== agentId) return false;
    clearTimeout(r.timer);
    this.replies.delete(msg.re!);
    r.resolve(msg);
    return true;
  }

  ack(commandId: string, ok: boolean, error?: string): void {
    const p = this.pending.get(commandId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(commandId);
    if (ok) p.resolve();
    else p.reject(new CommandFailedError(error ?? 'command failed'));
  }

  setStatus(agentId: string, status: unknown): void {
    this.statuses.set(agentId, status);
  }

  status(agentId: string): unknown {
    return this.statuses.get(agentId);
  }

  closeAll(): void {
    for (const ws of this.sockets.values()) ws.close(1001, 'server shutting down');
    this.sockets.clear();
    for (const p of [...this.pending.values(), ...this.replies.values()]) {
      clearTimeout(p.timer);
      p.reject(new CommandFailedError('server shutting down', 'server shutting down'));
    }
    this.pending.clear();
    this.replies.clear();
  }
}
