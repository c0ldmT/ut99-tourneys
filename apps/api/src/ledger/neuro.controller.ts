import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/guard.js';
import type { User } from '../auth/users.service.js';
import { BetsService } from '../bets/bets.service.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { NeuroHub } from './neuro-hub.js';

/** The own Neuro: one snapshot for every display (navbar, bets, shop, Dream Team) and a push. */
@Controller('me')
export class NeuroController {
  constructor(
    @Inject(BetsService) private readonly bets: BetsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(NeuroHub) private readonly hub: NeuroHub,
  ) {}

  /**
   * The wallet of the running season (out of season the last one, nothing to spend): balance,
   * staked in open bets, free to stake, the rescue floor and what can be spent above it.
   */
  @Get('neuro')
  neuro(@CurrentUser() user: User) {
    const current = this.seasons.current();
    const season = current ?? this.seasons.latestStarted();
    if (!season)
      return {
        season: null,
        running: false,
        balance: 0,
        staked: 0,
        free: 0,
        floor: 0,
        spendable: 0,
      };
    const w = this.bets.wallet(user.id, season);
    const floor = season.betting.floor;
    return {
      season: season.number,
      running: Boolean(current),
      balance: w.balance,
      staked: w.staked,
      free: w.free,
      floor,
      spendable: current ? Math.max(0, w.free - floor) : 0,
    };
  }

  /** Server-sent events: `neuro` whenever the own Neuro may have changed (fetch `me/neuro`). */
  @Get('stream')
  stream(@CurrentUser() user: User, @Req() req: Request, @Res() res: Response) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    const unsubscribe = this.hub.subscribe(user.id, () => res.write('event: neuro\ndata: {}\n\n'));
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}
