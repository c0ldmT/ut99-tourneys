import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { AdminOnly } from '../auth/guard.js';
import { ZodPipe } from '../common/http.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { RatingSettingsSchema, SettingsService, type RatingSettings } from './settings.service.js';

/** Website settings (admins). */
@AdminOnly()
@Controller('settings')
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
  ) {}

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
}
