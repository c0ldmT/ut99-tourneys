import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { BridgeToWebsiteSchema, type BridgeToWebsite } from '@tourney/protocol';
import { WebSocketServer, type WebSocket } from 'ws';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { EventLogService } from '../tournaments/event-log.service.js';
import { LiveHub } from '../tournaments/hub.js';
import { ACTIVE_PHASES, TournamentsService } from '../tournaments/tournaments.service.js';
import { AgentsService } from './agents.service.js';
import { AgentConnections } from './connections.js';

export const AGENT_PATH = '/api/agent';

/**
 * WebSocket endpoint for bridge agents (see packages/protocol/src/agent.ts). The bridge opens
 * the connection (outbound, works behind NAT) and authenticates with its agent token.
 */
@Injectable()
export class AgentGateway {
  private wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });

  constructor(
    @Inject(AgentsService) private readonly agents: AgentsService,
    @Inject(AgentConnections) private readonly connections: AgentConnections,
    @Inject(EventLogService) private readonly log: EventLogService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
    @Inject(LiveHub) private readonly hub: LiveHub,
    @Inject(LOGGER) private readonly logger: ApiLogger,
  ) {
    this.connections.onChange((agentId, online) => {
      for (const t of this.tournaments.byAgent(agentId)) {
        this.hub.publish(t.id, { type: 'agent', online });
      }
    });
  }

  attach(server: Server): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname !== AGENT_PATH) return; // other upgrade handlers may take it
      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const agent = token ? this.agents.byToken(token) : undefined;
      if (!agent) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        this.logger.warn(`agent connection with an invalid token from ${req.socket.remoteAddress}`);
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(agent.id, ws));
    });
  }

  close(): void {
    this.connections.closeAll();
    this.wss.close();
  }

  private onConnection(agentId: string, ws: WebSocket) {
    this.logger.info(`agent ${agentId} connected`);
    let alive = true;
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 30_000);
    ws.on('pong', () => (alive = true));
    ws.on('message', (data) => {
      alive = true;
      let msg: BridgeToWebsite;
      try {
        const parsed = BridgeToWebsiteSchema.safeParse(JSON.parse(String(data)));
        if (!parsed.success) {
          this.logger.warn(
            `agent ${agentId}: invalid message: ${parsed.error.message.slice(0, 300)}`,
          );
          return;
        }
        msg = parsed.data;
      } catch {
        this.logger.warn(`agent ${agentId}: message is not JSON`);
        return;
      }
      try {
        this.handle(agentId, ws, msg);
      } catch (e) {
        this.logger.error(`agent ${agentId}: ${msg.type}: ${(e as Error).stack ?? e}`);
      }
    });
    ws.on('close', () => {
      clearInterval(ping);
      this.connections.unregister(agentId, ws);
      this.logger.info(`agent ${agentId} disconnected`);
    });
    ws.on('error', (e) => this.logger.warn(`agent ${agentId}: ${e.message}`));
  }

  private handle(agentId: string, ws: WebSocket, msg: BridgeToWebsite) {
    switch (msg.type) {
      case 'agent.hello': {
        const p = msg.payload;
        if (p.agentId !== agentId) {
          this.logger.warn(`agent ${agentId} introduced itself as ${p.agentId}; using ${agentId}`);
        }
        this.connections.register(agentId, ws);
        this.agents.saveHello(agentId, {
          agentVersion: p.agentVersion,
          os: p.os,
          arch: p.arch,
          adapters: p.adapters,
          profiles: p.profiles,
          ...(p.activeTournamentId ? { activeTournamentId: p.activeTournamentId } : {}),
        });
        this.connections.send(agentId, {
          type: 'agent.welcome',
          re: msg.id,
          payload: { agentId, serverTime: Date.now() },
        });
        // Bring the agent's copies of the logs up to date, then resume what it should be running.
        for (const t of this.tournaments.byAgent(agentId)) {
          const known = p.knownSeq[t.id];
          if (known === undefined && t.phase === 'draft') continue;
          if (known !== undefined && known === t.headSeq) continue;
          this.tournaments.syncToAgent(t, known ?? 0);
        }
        const active = this.tournaments
          .byAgent(agentId)
          .find((t) => ACTIVE_PHASES.includes(t.phase));
        if (active) {
          this.tournaments
            .run(active.id)
            .catch((e: Error) =>
              this.logger.warn(`resume ${active.id} on ${agentId}: ${e.message}`),
            );
        }
        return;
      }
      case 'events.append': {
        const { tournamentId, baseSeq, events } = msg.payload;
        const t = this.tournaments.get(tournamentId);
        if (!t || t.agentId !== agentId) {
          this.connections.send(agentId, {
            type: 'events.ack',
            re: msg.id,
            payload: { tournamentId, accepted: false, events: [], reason: 'not your tournament' },
          });
          return;
        }
        const actor = { kind: 'bridge' as const, id: agentId };
        const res = this.log.append(
          tournamentId,
          baseSeq,
          events.map((e) => ({ ...e, actor })),
        );
        if (!res.accepted) this.logger.warn(`events from ${agentId} rejected: ${res.reason}`);
        this.connections.send(agentId, {
          type: 'events.ack',
          re: msg.id,
          payload: res.accepted
            ? { tournamentId, accepted: true, events: res.events }
            : { tournamentId, accepted: false, events: res.missing, reason: res.reason },
        });
        if (res.accepted && res.events.some((e) => e.type === 'match.result')) {
          this.hub.clearLive(tournamentId);
          // Bets were decided: the bots' personalities (bet news) go to the bridge.
          const t = this.tournaments.get(tournamentId);
          if (t) this.tournaments.syncToAgent(t, res.projection.headSeq);
        }
        if (res.accepted && res.events.some((e) => e.type === 'match.called')) {
          // The access list puts the players of the current match first (64 entries at most).
          void this.tournaments.refreshAccessForMatch(tournamentId);
        }
        return;
      }
      case 'command.ack':
        this.connections.ack(msg.payload.commandId, msg.payload.ok, msg.payload.error);
        return;
      case 'asset.data':
        this.connections.answer(agentId, msg);
        return;
      case 'server.status': {
        this.connections.setStatus(agentId, msg.payload);
        this.agents.touch(agentId);
        return;
      }
      case 'agent.inventory': {
        const p = msg.payload;
        this.agents.saveInventory(agentId, p.profileId, p, p.scannedAt);
        return;
      }
      case 'agent.classDefaults': {
        const p = msg.payload;
        this.agents.saveClassDefaults(agentId, p.profileId, p.classDefaults);
        return;
      }
      case 'match.live': {
        const t = this.tournaments.get(msg.payload.tournamentId);
        if (t && t.agentId === agentId) this.hub.publish(t.id, { type: 'live', data: msg.payload });
        return;
      }
      case 'match.feed': {
        const t = this.tournaments.get(msg.payload.tournamentId);
        if (t && t.agentId === agentId) this.hub.publish(t.id, { type: 'feed', data: msg.payload });
        return;
      }
      case 'agent.log': {
        const line = `agent ${agentId}: ${msg.payload.message}`;
        if (msg.payload.level === 'error') this.logger.error(line);
        else if (msg.payload.level === 'warn') this.logger.warn(line);
        else this.logger.debug(line);
        return;
      }
    }
  }
}
