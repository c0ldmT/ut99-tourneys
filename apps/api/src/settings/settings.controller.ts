import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { AdminOnly } from '../auth/guard.js';
import { ZodPipe } from '../common/http.js';
import { RatingSettingsSchema, SettingsService, type RatingSettings } from './settings.service.js';

/** Website settings (admins). */
@AdminOnly()
@Controller('settings')
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Put('rating')
  rating(@Body(new ZodPipe(RatingSettingsSchema.partial())) body: Partial<RatingSettings>) {
    return this.settings.setRating(body);
  }
}
