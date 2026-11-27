# Changelog

All notable changes to Tourney. Versions of the whole platform (website, bridge, install scripts) are listed
here; the UT mod has its own version (shown in the game type name and the bracket title), listed per release.

## [Unreleased]

### Added

- Settings › Dream Team league: keeper choice window (last days of the season) as a field, On this page like the other tabs, server choice as One server or Server pool with the pool's servers and their switches, automatic map pool as chips, money table and cup bonus aligned (decision 332, patch note 332).
- How it works on the administration pages (overview, new tournament, series, servers, bots, settings); long hints of the tournament form, series and bots pages moved into the guides (decision 329, patch note 331).
- League team names link to the team's squad (table, matchday, Final Four, next game) and the hub's league card has All teams (decision 330, patch note 331).
- Other teams' bots show their potential in the read-only details (decision 331, patch note 331).
- How it works on the player pages: Matches, tournament, match, calendar, statistics, shop and account get the guide button (cyan) with their own guide; How betting works in the bet panel opens the tournament guide at its bets section instead of a fold-out (decision 328, patch note 328).
- How it works on every Dream Team page: a ? button in the page head opens a short guide (one sentence, facts, steps, details to unfold) instead of the fold-outs and the one Dream Team help; links like Stamina or The rules in detail open it at the right place (decision 327, patch note 327).
- Bot details on My team with tabs Development, Traits, Use and Manage below level, stamina and form; a dot marks what is to do and the dialog opens there; on a team's squad page a click on a card opens the same details read only (decision 326, patch note 326).
- Tournament presets per admin: save the form's settings under a name, apply them with one click (name and date stay), delete them; GET/POST/DELETE /tournament-presets, migration 61 (decision 325, patch note 325).
- Tournament form: compact sections (one line each, all open remembered per browser, everything open when editing), the summary leads to the sections, date and flow in one row, section Server and tempo with tiles one after the other / parallel (stepper, estimate each, the pool servers and their state); the duration estimate counts parallel matches (decision 324).
- Packs: inventory, crafting and workshop in one card with tabs; search over name and effect, category, rarities and craftable only (remembered per browser); traits as tiles, crafting grouped by category with the reason a craft is locked; the workshop shows the chosen card with reroll and upgrade side by side; new cards marked New; Dream Team tab Workshop (decision 323, patch note 323).
- Tournament page live: the live row keeps the live match's height and the bets scroll inside it (names, pools and odds stay on top); a live bar under the header once the live row has scrolled away, with score, clock, the parallel matches to switch between, a way back up and, for a player of the match, the copy button for the connect command; phones show the first bets with All n bets (decision 322, patch note 322).
- Status and controls by one rule: season states and server online/offline as the phase badges of the tournament list; filters that act at once (statistics: show bots, settled only) and the admin/moderator roles on the user list as switches (decision 320).
- Administration start page (/admin, first entry of the Admin menu): servers (online, pool, what they play), moderation queue, season, tournaments, users and the latest problems (paused and aborted tournaments, server warnings and errors since the last restart) with links; GET /admin/overview (decision 319).
- Hover cards for bots and teams: resting the mouse on a linked bot or team name (or reaching it with the keyboard) shows rarity, skill, level, value, team and form of a bot, or manager, size and best bots of a team (decision 318).
- Two building blocks for choosing: na-tabs (tab rows) and na-segment (segments and filter chips) with one tab stop and arrow keys; settings, statistics, shop, bots, match, player, tournament admin, lineup, moderation, feedback, calendar, market, league, overview filters, league settings and the tournament form use them; league tiers as a segment, moderation and feedback with tab rows (decision 317).
- Two levels of depth on the Dream Team pages: the sides of a trade, its balance and the own bots of the academy are flat surfaces instead of framed boxes inside a card; token --well for the dark faces inside cards (decision 316).
- Tints of the token colours (188 rgba values) use color-mix with the token, so they follow it; no visible change; the UI ratchet counts rgba (decision 315).
- Quick search in the header and with Ctrl+K: bots, teams, players, tournaments and pages (admins: administration and all users); `GET /search` (decision 313, patch note 313).
- Dream Team hub: "For you" with what needs the manager (urgent lineup before a game, trades, cup sign-up, points, market day) and "First steps" for new managers instead of the help opening by itself; the hub sends `now` and `onboarding` (decisions 311, 312, patch note 312).
- Account page instead of the profile: name as others see it, in-game name, join token (copy, new token after a confirm), language and Discord messages in one column; settings with a section index on wide screens; the shop opens the wardrobe with `?tab=wardrobe` (decision 310, patch note 310).
- Packs: a slim stage until a box opens; calendar: league chips without the time, their names fit (decision 309, patch note 309).
- League games: the overview names the own game on its evening's row (no second row), a league game's page shows a result card instead of bracket and table (decisions 307, 308).
- Header: shop with its name on wide screens, burger menu with the administration heading and the profile; bot pages mark the Team tab; the test bar folds (decision 306, patch note 306).
- Dream Team pages share one plain page head with a violet kicker (area), the club house without a card around its buildings; long rules (trading, market legend, scouting, mentors) behind "So funktioniert's" (decisions 304, 305, patch note 305).
- Colours equal to a design token use the token (45 places, no visible change) (decision 303).
- Empty lists say what comes next (overview, statistics, trades, moderation); tab rows on phones fade out where more tabs are (decision 302, patch note 302).
- Locked purchases say how much Neuro is missing (shop, club house, packs); shop and club house use quiet buttons, a locked 10-pack is grey (decision 301).
- No browser dialogs left: reasons, team names and academy news in the website's dialog; the +n plaque no longer covers a card's rarity; lineups write NX Nova instead of NXNova (decision 300).
- The website's own confirm dialog instead of the browser's for buying, selling, deleting and other irreversible steps; destructive ones in red with the focus on Cancel (decision 299, patch note 299).
- Dates and times written the same way on every page (I18n.when), German dates on the statistics pages, local times in the ledger (decision 298).
- Design tokens for type sizes and corner radii used everywhere, small text at least about 11px, the faint grey readable (4.5:1); test ui-tokens.test.ts keeps raw values from coming back (decision 297).
- Neuro shown with its own N coin and the symbol N instead of €; consistent wording: Teams (all teams of the season), Dream Team league, server names, real plurals, rarities in German, shop tiers in the rarity colours, own place on finished cups, no BOT marks in Dream Team tournaments (decisions 295, 296, patch note 296).
- scripts/ui-snapshots.mjs: demo data and screenshots of every page at 1280 and 390 px for UI reviews.
- One live list for parallel matches and league evenings (tournament page, league page, overview); the header counter counts matches; league evenings reserve the pool only as long as parallel games need (decision 294, patch note 294).
- Tournament page: live section with the list of running matches and the chosen one with its bets; joining in the side column, no more scrollbars (decision 293, patch note 293).
- User list: AI managers without login columns, not counted as inactive (decision 292).
- Parallel matches: tournaments and series may use up to 8 servers at once; extra pool servers play the bot matches at the same time, matches with players stay on the main server; tabs per running match, extra servers with their connect command (decision 291, patch note 291).
- User list (admin): last activity and last login per player, inactive players (30 days) marked and sorted first (decision 290).
- Elite packs rise a little less with the index (index^0.35; 24,590 at index 5) (decision 289, patch note 289).
- deploy/update.sh: updates a running installation from the PC (bundle, optionally the mod, backup first, checks) (decision 288).
- Moderation: admins correct a text by hand (name, team name and tag, bot name, single chat lines, trade message) (decision 287).
- Premium and elite packs: higher base prices, a much flatter rise with the index (index^0.4 above 1; elite at index 5: 26,650 instead of 50,000) (decision 286, patch note 286).
- Header: administration in one dropdown, account (profile, language, logout) behind the avatar, the bar keeps one line (decision 285).
- Further game servers play from the one UT folder (own Tourney-<n>.ini/log only); older instances are moved onto it by install.sh; the bridge finds maps behind folder links (decision 284).
- Moderation: word filter for player texts (names, team names and tags, bot names, chat lines, trade messages), reports, moderator role, queue with reset, warnings, text and login bans, log, check of all texts (decision 283, migration 58, patch note 283).
- Several game servers: add-instance.sh, server pool with automatic server choice for tournaments, series, cups and the league (games of an evening side by side), no overlapping sign-ups, live tiles per server and a live counter in the header (decision 282, migration 57, patch note 282).
- Backups and moving to another server: deploy/linux/backup.sh and restore.sh, a nightly backup timer, a VPS section in the Linux guide and docs/move-server.md; the website refuses a database of a newer release (decision 281).
- Prestige stars on Dream Team cards as ★N, the chip fits small cards with many stars (decision 280, patch note 280).
- Yearbook and hall of fame show the prestige stage a bot reached (decision 279, patch note 279).
- Mod 0.23.0: the seven traits of wave 2 in the game, with their trait log (decision 278, README test 76, patch note 278).
- Seven Dream Team traits of wave 2 (belt runner, escape artist, close quarters, Hitscan Sniper, power surge, focus fire, last stand) in the catalogue, the duel simulator, the texts and the trait log (decision 277; in the game with mod 0.23.0).
- Mod 0.22.0: the nine traits of wave 1 in the game, with their trait log (decision 276, README test 75, patch note 276).
- Nine Dream Team traits of wave 1 (cool head, quick draw, spawn guard, fast hands, clutch, quartermaster, momentum, trigger discipline, arsenal) in the catalogue, the duel simulator, the texts and the trait log (decision 275; in the game with mod 0.22.0).
- Market pages: signatures, mentors and loans on the market, loan banner, settling in and the prestige of settled bots in the bot details (decision 274, patch note 274).
- Signatures in the API: drawn on the market day from the bots' lifetime statistics, in market values, the league model and the games; mentors pass them on (decision 273, migration 56).
- Mod 0.21.0: signatures of library bots in the game, new line `bsig` (decision 272, README test 74).
- Signature rules for library bots: seven career marks with two levels, sized with bot:sim (decision 271).
- Loans: an offer of the day plays 7 market days for 15 % of its value without salary, one per team; buying it then costs the price less the fee (decision 270, migration 55).
- Bought bots settle in after 10 Dream Team games and get 2 prestige points; prestige points count 4 % each against a team value cap (decision 269, migration 54).
- Club house page with levels, the analysis room in the next league game, the trophy room (crest next to the team name, trophy wall with league titles), the new scout report and development tiles (decision 268, patch note 268).
- Dream Team club house v2 (migration 51): ten buildings per season, training ground, physio and scouting office in three levels; analysis room, boarding school, workshop, fan shop, mentor wing, sports psychologist, trophy room with crest. AI managers build too. The pages follow.
- Dream Team prestige on the website: bot details with the prestige menu, ascension and stars; cards show prestige and stars, the hub the prestige points to place.
- Dream Team club upgrades per season (migration 50): training ground (+10 % experience), physio (rest 20 % cheaper), scouting office (scouting 25 % cheaper, sharper reports); AI managers buy them too. The page follows.
- Mod 0.20.0: Dream Team prestige in the game - the bridge sends a bot's prestige points (bprs), the mod plays them: aim, reaction, dodges and view on the skill curve, damage dealt and taken, armour at the spawn, sprint to items and on the retreat, ammo.
- Dream Team prestige rules (plan Season 3 P3): stages mature / Godlike / ascended with caps 4 / 6 / 6 + stars, the prestige menu (nine stats, at most 3 points each), points from left-over level points and Neuro, progressive prices; the duel simulator and the game model know prestige (bot:sim section "Prestige"). No change on the website yet.
- Mod 0.19.1: base AI by level on the skill curve - safety distances of splash weapons now and then, fewer weapon switches in fights, a switch before the last shot, less push towards drops, higher levels head for power items shortly before they are back; the measures count switches between enemies.
- Mod 0.19.0: measures of every bot in the game statistics - weapon switches and the time to the next shot, enforcer time in fights, retreats by health and how they ended, power items and how long they waited, suicides by damage type; the trait report downloads them per skill and per map (CSV).
- Dream Team: trait workshop on the packs page - reroll an inventory trait into another of its rarity or upgrade it one rarity (random), for Neuro and scrap.
- Dream Team: training camp in the bot details - +60 XP for a bot once a day for 300 × √index Neuro.
- Dream Team league: the AI clubs' strength regulates itself per tier - after every league evening it moves by 0.02 when the humans won more than 70 % or less than 55 % of their last 20 played games against AI clubs (0.8-1.3, carried into the next season); Settings → UDT Liga shows factor, rate and AI traits per tier.
- Dream Team league: AI managers get their own clubs (games against humans played, against AI clubs simulated, table money yes, cup bonus no) and are marked on the league page.
- Analysis export: the replays of the games (feed, timeline, players at the end) come along with neutral names (`--no-replays` leaves them out).
- Analysis export on the server: `node website/dist/export-cli.js <tourney.db> <folder> --bot-logs <bot-logs>` writes the anonymised database, feedback texts and bot logs with the same neutral names into one folder.
- Bridge: bot logs are kept 90 days by default (`botLogDays` in bridge.json, 0 = for good) instead of 14, earlier days are gzipped, and every line names its tournament.
- Feedback: a "Feedback" link in the footer sends the admins a message any time; at the end of a season admins open a short survey for the Dream Team managers (fun, money, prices, salaries, bot development, traits, league), which the website asks once per visit; answers and messages download as CSV without names.
- Dream Team: a daily snapshot of every team (money, roster value, salaries, strikes, strength) and roster bot (skill, level, experience, points, potential, value, stamina, form, traits) after the market day, for season analyses (in the anonymised database copy).
- Patch notes: after an update the website shows what changed once in a modal (per user, guests per browser); the footer link "Patch notes" opens all of them again.
- Dream Team: 29 new traits in every rarity (now 62) - e.g. light feet, scavenger, second wind, health hound, talent scout, cold blood, regeneration, captain, juggernaut, overload, weapon master (pick a favourite weapon), warden, deemer dream, rewind, hivemind, monster whisperer and dynasty, Monster Hunt traits among them; the bouncer no longer jumps all the time but dodges more often (mod 0.18.0).
- Dream Team: a Monster Hunt focus for your team on My team - from Hunter (fights every monster, big ones too) over Standard to Sprinter (runs past, only fights what is in the way) (mod 0.17.0).
- Mod 0.17.0, trait log: the match page shows what every Dream Team trait did in the game - when it switched on, how long, kills meanwhile and how it ended (kill, death or nothing), healed health, prevented damage, dodges and more; the feed has a "Traits" filter, the server log a line per trait episode, and admins download a trait report of the season (CSV/JSON) for balancing.
- Monster Hunt run panel: the map's objectives with the running team's progress (mod 0.17.0).
- Calendar (menu "Calendar"): tournaments, Dream Team cups and the planned starts of the series, league evenings with your game, relegation and final four (before the league starts its plan), season start and end, keeper window and paydays - as a month or a list, with filters, "only mine" and what comes next; on phones as a list and a month with dots.
- Settings → UDT Liga: a status card shows where the league stands (off, starts on …, starts next season, evening x of y, champion) and starts a regular league or a test run in the running season at once (with its plan).
- Activity bar under the header: everybody sees when the server sets up a league evening (with progress) or is very busy and pages take longer.
- Dream Team league page: the table of every tier with zones, form and the season's timeline; the matchday with the games on the server and the AI games as a conference, a live table with moves; the fixtures (only yours at a tap); the season finale with final four, relegation and who goes up and down; the history. My team shows the next league game, the home team picks its map. Settings: tab "UDT Liga" with the server time per league evening and the test league.
- Dream Team test mode: "Matchday now" plays the next league evening, "League season end" the rest of the league.
- Dream Team league: managers' teams and AI clubs play a double round robin in tiers (Pro Series, Division 1 ...) on league evenings, games with a manager on the server, AI against AI simulated and shown during the evening; table with overtime points, weekly table money and cup bonus, relegation and the Pro Series final four as the season's finale, promotion and relegation into the next season, a test league in a running season (admin settings).
- League simulation for the Dream Team league: `pnpm --filter @tourney/api udt:league-sim [export.db]` plays several seasons with the league and keepers against today (index, money, keepers, strikes, wins against AI clubs, champions).
- Dream Team keepers: on the last two days of a season (and until the next one starts) every manager picks up to two bots the team made on My team; next season they play again - one skill step lower (not below Skilled), with their potential and values, without traits, experience or salary. The founding form takes last season's team name and tag.
- Anonymised database copy for simulators and analyses (`pnpm --filter @tourney/api db:anonymize <tourney.db> [out.db]`): players, bots, clans, teams, tournaments, series and servers get neutral names in every table and in the event log; sessions, tokens, Discord ids, webhooks, server addresses, free texts and replays go; numbers stay, so wallets and the Dream Team economy compute the same. The source stays untouched; a final scan reports any original name left.
- Dream Team licences: as many as a manager pays for - each costs twice the one before (2,000 / 4,000 / 8,000 / 16,000 … × index); the limit of four own bots per season is gone. Blueprint bots now draw 75 % of a bought bot's salary (starter, talents and apprentices stay free); the bot details show a bot's salary.
- Dream Team: bots you made (starter, talents, apprentices, blueprint bots) can be traded like bought ones - every roster keeps at least one bot, not while nominated for the graduation. At the new team they stay own bots (no salary, they keep developing); their maker stays their breeder and keeps counting them for the licences. Market sales stay for bought bots.
- Dream Team academy: a mentor now teaches a bot your team made instead of making a new one - in the mentor panel pick the mentor card (a bot of your roster with skill 6 or more and level 3, also one you made) and the apprentice (a bot your team made with a lower skill that never had a mentor) then the apprentice card, and see what it learns as bars before → after (only bots that qualify are offered; a fold says why the others do not, and the running apprenticeships show whether the experience bonus is active): accuracy, alertness and strafing rise half the way to the mentor's (three quarters with the mentor trait, never down), its play style moves towards the mentor's, a trait may be passed on, and it gains 50 % more experience in matches while its mentor is in the team. Free, no licence, no name to type.
- Dream Team breakthrough: a fully developed own bot (level 10, skill at its potential, all values at 100) can raise skill and potential once for development points; its values drop by about a third, so it comes out a bit stronger and grows further with training. Fully developed bots lose the points plaque.
- Tournament page: the match being played in the match page's look - scorebar with clock and limits, every player's health and frags - and a tap opens the match page.
- Dream Team bot page: team, card, potential, Dream Team statistics (games, wins, K/D, damage, latest matches) and career; every bot link in Dream Team leads there, the normal bot profile only shows for bots that also play normal tournaments.
- Dream Team potential on every card of an own bot and as a skill ladder in the bot details and the academy, so a closed skill step explains itself.
- Mod 0.16.0, live data on the match page: health and armour bars, weapon, powerups (damage amplifier with its seconds, shield belt) and ping of every player, a table per team for 2on2 to 5on5; damage dealt and items taken per side, the momentum of the game, items and what bots are up to in the feed (with filters), kills with the killer's health and the distance. While a human plays, health, items and bot thoughts arrive 20 s late (Settings → Live data); bot-only games are live. Monster Hunt: the run panel with the time to beat, monsters left and the points of both runs.
- Replays: after a game the match page keeps its momentum, damage and items and the whole feed (kept 60 days, setting). Statistics: damage and items per player, records for the most damage and amplifiers in a game. The bridge logs what bots do (`bot-logs/`) for tuning the bots.
- 3D look preview: wherever a bot's look is chosen (Dream Team, control center) the model turns next to the choices with its skin, face and the talk portrait, team colours at a tap; drag turns it. The bridge reads models and skins from the game server's own files (new models and skin packs show up by themselves); the website keeps them, so they also show while the server is off.
- Mod 0.15.0: bots dodge rockets and other projectiles themselves - weak bots late or to the wrong side, sometimes without leading their target; strafing makes bots dodge more; weak bots use fewer detours. A bot left with only the impact hammer stops chasing an enemy it cannot reach and looks for a weapon (DM-SpaceNoxx).
- Dream Team: market values weigh accuracy more and alertness less; daredevil reacts faster, bouncer dodges more.
- Mod 0.14.1: the game server reports its bot classes' defaults (mesh, skin format, voices, default skin), so every model on the server - War Boss, Xan Mark II, custom packs - gets its skins, faces and voices in the look picker without maintenance; the bridge asks once per class and keeps the answers.
- Bot duel simulator: combat style, jumpy and strafing in the model, a comparison of all play-style values with weights for the market value, and the planned rows for mod 0.15.0 (`--curve scripts/bot-curves/plan-0.15.json`).
- Page changes fade out and in (the header stays); a new page starts at the top, back and forward keep the place.
- One loading display for the site: a page appears at once when its data is there (rising and fading in), the logo loader shows only for slow page loads, a thin line under the header for later loads and actions.
- Dream Team My team: drag and drop (or tap and tap) for the lineup, the roster and the traits, saved at once with undo; a bot's details with experience, development points (gold plaque on the card), traits, rest, renaming and look.
- Dream Team form of the day: every bot is in form, normal or out of form, new every day (±10 accuracy in Dream Team games), shown on the cards as "Form ▲ / ▼".
- Mod 0.14.0: skill curve v1 - the level is the main strength, the bot's own accuracy counts less; low levels turn slower, take a moment to react to a new enemy and pause firing. Dream Team values traits (steady hand, watchdog, side-stepper, patient hunter, eagle eye, all-rounder) now improve aim, reaction, view or dodging in the game instead of raising accuracy.
- Bot duel simulator (`pnpm --filter @tourney/api bot:sim`, HTML report): skill levels against accuracy and Dream Team traits in 1v1 meetings, guard rails, what each part of a level adds, reaction from an ambush, A/B against a curve file (proposal v1 included).
- Messages as toasts in the page's language: every error of the website is translated (German for every server message) and every action of users and admins confirms itself; the red error lines on the pages are gone.
- One Neuro state for the whole website: navbar, bets panel, shop and Dream Team pages show the same balance, pushed by the server when it changes (results, rewards, purchases).
- Dream Team help: "How it works" button in the Dream Team navigation (opens by itself the first time) with the ways to new bots.
- Dream Team: rename an own bot once for free (academy and My team).
- Mod 0.13.0: skill curve instead of UT's novice switch (all game types, setting under Bot AI help): every bot uses the full AI, the level sets speed, view, hearing, dodging and aim; aim error drifts instead of jittering, no long fire at walls, bots turn to hits from behind; works with SmartStockBots (two of its options are switched off at run time).
- Dream Team: rest bots with Neuro (2 per stamina point); "Enter automatically when possible" on the Events page.
- Servers: sync models and skins from the game server (texture packages, custom model packs), import bots on the Servers page; custom bot packages go into ServerPackages.
- Dream Team: look and chat lines of own bots (founding, academy, later), squads of all teams, a Dream Team draw on the tournament page; AI managers enter as soon as the sign-up opens.
- Mod 0.12.0: bot chat lines in the kill feed.
- Mod 0.11.0, Dream Team behaviour traits group 2: sniper's nest, team player, shuffle dancer, item controller (in the packs).
- Unreal Dream Team season finale: a Dream Team tournament can be the finale (no sign-up, the top of the season table
  plays); the season's Dream Team champion gets the frame "Dream Team" and the title "Dream Team Champion" in the shop.
