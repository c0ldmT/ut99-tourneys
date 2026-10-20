import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { conflict, ZodPipe } from '../common/http.js';
import { AdminOnly } from '../auth/guard.js';
import { AgentsService } from './agents.service.js';
import { AgentConnections } from './connections.js';

const CreateAgentBody = z.object({
  id: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(64),
});

@AdminOnly()
@Controller('agents')
export class AgentsController {
  constructor(
    @Inject(AgentsService) private readonly agents: AgentsService,
    @Inject(AgentConnections) private readonly connections: AgentConnections,
  ) {}

  @Get()
  list() {
    return this.agents.list().map((a) => this.agents.view(a));
  }

  /** The token is shown only in this response. */
  @Post()
  create(@Body(new ZodPipe(CreateAgentBody)) body: z.infer<typeof CreateAgentBody>) {
    const { agent, token } = this.agents.create(body.id, body.name);
    return { agent: this.agents.view(agent), token };
  }

  @Post(':id/token')
  @HttpCode(200)
  rotate(@Param('id') id: string) {
    return { token: this.agents.rotateToken(id) };
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    this.agents.remove(id);
  }

  @Post(':id/profiles/:profileId/rescan')
  @HttpCode(204)
  async rescan(@Param('id') id: string, @Param('profileId') profileId: string) {
    this.agents.require(id);
    if (!this.connections.isOnline(id)) throw conflict('agent {id} is offline', { id });
    await this.connections.command(id, { kind: 'inventory.rescan', profileId }, 120_000);
  }
}
