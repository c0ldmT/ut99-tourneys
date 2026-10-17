import { Inject, Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { badRequest, conflict, notFound } from '../common/http.js';
import { CLOCK, CONFIG, type ApiClock, type ApiConfig } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { seasons } from '../db/schema.js';
import {
  RatingSettingsSchema,
  SettingsService,
  type RatingSettings,
} from '../settings/settings.service.js';
import {
  isValidDate,
  seasonAt,
  seasonStatus,
  seasonWindow,
  today,
  type SeasonStatus,
} from './season-time.js';

export interface Season {
  number: number;
  startDate: string;
  endDate: string;
  endedAt: string | null;
  /** Rating settings the season runs with (kept when it ends). */
  rating: RatingSettings;
}

export interface SeasonView extends Season {
  status: SeasonStatus;
  /** Window in ISO timestamps: [from, to). */
  from: string;
  to: string;
}

/**
 * Seasons (admin page "Settings"): numbered from 1, one after the other, never overlapping.
 * "In season" while one is running. A season can be planned ahead, its last day moved, ended
 * now or deleted (only the newest, so numbers stay without gaps).
 */
@Injectable()
export class SeasonsService {
  /** Bumped on every change: caches built from the seasons compare it. */
  version = 0;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
    @Inject(CONFIG) private readonly config: ApiConfig,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  get timeZone(): string {
    return this.config.seasonTimeZone;
  }

  list(): Season[] {
    return this.db
      .select()
      .from(seasons)
      .orderBy(seasons.number)
      .all()
      .map((r) => {
        const rating = RatingSettingsSchema.safeParse(JSON.parse(r.ratingJson));
        return {
          number: r.number,
          startDate: r.startDate,
          endDate: r.endDate,
          endedAt: r.endedAt,
          rating: rating.success ? rating.data : RatingSettingsSchema.parse({}),
        };
      });
  }

  view(s: Season): SeasonView {
    const w = seasonWindow(s, this.timeZone);
    return {
      ...s,
      status: seasonStatus(s, this.clock.now(), this.timeZone),
      from: new Date(w.from).toISOString(),
      to: new Date(w.to).toISOString(),
    };
  }

  /** All seasons, the running one, the next planned one and today's date. */
  overview() {
    const all = this.list().map((s) => this.view(s));
    return {
      seasons: all,
      current: all.find((s) => s.status === 'running')?.number ?? null,
      planned: all.find((s) => s.status === 'planned')?.number ?? null,
      today: today(this.clock.now(), this.timeZone),
      timeZone: this.timeZone,
    };
  }

  /** The running season, if any ("in season"). */
  current(): Season | undefined {
    const now = this.clock.now();
    return this.list().find((s) => seasonStatus(s, now, this.timeZone) === 'running');
  }

  /** The newest season that has started (running or ended). */
  latestStarted(): Season | undefined {
    const now = this.clock.now();
    return this.list()
      .filter((s) => seasonStatus(s, now, this.timeZone) !== 'planned')
      .at(-1);
  }

  /** The season in which an instant lies. */
  at(instant: number): Season | undefined {
    return seasonAt(this.list(), instant, this.timeZone);
  }

  get(number: number): Season {
    const s = this.list().find((x) => x.number === number);
    if (!s) throw notFound(`season ${number}`);
    return s;
  }

  create(body: { startDate: string; endDate: string }): Season {
    const all = this.list();
    const last = all.at(-1);
    const day = today(this.clock.now(), this.timeZone);
    this.checkDates(body.startDate, body.endDate);
    if (body.startDate < day) throw badRequest('a season cannot start in the past');
    if (last && body.startDate <= this.lastDay(last))
      throw conflict(`season ${last.number} runs until ${this.lastDay(last)}`);
    const number = (last?.number ?? 0) + 1;
    this.db
      .insert(seasons)
      .values({
        number,
        startDate: body.startDate,
        endDate: body.endDate,
        ratingJson: JSON.stringify(this.settings.get().rating),
        createdAt: new Date(this.clock.now()).toISOString(),
      })
      .run();
    this.version++;
    return this.get(number);
  }

  /** Moves the days of a planned season, or the last day of the running one. */
  update(number: number, body: { startDate?: string; endDate?: string }): Season {
    const s = this.get(number);
    const status = seasonStatus(s, this.clock.now(), this.timeZone);
    if (status === 'ended') throw conflict(`season ${number} has ended`);
    const day = today(this.clock.now(), this.timeZone);
    const startDate = body.startDate ?? s.startDate;
    const endDate = body.endDate ?? s.endDate;
    if (status === 'running' && startDate !== s.startDate)
      throw conflict('the season has started: its first day cannot change');
    this.checkDates(startDate, endDate);
    if (status === 'planned' && startDate < day)
      throw badRequest('a season cannot start in the past');
    if (endDate < day) throw badRequest('the last day cannot be in the past (end the season now)');
    const before = this.list()
      .filter((x) => x.number < number)
      .at(-1);
    if (before && startDate <= this.lastDay(before))
      throw conflict(`season ${before.number} runs until ${this.lastDay(before)}`);
    const after = this.list().find((x) => x.number > number);
    if (after && endDate >= after.startDate)
      throw conflict(`season ${after.number} starts on ${after.startDate}`);
    this.db.update(seasons).set({ startDate, endDate }).where(eq(seasons.number, number)).run();
    this.version++;
    return this.get(number);
  }

  /** Ends the running season now (its last day becomes today). */
  endNow(number: number): Season {
    const s = this.get(number);
    if (seasonStatus(s, this.clock.now(), this.timeZone) !== 'running')
      throw conflict(`season ${number} is not running`);
    this.db
      .update(seasons)
      .set({
        endDate: today(this.clock.now(), this.timeZone),
        endedAt: new Date(this.clock.now()).toISOString(),
      })
      .where(eq(seasons.number, number))
      .run();
    this.version++;
    return this.get(number);
  }

  /** Deletes the newest season (its tournaments then count for no season). */
  remove(number: number): void {
    const last = this.db.select().from(seasons).orderBy(desc(seasons.number)).limit(1).get();
    if (!last || last.number !== number) throw conflict('only the newest season can be deleted');
    this.db.delete(seasons).where(eq(seasons.number, number)).run();
    this.version++;
  }

  /** New rating settings apply to the running and the planned season, not to ended ones. */
  applyRating(rating: RatingSettings): void {
    const now = this.clock.now();
    for (const s of this.list())
      if (seasonStatus(s, now, this.timeZone) !== 'ended')
        this.db
          .update(seasons)
          .set({ ratingJson: JSON.stringify(rating) })
          .where(eq(seasons.number, s.number))
          .run();
    this.version++;
  }

  private lastDay(s: Season): string {
    return s.endedAt ? today(Date.parse(s.endedAt), this.timeZone) : s.endDate;
  }

  private checkDates(startDate: string, endDate: string) {
    if (!isValidDate(startDate) || !isValidDate(endDate)) throw badRequest('dates: YYYY-MM-DD');
    if (endDate < startDate) throw badRequest('the last day is before the first day');
  }
}
