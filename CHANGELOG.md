# Changelog

All notable changes to Tourney. Versions of the whole platform (website, bridge, install scripts) are listed
here; the UT mod has its own version (shown in the game type name and the bracket title), listed per release.

## [Unreleased]

### Added

- Neuro shop (page "Shop"): cosmetics for the season's Neuro, kept for good – titles, name colours (gradients, the
  animated "Aurora"), avatar frames, badges, player page banners, victory fanfare, bot dedication; spending only down
  to the rescue floor. Wardrobe: one item per place, change any time. Season awards (champion frame, "Top Bettor"
  title) for ended seasons. Names are drawn in their look on the header, player page, tournament table, statistics,
  bets and the kill feed. Admins: shop on/off, prices, items taken out, approval of dedications (rejected ones are
  refunded), purchase log. The website reset also deletes purchases.
- Live kill feed on the match page (mod 0.7.3, `kf` line): killer and victim in their side's colour, weapon,
  headshots, first blood, sprees and multi kills as UT announces them, suicides and team kills; the live score above
  it. The bridge relays the kills (`match.feed`), the website streams them and keeps the last 40 for late visitors.
- Tournament series (admins): made from a tournament (organizer panel → "Make a series"); weekday, local start time,
  every n weeks, created n days ahead (default 7) with registration open, so the Discord channel announces it. Names
  with {n} or {date}; pause, resume, "create the next one now", edit, delete on the page "Series" (button on the
  tournament list).
- Player page: rating over the season as a line chart per mode (a dot per game, green up, red down, 1500 dashed,
  marks where a new tournament starts, tooltip with tournament, match and date on hover).
- Ratings (OpenSkill, shown like Elo, start 1500), one per season and mode: every game of a season tournament counts, the
  margin scales the change. Bots have their own ratings and play with a bonus for their difficulty, so beating weak
  bots is worth little. Statistics page: new tab "Ranking"; player page: rating per mode and the last changes;
  tournament page: rating changes per game.
- Seasons: started, planned, moved, ended or deleted on the settings page (days in `SEASON_TZ`, default
  Europe/Berlin). A "season tournament" (one switch instead of "counts for the statistics" and "ranked", only in
  season) counts as a whole for the season of its first game: ratings, season statistics and records. Ratings and
  records exist per season only, statistics per season and lifetime; ended seasons stay in the archive.
- Seeding "by rating": the strongest meet late, bots are chosen and spread so that the teams come out about equally
  strong. The rating at the seeding shows in the bracket tooltip.
- Admin page "Settings": games with bots count (default on), points per bot difficulty step (default 100).
- Tournaments of bots only: seeding works without registered players (everybody can watch).
- "Seed (random)" mixes players and bots completely: players no longer start on the top seeds for being human. The bot
  placement setting applies to registration order and rating.
- Rescue right after the loss: a lost bet that leaves less than the floor (100 €) tops the balance up at once, not only
  with the next bet.
- Match page (click a match in the bracket or its id in the bets panel): both sides with rating and players, the
  series score, a tab per game and for the whole series with map, score, end and every player's statistics in two
  columns (frags/deaths, K/D, headshots, spree, multi kills, first blood, favourite weapon; Monster Hunt: monsters,
  points, deaths and both runs), each player's share of the side's frags (points) and an MVP; the bets of the match.
- Users page: names link to the player page (yourself: your profile); the player page also works for users without
  games and shows their Neuro.
- Betting phase: a match of a season tournament takes bets at least 20 s (setting) after it was called; when
  everybody is ready earlier (bot matches at once), the countdown of its first game waits and the server says when
  bets close. The own Neuro balance shows next to the name at the top right.
- Betting with Neuro (€), the website's virtual currency: bet on the winner of a match in season tournaments
  (never on your own match), change or withdraw until the first game starts; pools stay hidden until then and are
  shared pari-mutuel; stakes come back when no game was played. Wallets start fresh every season (start balance and
  rescue floor in the settings). Tournament page: bets panel, bracket marks open matches with €. Statistics: tab
  "Bets" with the Neuro ranking and betting records; player page: Neuro of the season.
- The control center's bots bet too: up to N per match (setting), judging by the ratings with noise that shrinks
  with difficulty and accuracy, staking by their play style (a normal bot about 200 of 1,000 Neuro on an even match), loyal to their clan, against rivals, nemesis and the
  player who beat them most. "Expert tip" while bets are open, bot bets shown after the window; bot records apart
  from the players'; "man vs. machine" bar; betting type and Neuro on the bot profile. New bot lines "bet won" and
  "bet lost" ({amount}, {pick}) said at the start of the bot's next game (mod 0.7.1).
- Bets panel: once bets close, every bet of the match (players and bots) is listed with stake and
  result in two columns, one per side (like Salty Bet), with pool and odds on top; the odds stay visible after the
  match, so a small payout is explained.
