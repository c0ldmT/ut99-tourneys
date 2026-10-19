import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { TournamentSettingsSchema } from '@tourney/protocol';
import { UsersService } from '../auth/users.service.js';
import { badRequest, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { series, tournaments } from '../db/schema.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { today } from '../seasons/season-time.js';
import {
  CreateTournamentBody,
  TournamentsService,
  type CreateTournament,
} from '../tournaments/tournaments.service.js';
import { firstDate, nextStart, seriesName } from './series-time.js';

type SeriesRow = typeof series.$inferSelect;
type Template = Omit<CreateTournament, 'name' | 'scheduledAt' | 'id'>;

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const SeriesFields = z.object({
  name: z.string().trim().min(1).max(90),
  weekday: z.number().int().min(1).max(7),
  time: Time,
  everyWeeks: z.number().int().min(1).max(8).default(1),
  leadDays: z.number().int().min(0).max(28).default(7),
});
/** What every tournament of a series gets (server, settings, bots, Discord, season). */
export const TemplateBody = CreateTournamentBody.omit({ id: true, name: true, scheduledAt: true });
export const CreateSeriesBody = SeriesFields.extend({
  /** The tournament whose settings, server and bots the series copies … */
  fromTournament: z.string().min(1).max(64).optional(),
  /** … or the settings themselves (the form "New tournament"). */
  template: TemplateBody.optional(),
}).refine((b) => !!b.fromTournament !== !!b.template, 'either fromTournament or template');
export const UpdateSeriesBody = SeriesFields.partial().extend({
  active: z.boolean().optional(),
  template: TemplateBody.optional(),
});

/**
 * Tournament series: a template that creates the next tournament of the series a few days
 * before its start (registration open, so the Discord channel announces it).
 */
@Injectable()
export class SeriesService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(LOGGER) private readonly log: ApiLogger,
    @Inject(SeasonsService) private readonly seasons: SeasonsService,
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(TournamentsService) private readonly tournaments: TournamentsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.tick(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private get tz(): string {
    return this.seasons.timeZone;
  }

  private row(id: string): SeriesRow {
    const r = this.db.select().from(series).where(eq(series.id, id)).get();
    if (!r) throw notFound(`series ${id}`);
    return r;
  }

  /** The next start and when its tournament is created. */
  private next(r: SeriesRow): { start: number; createAt: number } {
    const after = r.lastStart ? Date.parse(r.lastStart) : this.clock.now();
    const start = nextStart(r, after, this.tz);
    return { start, createAt: start - r.leadDays * 86_400_000 };
  }

  view(r: SeriesRow) {
    const n = this.next(r);
    const t = JSON.parse(r.templateJson) as Template;
    const created = this.db
      .select({ id: tournaments.id, name: tournaments.name, phase: tournaments.phase })
      .from(tournaments)
      .where(eq(tournaments.seriesId, r.id))
      .all();
    return {
      id: r.id,
      name: r.name,
      weekday: r.weekday,
      time: r.time,
      everyWeeks: r.everyWeeks,
      leadDays: r.leadDays,
      active: r.active,
      nextNumber: r.nextNumber,
      nextStart: new Date(n.start).toISOString(),
      nextCreateAt: new Date(n.createAt).toISOString(),
      nextName: seriesName(r.name, r.nextNumber, n.start, this.tz),
      lastStart: r.lastStart,
      settings: t.settings,
      template: t,
      tournaments: created.length,
      timeZone: this.tz,
    };
  }

  list() {
    return this.db
      .select()
      .from(series)
      .all()
      .map((r) => this.view(r));
  }

  /** A copy of a tournament's server, settings, bots and channel. */
  private templateOf(id: string): Template {
    const t = this.db.select().from(tournaments).where(eq(tournaments.id, id)).get();
    if (!t) throw notFound(`tournament ${id}`);
    return {
      agentId: t.agentId,
      profileId: t.profileId,
      connectAddress: t.connectAddress,
      settings: TournamentSettingsSchema.parse(JSON.parse(t.settingsJson)),
      // A control-center tournament: the series follows the control center too.
      botPool: t.botsFromLibrary ? [] : JSON.parse(t.botPoolJson),
      registrationOpen: true,
      notifyMode: t.notifyMode as 'default' | 'custom' | 'off',
      webhookUrl: t.webhookUrl,
      seasonal: t.seasonal,
    };
  }

  create(body: z.infer<typeof CreateSeriesBody>, by: { id: string }) {
    const template: Template = body.template
      ? { ...body.template, registrationOpen: true }
      : this.templateOf(body.fromTournament!);
    this.tournaments.checkTemplate(template);
    const id = `s${randomId(10)}`;
    this.db
      .insert(series)
      .values({
        id,
        name: body.name,
        templateJson: JSON.stringify(template),
        weekday: body.weekday,
        time: body.time,
        everyWeeks: body.everyWeeks,
        leadDays: body.leadDays,
        anchorDate: firstDate(today(this.clock.now(), this.tz), body.weekday),
        createdBy: by.id,
        createdAt: new Date(this.clock.now()).toISOString(),
      })
      .run();
    this.log.info(
      `series ${body.name} created${body.fromTournament ? ` from ${body.fromTournament}` : ''}`,
    );
    this.tick();
    return this.view(this.row(id));
  }

  update(id: string, body: z.infer<typeof UpdateSeriesBody>) {
    const r = this.row(id);
    const patch: Partial<SeriesRow> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.time !== undefined) patch.time = body.time;
    if (body.everyWeeks !== undefined) patch.everyWeeks = body.everyWeeks;
    if (body.leadDays !== undefined) patch.leadDays = body.leadDays;
    if (body.active !== undefined) patch.active = body.active;
    if (body.template) {
      const template: Template = { ...body.template, registrationOpen: true };
      this.tournaments.checkTemplate(template);
      patch.templateJson = JSON.stringify(template);
    }
    if (body.weekday !== undefined && body.weekday !== r.weekday) {
      patch.weekday = body.weekday;
      patch.anchorDate = firstDate(today(this.clock.now(), this.tz), body.weekday);
    }
    if (body.everyWeeks !== undefined && body.everyWeeks !== r.everyWeeks && !patch.anchorDate)
      // The rhythm counts from the next start.
      patch.anchorDate = today(this.next(r).start, this.tz);
    if (Object.keys(patch).length) this.db.update(series).set(patch).where(eq(series.id, id)).run();
    this.tick();
    return this.view(this.row(id));
  }

  remove(id: string) {
    this.row(id);
    this.db.delete(series).where(eq(series.id, id)).run();
  }

  /** Creates the next tournament now (the start stays as scheduled). */
  runNow(id: string) {
    const r = this.row(id);
    this.createNext(r, this.next(r).start);
    return this.view(this.row(id));
  }

  /** Every minute: creates the tournaments whose time has come. */
  tick(): void {
    const now = this.clock.now();
    for (const r of this.db.select().from(series).where(eq(series.active, true)).all()) {
      try {
        const n = this.next(r);
        if (now >= n.createAt) this.createNext(r, n.start);
      } catch (e) {
        this.log.warn(`series ${r.name}: ${(e as Error).message}`);
      }
    }
  }

  private createNext(r: SeriesRow, start: number): void {
    const t = JSON.parse(r.templateJson) as Template;
    const by = this.users.byId(r.createdBy) ?? this.users.list().find((u) => u.isAdmin);
    if (!by) throw badRequest('no admin to create the tournament');
    const name = seriesName(r.name, r.nextNumber, start, this.tz);
    const row = this.tournaments.create(
      {
        ...t,
        name,
        scheduledAt: new Date(start).toISOString(),
        registrationOpen: true,
        // A season tournament only while a season runs.
        seasonal: !!t.seasonal && !!this.seasons.current(),
      },
      by,
      { seriesId: r.id },
    );
    this.db
      .update(series)
      .set({ lastStart: new Date(start).toISOString(), nextNumber: r.nextNumber + 1 })
      .where(eq(series.id, r.id))
      .run();
    this.log.info(`series ${r.name}: created ${row.id} for ${new Date(start).toISOString()}`);
  }
}
