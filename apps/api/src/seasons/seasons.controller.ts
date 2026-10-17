import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly } from '../auth/guard.js';
import { ZodPipe } from '../common/http.js';
import { SeasonsService } from './seasons.service.js';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CreateSeasonBody = z.object({ startDate: Day, endDate: Day });
const UpdateSeasonBody = z.object({ startDate: Day.optional(), endDate: Day.optional() });

/** Seasons: everybody sees them, admins run them (page "Settings"). */
@Controller('seasons')
export class SeasonsController {
  constructor(@Inject(SeasonsService) private readonly seasons: SeasonsService) {}

  @Get()
  overview() {
    return this.seasons.overview();
  }

  @AdminOnly()
  @Post()
  create(@Body(new ZodPipe(CreateSeasonBody)) body: z.infer<typeof CreateSeasonBody>) {
    return this.seasons.view(this.seasons.create(body));
  }

  @AdminOnly()
  @Patch(':n')
  update(
    @Param('n', ParseIntPipe) n: number,
    @Body(new ZodPipe(UpdateSeasonBody)) body: z.infer<typeof UpdateSeasonBody>,
  ) {
    return this.seasons.view(this.seasons.update(n, body));
  }

  @AdminOnly()
  @Post(':n/end')
  @HttpCode(200)
  end(@Param('n', ParseIntPipe) n: number) {
    return this.seasons.view(this.seasons.endNow(n));
  }

  @AdminOnly()
  @Delete(':n')
  @HttpCode(204)
  remove(@Param('n', ParseIntPipe) n: number) {
    this.seasons.remove(n);
  }
}
