import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  /** Counts for the statistics page. */
  statsEnabled: integer('stats_enabled', { mode: 'boolean' }).notNull().default(true),
  /** Counts for the ratings. */
  ranked: integer('ranked', { mode: 'boolean' }).notNull().default(true),
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
