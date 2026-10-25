import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { TournamentSettingsSchema } from '@tourney/protocol';
import { UsersService } from '../auth/users.service.js';
import { badRequest, conflict, notFound } from '../common/http.js';
import { randomId } from '../common/ids.js';
import { LOGGER, type ApiLogger } from '../common/logger.js';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { series, tournaments } from '../db/schema.js';
import { SeasonsService } from '../seasons/seasons.service.js';
import { today } from '../seasons/season-time.js';
import {
  CreateTournamentBody,
  DONE_PHASES,
  TournamentsService,
  type CreateTournament,
} from '../tournaments/tournaments.service.js';
import {
  baseName,
  createTime,
  dayTimes,
  nextStarts,
  seriesName,
  type SeriesSchedule,
} from './series-time.js';

type SeriesRow = typeof series.$inferSelect;
type Template = Omit<CreateTournament, 'name' | 'scheduledAt' | 'id'>;

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** A series starts at most 24 tournaments a day. */
const MAX_TIMES = 24;
const ScheduleFields = z.object({
  /** ISO weekdays 1 (Monday) .. 7 (Sunday); all seven = daily. */
  days: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
  /** Fixed local start times … */
  times: z.array(Time).max(MAX_TIMES).optional(),
  /** … and/or every n hours from `from` to `to` (null: none). */
  every: z
    .object({ hours: z.number().int().min(1).max(12), from: Time, to: Time })
    .nullable()
    .optional(),
  everyWeeks: z.number().int().min(1).max(8).optional(),
  /** The tournament is created (and announced) this long before its start. */
  leadMinutes: z
    .number()
    .int()
    .min(0)
    .max(28 * 1440)
    .optional(),
  /** Older clients: one weekday and time, the lead time in days. */
  weekday: z.number().int().min(1).max(7).optional(),
  time: Time.optional(),
  leadDays: z.number().int().min(0).max(28).optional(),
});
export const SeriesFields = ScheduleFields.extend({ name: z.string().trim().min(1).max(90) });
/** What every tournament of a series gets (server, settings, bots, Discord, season, autostart). */
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
export const PreviewSeriesBody = ScheduleFields.extend({
  name: z.string().trim().max(90).optional(),
  /** Number of the next tournament (an existing series). */
  nextNumber: z.number().int().min(1).optional(),
});
type ScheduleInput = z.infer<typeof ScheduleFields>;

/** The stored schedule of a series (rows of older versions: their weekday and time). */
interface Schedule {
  days: number[];
  times: string[];
  every: { hours: number; from: string; to: string } | null;
}

