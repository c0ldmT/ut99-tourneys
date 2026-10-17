import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { BOT_TEAM_NAMES } from '@tourney/protocol';
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

/** Rating settings are the defaults for new seasons; each season keeps a copy (seasons table). */
/** Names for teams made of bots only (bot control center), in the order they are used. */
export const TeamNamesSchema = z
  .array(z.string().trim().min(1).max(40))
  .min(1)
  .max(200)
  .refine((l) => new Set(l.map((n) => n.toLowerCase())).size === l.length, 'names must differ');

export const WebsiteSettingsSchema = z.object({
  rating: RatingSettingsSchema.default(RatingSettingsSchema.parse({})),
  teamNames: TeamNamesSchema.default([...BOT_TEAM_NAMES]),
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
    const teamNames = TeamNamesSchema.safeParse(raw['teamNames']);
    return {
      rating: rating.success ? rating.data : RatingSettingsSchema.parse({}),
      teamNames: teamNames.success ? teamNames.data : [...BOT_TEAM_NAMES],
    };
  }

  setRating(value: Partial<RatingSettings>): WebsiteSettings {
    this.put('rating', RatingSettingsSchema.parse({ ...this.get().rating, ...value }));
    return this.get();
  }

  setTeamNames(names: string[]): WebsiteSettings {
    this.put('teamNames', TeamNamesSchema.parse(names));
    return this.get();
  }

  private put(key: string, value: unknown) {
    const row = { key, valueJson: JSON.stringify(value), updatedAt: this.now() };
    const exists = this.db.select().from(settings).where(eq(settings.key, key)).get();
    if (exists) this.db.update(settings).set(row).where(eq(settings.key, key)).run();
    else this.db.insert(settings).values(row).run();
    this.version++;
    return this.get();
  }

  private now(): string {
    return new Date(this.clock.now()).toISOString();
  }
}