- Settings: "danger zone" to reset the website - deletes all tournaments, statistics and seasons (users, bots,
  servers and settings stay), protected by a checkbox, the typed word RESET and a last confirmation.
- Bot control center (admin page "Bots"): the website's own bots without the ini's limit of 32 - name, model, skin,
  face, voice, favourite weapon and play style, bio and colour; active or retired; random bots and import from a
  server's bot configuration. Clans with a tag in front of the name in the game; in team tournaments clans can play
  as bot teams; the names of bot teams are editable. Personality: chat lines on occasions (start, kill, death, win,
  loss, rival kill/death) with placeholders and talkativeness; rivals and a nemesis (players or bots) the bot goes
  after. Bot profile page for everybody with the head-to-head record against its rivals. Statistics and ratings
  follow the bot, not its name. Needs mod 0.7.0 for look, play style and personality in the game.

- Bets in the Discord channel of the tournament: "bets open" with the link to the match page when a match is
  called, "bets closed" with pool, odds and the biggest bet when its first game starts, the payout (or refund) under
  the result and the biggest winner and loser under the champion. Switch in the betting settings (default on).

### Fixed

- Bots of the control center show with their current name everywhere (statistics, records, ranking, tournament
  pages); bot profiles are linked from the standings and team lists.
- Manual seeding could not place bots of the control center (wrong entrant id).
- Monster Hunt: the final time (run time plus penalty) now decides to the millisecond. Before, it was compared in
  whole seconds, so a team 0.3 s faster (7:17.3 against 7:17.6) could lose on monster points.
- Monster Hunt: the bracket shows the final time of a run as soon as it is over, not only the run in progress; run
  times in the bracket show tenths of a second.
- Monster Hunt bots (mod 0.7.2): a monster they shoot at for seconds without hurting it (in a cage or behind bars,
  e.g. MH-NaliVillage, MH-Forbidden) is left alone for a while; the bots follow the waypoints and go to what opens
  the cage instead of shooting at it forever. A bot whose weapon has no ammo switches weapons and, with no ammo
  left at all, fetches ammo or a weapon instead of only dodging.

### Changed

- Discord channel posts are embeds: registration, check-in, results (series and games as fields, bets payout),
  champion (medals, bets summary), bets open and closed (odds, pools, biggest bet as fields), coloured by type and
  linked to the tournament or match page. Direct messages stay plain text.
- Tournament list: the banner of a running tournament opens the tournament page and shows the live score of the
  game in progress (frags; Monster Hunt: run times), refreshed every few seconds, with the game phase and the series.
  Statistics: filters inside the table panel like the bot control center. Icon buttons (edit, delete, copy, new
  token, remove) where the meaning is clear; a shared icon set.
- New look "Neuro Arena" (dark e-sports style): self-hosted fonts (Barlow, Barlow Condensed, JetBrains Mono), logo
  and favicon, design tokens for all colours (cyan actions, magenta highlights, gold only for Neuro, red/blue for the
  sides of a match), Neuro coin next to balances, header with a menu button on phones, footer with the version,
  page titles in the browser tab. Tournament list: the match being played now on top (series score), filters,
  cards with fill bar and champion. Default `SITE_NAME` is now "Neuro Arena" (an existing `.env` keeps its value).
- Tournament page for big brackets: bets in a side column (one open match at a time, switch between them; stake
  presets 10 %/25 %/all-in; expert tip) with the next five matches below it; only the bets of the match being played
  are listed (the history per match stays on the match pages); one compact table with placement, rating after the
  tournament and its change, wins–losses (per game on the match pages) replaces "rating changes" and "standings".
  Bot control center: compact list with icon buttons, no horizontal scrolling. "BOT" is the same badge everywhere.
- Monster Hunt: the bot AI enhancements (waypoint order, jump routes, keeping clear of movers, opening closed
  doors, unstick, the fix for once-only movers) are always on; the option "Bot helpers" is gone from the
  tournament form, which explains them in a note instead. Older tournaments with the option switched off now use
  them too. No change in the mod.
- Tournament form: SmartStockBots is in the panel "Options" next to the season tournament switch.
- Statistics: season or lifetime, search, minimum games, "without provisional" in the ranking; Monster Hunt map
  records per monster skill (dropdown) and map search; more space between the record groups; long tables scroll
  inside the card with a fixed header row and name column.

## [0.9.0] – 2026-10-14

First complete version, tested on 469f with 1v1, team deathmatch and Monster Hunt tournaments, in a LAN, from
outside over a VPN (Tailscale) and on a Raspberry Pi 3 Model B+ (website, bridge and UT server on the Pi). Not
published yet.

Mod: **0.6.0** (packages `UTTourney_v1`, `UTTourneyMH_v1`).

### Tournaments

