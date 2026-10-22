import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { AgentProfile, ClassDefaults } from '@tourney/protocol';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { agents, inventories } from '../db/schema.js';
import { newAgentToken, sha256, TOURNAMENT_ID } from '../common/ids.js';
import { badRequest, conflict, notFound } from '../common/http.js';
import { AgentConnections } from './connections.js';

export type AgentRow = typeof agents.$inferSelect;

export interface AgentInfo {
  agentVersion?: string;
  os?: string;
  arch?: string;
  adapters?: string[];
  profiles?: AgentProfile[];
  activeTournamentId?: string;
}

@Injectable()
export class AgentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(AgentConnections) private readonly connections: AgentConnections,
  ) {}

  private now() {
    return new Date(this.clock.now()).toISOString();
  }

  list(): AgentRow[] {
    return this.db.select().from(agents).orderBy(asc(agents.id)).all();
  }

  get(id: string): AgentRow | undefined {
    return this.db.select().from(agents).where(eq(agents.id, id)).get();
  }

  require(id: string): AgentRow {
    const a = this.get(id);
    if (!a) throw notFound('agent {id}', { id });
    return a;
  }

  byToken(token: string): AgentRow | undefined {
    return this.db
      .select()
      .from(agents)
      .where(eq(agents.tokenHash, sha256(token)))
      .get();
  }

  /** Returns the plain token once; only its hash is stored. */
  create(id: string, name: string): { agent: AgentRow; token: string } {
    if (!TOURNAMENT_ID.test(id)) throw badRequest('agent id: letters, digits, - and _ only');
    if (this.get(id)) throw conflict('agent {id} exists', { id });
    const token = newAgentToken();
    this.db
      .insert(agents)
      .values({ id, name, tokenHash: sha256(token), createdAt: this.now() })
      .run();
    return { agent: this.require(id), token };
  }

  rotateToken(id: string): string {
    this.require(id);
    const token = newAgentToken();
    this.db
      .update(agents)
      .set({ tokenHash: sha256(token) })
      .where(eq(agents.id, id))
      .run();
    return token;
  }

  remove(id: string): void {
    this.require(id);
    this.db.delete(agents).where(eq(agents.id, id)).run();
  }

  info(agent: AgentRow): AgentInfo {
    return agent.infoJson ? (JSON.parse(agent.infoJson) as AgentInfo) : {};
  }

  profile(agentId: string, profileId: string): AgentProfile | undefined {
    const a = this.get(agentId);
    return a ? this.info(a).profiles?.find((p) => p.id === profileId) : undefined;
  }

  saveHello(id: string, info: AgentInfo): void {
    this.db
      .update(agents)
      .set({ infoJson: JSON.stringify(info), lastSeenAt: this.now() })
      .where(eq(agents.id, id))
      .run();
  }

  touch(id: string): void {
    this.db.update(agents).set({ lastSeenAt: this.now() }).where(eq(agents.id, id)).run();
  }

  saveInventory(agentId: string, profileId: string, data: unknown, scannedAt: string): void {
    this.db
      .insert(inventories)
      .values({ agentId, profileId, dataJson: JSON.stringify(data), scannedAt })
      .onConflictDoUpdate({
        target: [inventories.agentId, inventories.profileId],
        set: { dataJson: JSON.stringify(data), scannedAt },
      })
      .run();
  }

  /**
   * Bot class defaults the mod reported after the last scan go into the stored inventory (the
   * next scan carries them anyway). Without a scan yet there is nothing to add them to.
   */
  saveClassDefaults(agentId: string, profileId: string, classDefaults: ClassDefaults[]): void {
    const row = this.db
      .select()
      .from(inventories)
      .where(and(eq(inventories.agentId, agentId), eq(inventories.profileId, profileId)))
      .get();
    if (!row) return;
    const data = JSON.parse(row.dataJson) as { assets?: Record<string, unknown> };
    data.assets = { ...(data.assets ?? {}), classDefaults };
    this.saveInventory(agentId, profileId, data, row.scannedAt);
  }

  inventory(agentId: string, profileId: string): unknown {
    const row = this.db
      .select()
      .from(inventories)
      .where(and(eq(inventories.agentId, agentId), eq(inventories.profileId, profileId)))
      .get();
    return row ? JSON.parse(row.dataJson) : undefined;
  }

  /** Every stored inventory with its server and profile. */
  inventoryRows(): { agentId: string; profileId: string; data: unknown }[] {
    return this.db
      .select()
      .from(inventories)
      .all()
      .map((r) => ({ agentId: r.agentId, profileId: r.profileId, data: JSON.parse(r.dataJson) }));
  }

  /** Every stored inventory (all servers and profiles). */
  allInventories(): unknown[] {
    return this.db
      .select()
      .from(inventories)
      .all()
      .map((r) => JSON.parse(r.dataJson) as unknown);
  }

  view(agent: AgentRow) {
    const info = this.info(agent);
    return {
      id: agent.id,
      name: agent.name,
      createdAt: agent.createdAt,
      lastSeenAt: agent.lastSeenAt,
      online: this.connections.isOnline(agent.id),
      status: this.connections.status(agent.id) ?? null,
      ...info,
      profiles: (info.profiles ?? []).map((p) => ({
        ...p,
        inventory: this.inventory(agent.id, p.id) ?? null,
      })),
    };
  }
}
