/**
 * Schema migrations, applied in order at startup. The database records how many ran in
 * PRAGMA user_version. Never edit a migration that was released; append a new one.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    display_key TEXT NOT NULL UNIQUE,
    avatar TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    join_token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_seen_at TEXT,
    info_json TEXT
  );
  CREATE TABLE inventories (
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    profile_id TEXT NOT NULL,
    data_json TEXT NOT NULL,
    scanned_at TEXT NOT NULL,
    PRIMARY KEY (agent_id, profile_id)
  );
  CREATE TABLE tournaments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    connect_address TEXT,
    settings_json TEXT NOT NULL,
    bot_pool_json TEXT NOT NULL,
    registration_open INTEGER NOT NULL DEFAULT 1,
    scheduled_at TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    phase TEXT NOT NULL DEFAULT 'draft',
    head_seq INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE registrations (
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tournament_id, user_id)
  );
  CREATE TABLE watchers (
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tournament_id, user_id)
  );
  CREATE TABLE events (
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    at TEXT NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (tournament_id, seq)
  );
  `,
  // 2: team tournaments (milestone 7). Teams exist per tournament; a registration without a team
  // is a solo player who gets drawn into a team before seeding.
  `
  CREATE TABLE teams (
    id TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    tag TEXT,
    captain_id TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    UNIQUE (tournament_id, name_key)
  );
  CREATE INDEX teams_tournament ON teams(tournament_id);
  ALTER TABLE registrations ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE SET NULL;
  ALTER TABLE registrations ADD COLUMN sub INTEGER NOT NULL DEFAULT 0;
  `,
  // 3: Discord notifications (milestone 9). Players can switch off direct messages; a tournament
  // posts to the default webhook, its own webhook or nowhere. announced/reminded keep messages
  // from being sent twice.
  `
  ALTER TABLE users ADD COLUMN notify_dm INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE tournaments ADD COLUMN notify_mode TEXT NOT NULL DEFAULT 'default';
  ALTER TABLE tournaments ADD COLUMN webhook_url TEXT;
  ALTER TABLE tournaments ADD COLUMN announced_at TEXT;
  ALTER TABLE tournaments ADD COLUMN reminded_at TEXT;
  `,
  // 4: statistics. A tournament counts for the statistics page when stats_enabled is set (new
  // tournaments: yes). Tournaments that exist before this update start excluded; an admin can
  // include them in the tournament form.
  `
  ALTER TABLE tournaments ADD COLUMN stats_enabled INTEGER NOT NULL DEFAULT 1;
  UPDATE tournaments SET stats_enabled = 0;
  `,
  // 5: ratings (milestone 10). A tournament counts for the ratings when ranked is set (new
  // tournaments: yes); tournaments that exist before this update never count (nothing is rated
  // retroactively). Website settings (key -> JSON value) such as "rating".
  `
  ALTER TABLE tournaments ADD COLUMN ranked INTEGER NOT NULL DEFAULT 1;
  UPDATE tournaments SET ranked = 0;
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  // 6: seasons. Lifetime statistics count every tournament; a "season tournament" (seasonal)
  // counts for the ratings and the season statistics and records of the season in which its
  // first game is played. One switch replaces stats_enabled and ranked. A season keeps the
  // rating settings it ran with (rating_json), so later changes do not alter its archive.
  `
  ALTER TABLE tournaments ADD COLUMN seasonal INTEGER NOT NULL DEFAULT 1;
  UPDATE tournaments SET seasonal = ranked;
  ALTER TABLE tournaments DROP COLUMN ranked;
  ALTER TABLE tournaments DROP COLUMN stats_enabled;
  CREATE TABLE seasons (
    number INTEGER PRIMARY KEY,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    rating_json TEXT NOT NULL,
    ended_at TEXT,
    created_at TEXT NOT NULL
  );
  `,
  // 7: bot control center. The website keeps its own bots (no limit, ids that statistics and
  // ratings follow) and bot clans (a tag in front of the name in the game). Look and play style
  // as in UT's bot configuration, plus personality (chat lines, rivals), bio, active/retired.
  `
  CREATE TABLE bot_clans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    tag TEXT NOT NULL,
    color TEXT,
    description TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE bots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    clan_id TEXT REFERENCES bot_clans(id) ON DELETE SET NULL,
    skill REAL NOT NULL DEFAULT 4,
    bot_class TEXT,
    skin TEXT,
    face TEXT,
    traits_json TEXT NOT NULL,
    personality_json TEXT NOT NULL,
    bio TEXT,
    color TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX bots_clan ON bots(clan_id);
  `,
  // 8: betting with Neuro (virtual currency, per season). Bets on the winner of a match; the
  // settlement is derived from the event log (like the statistics). Rescues (bailouts) are
  // stored because they happen at a point in time. Each season keeps its betting settings.
  `
  ALTER TABLE seasons ADD COLUMN betting_json TEXT;
  CREATE TABLE bets (
    id TEXT PRIMARY KEY,
    season INTEGER NOT NULL,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    match_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pick TEXT NOT NULL,
    amount INTEGER NOT NULL,
    all_in INTEGER NOT NULL DEFAULT 0,
    placed_at TEXT NOT NULL,
    UNIQUE (tournament_id, match_id, kind, user_id)
  );
  CREATE INDEX bets_season ON bets(season);
  CREATE INDEX bets_user ON bets(user_id, season);
  CREATE TABLE bet_bailouts (
    id TEXT PRIMARY KEY,
    season INTEGER NOT NULL REFERENCES seasons(number) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    at TEXT NOT NULL
  );
  CREATE INDEX bet_bailouts_season ON bet_bailouts(season);
  `,
  // 9: the control center's bots bet too. A bet or rescue belongs to a user or to a bot.
  `
  CREATE TABLE bets_new (
    id TEXT PRIMARY KEY,
    season INTEGER NOT NULL,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    match_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
    pick TEXT NOT NULL,
    amount INTEGER NOT NULL,
    all_in INTEGER NOT NULL DEFAULT 0,
    placed_at TEXT NOT NULL,
    CHECK ((user_id IS NULL) <> (bot_id IS NULL))
  );
  INSERT INTO bets_new (id, season, tournament_id, match_id, kind, user_id, pick, amount, all_in, placed_at)
    SELECT id, season, tournament_id, match_id, kind, user_id, pick, amount, all_in, placed_at FROM bets;
  DROP TABLE bets;
  ALTER TABLE bets_new RENAME TO bets;
  CREATE UNIQUE INDEX bets_user_match ON bets(tournament_id, match_id, kind, user_id) WHERE user_id IS NOT NULL;
  CREATE UNIQUE INDEX bets_bot_match ON bets(tournament_id, match_id, kind, bot_id) WHERE bot_id IS NOT NULL;
  CREATE INDEX bets_season ON bets(season);
  CREATE TABLE bet_bailouts_new (
    id TEXT PRIMARY KEY,
    season INTEGER NOT NULL REFERENCES seasons(number) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    bot_id TEXT REFERENCES bots(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    at TEXT NOT NULL,
    CHECK ((user_id IS NULL) <> (bot_id IS NULL))
  );
  INSERT INTO bet_bailouts_new (id, season, user_id, amount, at)
    SELECT id, season, user_id, amount, at FROM bet_bailouts;
  DROP TABLE bet_bailouts;
  ALTER TABLE bet_bailouts_new RENAME TO bet_bailouts;
  CREATE INDEX bet_bailouts_season ON bet_bailouts(season);
  `,
  // 10: tournament series: a template that creates a tournament every week (or every n weeks).
  `
  CREATE TABLE series (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    template_json TEXT NOT NULL,
    weekday INTEGER NOT NULL,
    time TEXT NOT NULL,
    every_weeks INTEGER NOT NULL DEFAULT 1,
    lead_days INTEGER NOT NULL DEFAULT 7,
    anchor_date TEXT NOT NULL,
    next_number INTEGER NOT NULL DEFAULT 1,
    last_start TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  ALTER TABLE tournaments ADD COLUMN series_id TEXT REFERENCES series(id) ON DELETE SET NULL;
  `,
  // 11: the Neuro shop: purchases (paid with the season's Neuro, kept for good) and the look a
  // user wears (title, colour, frame, badge, banner, fanfare).
  `
  CREATE TABLE shop_purchases (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    season INTEGER NOT NULL,
    price INTEGER NOT NULL,
    at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    data_json TEXT
  );
  CREATE INDEX shop_purchases_user ON shop_purchases(user_id);
  CREATE INDEX shop_purchases_season ON shop_purchases(season);
  ALTER TABLE users ADD COLUMN look_json TEXT;
  `,
  // 12: the bot pool comes from the bot control center (active bots) until the seeding.
  `
  ALTER TABLE tournaments ADD COLUMN bots_from_library INTEGER NOT NULL DEFAULT 0;
  `,
  // 13: series on several weekdays or daily, at several times or every n hours; the lead time in
  // minutes; tournaments that start by themselves at their start time.
  `
  ALTER TABLE series ADD COLUMN schedule_json TEXT;
  ALTER TABLE series ADD COLUMN lead_minutes INTEGER NOT NULL DEFAULT 10080;
  UPDATE series SET
    schedule_json = '{"days":[' || weekday || '],"times":["' || time || '"]}',
    lead_minutes = lead_days * 1440;
  ALTER TABLE tournaments ADD COLUMN auto_start INTEGER NOT NULL DEFAULT 0;
  `,
  // 14: Neuro ledger: earnings and spendings besides bets and the shop (Dream Team), one row per
  // booking, `ref` makes bookings idempotent.
  `
  CREATE TABLE neuro_ledger (
    id TEXT PRIMARY KEY,
    season INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    amount INTEGER NOT NULL,
    ref TEXT NOT NULL UNIQUE,
    at TEXT NOT NULL,
    meta_json TEXT
  );
  CREATE INDEX neuro_ledger_season ON neuro_ledger(season, user_id);
  `,
  // 15: Unreal Dream Team. Tournaments get a kind ("udt" ones stay out of the statistics); bots
  // made by managers live in the library (inactive) with their owner; teams, rosters (a bot
  // belongs to one manager per season), market days, values, offers, bids, event entries.
  `
  ALTER TABLE tournaments ADD COLUMN kind TEXT NOT NULL DEFAULT 'standard';
  ALTER TABLE bots ADD COLUMN udt_owner TEXT;
  ALTER TABLE bots ADD COLUMN udt_origin TEXT;
  CREATE TABLE udt_teams (
    season INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL,
    tag TEXT NOT NULL,
    tag_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (season, user_id),
    UNIQUE (season, name_key),
    UNIQUE (season, tag_key)
  );
  CREATE TABLE udt_roster (
    season INTEGER NOT NULL,
    bot_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    price INTEGER NOT NULL,
    acquired_at TEXT NOT NULL,
    starter INTEGER NOT NULL DEFAULT 0,
    dm_slot INTEGER,
    mh_slot INTEGER,
    bench INTEGER,
    stamina INTEGER NOT NULL DEFAULT 100,
    xp INTEGER NOT NULL DEFAULT 0,
    striking INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (season, bot_id)
  );
  CREATE INDEX udt_roster_user ON udt_roster(season, user_id);
  CREATE TABLE udt_days (
    day TEXT PRIMARY KEY,
    season INTEGER NOT NULL,
    economy_index REAL NOT NULL,
    done_at TEXT NOT NULL
  );
  CREATE TABLE udt_values (
    bot_id TEXT NOT NULL,
    day TEXT NOT NULL,
    value INTEGER NOT NULL,
    PRIMARY KEY (bot_id, day)
  );
  CREATE TABLE udt_offers (
    day TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    min_price INTEGER NOT NULL,
    PRIMARY KEY (day, bot_id)
  );
  CREATE TABLE udt_bids (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL,
    UNIQUE (day, bot_id, user_id)
  );
  CREATE TABLE udt_entries (
    tournament_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (tournament_id, user_id)
  );
  `,
  // 16: Dream Team tournaments: their rules (team value cap, star limit) as JSON.
  `
  ALTER TABLE tournaments ADD COLUMN udt_json TEXT;
  `,
  // 17: Dream Team packs and traits: trait cards (in the inventory or on a roster bot), the
  // pity counters per box and season, the manager's scrap.
  `
  CREATE TABLE udt_traits (
    id TEXT PRIMARY KEY,
    season INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    code TEXT NOT NULL,
    bot_id TEXT,
    weapon TEXT,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    assigned_at TEXT
  );
  CREATE INDEX udt_traits_user ON udt_traits(season, user_id);
  CREATE TABLE udt_pity (
    season INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    box TEXT NOT NULL,
    since_epic INTEGER NOT NULL DEFAULT 0,
    since_legendary INTEGER NOT NULL DEFAULT 0,
    opened INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (season, user_id, box)
  );
  ALTER TABLE udt_teams ADD COLUMN scrap INTEGER NOT NULL DEFAULT 0;
  `,
  // 18: Dream Team trades between managers: bots (with their traits) and Neuro both ways, the
  // proposer's Neuro and fee held until the offer is decided.
  `
  CREATE TABLE udt_trades (
    id TEXT PRIMARY KEY,
    season INTEGER NOT NULL,
    from_user TEXT NOT NULL,
    to_user TEXT NOT NULL,
    give_json TEXT NOT NULL,
    take_json TEXT NOT NULL,
    give_neuro INTEGER NOT NULL DEFAULT 0,
    take_neuro INTEGER NOT NULL DEFAULT 0,
    give_value INTEGER NOT NULL,
    take_value INTEGER NOT NULL,
    fee_from INTEGER NOT NULL DEFAULT 0,
    fee_to INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    reason TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    decided_at TEXT
  );
  CREATE INDEX udt_trades_to ON udt_trades(season, to_user, status);
  CREATE INDEX udt_trades_from ON udt_trades(season, from_user, status);
  `,
  // 19: Dream Team high stakes: the entry ticket a manager paid (and its ledger ref).
  `
  ALTER TABLE udt_entries ADD COLUMN ticket INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE udt_entries ADD COLUMN ticket_ref TEXT;
  `,
  // 20: Dream Team academy: the managers' own bots (starter, scouted talents, apprentices) with
  // their potential and development, the current scout report, games per roster bot.
  `
  CREATE TABLE udt_bots (
    bot_id TEXT PRIMARY KEY,
    season INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    origin TEXT NOT NULL,
    potential INTEGER NOT NULL,
    points_spent INTEGER NOT NULL DEFAULT 0,
    mentor_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX udt_bots_user ON udt_bots(season, user_id);
  INSERT INTO udt_bots (bot_id, season, user_id, origin, potential, created_at)
    SELECT r.bot_id, r.season, r.user_id, 'starter', MIN(7, CAST(ROUND(b.skill) AS INTEGER) + 2), r.acquired_at
    FROM udt_roster r JOIN bots b ON b.id = r.bot_id WHERE r.starter = 1;
  CREATE TABLE udt_scouts (
    season INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    talents_json TEXT NOT NULL,
    report_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (season, user_id)
  );
  ALTER TABLE udt_roster ADD COLUMN games INTEGER NOT NULL DEFAULT 0;
  `,
  // 21: Dream Team graduation: an own bot nominated by its manager, graduated (approved by an
  // admin) into the library or rejected; with honours from level 10.
  `
  ALTER TABLE udt_bots ADD COLUMN status TEXT NOT NULL DEFAULT 'own';
  ALTER TABLE udt_bots ADD COLUMN nominated_at TEXT;
  ALTER TABLE udt_bots ADD COLUMN graduated_at TEXT;
  ALTER TABLE udt_bots ADD COLUMN honours INTEGER NOT NULL DEFAULT 0;
  `,
  // 22: Dream Team blueprints from packs: blanks and signature blueprints a manager builds an
  // own bot from (with a creation licence).
  `
  CREATE TABLE udt_blueprints (
    id TEXT PRIMARY KEY,
    season INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    rarity TEXT NOT NULL,
    created_at TEXT NOT NULL,
    used_at TEXT,
    bot_id TEXT
  );
  CREATE INDEX udt_blueprints_user ON udt_blueprints(season, user_id);
  `,
  // 23: careers: retired bots in the hall of fame with their career at the time.
  `
  CREATE TABLE udt_hall (
    bot_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    season INTEGER,
    retired_at TEXT NOT NULL,
    career_json TEXT NOT NULL
  );
  `,
  // 24: Dream Team AI managers (users with discord id "ai:<n>") and their personality.
  `
  CREATE TABLE udt_ai (
    user_id TEXT PRIMARY KEY,
    n INTEGER NOT NULL UNIQUE,
    personality TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  // 25: Dream Team tags are used as they are (any signs); the old ones get the brackets they had.
  `
  UPDATE udt_teams SET tag = '[' || tag || ']', tag_key = '[' || tag_key || ']';
  `,
  // 26: Dream Team tournaments sign up through the Dream Team (the manager enters the team):
  // registrations and teams made on the tournament page before had no effect and go.
  `
  DELETE FROM registrations WHERE tournament_id IN (SELECT id FROM tournaments WHERE kind = 'udt');
  DELETE FROM teams WHERE tournament_id IN (SELECT id FROM tournaments WHERE kind = 'udt');
  UPDATE tournaments SET seasonal = 1 WHERE kind = 'udt';
  `,
  // 27: Dream Team: a manager's switch "enter automatically when possible".
  `
  ALTER TABLE udt_teams ADD COLUMN auto_enter INTEGER NOT NULL DEFAULT 0;
  `,
  // 28: Dream Team: an own bot can be renamed once (free).
  `
  ALTER TABLE udt_bots ADD COLUMN renamed INTEGER NOT NULL DEFAULT 0;
  `,
  // 29: Dream Team market: the demand factor of an offer (the list shows "in demand" / "cheap").
  `
  ALTER TABLE udt_offers ADD COLUMN demand REAL NOT NULL DEFAULT 1;
  `,
  // 30: replays of games (Monster Hunt: runs): the whole feed and a timeline, compressed JSON.
  // Deleted with the tournament and after the days set under Settings (live.replayDays).
  `
  CREATE TABLE game_replays (
    tournament_id TEXT NOT NULL,
    match_id TEXT NOT NULL,
    game INTEGER NOT NULL,
    run INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (tournament_id, match_id, game, run)
  );
  CREATE INDEX game_replays_created ON game_replays(created_at);
  `,
  // 31: Dream Team: an own bot's one breakthrough (potential and skill +1, values cut).
  `
  ALTER TABLE udt_bots ADD COLUMN breakthrough INTEGER NOT NULL DEFAULT 0;
  `,
];
