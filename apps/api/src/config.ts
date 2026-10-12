import path from 'node:path';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no', ''])])
  .transform((v) => v === true || v === 'true' || v === '1' || v === 'yes');

const list = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

/** All settings come from environment variables (a `.env` file in development). */
export const ApiConfigSchema = z
  .object({
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(0).max(65535).default(8080),
    /** Public base URL of the website, e.g. https://cup.example.com (OAuth redirect, cookies). */
    PUBLIC_URL: z.url().default('http://localhost:8080'),
    /** Directory for the SQLite database. ":memory:" keeps everything in memory (tests). */
    DATA_DIR: z.string().default('./data'),
    SITE_NAME: z.string().max(64).default('UT99 Tournaments'),
    DISCORD_CLIENT_ID: z.string().default(''),
    DISCORD_CLIENT_SECRET: z.string().default(''),
    /** Only members of this Discord server may log in (optional). */
    DISCORD_GUILD_ID: z.string().default(''),
    /** Discord user ids that are admins. */
    ADMIN_DISCORD_IDS: list,
    /**
     * Login with a name only, no Discord. For local development and tests; never enable this on
     * a reachable server.
     */
    DEV_LOGIN: bool.default(false),
    /** Built Angular app to serve (index.html + assets). Empty = API only. */
    WEB_DIST: z.string().default(''),
    SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .transform((c) => ({
    host: c.HOST,
    port: c.PORT,
    publicUrl: c.PUBLIC_URL.replace(/\/+$/, ''),
    dataDir: c.DATA_DIR,
    dbFile: c.DATA_DIR === ':memory:' ? ':memory:' : path.join(c.DATA_DIR, 'tourney.db'),
    siteName: c.SITE_NAME,
    discord: {
      clientId: c.DISCORD_CLIENT_ID,
      clientSecret: c.DISCORD_CLIENT_SECRET,
      guildId: c.DISCORD_GUILD_ID,
      enabled: Boolean(c.DISCORD_CLIENT_ID && c.DISCORD_CLIENT_SECRET),
    },
    adminDiscordIds: c.ADMIN_DISCORD_IDS,
    devLogin: c.DEV_LOGIN,
    webDist: c.WEB_DIST,
    sessionDays: c.SESSION_DAYS,
    logLevel: c.LOG_LEVEL,
    secureCookies: c.PUBLIC_URL.startsWith('https://'),
  }));

export type ApiConfig = z.output<typeof ApiConfigSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const parsed = ApiConfigSchema.safeParse(env);
  if (!parsed.success) throw new Error(`invalid configuration:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export const CONFIG = Symbol('CONFIG');
export const CLOCK = Symbol('CLOCK');

/** Time source; tests replace it to run tournaments on a fake clock. */
export interface ApiClock {
  now(): number;
}
export const systemClock: ApiClock = { now: () => Date.now() };
