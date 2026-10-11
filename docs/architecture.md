# Architecture

## Components

| Component                             | Runs on                      | Responsibility                                                                                               |
| ------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Website** (`apps/web` + `apps/api`) | anywhere (Pi or remote host) | Discord login, tournaments, seeding, live bracket, admin control, canonical event log (SQLite)               |
| **Bridge** (`apps/bridge`)            | the game server machine      | Starts/supervises `ucc server`, scans maps and bots, drives the match flow, talks to the mod, appends events |
| **Mod** (`mods/ut99-tournament`)      | inside the UT server         | Login/role assignment by token, ready check, countdown, spawning, scoring, HUD, vote UI                      |

Bridge and UT server always run on the same machine. The website can run on the same machine (target setup:
everything on one Raspberry Pi 3B+) or remotely; that is configuration only.

## Principles

1. **Thin UnrealScript.** The mod only does what must happen in-game. Bracket logic, scheduling, map choice and
   timeouts live in TypeScript where they are tested.
2. **Stateless mod.** Actors die on map change. The mod reconnects to the bridge after each level load and
   receives a full snapshot. Map changes and server crashes need no special handling.
3. **Event sourcing.** The tournament is an append-only event log; state = `projectTournament(log)`. Website
   and bridge share that code, so the bridge can keep playing while the website is unreachable.
4. **Core vs. adapter.** Tournament, entrants, matches and sync are generic. UT99 specifics (rules schema,
   map vote, launch parameters, mod protocol) live in `adapter-ut99` and the mod. A future game mode adds an
   adapter and a mod, nothing else.

## Server lifecycle

```
tournament.run ─► bridge writes Tourney.ini, starts ucc on the lobby map ─► checkin.opened
   players connect with  open host:7777?tk=<personal token>
all checked in / admin force / window over (missing -> bots) ─► tournament.started
loop:  match.called ─► vote (during post-game) ─► ServerTravel ─► ready check ─► countdown ─► live ─► result
final ─► final standings on screen for `postTournamentShutdownSec` (30 s) ─► server and bridge stop
```

The server process stays up for the whole tournament; matches only change the map. A restart happens only
after a crash (the bridge restarts it and restores the current match from the log).

## Match flow (per game)

| Step                   | Owner                              | Timeout → consequence                                                      |
| ---------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| Map vote / random pick | bridge decides, mod collects votes | vote timeout → missing ballots random                                      |
| Travel to map          | mod (`ServerTravel`)               |                                                                            |
| Ready check            | mod shows UI, bridge times         | `noShowSec` → forfeit                                                      |
| Countdown, spawn       | mod                                |                                                                            |
| Live                   | mod reports score/end              | disconnect: pause, `reconnectGraceSec` → forfeit, score restored on return |
| Result                 | bridge appends events              |                                                                            |

## Deployment

- **Default:** systemd services + install script (no Docker; the Pi 3B+ has 1 GB RAM).
- **Optional:** Docker Compose, mainly for a remote website.
- Angular is built in CI; the API serves the static files. Caddy optional for HTTPS (Discord OAuth from the
  internet needs a public URL).
- UT99 on the Pi needs a 64-bit OS (469 supports Linux/ARM64).
