import { rescueTarget } from '../bets/betting.js';
import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../auth/guard.js';
import type { User } from '../auth/users.service.js';
import { BetsService } from '../bets/bets.service.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { ServerActivity, type ActivityState } from '../common/activity.js';
import { NeuroHub } from './neuro-hub.js';

/** The own Neuro: one snapshot for every display (navbar, bets, shop, Dream Team) and a push. */
@Controller('me')
export class NeuroController {
  constructor(
    @Inject(BetsService) private readonly bets: BetsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(NeuroHub) private readonly hub: NeuroHub,
    @Inject(ServerActivity) private readonly activity: ServerActivity,
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
        rescueTo: 0,
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
      // What a rescue tops up to: the floor minus Neuro in Dream Team bots (a debt: none).
      rescueTo: w.balance < 0 ? 0 : rescueTarget(floor, w.invested),
      spendable: current ? Math.max(0, w.free - floor) : 0,
    };
  }

  /**
   * Server-sent events: `neuro` whenever the own Neuro may have changed (fetch `me/neuro`);
   * `activity` with what the server works on (at the start and on every change, decision 227).
   */
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
    const activity = (s: ActivityState) =>
      res.write(`event: activity\ndata: ${JSON.stringify(s)}\n\n`);
    activity(this.activity.state());
    const unsubscribeActivity = this.activity.subscribe(activity);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      unsubscribeActivity();
    });
  }
}
