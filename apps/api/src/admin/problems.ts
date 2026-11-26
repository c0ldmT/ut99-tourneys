import { Inject, Injectable } from '@nestjs/common';
import { AgentConnections } from '../agents/connections.js';
import { CLOCK, type ApiClock } from '../config.js';

/** One thing that went wrong on a game server (since the API started). */
export interface ServerProblem {
  at: string;
  agentId: string;
  /** `offline`: the server went away; `error` / `warn`: a line the bridge reported. */
  kind: 'offline' | 'error' | 'warn';
  text: string;
}

/** Problems kept (newest first). */
export const PROBLEMS_MAX = 30;

/**
 * Recent problems of the game servers for the administration's start page (decision 319):
 * warnings and errors the bridges report (`agent.log`) and servers that went offline. Kept in
 * memory only - the log file has the full story; the page says "since the last restart".
 */
@Injectable()
export class ServerProblems {
  private readonly items: ServerProblem[] = [];

  constructor(
    @Inject(AgentConnections) connections: AgentConnections,
    @Inject(CLOCK) private readonly clock: ApiClock,
  ) {
    connections.onChange((agentId, online) => {
      if (!online) this.add(agentId, 'offline', '');
    });
  }

  add(agentId: string, kind: ServerProblem['kind'], text: string): void {
    this.items.unshift({
      at: new Date(this.clock.now()).toISOString(),
      agentId,
      kind,
      text: text.slice(0, 300),
    });
    this.items.length = Math.min(this.items.length, PROBLEMS_MAX);
  }

  list(): readonly ServerProblem[] {
    return this.items;
  }
}
