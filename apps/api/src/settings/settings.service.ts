import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { BOT_TEAM_NAMES } from '@tourney/protocol';
import { z } from 'zod';
import { invalidInput } from '../common/http.js';
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
  levelPoints: z.number().int().min(0).max(300).default(200),
});
export type RatingSettings = z.infer<typeof RatingSettingsSchema>;

/** Betting with Neuro: start balance of a season and the floor rescues top up to. */
export const BettingFieldsSchema = z.object({
  startBalance: z.number().int().min(10).max(1_000_000).default(1000),
  floor: z.number().int().min(0).max(1_000_000).default(100),
  /** The control center's active bots bet too. */
  botsBet: z.boolean().default(true),
  /** At most this many bots bet on one match. */
  botsPerMatch: z.number().int().min(0).max(50).default(6),
  /** Betting phase: a match takes bets at least this many seconds before its first game. */
  windowSec: z.number().int().min(0).max(600).default(20),
  /** Bets in the tournament's Discord channel: open, closed (pools), payout, tournament summary. */
  discord: z.boolean().default(true),
});
export const BettingSettingsSchema = BettingFieldsSchema.refine(
  (b) => b.floor <= b.startBalance,
  'the floor must not exceed the start balance',
);
export type BettingSettings = z.infer<typeof BettingSettingsSchema>;
export const DEFAULT_BETTING: BettingSettings = {
  startBalance: 1000,
  floor: 100,
  botsBet: true,
  botsPerMatch: 6,
  windowSec: 20,
  discord: true,
};

/** Rating settings are the defaults for new seasons; each season keeps a copy (seasons table). */
/** Names for teams made of bots only (bot control center), in the order they are used. */
export const TeamNamesSchema = z
  .array(z.string().trim().min(1).max(40))
  .min(1)
  .max(200)
  .refine((l) => new Set(l.map((n) => n.toLowerCase())).size === l.length, 'names must differ');

/** Neuro shop: on/off, prices and items taken out (by item id). */
export const ShopSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  prices: z.record(z.string().max(64), z.number().int().min(1).max(1_000_000)).default({}),
  hidden: z.array(z.string().max(64)).max(200).default([]),
});
export type ShopSettings = z.infer<typeof ShopSettingsSchema>;

/**
 * Help for the game's bot AI in deathmatch games (mod 0.8.0): 0 off, 1 failsafe (bots that stand
 * still or find no enemy for long get moving), 2 also the duel mode (one on one: a bot without an
 * enemy hunts its opponent). Monster Hunt keeps its own bot help.
 */
export const BotAiSettingsSchema = z.object({
  level: z.number().int().min(0).max(2).default(2),
  /**
   * Skill curve (mod 0.13.0, all game types): bots of all levels use the full AI, the level sets
   * speed, view, dodging and aim; off = UT's own levels (novice switch below Adept).
   */
  skillCurve: z.boolean().default(true),
});
export type BotAiSettings = z.infer<typeof BotAiSettingsSchema>;

/**
 * Unreal Dream Team (add-on): off by default. The market day runs once a day at `marketTime`
 * (SEASON_TZ); `offersPerDay` bots are on offer; the starter bot may cost up to `starterBudget`
 * (reference value at index 1.0, about skill 3 with average values).
 */
export const UdtSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  marketTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .default('04:00'),
  offersPerDay: z.number().int().min(1).max(40).default(8),
  starterBudget: z.number().int().min(100).max(100_000).default(1500),
  /** Free points on top of the starter budget: the default starter (skill 3, average values)
   * costs the budget, these are left to allocate. */
  starterExtra: z.number().int().min(0).max(100_000).default(50),
  /** Trading between managers (phase 3) and its brakes against moving Neuro to a friend. */
  tradeEnabled: z.boolean().default(true),
  /** Fee in percent of what each side receives (bots' market value + Neuro). */
  tradeFeePct: z.number().int().min(0).max(50).default(5),
  /** The smaller side must be worth at least this percent of the bigger side. */
  tradeBalancePct: z.number().int().min(0).max(100).default(50),
  /** A bot can be traded this many days after it was bought or traded. */
  tradeLockDays: z.number().int().min(0).max(30).default(3),
  tradeExpiryHours: z.number().int().min(1).max(336).default(48),
  /** Trades between the same two managers per 7 days (0 = no limit). */
  tradePairPerWeek: z.number().int().min(0).max(50).default(2),
  /** AI managers: teams of the website that play like managers (off: they do nothing). */
  aiEnabled: z.boolean().default(false),
  aiCount: z.number().int().min(0).max(8).default(4),
  aiStrength: z.enum(['calm', 'normal', 'ambitious']).default('normal'),
});
export type UdtSettings = z.infer<typeof UdtSettingsSchema>;

