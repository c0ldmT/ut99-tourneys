import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { z } from 'zod';
import { AdminOnly, CurrentUser } from '../auth/guard.js';
import type { User } from '../auth/users.service.js';
import { ZodPipe } from '../common/http.js';
import { CreateSeriesBody, SeriesService, UpdateSeriesBody } from './series.service.js';

/** Tournament series (admins): weekly templates that create tournaments by themselves. */
@AdminOnly()
@Controller('series')
export class SeriesController {
  constructor(@Inject(SeriesService) private readonly series: SeriesService) {}

  @Get()
  list() {
    return this.series.list();
  }

  @Post()
  create(
    @CurrentUser() user: User,
    @Body(new ZodPipe(CreateSeriesBody)) body: z.infer<typeof CreateSeriesBody>,
  ) {
    return this.series.create(body, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodPipe(UpdateSeriesBody)) body: z.infer<typeof UpdateSeriesBody>,
  ) {
    return this.series.update(id, body);
  }

  @Post(':id/run')
  @HttpCode(200)
  run(@Param('id') id: string) {
    return this.series.runNow(id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    this.series.remove(id);
  }
}