- Single and double elimination brackets (grand final reset optional), best-of with separate values for
  semifinals and finals, seeding at random, in seed order or by hand, byes and bot fill.
- 1v1 deathmatch and team deathmatch (2on2, 3on3, 5on5) with team registration, captains, substitutes and line-ups
  per game.
- Monster Hunt as a time race: both teams run the same map one after the other; run time plus a penalty per death
  decides. Lives, monster skill, weapon stay and hardcore per tournament.
- Map vote in the game (vote window and `!vote`), ready check, countdown, pause and resume, reconnect grace and
  limits, no-show handling.
- Bots: skills 0–7 as set, bot-only matches played or simulated, stand-in bots for missing players in team games,
  optional SmartStockBots.
- Monster Hunt bots: a virtual captain gives player-less teams orders; bot helpers (waypoint order, jump routes
  over JumpSpots, keeping clear of movers, unstick, finding what opens a closed door, key monsters); a general fix
  for once-only movers that would stay closed for good.

### Website

- Discord login (or a development login for LAN tests), admins by Discord id.
- Tournament pages with the live bracket, standings, the running game and the event log; registration, check-in,
  teams and line-ups.
- Joining: per-player join tokens (short codes that can be typed), copy buttons that also work on `http://` pages,
  a ready terminal command for native Linux clients, warnings for loopback addresses.
- Organizer tools: set results, restart the current game, end a stuck run, pause and abort.
- Statistics page: players (identified by their Discord login, bots optional), per-mode tables, player pages,
  records (game, career, Monster Hunt run) and Monster Hunt map records. Tournaments can be left out of the
  statistics.
- Optional Discord notifications (channel webhook, direct messages through a bot).
- English and German.

### Bridge and game server

- The bridge starts, watches and stops the UT server, writes its own `Tourney.ini` (your ini files stay untouched)
  and connects to the website; a running tournament survives website and bridge restarts.
- Inventory scan of maps, Monster Hunt and bots; tournaments are checked against the server before they start.
- Client downloads of maps and packages (optionally through an HTTP redirect).
- Tick rate and client rate in `bridge.json` (defaults: the 469f values 50 and 20000).
- `tourney-bridge import-bots`: takes the bots from a `User.ini` (e.g. from your PC).

### In the game (mod)

- HUD with the tournament state, the bracket, standings and the Monster Hunt run banner (time, deaths, time to
  beat, map record).
- Spectators follow the players; players on the bench watch.
- Player statistics per game and run (kills, deaths, suicides, team kills, headshots, first blood, sprees, multi
  kills, kills per weapon, time, monsters and monster points), for players and bots.

### Installation

- Release bundle (`pnpm release`) with install scripts for Raspberry Pi, Linux (systemd) and Windows (scheduled
  tasks); guides in `docs/`.
- `install-ut.sh` sets up the UT 469f server on Linux/ARM64, builds the mod (with a timeout) or installs files from
  your PC: a prebuilt mod, SmartStockBots, your bots.
- Guides for SmartStockBots, your own bots, tick rate (`docs/server-extras.md`) and players' network settings
  (`docs/client-settings.md`).

### Mod versions in this release

| Mod   | Changes                                                                                    |
| ----- | ------------------------------------------------------------------------------------------ |
| 0.3.0 | 1v1 and team deathmatch, HUD, vote window, spectator follow                                |
| 0.4.0 | tournament logic moved into `TourneyCore`                                                  |
| 0.5.0 | Monster Hunt time race (`UTTourneyMH_v1`)                                                  |
| 0.5.1 | messages for the organizer tools (restart a game, set a winner, call a match off)          |
| 0.5.2 | mod version in the game type name and the bracket title                                    |
| 0.5.3 | bot skills as set (before, every bot played at most like "Skilled")                        |
| 0.5.4 | Monster Hunt lives, monster skill, weapon stay and hardcore from the tournament; end a run |
| 0.5.5 | Monster Hunt bots: virtual captain and waypoint fix                                        |
| 0.5.6 | bot helpers: jump routes, keeping clear of movers, unstick; bot debug log                  |
| 0.5.7 | map fix for once-only movers, bots open closed doors, lifts, key monsters                  |
| 0.5.8 | bots no longer wait in front of opening doors                                              |
| 0.5.9 | join tokens compared without regard to case (short codes)                                  |
| 0.6.0 | player statistics; Monster Hunt map record in the HUD                                      |

### Known limitations

- `ucc make` hangs on the ARM64 build of 469f (seen on a Raspberry Pi): build the mod on a PC and install it with
  `install-ut.sh` (see `docs/install-raspberry-pi.md`).
- Team games: `TournamentTDM` is not a `TeamGamePlus`; the bot order "Follow me" causes harmless `Accessed None`
  warnings in the server log.
- More in `mods/ut99-tournament/README.md` (Known limitations).