/**
 * Live data of games (mod 0.16.0): how long replays (feed and timeline of each game) are kept,
 * and the delay of health, items and bot thoughts while a human plays (kills stay live).
 */
export const LiveSettingsSchema = z.object({
  /** Days a replay is kept; 0 = for good. */
  replayDays: z.number().int().min(0).max(3650).default(60),
  /** Seconds the state, items and thoughts are held back while a human plays; 0 = live. */
  delaySec: z.number().int().min(0).max(120).default(20),
});
export type LiveSettings = z.infer<typeof LiveSettingsSchema>;

export const WebsiteSettingsSchema = z.object({
  rating: RatingSettingsSchema.default(RatingSettingsSchema.parse({})),
  teamNames: TeamNamesSchema.default([...BOT_TEAM_NAMES]),
  betting: BettingSettingsSchema.default(DEFAULT_BETTING),
  shop: ShopSettingsSchema.default(ShopSettingsSchema.parse({})),
  botAi: BotAiSettingsSchema.default(BotAiSettingsSchema.parse({})),
  udt: UdtSettingsSchema.default(UdtSettingsSchema.parse({})),
  live: LiveSettingsSchema.default(LiveSettingsSchema.parse({})),
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
    const betting = BettingSettingsSchema.safeParse(raw['betting'] ?? {});
    const shop = ShopSettingsSchema.safeParse(raw['shop'] ?? {});
    const botAi = BotAiSettingsSchema.safeParse(raw['botAi'] ?? {});
    const udt = UdtSettingsSchema.safeParse(raw['udt'] ?? {});
    const live = LiveSettingsSchema.safeParse(raw['live'] ?? {});
    return {
      live: live.success ? live.data : LiveSettingsSchema.parse({}),
      udt: udt.success ? udt.data : UdtSettingsSchema.parse({}),
      botAi: botAi.success ? botAi.data : BotAiSettingsSchema.parse({}),
      shop: shop.success ? shop.data : ShopSettingsSchema.parse({}),
      betting: betting.success ? betting.data : { ...DEFAULT_BETTING },
      rating: rating.success ? rating.data : RatingSettingsSchema.parse({}),
      teamNames: teamNames.success ? teamNames.data : [...BOT_TEAM_NAMES],
    };
  }

  setRating(value: Partial<RatingSettings>): WebsiteSettings {
    this.put('rating', RatingSettingsSchema.parse({ ...this.get().rating, ...value }));
    return this.get();
  }

  setBetting(value: Partial<BettingSettings>): WebsiteSettings {
    const next = BettingSettingsSchema.safeParse({ ...this.get().betting, ...value });
    if (!next.success) throw invalidInput(next.error);
    this.put('betting', next.data);
    return this.get();
  }

  setShop(value: Partial<ShopSettings>): WebsiteSettings {
    const next = ShopSettingsSchema.safeParse({ ...this.get().shop, ...value });
    if (!next.success) throw invalidInput(next.error);
    this.put('shop', next.data);
    return this.get();
  }

  setBotAi(value: Partial<BotAiSettings>): WebsiteSettings {
    const next = BotAiSettingsSchema.safeParse({ ...this.get().botAi, ...value });
    if (!next.success) throw invalidInput(next.error);
    this.put('botAi', next.data);
    return this.get();
  }

  setUdt(value: Partial<UdtSettings>): WebsiteSettings {
    const next = UdtSettingsSchema.safeParse({ ...this.get().udt, ...value });
    if (!next.success) throw invalidInput(next.error);
    this.put('udt', next.data);
    return this.get();
  }

  setLive(value: Partial<LiveSettings>): WebsiteSettings {
    const next = LiveSettingsSchema.safeParse({ ...this.get().live, ...value });
    if (!next.success) throw invalidInput(next.error);
    this.put('live', next.data);
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
