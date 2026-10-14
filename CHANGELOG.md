# Changelog

All notable changes to Tourney. Versions of the whole platform (website, bridge, install scripts) are listed
here; the UT mod has its own version (shown in the game type name and the bracket title), listed per release.

## [Unreleased]

### Changed

- Monster Hunt: the bot AI enhancements (waypoint order, jump routes, keeping clear of movers, opening closed
  doors, unstick, the fix for once-only movers) are always on; the option "Bot helpers" is gone from the
  tournament form, which explains them in a note instead. Older tournaments with the option switched off now use
  them too. No change in the mod.

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
