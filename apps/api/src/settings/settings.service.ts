import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { CLOCK, type ApiClock } from '../config.js';
import { DB, type Db } from '../db/database.js';
import { settings } from '../db/schema.js';

/**
 * Website settings (admin page "Settings"), one JSON value per key. Unknown or broken values fall
 * back to the defaults, so a setting added later never breaks an existing database.
 */

export const RatingSettingsSchema = z.object({
  /** Games with bots count for the ratings. Off: only games between humans. */
  botGames: z.boolean().default(true),
  /** Rating points per bot difficulty step above or below Adept. */
  levelPoints: z.number().int().min(0).max(300).default(100),
});
export type RatingSettings = z.infer<typeof RatingSettingsSchema>;

/** Seasons come later (statistics milestone): the ratings already take a time window. */
export const WebsiteSettingsSchema = z.object({
  rating: RatingSettingsSchema.default(RatingSettingsSchema.parse({})),
});
export type WebsiteSettings = z.infer<typeof WebsiteSettingsSchema>;

@Injectable()
export class SettingsService {
  /** Bumped on every change: caches built from the settings (ratings) compare it. */
  version = 0;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CLOCK) private readonly clock: ApiClock,
  ) {}

  get(): WebsiteSettings {
    const rows = this.db.select().from(settings).all();
    const raw: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        raw[r.key] = JSON.parse(r.valueJson);
      } catch {
        // broken value: default
      }
    }
    const rating = RatingSettingsSchema.safeParse(raw['rating'] ?? {});
    return { rating: rating.success ? rating.data : RatingSettingsSchema.parse({}) };
  }

  setRating(value: Partial<RatingSettings>): WebsiteSettings {
    const next = RatingSettingsSchema.parse({ ...this.get().rating, ...value });
    const row = { key: 'rating', valueJson: JSON.stringify(next), updatedAt: this.now() };
    const exists = this.db.select().from(settings).where(eq(settings.key, 'rating')).get();
    if (exists) this.db.update(settings).set(row).where(eq(settings.key, 'rating')).run();
    else this.db.insert(settings).values(row).run();
    this.version++;
    return this.get();
  }

  private now(): string {
    return new Date(this.clock.now()).toISOString();
  }
}
