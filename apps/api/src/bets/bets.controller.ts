import { Body, Controller, Delete, Get, Inject, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/guard.js';
import type { User } from '../auth/users.service.js';
import { ZodPipe } from '../common/http.js';
import { BET_KINDS } from './betting.js';
import { BetsService } from './bets.service.js';

const BetBody = z.object({
  pick: z.string().min(1).max(64),
  amount: z.number().int().min(1).max(100_000_000),
  kind: z.enum(BET_KINDS).optional(),
});
const SeasonQuery = z.object({ season: z.coerce.number().int().min(1).optional() });

/** Betting with Neuro (any logged-in user). */
@Controller('bets')
export class BetsController {
  constructor(@Inject(BetsService) private readonly bets: BetsService) {}

  @Get('tournaments/:id')
  tournament(@Param('id') id: string, @CurrentUser() user: User) {
    return this.bets.tournamentView(id, user.id);
  }

  @Put('tournaments/:id/:matchId')
  place(
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @Body(new ZodPipe(BetBody)) body: z.infer<typeof BetBody>,
    @CurrentUser() user: User,
  ) {
    return this.bets.place(id, matchId, user.id, body);
  }

  @Delete('tournaments/:id/:matchId')
  withdraw(@Param('id') id: string, @Param('matchId') matchId: string, @CurrentUser() user: User) {
    return this.bets.withdraw(id, matchId, user.id);
  }

  @Get('leaderboard')
  leaderboard(@Query(new ZodPipe(SeasonQuery)) q: z.infer<typeof SeasonQuery>) {
    return this.bets.leaderboard(q.season);
  }

  @Get('records')
  records(@Query(new ZodPipe(SeasonQuery)) q: z.infer<typeof SeasonQuery>) {
    return this.bets.records(q.season);
  }

  @Get('bots/:botId')
  bot(
    @Param('botId') botId: string,
    @Query(new ZodPipe(SeasonQuery)) q: z.infer<typeof SeasonQuery>,
  ) {
    return this.bets.botView(botId, q.season);
  }

  @Get('users/:userId')
  user(
    @Param('userId') userId: string,
    @Query(new ZodPipe(SeasonQuery)) q: z.infer<typeof SeasonQuery>,
  ) {
    return this.bets.userView(userId, q.season);
  }
}
