import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { notFound, ZodPipe } from '../common/http.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { StatsService, type StatScope } from './stats.service.js';

const Query_ = z.object({
  mode: z.enum(['dm', 'tdm', 'mh']).optional(),
  bots: z.enum(['0', '1']).optional(),
  /** "lifetime" or a season number; default: the running season, else the last one. */
  season: z.union([z.literal('lifetime'), z.coerce.number().int().min(1)]).optional(),
});
type Query_ = z.infer<typeof Query_>;

/** Statistics page (any logged-in user). */
@Controller('stats')
export class StatsController {
  constructor(
    @Inject(StatsService) private readonly stats: StatsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
  ) {}

  /** The season to show when none is asked for (undefined: there is none yet). */
  private defaultSeason(): number | undefined {
    return (this.seasons.current() ?? this.seasons.latestStarted())?.number;
  }

  private scope(q: Query_): StatScope {
    return q.season ?? this.defaultSeason() ?? 'lifetime';
  }

  @Get('players')
  players(@Query(new ZodPipe(Query_)) q: Query_) {
    return this.stats.players(this.scope(q), q.mode, q.bots === '1');
  }

  @Get('players/:key')
  player(@Param('key') key: string, @Query(new ZodPipe(Query_)) q: Query_) {
    const d = this.stats.player(key, this.scope(q));
    if (!d) throw notFound(`player ${key}`);
    return d;
  }

  /** Ratings exist per season only. */
  @Get('ratings')
  ratings(@Query(new ZodPipe(Query_)) q: Query_) {
    const season = q.season === 'lifetime' ? undefined : (q.season ?? this.defaultSeason());
    if (season === undefined) return [];
    return this.stats.ratingList(season, q.mode ?? 'dm', q.bots !== '0');
  }

  @Get('players/:key/ratings')
  playerRatings(@Param('key') key: string, @Query(new ZodPipe(Query_)) q: Query_) {
    const season = q.season === 'lifetime' ? undefined : (q.season ?? this.defaultSeason());
    if (season === undefined) return { modes: {}, recent: [] };
    return this.stats.playerRatings(key, season);
  }

  /** Records belong to seasons; lifetime has none. */
  @Get('records')
  records(@Query(new ZodPipe(Query_)) q: Query_) {
    const season = q.season === 'lifetime' ? undefined : (q.season ?? this.defaultSeason());
    if (season === undefined) return { records: [], maps: [] };
    return this.stats.records(season, q.mode);
  }
}
