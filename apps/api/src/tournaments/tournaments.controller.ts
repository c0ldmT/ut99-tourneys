import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodPipe } from '../common/http.js';
import { AdminOnly, CurrentUser } from '../auth/guard.js';
import type { User } from '../auth/users.service.js';
import { LiveHub, type HubMessage } from './hub.js';
import {
  CommandBody,
  CreateTournamentBody,
  SeedBody,
  TournamentsService,
  UpdateTournamentBody,
  type Command,
  type CreateTournament,
  type Seed,
  type UpdateTournament,
} from './tournaments.service.js';

@Controller('tournaments')
export class TournamentsController {
  constructor(
    @Inject(TournamentsService) private readonly svc: TournamentsService,
    @Inject(LiveHub) private readonly hub: LiveHub,
  ) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.svc.list(user);
  }

  @AdminOnly()
  @Post()
  create(
    @CurrentUser() user: User,
    @Body(new ZodPipe(CreateTournamentBody)) body: CreateTournament,
  ) {
    const t = this.svc.create(body, user);
    return this.svc.detail(t.id, user);
  }

  @Get(':id')
  detail(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.detail(id, user);
  }

  @AdminOnly()
  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(UpdateTournamentBody)) body: UpdateTournament,
  ) {
    this.svc.update(id, body);
    return this.svc.detail(id, user);
  }

  @AdminOnly()
  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    this.svc.remove(id);
  }

  @AdminOnly()
  @Get(':id/events')
  events(@Param('id') id: string) {
    return this.svc.events(id);
  }

  @Post(':id/registration')
  @HttpCode(204)
  register(@CurrentUser() user: User, @Param('id') id: string) {
    this.svc.register(id, user);
  }

  @Delete(':id/registration')
  @HttpCode(204)
  unregister(@CurrentUser() user: User, @Param('id') id: string) {
    this.svc.unregister(id, user.id);
  }

  /** Admin: remove a registered player. */
  @AdminOnly()
  @Delete(':id/registrations/:userId')
  @HttpCode(204)
  kick(@Param('id') id: string, @Param('userId') userId: string) {
    this.svc.unregister(id, userId);
  }

  @Post(':id/watch')
  @HttpCode(204)
  async watch(@CurrentUser() user: User, @Param('id') id: string) {
    await this.svc.watch(id, user);
  }

  @Delete(':id/watch')
  @HttpCode(204)
  async unwatch(@CurrentUser() user: User, @Param('id') id: string) {
    await this.svc.unwatch(id, user.id);
  }

  @AdminOnly()
  @Post(':id/seed')
  @HttpCode(200)
  seed(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(SeedBody)) body: Seed,
  ) {
    this.svc.seed(id, body, user);
    return this.svc.detail(id, user);
  }

  @AdminOnly()
  @Post(':id/reset')
  @HttpCode(200)
  reset(@CurrentUser() user: User, @Param('id') id: string) {
    this.svc.resetToDraft(id);
    return this.svc.detail(id, user);
  }

  @AdminOnly()
  @Post(':id/run')
  @HttpCode(204)
  async run(@Param('id') id: string) {
    await this.svc.run(id);
  }

  @AdminOnly()
  @Post(':id/command')
  @HttpCode(204)
  async command(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body(new ZodPipe(CommandBody)) body: Command,
  ) {
    await this.svc.command(id, body, user);
  }

  /** Server-sent events: "change" (refetch the detail) and "live" (match telemetry). */
  @Get(':id/stream')
  stream(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    this.svc.require(id);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (msg: HubMessage) => {
      res.write(
        `event: ${msg.type}\ndata: ${JSON.stringify(msg.type === 'live' ? msg.data : msg)}\n\n`,
      );
    };
    res.write(': connected\n\n');
    const unsubscribe = this.hub.subscribe(id, send);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}
