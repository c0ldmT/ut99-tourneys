import { Body, Controller, Get, Inject, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/guard.js';
import type { User } from '../auth/users.service.js';
import { ZodPipe } from '../common/http.js';
import {
  LineupBody,
  TeamBody,
  UdtService,
  type LineupInput,
  type TeamInput,
} from './udt.service.js';

/** Unreal Dream Team: a manager's team, roster and lineups. */
@Controller('udt')
export class UdtController {
  constructor(@Inject(UdtService) private readonly udt: UdtService) {}

  @Get()
  view(@CurrentUser() user: User) {
    return this.udt.view(user);
  }

  /** All teams of the running season. */
  @Get('teams')
  teams() {
    this.udt.assertOn();
    return this.udt.teams(this.udt.season().number);
  }

  @Post('team')
  createTeam(@CurrentUser() user: User, @Body(new ZodPipe(TeamBody)) body: TeamInput) {
    this.udt.createTeam(user, body);
    return this.udt.view(user);
  }

  @Put('lineup')
  lineup(@CurrentUser() user: User, @Body(new ZodPipe(LineupBody)) body: LineupInput) {
    return this.udt.setLineup(user, body);
  }
}
