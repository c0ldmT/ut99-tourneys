import { blob, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  /** "standard", or "udt" (Unreal Dream Team: managers' lineups, not in the statistics). */
  kind: text('kind').notNull().default('standard'),
  /** Dream Team tournaments: UdtEventRules (team value cap, star limit). */
  udtJson: text('udt_json'),
  /**
   * Dream Team tournaments: the season they belong to (set when made one; older ones: null, the
   * season of `createdAt`). Rewards, tickets and the table book there, the seeding needs it.
   */
  udtSeason: integer('udt_season'),
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
  /** Unreal Dream Team: the manager who made the bot (not in the control center, inactive). */
  udtOwner: text('udt_owner'),
  /** How it was made: "starter" (later: scouting, blueprint, ...). */
  udtOrigin: text('udt_origin'),
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

// --- Unreal Dream Team ------------------------------------------------------------------------

/** A manager's team of a season (name and tag in front of the bots' names in the game). */
export const udtTeams = sqliteTable(
  'udt_teams',
  {
    season: integer('season').notNull(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    tag: text('tag').notNull(),
    tagKey: text('tag_key').notNull(),
    createdAt: text('created_at').notNull(),
    /** Scrap from duplicates and removed traits; crafting spends it. */
    scrap: integer('scrap').notNull().default(0),
    /** The manager's switch: enter open Dream Team tournaments automatically when possible. */
    autoEnter: integer('auto_enter', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.season, t.userId] })],
);

/** Bots of the managers: one owner per bot and season. Slots 1..5 (lineups), bench 1..2. */
export const udtRoster = sqliteTable(
  'udt_roster',
  {
    season: integer('season').notNull(),
    botId: text('bot_id').notNull(),
    userId: text('user_id').notNull(),
    price: integer('price').notNull(),
    acquiredAt: text('acquired_at').notNull(),
    starter: integer('starter', { mode: 'boolean' }).notNull().default(false),
    dmSlot: integer('dm_slot'),
    mhSlot: integer('mh_slot'),
    bench: integer('bench'),
    stamina: integer('stamina').notNull().default(100),
    xp: integer('xp').notNull().default(0),
    /** Dream Team games played this season (for the graduation). */
    games: integer('games').notNull().default(0),
    /** Salary not paid: cannot play until the next market day pays it. */
    striking: integer('striking', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.season, t.botId] })],
);

/** Market days done (one per day in SEASON_TZ) with the economy index of the day. */
export const udtDays = sqliteTable('udt_days', {
  day: text('day').primaryKey(),
  season: integer('season').notNull(),
  economyIndex: real('economy_index').notNull(),
  doneAt: text('done_at').notNull(),
});

/** Market value of every bot per market day (history for the charts). */
export const udtValues = sqliteTable(
  'udt_values',
  {
    botId: text('bot_id').notNull(),
    day: text('day').notNull(),
    value: integer('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.botId, t.day] })],
);

/** Bots on offer from a market day until the next one. */
export const udtOffers = sqliteTable(
  'udt_offers',
  {
    day: text('day').notNull(),
    botId: text('bot_id').notNull(),
    minPrice: integer('min_price').notNull(),
    /** Demand factor in the value (>1 in demand, <1 cheaper after unsold days). */
    demand: real('demand').notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.day, t.botId] })],
);

/** Hidden bids for an offer; resolved on the next market day (won, lost, refunded). */
export const udtBids = sqliteTable('udt_bids', {
  id: text('id').primaryKey(),
  day: text('day').notNull(),
  botId: text('bot_id').notNull(),
  userId: text('user_id').notNull(),
  amount: integer('amount').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: text('created_at').notNull(),
});

/** Managers signed up for a Dream Team tournament. */
export const udtEntries = sqliteTable(
  'udt_entries',
  {
    tournamentId: text('tournament_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: text('created_at').notNull(),
    /** High stakes: the ticket paid on entering (0: none), refunded on leaving or calling off. */
    ticket: integer('ticket').notNull().default(0),
    ticketRef: text('ticket_ref'),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.userId] })],
);

/**
 * Trait cards of a season: in the manager's inventory (`botId` null) or on one of their roster
 * bots. A bot sold to the market loses its traits.
 */
export const udtTraits = sqliteTable('udt_traits', {
  id: text('id').primaryKey(),
  season: integer('season').notNull(),
  userId: text('user_id').notNull(),
  code: text('code').notNull(),
  botId: text('bot_id'),
  /** Gun nut: the favourite weapon chosen when it was put on the bot. */
  weapon: text('weapon'),
  /** "pack" or "craft". */
  source: text('source').notNull(),
  createdAt: text('created_at').notNull(),
  assignedAt: text('assigned_at'),
});

