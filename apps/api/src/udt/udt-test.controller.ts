import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { AdminOnly, CurrentUser } from '../auth/guard.js';
import type { User } from '../auth/users.service.js';
import { ZodPipe } from '../common/http.js';
import { AdvanceBody, ManagersBody, UdtTestService } from './udt-test.service.js';

/** Dream Team test mode (TEST_MODE=1 only, admins): time, market days, simulation, managers. */
@AdminOnly()
@Controller('udt/test')
export class UdtTestController {
  constructor(@Inject(UdtTestService) private readonly test: UdtTestService) {}

  @Get()
  state() {
    return this.test.state();
  }

  @Post('advance')
  @HttpCode(200)
  advance(@Body(new ZodPipe(AdvanceBody)) body: { hours: number }) {
    return this.test.advance(body.hours);
  }

  @Post('market-day')
  @HttpCode(200)
  marketDay() {
    return this.test.marketDay();
  }

  @Post('season-end')
  @HttpCode(200)
  seasonEnd() {
    return this.test.endSeason();
  }

  @Post('league/day')
  @HttpCode(200)
  leagueDay(@CurrentUser() user: User) {
    return this.test.leagueDay(user);
  }

  @Post('league/end')
  @HttpCode(200)
  leagueEnd(@CurrentUser() user: User) {
    return this.test.leagueEnd(user);
  }

  @Post('simulate/:id')
  @HttpCode(200)
  simulate(@CurrentUser() user: User, @Param('id') id: string) {
    return this.test.simulate(id, user);
  }

  @Post('managers')
  @HttpCode(200)
  managers(@Body(new ZodPipe(ManagersBody)) body: { count: number }) {
    return this.test.createManagers(body.count);
  }

  @Post('managers/act')
  @HttpCode(200)
  act() {
    return this.test.act();
  }
}
