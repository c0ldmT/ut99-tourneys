import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/guard.js';
import type { User } from '../auth/users.service.js';
import { ZodPipe } from '../common/http.js';
import { UdtEventsService } from './udt-events.service.js';
import { UdtRewardsService } from './udt-rewards.service.js';
import { BidBody, UdtMarketService, type BidInput } from './udt-market.service.js';
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
  constructor(
    @Inject(UdtService) private readonly udt: UdtService,
    @Inject(UdtMarketService) private readonly market: UdtMarketService,
    @Inject(UdtEventsService) private readonly events: UdtEventsService,
    @Inject(UdtRewardsService) private readonly rewards: UdtRewardsService,
  ) {}

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

  /** Today's offers (values, last 14 days), the manager's hidden bids, the next market day. */
  @Get('market')
  marketView(@CurrentUser() user: User) {
    return this.market.view(user);
  }

  @Post('market/bid')
  @HttpCode(200)
  bid(@CurrentUser() user: User, @Body(new ZodPipe(BidBody)) body: BidInput) {
    return this.market.bid(user, body);
  }

  @Delete('market/bid/:botId')
  withdraw(@CurrentUser() user: User, @Param('botId') botId: string) {
    return this.market.withdraw(user, botId);
  }

  /** Sells a roster bot to the market (85 % of its value). */
  @Post('roster/:botId/sell')
  @HttpCode(200)
  sell(@CurrentUser() user: User, @Param('botId') botId: string) {
    return this.market.sell(user, botId);
  }

  /** Dream Team tournaments with the manager's sign-up and what lineup would play. */
  @Get('events')
  eventList(@CurrentUser() user: User) {
    return this.events.events(user);
  }

  @Post('events/:id/enter')
  @HttpCode(200)
  enter(@CurrentUser() user: User, @Param('id') id: string) {
    return this.events.enter(user, id);
  }

  @Delete('events/:id/enter')
  leave(@CurrentUser() user: User, @Param('id') id: string) {
    return this.events.leave(user, id);
  }

  /** Season table: points from the places of finished Dream Team tournaments. */
  @Get('table')
  table() {
    this.udt.assertOn();
    return this.rewards.table(this.udt.season().number);
  }

  /** The manager's ledger bookings of the season (newest first). */
  @Get('ledger')
  ledgerEntries(@CurrentUser() user: User) {
    this.udt.assertOn();
    return this.udt.ledgerOf(user.id);
  }
}