/** Boxes opened per kind and season, and since the last epic / legendary (pity). */
export const udtPity = sqliteTable(
  'udt_pity',
  {
    season: integer('season').notNull(),
    userId: text('user_id').notNull(),
    box: text('box').notNull(),
    sinceEpic: integer('since_epic').notNull().default(0),
    sinceLegendary: integer('since_legendary').notNull().default(0),
    opened: integer('opened').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.season, t.userId, t.box] })],
);

/**
 * Trade offers between managers: the proposer gives bots and Neuro and asks for bots and Neuro.
 * Status open, accepted, declined, withdrawn, expired or void (a bot left a roster).
 */
export const udtTrades = sqliteTable('udt_trades', {
  id: text('id').primaryKey(),
  season: integer('season').notNull(),
  fromUser: text('from_user').notNull(),
  toUser: text('to_user').notNull(),
  /** Bot ids the proposer gives (JSON array). */
  giveJson: text('give_json').notNull(),
  /** Bot ids the proposer asks for (JSON array). */
  takeJson: text('take_json').notNull(),
  giveNeuro: integer('give_neuro').notNull().default(0),
  takeNeuro: integer('take_neuro').notNull().default(0),
  /** Market value of each side when the offer was made (bots + Neuro). */
  giveValue: integer('give_value').notNull(),
  takeValue: integer('take_value').notNull(),
  feeFrom: integer('fee_from').notNull().default(0),
  feeTo: integer('fee_to').notNull().default(0),
  message: text('message'),
  status: text('status').notNull().default('open'),
  reason: text('reason'),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  decidedAt: text('decided_at'),
});

/**
 * Bots a manager made (starter, scouted talent, apprentice of a mentor): potential (highest
 * skill), development points spent, the mentor.
 */
export const udtBots = sqliteTable('udt_bots', {
  botId: text('bot_id').primaryKey(),
  season: integer('season').notNull(),
  userId: text('user_id').notNull(),
  /** "starter", "academy", "apprentice" or "blueprint". */
  origin: text('origin').notNull(),
  potential: integer('potential').notNull(),
  pointsSpent: integer('points_spent').notNull().default(0),
  mentorId: text('mentor_id'),
  createdAt: text('created_at').notNull(),
  /** "own", "nominated" (by the manager), "graduated" (into the library) or "rejected". */
  status: text('status').notNull().default('own'),
  nominatedAt: text('nominated_at'),
  graduatedAt: text('graduated_at'),
  /** Graduated with honours (level 10). */
  honours: integer('honours', { mode: 'boolean' }).notNull().default(false),
  /** The manager used the one free renaming. */
  renamed: integer('renamed', { mode: 'boolean' }).notNull().default(false),
  /** The one breakthrough happened (potential and skill +1, values cut). */
  breakthrough: integer('breakthrough', { mode: 'boolean' }).notNull().default(false),
});

/** The manager's latest scout report (three talents) of a season. */
export const udtScouts = sqliteTable(
  'udt_scouts',
  {
    season: integer('season').notNull(),
    userId: text('user_id').notNull(),
    talentsJson: text('talents_json').notNull(),
    reportJson: text('report_json').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.season, t.userId] })],
);

/** Blueprints from packs (blanks, signature blueprints); used when a bot is built from one. */
export const udtBlueprints = sqliteTable('udt_blueprints', {
  id: text('id').primaryKey(),
  season: integer('season').notNull(),
  userId: text('user_id').notNull(),
  rarity: text('rarity').notNull(),
  createdAt: text('created_at').notNull(),
  usedAt: text('used_at'),
  botId: text('bot_id'),
});

/** Retired bots (hall of fame) with their career when they retired. */
export const udtHall = sqliteTable('udt_hall', {
  botId: text('bot_id').primaryKey(),
  name: text('name').notNull(),
  season: integer('season'),
  retiredAt: text('retired_at').notNull(),
  careerJson: text('career_json').notNull(),
});

/** AI managers of the Dream Team: a website user ("ai:<n>") with a personality. */
export const udtAi = sqliteTable('udt_ai', {
  userId: text('user_id').primaryKey(),
  n: integer('n').notNull(),
  /** "saver", "gambler", "tactician" or "breeder". */
  personality: text('personality').notNull(),
  createdAt: text('created_at').notNull(),
});

/** Replays of games (Monster Hunt: runs, else run 0): feed and timeline as deflated JSON. */
export const gameReplays = sqliteTable(
  'game_replays',
  {
    tournamentId: text('tournament_id').notNull(),
    matchId: text('match_id').notNull(),
    game: integer('game').notNull(),
    run: integer('run').notNull().default(0),
    createdAt: text('created_at').notNull(),
    data: blob('data', { mode: 'buffer' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.matchId, t.game, t.run] })],
);