- Unreal Dream Team AI managers (off by default; settings "Dream Team"): up to eight AI teams with a personality
  play the Dream Team like managers - market, packs, traits, academy, lineups, sign-ups, trades. They do not bet, get a
  small sponsor, and count neither for the betting rankings nor for the economy index, high stakes or place rewards.
- Careers of all bots: age in seasons, career level, phase (rookie, rising, peak, veteran, decline) and form on the bot
  profile and on the Dream Team cards; the phase changes accuracy and market value in Dream Team games. Admins retire
  old bots into the hall of fame (yearbook page), which suggests candidates.
- Unreal Dream Team blueprints: packs now and then bring a blank or a blueprint (signature blueprints with a start
  trait); the academy builds an own bot from it (points, skill cap, model from rare on) with a creation licence.
- Unreal Dream Team academy: creation licences, scouting (three talents with value and potential ranges), apprentices of
  mentors (with the new mentor trait), development points per level up to the potential; own bots stay with their
  team and draw no salary. Graduation (15 games, level 5, approved by an admin) turns them into library bots with
  their breeder ("homegrown" on the market, breeder bonuses); a yearbook per season and the best breeders.
- Unreal Dream Team behaviour traits (mod 0.10.0): vulture, kamikaze, berserker, revenant and bounty hunter steer the
  bot's AI in the game (in the packs). Needs mod 0.10.0 on the game server.
