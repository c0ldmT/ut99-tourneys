import { Controller, Get, Inject, Query } from '@nestjs/common';
import type { z } from 'zod';
import { CurrentUser } from '../auth/guard.js';
import type { User } from '../auth/users.service.js';
import { ZodPipe } from '../common/http.js';
import { CalendarQuery, CalendarService } from './calendar.service.js';

/** The calendar for every player (decision 231). */
@Controller('calendar')
export class CalendarController {
  constructor(@Inject(CalendarService) private readonly calendar: CalendarService) {}

  @Get()
  view(
    @CurrentUser() user: User,
    @Query(new ZodPipe(CalendarQuery)) q: z.infer<typeof CalendarQuery>,
  ) {
    return this.calendar.view(user, q);
  }
}
