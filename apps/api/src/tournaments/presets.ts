import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Post,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AdminOnly, CurrentUser } from '../auth/guard.js';
import type { User } from '../auth/users.service.js';
import { conflict, notFound, ZodPipe } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { nameKey } from '../common/names.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { tournamentPresets } from '../db/schema.js';
import { TemplateBody } from '../series/series.service.js';

/** Presets an admin keeps at most. */
export const MAX_PRESETS = 20;

/** A preset: a name and the form's template (server, tempo, settings, Discord, Dream Team). */
export const PresetBody = z.object({
  name: z.string().trim().min(1).max(40),
  /**
   * The bots are always the control center's: a preset has none. Server and profile may be
   * empty (none set up yet); the form falls back to an online server when applying.
   */
  body: TemplateBody.omit({ botPool: true }).extend({
    agentId: z.string().max(64),
    profileId: z.string().max(64),
  }),
  /** Overwrite the admin's preset of the same name. */
  replace: z.boolean().optional(),
});
export type PresetInput = z.infer<typeof PresetBody>;

export interface PresetView {
  id: string;
  name: string;
  body: z.infer<typeof PresetBody>['body'];
  createdAt: string;
  updatedAt: string;
}

/**
 * Tournament presets (decision 325): every admin keeps up to MAX_PRESETS named sets of the
 * tournament form's settings for themselves; the form applies one and keeps name and date.
 */
@Injectable()
export class PresetsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
  ) {}

  list(user: User): PresetView[] {
    return this.db
      .select()
      .from(tournamentPresets)
      .where(eq(tournamentPresets.userId, user.id))
      .all()
      .map((r) => ({
        id: r.id,
        name: r.name,
        body: JSON.parse(r.bodyJson) as PresetView['body'],
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  save(user: User, input: PresetInput): PresetView[] {
    const now = new Date(this.clock.now()).toISOString();
    const key = nameKey(input.name);
    const same = this.db
      .select({ id: tournamentPresets.id })
      .from(tournamentPresets)
      .where(and(eq(tournamentPresets.userId, user.id), eq(tournamentPresets.nameKey, key)))
      .get();
    const body = JSON.stringify(input.body);
    if (same) {
      if (!input.replace)
        throw conflict('a preset named {name} already exists', { name: input.name });
      this.db
        .update(tournamentPresets)
        .set({ name: input.name, bodyJson: body, updatedAt: now })
        .where(eq(tournamentPresets.id, same.id))
        .run();
    } else {
      const n =
        this.db
          .select({ n: sql<number>`count(*)` })
          .from(tournamentPresets)
          .where(eq(tournamentPresets.userId, user.id))
          .get()?.n ?? 0;
      if (n >= MAX_PRESETS) throw conflict('at most {n} presets', { n: MAX_PRESETS });
      this.db
        .insert(tournamentPresets)
        .values({
          id: `p${randomId(12)}`,
          userId: user.id,
          name: input.name,
          nameKey: key,
          bodyJson: body,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    return this.list(user);
  }

  remove(user: User, id: string): void {
    const r = this.db
      .delete(tournamentPresets)
      .where(and(eq(tournamentPresets.id, id), eq(tournamentPresets.userId, user.id)))
      .run();
    if (!r.changes) throw notFound('preset');
  }
}

/** The admin's own presets of the tournament form (decision 325). */
@AdminOnly()
@Controller('tournament-presets')
export class PresetsController {
  constructor(@Inject(PresetsService) private readonly presets: PresetsService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.presets.list(user);
  }

  @Post()
  @HttpCode(200)
  save(@CurrentUser() user: User, @Body(new ZodPipe(PresetBody)) body: PresetInput) {
    return this.presets.save(user, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    this.presets.remove(user, id);
  }
}
