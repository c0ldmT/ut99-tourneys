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
];
