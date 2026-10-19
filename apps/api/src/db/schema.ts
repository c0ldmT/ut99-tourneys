import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  /** Discord user id, or "dev:<name>" for development logins. */
  discordId: text('discord_id').notNull().unique(),
  username: text('username').notNull(),
  /** In-game name: ASCII, unique (case-insensitive via displayKey). */
  displayName: text('display_name').notNull(),
  displayKey: text('display_key').notNull().unique(),
  avatar: text('avatar'),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  joinToken: text('join_token').notNull().unique(),
  createdAt: text('created_at').notNull(),
  lastLoginAt: text('last_login_at').notNull(),
  /** Discord direct messages from the bot (if one is configured). */
  notifyDm: integer('notify_dm', { mode: 'boolean' }).notNull().default(true),
  /** Worn shop items per slot (title, color, frame, badge, banner, fanfare). */
  lookJson: text('look_json'),
});

/** Neuro shop purchases: paid with the Neuro of a season, owned for good. */
export const shopPurchases = sqliteTable('shop_purchases', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  itemId: text('item_id').notNull(),
  season: integer('season').notNull(),
  price: integer('price').notNull(),
  at: text('at').notNull(),
  /** ok; dedications: pending (waiting for an admin), approved, rejected (refunded). */
  status: text('status').notNull().default('ok'),
  /** Dedication lines. */
  dataJson: text('data_json'),
});

/**
 * Neuro ledger: bookings besides bets and shop purchases (Dream Team rewards, purchases,
 * salaries, ...). Positive amounts earn, negative ones spend; `ref` is unique (idempotent).
 */
export const neuroLedger = sqliteTable('neuro_ledger', {
  id: text('id').primaryKey(),
  season: integer('season').notNull(),
  userId: text('user_id').notNull(),
  kind: text('kind').notNull(),
  amount: integer('amount').notNull(),
  ref: text('ref').notNull().unique(),
  at: text('at').notNull(),
  metaJson: text('meta_json'),
});

export const sessions = sqliteTable('sessions', {
  /** sha256 of the cookie value. */
  idHash: text('id_hash').primaryKey(),
  userId: text('user_id').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: text('created_at').notNull(),
  lastSeenAt: text('last_seen_at'),
  /** Last agent.hello payload (version, profiles, ...). */
  infoJson: text('info_json'),
});