- Unreal Dream Team body traits (mod 0.9.0): starter armour, thick skin, adrenaline, glass cannon, vampire and phoenix
  are played by the game server (one per bot, in the packs). Needs mod 0.9.0 on the game server.
- Unreal Dream Team high stakes: Dream Team tournaments with an entry ticket (fixed or at the economy index) and a
  smallest number of human teams; the best team takes 60 % of the tickets plus one ticket, the second best 20 %.
  Tickets come back when a team leaves, is left out or too few teams enter, or the tournament is called off.
- Unreal Dream Team trades (page "Trades", badge for waiting offers): offer bots and Neuro to another manager and ask
  for bots and Neuro; the partner accepts or declines, the proposer can withdraw, offers expire after 48 hours. Brakes
  against moving Neuro (settings "Dream Team"): balance of both sides, fee on what each side receives, lock after
  buying or trading, trades per pair and week. Bots keep their traits, level and stamina.
- Unreal Dream Team packs and traits: page "Packs" with three boxes (standard, premium, elite) and 10-pulls, open
  drop rates and pity, an opening animation (charge up, burst, cards dealt face down, flip one by one or all,
  legendary banner); trait inventory, scrap and crafting. Traits go on roster bots within the slots of their level
  (1, 3 from level 5, 5 from level 10): values traits change what the game gets (accuracy, alertness, strafing,
  jumping, favourite weapon, aggressiveness, camping, Claudius' heir +1 skill), manager traits change stamina,
  salary, rewards, market value and experience. Cards show the values with traits and the trait chips.
- Unreal Dream Team on the website (add-on, off by default; settings page "Dream Team"): menu item "Dream Team" with
  My team (found a team with a self-built starter bot, lineups for deathmatch and Monster Hunt with bench, roster with
  stamina, value and sell-back, Neuro ledger), Market (daily offers as cards with rarity and value trend, hidden bids),
  Events (enter Dream Team tournaments, see which lineup plays and why not) and the season table. The tournament form
  marks Dream Team tournaments with value cap and star limit. A test instance (`TEST_MODE=true`) shows admins a test
  bar to move time, run market days, add test managers and end the season.
- Unreal Dream Team, groundwork: package `@tourney/udt` with the economy rules (market values from skill and play
  style, economy index, salaries, rewards, stamina, packs with pity) and a season simulator on real betting data
  (`pnpm --filter @tourney/api udt:sim <export.db>`, HTML report with index, wealth and roster curves per manager type).
- Bot AI help in deathmatch and team deathmatch (mod 0.8.0, settings page "Bot AI help", on by default): bots
  that stand still or find no enemy for long get moving again, and in one-on-one games a bot without an enemy hunts
  its opponent, so bot duels no longer stall. Monster Hunt and other game modes are not touched.
- Series schedules: weekly on several weekdays (every n weeks) or daily; at fixed times (up to 24 a day) or every n
  hours within a window ("daily, every 4 hours"); lead time in minutes, hours or days (whole days in local time);
  {time} in the name; the form shows the next three tournaments. "Start by itself" (series and single tournaments):
  at the start time the bracket is seeded by rating and check-in starts; a busy or offline server is waited for up
  to an hour, then the tournament is called off. Starts missed while the website was down are skipped.
- New tournament form: sections as cards (name and date, game and bracket, rules and maps, server, bots, Discord,
  advanced), segmented buttons and switches, map tiles with search and "all/none", a summary on the side with the
  create button (a bar at the bottom on phones). "Repeating series" right in the form: weekday, time, rhythm and
  lead days with the same settings as a tournament; series are edited in the same form (Series → edit).
- Bots of a tournament come from the bot control center: its active bots with their skill, until the bracket is
  seeded (then the pool is fixed). The per-tournament bot list with single skills is gone; older tournaments switch
  when they are saved. API: `botPool` is optional (missing or empty = control center); `POST/PATCH /series` take a
  `template` (the tournament settings) instead of `fromTournament`.
- Neuro shop (bag icon next to the Neuro balance in the header): cosmetics for the season's Neuro, kept for good – titles, name colours (gradients, the
  animated "Aurora"), avatar frames, badges, player page banners, victory fanfare, bot dedication; spending only down
  to the rescue floor. Wardrobe: one item per place, change any time. Season awards (champion frame, "Top Bettor"
  title) for ended seasons. Names are drawn in their look on the header, player page, tournament table, statistics,
  bets and the kill feed. Admins: shop on/off, prices and items taken out on the settings page, approval of dedications (rejected ones are
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

- Phone pages no longer get wider when a tab row shows a dot (screen reader text of the dot positioned at the row's start) (decision 332).
- Page heads with a guide button: key figures, admin buttons, the season select and the balance stay at the right again instead of moving next to the title (decision 329).
- Packs: the inventory, scrap and crafting list change only when the cards of a pull are face up (they told the result while the box was charging); bot cards on a squad page are as tall as their row, so their marks line up (decision 321).

- Header on phones (up to 520 px): the logo without the wordmark, no button shrinks, nothing sticks out at 360-430 px (the burger stuck out by 5 px at 390 px) (decision 314).
- deploy/update.sh ended without a word with a real release bundle (tar died of SIGPIPE behind `head`, `pipefail` ended the script); the same in update-remote.sh on the server. Both now name the failed line on any error, and `sh deploy/update.sh` continues in bash.
- backup.sh and restore.sh work in /var/tmp instead of /tmp (a small RAM disk on newer systems: the game content may not fit on a Pi 3).
- Dream Team: fully developed bots no longer show development points to give (hub, My team); their level points are kept for prestige.
- League games: their page no longer offers a sign-up or organizer buttons like "Draw bracket" - it shows the two clubs, the matchday and your lineup link, and you can bet as before.
- Monster Hunt match page: the "Monsters / deaths" column counts the monsters killed (it stayed at 0), the running time includes the death penalty like everywhere else, and the useless "monsters left" bar is gone (bosses left stay).
- Monster Hunt map records: Dream Team games are season games and set records too.
- Dream Team packs: a blueprint drawn with a full blueprint inventory is no longer scrapped by itself - you choose which blueprint goes (scrap or build one before the next pack); every blueprint can be scrapped from the inventory. As an apology every manager of the running season gets a legendary blueprint (outside the limit) and a message at the next login.
- Dream Team league: setting up a league evening no longer blocks the website (games are made and simulated in steps), quiet minutes cost next to nothing and starting a league is about twice as fast.
- Drawing a bracket again (after a reset or with "draw again") showed the old pairings in the bets panel and the bots bet on them; old bets could even move to another team (fill teams keep their ids like "udtbots-1"). A new draw now voids the bets placed so far (stakes back) and the bots bet on the new matches. Deleting a tournament and creating one with the same name no longer keeps the bots from betting.
- Dream Team: a team left out at the draw because its bots play in another drawn or running Dream Team tournament (one tournament at a time) no longer vanishes silently: the Dream Team page and the tournament page warn before the draw, automatic sign-ups (also the AI managers') wait until the bots are free, and the organizer is told after the draw which teams are not in the bracket and why.
- Drawing a bracket is much faster, above all late in a season and for Dream Team cups: the betting bots no longer settle every bet of the season for each bet they place, the AI and automatic sign-ups read only the tournament they enter, and season dates, bot pools and the bots playing elsewhere are read once instead of per entry. Tournament pages and the Neuro balance load faster too. Nothing in the rules changes.
- Bot bets with many bots per match (up to 50) are much faster: a round of bot bets reads the season's betting data once and stores its bets in one write.
- Dream Team games: two bots with the same name in the game (a bought "[ND]Xan" and an own "Xan" under one tag, or a fill bot whose clan tag is a team tag) both play now (the second gets a number); rivals and nemeses also work under the manager's tag.
- Bot ratings in the seeding, the bracket and the betting bots' tips: website bots now count their real rating (it was never found, so only the skill counted); Dream Team brackets show ratings and the betting bots tip on them.
- Dream Team: the team value cap counts a developed starter (above a default one) and own bots at their current strength; the hidden potential can no longer be read from the yearbook, from crossing the scout report with the roster, from a blueprint's range or from the bot's id.
- Dream Team salaries: a bot on strike owes its salary until a market day can collect it (the strike ends then); a Monday the server missed is charged on the next market day; a sale pays what is owed; striking bots cannot be traded.
- Dream Team at the season end: rewards, pot and table stay with the tournament's season (a cup ending after midnight paid nothing or into the new season), tickets go back into the season they were paid in, sign-ups of a season that is over close with the tickets back, series make no Dream Team tournaments out of season or with the Dream Team off; deleting a drawn high stakes tournament gives the tickets back; rules with paid entries stay. The season champion is the winner of the last finale or the top of the table.
- Dream Team founding: every starter bot has skill 3 (like the blueprints), the start points go into its values; a lower or fractional skill was priced below what it plays (the game rounds the skill, and skill 2 with top values became skill 3 with them after three points).
- Dream Team: a bot playing in a seeded or running Dream Team tournament (also a paused one or the finale) can no longer be sold or traded until the tournament ends; before, the seller kept the rewards of its games and a later buyer got their stamina and experience.
- Dream Team trades: when accepting failed on the fee, a second accept took the bots without paying the asked Neuro (the partner still got them); payment, fee and bots are now booked together or not at all.
- Dream Team careers counted no wins in Dream Team games and missed bots' games in normal tournaments (also in the market's form); live frag and time limits show when the tournament keeps the defaults.
- Monster Hunt: the kill feed of the match page vanished after the first run of a game; it goes on in run 2 and shows each run with its own times.
- The bridge no longer offers the tournament mod's internal bot classes (`TourneyMale1Bot` etc.) as models.
- Server sync: the bridge also reads the .int files in SystemLocalized/int (UT 469) and keeps all voice packs (with their meta class) and texture entries; skins named with 4 letters only (Cyborg Trooper) were missing.
- Pages that load in an effect (tournament page with its live connection, the names' looks) loaded twice since the loading display; the Dream Team market no longer marks sold bots as in demand or cheaper.
- Team names of the list are drawn at random; a bot team that fills a Dream Team bracket never has the name of an AI team (or another team).
- Player pages: no more "player not found" toast for players without games in the season; the Dream Team badge "Blueprint" is translated; market offers without the library clan tag.
- Mod 0.12.1: bots cut off from their opponents (DM-SpaceNoxx: upper ring, kicker) are moved to a start spot with a path to one; bouncing on a kicker counts as staying in place; repeated stuck spots get a detour; no more `Accessed None` in StakeOut after the AI help cleared an enemy.
- Bets: the expert tip showed an internal id for Dream Team sides; a Dream Team bracket full of AI teams looked closed for humans.
- Mod 0.10.1: bots no longer run back and forth on the spot or stay stuck (deathmatch games): hunts without a path or progress are given up, stuck bots jump aside, take detours and as a last resort move to a start spot (with Bot AI help).
- Dream Team tournaments: registering on the tournament page enters the Dream Team (one sign-up, one count with the Dream Team events page); the page shows the teams with tag and name; old registrations of the tournament page are removed.
- Website reset wipes the Dream Team too (teams, rosters, market, packs, trades, academy, yearbook, hall of fame, manager-made bots, AI managers); before only its ledger bookings went, the teams stayed.
- Partial settings updates (API) no longer reset the fields they leave out to their defaults.
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

- Dream Team scouting reworked: talents are rough diamonds (skill 2-3, potential mostly 5-7, learn 30 % faster, licence at half the price), some carry a hidden trait that comes free at level 10, scouted talents lose no skill as keepers (migration 52).
- Dream Team AI managers buy and set prestige points by their personality; AI clubs get prestige like the median human of their tier. Fix: the league's AI club bots now play with their own values and traits in real games (the bridge did not send them).
- Dream Team: a breakthrough needs level 15 (was 10). Prestige in the API (migration 49): points on a menu of nine stats, bought points, reset, ascension and stars for own bots at the end of their development; the manager's bots take their prestige into the game (mod 0.20.0). The pages follow.
- Mod 0.19.2: trait rework - light feet sprints only to items and on the retreat, sniper's nest only with a hitscan weapon and shorter (a hit ends it), assassin without the hunt; thick skin, regeneration, counter-attacker, health hound and team player stronger; overload, vampire and weapon master a little weaker.
- Dream Team: salaries, standard packs and creation licences follow the economy index only with its square root above 1 (at index 5 about ×2.2 instead of ×5); premium and elite packs, the market and scouting stay fully indexed.
- Dream Team league: AI clubs play with traits (as many per bot as the median human of their tier, at most 4/3/2/1 by tier, drawn at random), and the game model counts every bot's traits (rubber band, simulated games, test mode, calibration); the trait report marks the AI's randomly drawn traits (trait lab).
- Dream Team AI managers: points go into skill until the potential (saved for the next step), a full roster swaps its weakest bought bot for a clearly stronger offer from savings, savings also open packs and build blueprints, trait cards land on a random bot (trait lab).
- Trait report: each row shows the bot's skill and all its traits in that game, the summary the average skill - so a trait's numbers can be told apart from a strong bot.
- Dream Team packs: the crafting list is grouped by category and sorted by rarity, the trait inventory in the same order.
- Dream Team: the Monster Hunt focus is set per bot in its details (e.g. one Hunter who clears the way, one Sprinter); the Monster Hunt lineup shows it under the card. Bots keep the focus their team had.
- Dream Team trait rarities: watchdog is epic now (effect unchanged), starter armour rare; daredevil, berserker and revenant uncommon. Scrap and crafting costs follow.
- Bots bet with more variety: some bet half-informed, back the underdog, hunt value where the pool pays more (they fill an empty side, so fewer bets are refunded) or simply bet tipsy; the bot profile shows the betting type.
- Settings → UDT Liga tidied: tiers, teams, start day and keepers as buttons, server and maps like the tournament form (automatic pool or own choice), table money as a table per place and tier with the weekly amounts, cup bonus as a podium, AI strength as sliders; no more lists like "1200 · 700 · 400 · 200".
- Activity bar: "very busy" only shows after two long blocks of the server (1.5 s or more) within 10 s or when a page waits 4 s or more for an answer; background refreshes no longer count. The server log names what ran during each long block.
- Dream Team: the menu item opens an overview with the areas My team, League, Packs, Cups and Transfers as segments of one shape, each with its pages and what is due (next league game, points to give, trade offers, next cup); every Dream Team page has a two-row navigation (area, then its pages); My team moved to /udt/team, Events are called Cups.
- SmartStockBots is a website setting (Bots & live: automatic, on, off) for every tournament - also league games and Dream Team cups, which so far ran without it.
- New tournament: kind as tiles (classic, season, Dream Team), the flow as switch rows with hints, lengths short / medium / long (best of and limits for the mode, with the longest possible duration), every map of the server chosen to start with; the bots section is gone.
- Tournament list: now called "Matches", with a "League" filter; the league's games of an evening show as one row that opens to list them (your own game stays a row of its own).
- Dream Team navigation: "Table" is now "Cup ranking", the league has its own tab.
- Ratings: a bot's difficulty step is worth 200 rating points by default (was 100), which predicts real games best; saved settings and running seasons keep their value.
- Dream Team game model calibrated on real games: simulated games (season simulator `udt:sim`, the test mode's simulated matches) use `p = sA^k / (sA^k + sB^k)` with k = 3 in 1v1 and 4.5 in teams instead of 2, so a favourite wins as often as in the games (one skill step: about three of four duels). `pnpm --filter @tourney/api udt:calibrate <tourney.db>` checks the model on a database (log loss per k, favourite's win rate per skill gap) and fits the rating setting "rating points per bot level" to the same games (the owner's export: 200 instead of the default 100).
- Settings (admins) in tabs: Season, Bets & shop, Bots & live, Dream Team, System. The tab is in the address (`?tab=`), so links and the back button work; every tab saves its own forms, a tab with unsaved changes shows a dot and asks before another tab opens.
- Dream Team: a bot plays one tournament at a time (a second drawn cup goes on without it); pack pity comes later (epic after 30/15/6 boxes, legendary after 150/75/20), so the shown rates hold and the 10-pull promises count; Dream Team matches cannot be simulated.
- Dream Team academy: a breakthrough needs every value at 60 or more (not 100); an apprentice's potential is one step below its mentor's skill; graduations are approved when the season is over.
- Rescue floor: Neuro in bought Dream Team bots count towards it, so a manager whose Neuro is in bots gets no free bet after each loss; a corrected result that turns a spent win into a loss leaves a debt instead of a rescue.
- Dream Team economy: rewards follow the economy index only weakly (index^0.2), so several cups a day no longer push it to its cap; the high stakes winner's bonus is at most a tenth of the pot; the index counts managers active in the last 7 days; selling a bot back pays at most what it cost.
- Dream Team blueprints always build skill 3 with fewer points for the values (a starter +50 / +75 / +125 / +225) and a potential range by rarity (3–4, 3–5, 4–6, 6–7), drawn when the bot is built.
- Bot looks as in UT's player setup: the model's skins, the skin's faces and the model's voices with their readable names, as dropdowns that work on phones; unfitting looks are refused for Dream Team managers.
- Tournaments: an overview (live, coming up by day, series as cards, last results) and an archive of all finished and aborted tournaments (by day, in pages), with search and filters.
- Softer page changes: the old page sinks back and fades, the new one's blocks rise one after another, the Dream Team tabs stay in place, the loader comes and goes softly; shown also when the system asks for reduced motion.
- Dream Team market list: the value line and % without the economy index (the bot's own development), marks "in demand" / "cheaper", explained; better on phones.
- Dream Team economy: weekly salaries 8 / 12 / 20 % of the value (were 3 / 5 / 8), rest with Neuro 7 per stamina point (was 2), starter extra points 50 by default (was 100); checked with the season simulator.
- Dream Team blueprints: one rarity above the pack draw; points = a default starter plus 150 / 300 / 1,000 / 1,500 (uncommon … legendary), skill up to 3 (uncommon, rare) or 4 (epic, legendary).
- Dream Team packs: "Again" buys and opens the same box (or 10-pull) at once and shows its price.
- Dream Team market: buy at once at a fixed price instead of hidden bids (market value plus 10/20/30 % for weak/middle/strong bots, calibrated with the season simulator); demand follows the purchases of the bracket; AI managers buy what is left at the market's closing; open bids are refunded.
- Dream Team trades: every roster keeps at least one bot; the rules say which bots can be traded and why.
- Dream Team academy: no more "look and lines for the next bot" (change them on My team).
- Dream Team: tournament win reward 3,000 (index 1), high stakes place rewards ×1.5; 100 extra points for the starter (setting).
- Dream Team: "Dream Team" next to the nav mark; trait titles in English; trade inputs and the 10-pull price aligned.
- Dream Team: rewards doubled, stamina 6 per game (was 15) with an explanation on the team page; the model is free for own bots.
- Dream Team cards: one shared card, English terms, fits phones; trade window, look editor and spacing reworked.
- Dream Team tournaments always count for the running season (no season switch in the form).
- Tournament cards: Dream Team tournaments in violet with a badge; finished and aborted tournaments get a gold or red accent.
- Dream Team tags: 1-8 signs of any kind (e.g. `td'`), used as typed, no brackets added; existing tags keep theirs.
- Navigation: the Dream Team is a self-drawn mark left of the menu; "New tournament" left the menu (button on the tournament list).
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
