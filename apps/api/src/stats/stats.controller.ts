import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { notFound, ZodPipe } from '../common/http.js';
import { StatsService } from './stats.service.js';

const ModeQuery = z.object({
  mode: z.enum(['dm', 'tdm', 'mh']).optional(),
  bots: z.enum(['0', '1']).optional(),
});
type ModeQuery = z.infer<typeof ModeQuery>;

/** Statistics page (any logged-in user). */
@Controller('stats')
export class StatsController {
  constructor(@Inject(StatsService) private readonly stats: StatsService) {}

  @Get('players')
  players(@Query(new ZodPipe(ModeQuery)) q: ModeQuery) {
    return this.stats.players(q.mode, q.bots === '1');
  }

  @Get('players/:key')
  player(@Param('key') key: string) {
    const d = this.stats.player(key);
    if (!d) throw notFound(`player ${key}`);
    return d;
  }

  @Get('ratings')
  ratings(@Query(new ZodPipe(ModeQuery)) q: ModeQuery) {
    return this.stats.ratingList(q.mode ?? 'dm', q.bots !== '0');
  }

  @Get('players/:key/ratings')
  playerRatings(@Param('key') key: string) {
    return this.stats.playerRatings(key);
  }

  @Get('records')
  records(@Query(new ZodPipe(ModeQuery)) q: ModeQuery) {
    return this.stats.records(q.mode);
  }
}