export const inventories = sqliteTable(
  'inventories',
  {
    agentId: text('agent_id').notNull(),
    profileId: text('profile_id').notNull(),
    dataJson: text('data_json').notNull(),
    scannedAt: text('scanned_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.profileId] })],
);

export const tournaments = sqliteTable('tournaments', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  agentId: text('agent_id').notNull(),
  profileId: text('profile_id').notNull(),
  /** Overrides the profile's public address on the website. */
  connectAddress: text('connect_address'),
  settingsJson: text('settings_json').notNull(),
  botPoolJson: text('bot_pool_json').notNull(),
  /**
   * The pool is the active bots of the control center (their skill); it is fixed when the
   * bracket is seeded. Off: the stored pool (older tournaments, API clients that send one).
   */
  botsFromLibrary: integer('bots_from_library', { mode: 'boolean' }).notNull().default(false),
  /** Seeded and started by itself at `scheduledAt` (waits up to an hour for a free server). */
  autoStart: integer('auto_start', { mode: 'boolean' }).notNull().default(false),
  registrationOpen: integer('registration_open', { mode: 'boolean' }).notNull().default(true),
  scheduledAt: text('scheduled_at'),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  /** Cached projection phase ("draft" while there are no events). */
  phase: text('phase').notNull().default('draft'),
  headSeq: integer('head_seq').notNull().default(0),
  /** Discord channel: "default" (DISCORD_WEBHOOK_URL), "custom" (webhookUrl) or "off". */
  notifyMode: text('notify_mode').notNull().default('default'),
  webhookUrl: text('webhook_url'),
  /** When "registration open" was posted, and when registered players were reminded. */
  announcedAt: text('announced_at'),
  remindedAt: text('reminded_at'),
  /**
   * Season tournament: counts for the ratings and the season statistics and records of the
   * season of its first game. Lifetime statistics count every tournament.
   */
  seasonal: integer('seasonal', { mode: 'boolean' }).notNull().default(true),
  /** Created by a tournament series. */
  seriesId: text('series_id'),
});

/** Tournament series: a template that creates a tournament every n weeks before its start. */
export const series = sqliteTable('series', {
  id: text('id').primaryKey(),
  /** Name of the tournaments; {n} = number, {date} = start date. */
  name: text('name').notNull(),
  /** The tournament's fields without name and start (agent, profile, settings, bots, ...). */
  templateJson: text('template_json').notNull(),
  /** First weekday and time of the schedule (older versions; the schedule is `scheduleJson`). */
  weekday: integer('weekday').notNull(),
  time: text('time').notNull(),
  /** Weekdays, times or an hour interval (local times in SEASON_TZ), see series-time.ts. */
  scheduleJson: text('schedule_json'),
  everyWeeks: integer('every_weeks').notNull().default(1),
  /** Older versions: lead time in days (now `leadMinutes`). */
  leadDays: integer('lead_days').notNull().default(7),
  /** The tournament is created (and announced) this many minutes before its start. */
  leadMinutes: integer('lead_minutes').notNull().default(10080),
  /** A start date of the series (YYYY-MM-DD): the weeks count from it. */
  anchorDate: text('anchor_date').notNull(),
  nextNumber: integer('next_number').notNull().default(1),
  /** Start (ISO) of the last tournament created. */
  lastStart: text('last_start'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
});

/** Bot clans: their tag is put in front of the members' names in the game. */
export const botClans = sqliteTable('bot_clans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull().unique(),
  tag: text('tag').notNull(),
  color: text('color'),
  description: text('description'),
  createdAt: text('created_at').notNull(),
});

/** Website bots (bot control center). */
export const bots = sqliteTable('bots', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull().unique(),
  clanId: text('clan_id'),
  /** Default difficulty when the bot is added to a tournament's pool (0..7). */
  skill: real('skill').notNull().default(4),
  botClass: text('bot_class'),
  skin: text('skin'),
  face: text('face'),
  /** BotTraits (accuracy, alertness, combat style, camping, strafing, jumpy, weapon, voice). */
  traitsJson: text('traits_json').notNull(),
  /** BotPersonality of the website: talk, lines, rivals (by user/bot id). */
  personalityJson: text('personality_json').notNull(),
  bio: text('bio'),
  color: text('color'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Seasons, numbered from 1; dates are days (YYYY-MM-DD) in the season time zone, inclusive. */
export const seasons = sqliteTable('seasons', {
  number: integer('number').primaryKey(),
  startDate: text('start_date').notNull(),
  endDate: text('end_date').notNull(),
  /** Rating settings of the season (frozen when it ends). */
  ratingJson: text('rating_json').notNull(),
  /** Betting settings of the season (start balance, rescue floor); null: the defaults. */
  bettingJson: text('betting_json'),
  /** Set when an admin ended the season before its last day ("end now"). */
  endedAt: text('ended_at'),
  createdAt: text('created_at').notNull(),
});

/** Website settings: one JSON value per key (e.g. "rating"). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  tournamentId: text('tournament_id').notNull(),
  name: text('name').notNull(),
  nameKey: text('name_key').notNull(),
  tag: text('tag'),
  captainId: text('captain_id').notNull(),
  inviteCode: text('invite_code').notNull().unique(),
  createdAt: text('created_at').notNull(),
});

export const registrations = sqliteTable(
  'registrations',
  {
    tournamentId: text('tournament_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: text('created_at').notNull(),
    /** Team tournaments: null = solo player (drawn into a team before seeding). */
    teamId: text('team_id'),
    sub: integer('sub', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.userId] })],
);

export const watchers = sqliteTable(
  'watchers',
  {
    tournamentId: text('tournament_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.userId] })],
);

export const events = sqliteTable(
  'events',
  {
    tournamentId: text('tournament_id').notNull(),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    at: text('at').notNull(),
    json: text('json').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.seq] })],
);

/** Bets with Neuro (virtual currency, per season); settled from the event log. */
export const bets = sqliteTable('bets', {
  id: text('id').primaryKey(),
  season: integer('season').notNull(),
  tournamentId: text('tournament_id').notNull(),
  matchId: text('match_id').notNull(),
  kind: text('kind').notNull(),
  /** A bet of a user or of a bot of the control center (exactly one is set). */
  userId: text('user_id'),
  botId: text('bot_id'),
  pick: text('pick').notNull(),
  amount: integer('amount').notNull(),
  allIn: integer('all_in', { mode: 'boolean' }).notNull().default(false),
  placedAt: text('placed_at').notNull(),
});

/** Rescues: Neuro topped up to the season's floor before a bet. */
export const betBailouts = sqliteTable('bet_bailouts', {
  id: text('id').primaryKey(),
  season: integer('season').notNull(),
  userId: text('user_id'),
  botId: text('bot_id'),
  amount: integer('amount').notNull(),
  at: text('at').notNull(),
});
