import { Body, Controller, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/guard.js';
import { ZodPipe } from '../common/http.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { TournamentsService } from '../tournaments/tournaments.service.js';
import {
  RatingSettingsSchema,
  SettingsService,
  TeamNamesSchema,
  type RatingSettings,
} from './settings.service.js';

/** Website settings (admins). */
@AdminOnly()
@Controller('settings')
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
  ) {}

  /**
   * Deletes all tournaments, statistics and seasons for good. The body must carry the word
   * RESET (typed by the admin), so that no stray request can do it.
   */
  @Post('reset')
  @HttpCode(200)
  reset(@Body(new ZodPipe(z.object({ confirm: z.literal('RESET') }))) _body: { confirm: 'RESET' }) {
    return this.tournaments.resetAll();
  }

  @Get()
  get() {
    return this.settings.get();
  }

  @Put('rating')
  rating(@Body(new ZodPipe(RatingSettingsSchema.partial())) body: Partial<RatingSettings>) {
    const next = this.settings.setRating(body);
    // The running and the planned season use the new settings; ended seasons keep theirs.
    this.seasons.applyRating(next.rating);
    return next;
  }

  /** Names for teams made of bots only. */
  @Put('team-names')
  teamNames(@Body(new ZodPipe(z.object({ names: TeamNamesSchema }))) body: { names: string[] }) {
    return this.settings.setTeamNames(body.names);
  }
}