/**
 * Tournament series: a template that creates the next tournament of the series some time
 * before its start (registration open, so the Discord channel announces it), on weekdays or
 * daily, at fixed times or every n hours.
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
    if (!r) throw notFound('series {id}', { id });
    return r;
  }

  private schedule(r: SeriesRow): Schedule {
    const s = r.scheduleJson ? (JSON.parse(r.scheduleJson) as Partial<Schedule>) : {};
    return {
      days: s.days?.length ? s.days : [r.weekday],
      times: s.times ?? (s.every ? [] : [r.time]),
      every: s.every ?? null,
    };
  }

  private timing(r: SeriesRow): SeriesSchedule {
    return { ...this.schedule(r), everyWeeks: r.everyWeeks, anchorDate: r.anchorDate };
  }

  /** The schedule of a body, on top of the current one (an update), checked. */
  private scheduleOf(b: ScheduleInput, current?: Schedule): Schedule {
    const days = b.days ?? (b.weekday ? [b.weekday] : current?.days);
    const times = b.times ?? (b.time ? [b.time] : b.every !== undefined ? [] : current?.times);
    const every =
      b.every !== undefined ? b.every : b.times || b.time ? null : (current?.every ?? null);
    if (!days?.length) throw badRequest('a series needs at least one weekday');
    const s: Schedule = { days: [...new Set(days)].sort(), times: times ?? [], every };
    const n = dayTimes(s).length;
    if (!n) throw badRequest('a series needs a start time or an hour interval');
    if (n > MAX_TIMES) throw badRequest('at most {max} tournaments a day', { max: MAX_TIMES });
    return s;
  }

  private leadOf(b: ScheduleInput): number | undefined {
    return b.leadMinutes ?? (b.leadDays !== undefined ? b.leadDays * 1440 : undefined);
  }

  /**
   * The next start and when its tournament is created. Starts that passed without a
   * tournament (the website was down) are skipped.
   */
  private next(r: SeriesRow): { start: number; createAt: number } {
    const now = this.clock.now();
    const after = Math.max(r.lastStart ? Date.parse(r.lastStart) : 0, now);
    const start = nextStarts(this.timing(r), after, this.tz, 1)[0] ?? NaN;
    return { start, createAt: createTime(start, r.leadMinutes, this.tz) };
  }

  view(r: SeriesRow) {
    const n = this.next(r);
    const t = JSON.parse(r.templateJson) as Template;
    const s = this.schedule(r);
    const created = this.db
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(eq(tournaments.seriesId, r.id))
      .all();
    const ok = Number.isFinite(n.start);
    return {
      id: r.id,
      name: r.name,
      days: s.days,
      times: s.times,
      every: s.every,
      everyWeeks: r.everyWeeks,
      leadMinutes: r.leadMinutes,
      autoStart: !!t.autoStart,
      active: r.active,
      nextNumber: r.nextNumber,
      nextStart: ok ? new Date(n.start).toISOString() : null,
      nextCreateAt: ok ? new Date(n.createAt).toISOString() : null,
      nextName: ok ? seriesName(r.name, r.nextNumber, n.start, this.tz) : null,
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

  /**
   * The series for everyone (the tournament overview): schedule, the next tournament, the last
   * results and counts. Active series, and paused ones with a tournament still to come; the next
   * start first.
   */
  overview() {
    const all = this.db.select().from(tournaments).where(isNotNull(tournaments.seriesId)).all();
    const at = (t: (typeof all)[number]) => t.scheduledAt ?? t.createdAt;
    const names = this.tournaments.botNames();
    const out = this.db
      .select()
      .from(series)
      .all()
      .map((r) => {
        const own = all.filter((t) => t.seriesId === r.id);
        const done = own
          .filter((t) => DONE_PHASES.includes(t.phase))
          .sort((a, b) => (at(a) < at(b) ? 1 : -1));
        const coming = own
          .filter((t) => !DONE_PHASES.includes(t.phase))
          .sort((a, b) => (at(a) < at(b) ? -1 : 1));
        if (!r.active && !coming.length) return null;
        const tpl = JSON.parse(r.templateJson) as Template;
        const set = TournamentSettingsSchema.parse(tpl.settings);
        const s = this.schedule(r);
        const n = this.next(r);
        const first = coming[0];
        const result = (t: (typeof all)[number]) => ({
          id: t.id,
          name: t.name,
          at: at(t),
          phase: t.phase,
          champion: this.tournaments.championName(t, names) ?? null,
        });
        return {
          id: r.id,
          name: baseName(r.name),
          active: r.active,
          days: s.days,
          times: s.times,
          every: s.every,
          everyWeeks: r.everyWeeks,
          kind: tpl.kind ?? 'standard',
          seasonal: tpl.kind === 'udt' || !!tpl.seasonal,
          game: set.game.adapter === 'ut99-mh' ? ('mh' as const) : ('dm' as const),
          teamSize: set.teamSize,
          size: set.size,
          finished: done.filter((t) => t.phase === 'finished').length,
          aborted: done.filter((t) => t.phase === 'aborted').length,
          /** The next tournament: created already (with its id), or the next start planned. */
          next: first
            ? { id: first.id, name: first.name, at: at(first) }
            : r.active && Number.isFinite(n.start)
              ? {
                  id: null,
                  name: seriesName(r.name, r.nextNumber, n.start, this.tz),
                  at: new Date(n.start).toISOString(),
                }
              : null,
          recent: done.slice(0, 5).map(result),
        };
      })
      .filter((x) => x !== null);
    return out.sort((a, b) => (a.next?.at ?? '~').localeCompare(b.next?.at ?? '~'));
  }

  /** The next starts of a schedule (the form shows them before saving). */
  preview(b: z.infer<typeof PreviewSeriesBody>) {
    const s = this.scheduleOf(b);
    const now = this.clock.now();
    const starts = nextStarts(
      { ...s, everyWeeks: b.everyWeeks ?? 1, anchorDate: today(now, this.tz) },
      now,
      this.tz,
      4,
    );
    const first = b.nextNumber ?? 1;
    return {
      timeZone: this.tz,
      perDay: dayTimes(s).length,
      next: starts.map((t, i) => ({
        start: new Date(t).toISOString(),
        name: b.name ? seriesName(b.name, first + i, t, this.tz) : null,
      })),
    };
  }

  /** A copy of a tournament's server, settings, bots and channel. */
  private templateOf(id: string): Template {
    const t = this.db.select().from(tournaments).where(eq(tournaments.id, id)).get();
    if (!t) throw notFound('tournament {id}', { id });
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
      autoStart: t.autoStart,
      kind: t.kind as 'standard' | 'udt',
      ...(t.kind === 'udt' && t.udtJson ? { udt: JSON.parse(t.udtJson) } : {}),
    };
  }

  create(body: z.infer<typeof CreateSeriesBody>, by: { id: string }) {
    const template: Template = body.template
      ? { ...body.template, registrationOpen: true }
      : this.templateOf(body.fromTournament!);
    this.tournaments.checkTemplate(template);
    const s = this.scheduleOf(body);
    const id = `s${randomId(10)}`;
    this.db
      .insert(series)
      .values({
        id,
        name: body.name,
        templateJson: JSON.stringify(template),
        weekday: s.days[0]!,
        time: dayTimes(s)[0]!,
        scheduleJson: JSON.stringify(s),
        everyWeeks: body.everyWeeks ?? 1,
        leadMinutes: this.leadOf(body) ?? 7 * 1440,
        anchorDate: today(this.clock.now(), this.tz),
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
    if (body.active !== undefined) patch.active = body.active;
    const lead = this.leadOf(body);
    if (lead !== undefined) patch.leadMinutes = lead;
    const touched =
      body.days ?? body.times ?? body.every ?? body.weekday ?? body.time ?? body.everyWeeks;
    if (touched !== undefined || body.every === null) {
      const s = this.scheduleOf(body, this.schedule(r));
      patch.scheduleJson = JSON.stringify(s);
      patch.weekday = s.days[0]!;
      patch.time = dayTimes(s)[0]!;
      if (body.everyWeeks !== undefined) patch.everyWeeks = body.everyWeeks;
      // A new rhythm counts from the week of the next start.
      const next = this.next(r).start;
      patch.anchorDate = today(Number.isFinite(next) ? next : this.clock.now(), this.tz);
    }
    if (body.template) {
      const template: Template = { ...body.template, registrationOpen: true };
      this.tournaments.checkTemplate(template);
      patch.templateJson = JSON.stringify(template);
    }
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
    const n = this.next(r);
    if (!Number.isFinite(n.start)) throw badRequest('the series has no next start');
    if (!this.tournaments.canMake((JSON.parse(r.templateJson) as Template).kind, n.start))
      throw conflict(
        'Dream Team tournaments need the Dream Team on and a start in the running season',
      );
    this.createNext(r, n.start);
    return this.view(this.row(id));
  }

  /** Every minute: creates the tournaments whose time has come. */
  tick(): void {
    const now = this.clock.now();
    for (const r of this.db.select().from(series).where(eq(series.active, true)).all()) {
      try {
        const n = this.next(r);
        if (Number.isFinite(n.start) && now >= n.createAt) this.createNext(r, n.start);
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
    // Dream Team tournaments only while the Dream Team is on and for a start in the running
    // season (decision 129): otherwise not yet - it is made once that season runs, and a start
    // that passes meanwhile is left behind like a missed one.
    if (!this.tournaments.canMake(t.kind, start)) return;
    // A start in a reservation of the server (the league evening) moves behind it.
    const at = this.tournaments.calendar.nextFree(
      this.tournaments.calendarView({
        agentId: t.agentId,
        kind: t.kind ?? 'standard',
        udtJson: null,
        settings: t.settings,
      }),
      start,
    );
    if (at !== start)
      this.log.info(
        `series ${r.name}: ${new Date(start).toISOString()} moved behind a reservation`,
      );
    const row = this.tournaments.create(
      {
        ...t,
        name,
        scheduledAt: new Date(at).toISOString(),
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
