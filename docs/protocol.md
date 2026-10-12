# Protocol

Source of truth for all schemas: [`packages/protocol`](../packages/protocol/src). This document explains the
intent; if the two disagree, the code wins and this file gets fixed.

```
Angular SPA ──HTTP/WS──> API (NestJS, SQLite)  <──WSS, JSON envelopes──  Bridge agent (Node)
                                                                             │ TCP 127.0.0.1, flat JSON lines
                                                                         UT99 mod (TcpLink client)
```

## 1. Tournament event log

The tournament state is never stored as a mutable blob. The website stores an append-only, gapless event log
per tournament; `projectTournament(events)` folds it into the current state (phase, entrants, current match,
games, bracket via the bracket engine). Website and bridge run the same code, so they always agree.

| Event                             | Emitted by      | Meaning                                                                               |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------- |
| `tournament.created`              | website         | Name and settings (format, size, best-of policy, timeouts, game rules)                |
| `seeding.set`                     | website (admin) | Entrant list, first-round slots, RNG seed. Can be re-issued until check-in opens      |
| `checkin.opened`                  | bridge          | Game server is up, players may connect                                                |
| `entrant.checkedIn`               | bridge          | A human entrant connected with a valid token (teams: `userId` names the member)       |
| `team.lineupSet`                  | admin / player  | Team tournaments: a captain picks the starters; applies from the next game            |
| `entrant.replaced`                | bridge / admin  | A bot takes over a bracket position (no-show at check-in, admin)                      |
| `tournament.started`              | bridge          | All checked in (or forced / check-in window over)                                     |
| `match.called`                    | bridge          | Next match chosen by the scheduler                                                    |
| `match.mapSelected`               | bridge          | Map for a game, with method (`vote`, `random`, `loserPick`, `admin`) and vote details |
| `match.started`                   | bridge          | Countdown over, game is live                                                          |
| `match.runFinished`               | bridge          | Monster Hunt: one team's run of the game is over (time, deaths, penalty, points)      |
| `match.gameFinished`              | bridge          | One game of a series is over (scores, end reason)                                     |
| `match.result`                    | bridge / admin  | Final result of a match; a later result for the same match overrides                  |
| `tournament.paused` / `resumed`   | admin / bridge  |                                                                                       |
| `tournament.finished` / `aborted` | bridge / admin  |                                                                                       |

**Team tournaments.** With `settings.teamSize` 2, 3 or 5 every bracket entrant has `kind: "team"`: name, tag,
captain, `members` (starters first, `sub` marks substitutes, at most `teamSize + 2`) and `bots` for starter places
nobody fills. Teams made of bots only have no members. Brackets of 4, 8 and 16 teams; 4 is also allowed for 1v1.

**Monster Hunt** (`game.adapter: "ut99-mh"`, teams only). Every game is a time race on one map: both teams run
it one after the other. `match.mapSelected.runOrder` fixes the order (game 1 by lot, then whoever ran second
starts), `match.started.runner` names the running team, `match.runFinished` records each run. After the second
run `match.gameFinished` (`endReason: "race"`, `scores` = final times in ms) names the winner: a team at the exit
beats one that is not; otherwise the lower time plus `penaltySec` per death (whole seconds), then monster points,
fewer deaths, lot.

**Concurrency.** The bridge sends `events.append` with `baseSeq` (the head it based its decision on). The
website accepts only if `baseSeq` is still the head and answers `events.ack {accepted:true, events}` with
seq/timestamps assigned. Otherwise it answers `accepted:false` with the events the bridge missed (e.g. an admin
override); the bridge re-projects and decides again. Admin actions therefore always win.

**Organizer tools.** `POST /tournaments/:id/override {matchId, winnerId}` appends `match.result` with
`outcome: "override"` for any match whose entrants are known (current, coming or played). If it decides the current
match, or a corrected earlier result changes the current match's pairing, the projection drops the current match;
the bridge ends the game on the server (`abort` with `why` `admin`/`void`) and calls the next match. A match called
again starts its series from game 1. The command `restart` (bridge: `match.restart`) loads the current game's map
again (Monster Hunt: the current run); nothing goes into the log.

**Overrides.** Correcting a result upstream can invalidate results further down. The engine does not throw; it
ignores results whose pairing no longer matches and reports them as `stale_result` issues so the admin UI can
show them.

**Offline bridge.** If the website is unreachable, the bridge keeps playing on its local projection and queues
its events. On reconnect it appends them with the old `baseSeq`; if the website moved on meanwhile, the normal
reject/rebase path applies.

## 2. Website <-> Bridge

One WebSocket per agent, opened by the bridge (outbound, works behind NAT), authenticated with a per-agent
token (`Authorization: Bearer …`). Every frame is an envelope:

```json
{
  "v": 1,
  "id": "uuid",
  "type": "server.status",
  "ts": 1760000000000,
  "re": "optional-reply-to",
  "payload": {}
}
```

| Direction | Type                                 | Purpose                                                                                                                                                                 |
| --------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B → W     | `agent.hello`                        | Agent id, version, OS/arch, supported adapters, last known seq per tournament, server profiles, active tournament                                                       |
| W → B     | `agent.welcome`                      | Accepted, server time                                                                                                                                                   |
| W → B     | `tournament.sync`                    | Full log (`fromSeq: 0`) or delta, plus the access list (tokens)                                                                                                         |
| B → W     | `events.append` / W → B `events.ack` | See concurrency above                                                                                                                                                   |
| W → B     | `command`                            | `inventory.rescan`, `tournament.run`, `tournament.forceStart`, `pause`, `resume`, `abort`, `match.restart`, `server.stop`, `access.upsert`, `access.revoke`, `announce` |
| B → W     | `command.ack`                        | Result of a command                                                                                                                                                     |
| B → W     | `agent.inventory`                    | Maps and bots found in the UT installation                                                                                                                              |
| B → W     | `server.status`                      | Process state, current map, connected players, mod connection                                                                                                           |
| B → W     | `match.live`                         | Non-persistent telemetry: phase, scores, ready flags, deadlines                                                                                                         |
| B → W     | `agent.log`                          | Forwarded log lines for the admin console                                                                                                                               |

**Server profiles are configured on the bridge machine only** (`server` in `bridge.json`: install directory,
binary, port, lobby map, public address). The bridge reports them in `agent.hello` (without anything
executable), and `tournament.run` / `inventory.rescan` only name a `profileId`. So a compromised website
cannot make the bridge run arbitrary programs.

`tournament.run` also carries the bot pool. The website sends the log with `tournament.sync` right before it,
and re-sends `tournament.run` after every reconnect of an agent whose tournament is still active (the bridge
ignores it if it already runs that tournament). A `tournament.sync` with events the bridge did not write itself
(an admin action while the bridge was offline) makes the director reload and continue from the new state.

While the website is unreachable the bridge keeps the game running; `events.append` waits and is retried after
the reconnect (a stale `baseSeq` is answered with the missing events, as usual).

**Access control (closed system).** Every website user who may join the server (players and spectators) has a
personal token. The website pushes the list with `tournament.sync` and incremental `access.upsert` /
`access.revoke`. Connections without a known token are rejected by the mod.

## 3. Bridge <-> UT mod

TCP on `127.0.0.1`; the bridge listens, the mod connects (and reconnects after every map change, because
UnrealScript actors do not survive travel). The bridge owns all state and sends a full snapshot on connect.

### Wire format: flat JSON lines

- One JSON object per line, `\n` terminated (`\r\n` tolerated).
- **Flat**: values are strings, integers or booleans only. No arrays, no nesting, no floats. A ~150-line
  UnrealScript parser handles this.
- **≤ 255 bytes per line** including newline. Conservative until verified against the 469f `TcpLink`;
  `MAX_LINE_BYTES` is the single place to raise it.
- **ASCII only**: other characters are sent as `\uXXXX`. Names are cut by `wireName()` (≤ 32 chars,
  ≤ 48 escaped bytes, emoji dropped) so two names always fit into one bracket line.
- `t` is the message type. Lists are sent as a header line with count and revision, then one line per item.

### Mod → Bridge

| `t`      | Fields                 | Meaning                                                                                                                             |
| -------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `hello`  | `key pv mv eng lvl gm` | Shared secret, protocol version, mod version, engine version, current map, a game was started on this level (running or just ended) |
| `join`   | `pid tk name role`     | Player connected; role (`a`/`b`/`s`) already decided by the mod from the access list                                                |
| `leave`  | `pid`                  |                                                                                                                                     |
| `reject` | `name why`             | Connection without a valid token was refused                                                                                        |
| `ready`  | `pid`                  | Match player is ready (UWindow button or `!ready`)                                                                                  |
| `vote`   | `pid m1 m2 m3`         | Ranked map choices (`""` = none)                                                                                                    |
| `live`   | `mid g`                | Countdown over, players spawned                                                                                                     |
| `score`  | `mid g sa sb tl ot`    | Periodic and on every frag                                                                                                          |
| `end`    | `mid g sa sb w why`    | Game over: `frag`, `time`, `sd` (sudden death), `forfeit`                                                                           |
| `lost`   | `mid s`                | 1v1: match player disconnected during a live game; mod paused the game                                                              |
| `cmd`    | `pid c`                | Chat command the bridge decides on: `start` (team captain starts with bots for missing players)                                     |
| `hb`     | `up`                   | Heartbeat every 5 s                                                                                                                 |
| `err`    | `msg`                  |                                                                                                                                     |

### Bridge → Mod

| `t`                                  | Meaning                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `welcome`                            | Handshake accepted                                                                                                                                                       |
| `sync` (`begin`/`end`)               | Frames a snapshot; everything in between replaces the mod's state                                                                                                        |
| `phase`                              | `lobby`, `vote`, `ready`, `countdown`, `live`, `paused`, `post`, `finished` + timeout seconds                                                                            |
| `match`                              | Current match: id, game number, best-of, series score, names, frag/time limit (a tie always goes to sudden death), `ts` players per side (1 = 1v1), `ff` friendly fire % |
| `bot`                                | A bot playing for a side (name, skill, class). 1v1: the bot side. Team games: the bots of the game, with the countdown, and stand-ins                                    |
| `botadd` / `botdel`                  | Team games: a stand-in bot joins the running game for a disconnected player / leaves when the player is back                                                             |
| `tready`                             | Team games: the bridge declared a side ready (all ready, captain `!start`, bot team, time up)                                                                            |
| `acl` / `acle` / `acladd` / `acldel` | Access list: token → name + role (`a`, `b`, `s`)                                                                                                                         |
| `vopen` / `vmap` / `vclose`          | Map vote options and final choice                                                                                                                                        |
| `travel`                             | Load map for a match (+ extra URL options); the mod performs the `ServerTravel`                                                                                          |
| `cd`                                 | Start countdown                                                                                                                                                          |
| `pause`                              | Pause / unpause                                                                                                                                                          |
| `abort`                              | End the current game without a result: `why` = `forfeit`, `admin` (organizer set the winner), `void` (match called off), `restart`                                       |
| `brh` / `brm`                        | Bracket for the HUD                                                                                                                                                      |
| `sth` / `ste`                        | Standings for the HUD                                                                                                                                                    |
| `say`                                | Message to all (`pid: -1`) or one player                                                                                                                                 |
| `title`                              | Tournament name (HUD), part of the snapshot                                                                                                                              |
| `warn`                               | Big centered warning for one player (e.g. last reconnect before a forfeit)                                                                                               |

### Team games (2on2, 3on3, 5on5)

The server runs `TournamentTDM` (red = side a, blue = side b); the frag limit is the team score.

- **Roles.** While the map is voted every member of both teams has role `a`/`b` and votes; the bridge adds one
  ballot per team (Borda points of its players). Before the travel the bridge fixes the **line-up**: members on
  the server first (starters, then substitutes), then absent starters; at most `teamSize`. Only the line-up keeps
  role `a`/`b` on the new map, everybody else joins as spectator (UT cannot switch a connection from player to
  spectator).
- **Ready.** A team is ready when its line-up is here and ready, or when its captain types `!start` (allowed
  `captainStartMs` = 60 s after the ready check began; the captain is the first member on the server if the
  captain is not), or when the ready check times out (a team with nobody on the server forfeits).
- **Countdown.** The bridge sends `match` + one `bot` line per bot that fills a place, then `cd`; the line-ups go
  into `match.started` (`lineups`).
- **Disconnects.** The game goes on. After `standInDelayMs` (20 s) the bridge sends `botadd`; when the player is
  back, `botdel`. A player with more than `maxReconnects` disconnects in a match gets role `s` (`acladd`) and is
  out of that match; the stand-in stays.
- **Line-up changes** from the website (`team.lineupSet`) are passive events: the bridge applies them from the
  next game and never re-plans for them.

### Monster Hunt time race

The server runs `UTTourneyMH_v1.TournamentMH` (a `MonsterHunt` subclass, Monster Hunt 613). Each game loads the
map twice, once per team:

- **Roles.** Only the line-up of the running team has role `a`/`b`; the other team joins as spectators and
  watches. The running team plays in Monster Hunt's hunter team. Fill bots and stand-in bots as in team games.
- **`race`** (bridge → mod, with `match`): `rs` running side, `n` run 1/2, `pen` seconds per death, and the other
  team's finished run (`pt` final time in ms or -1, `pd` deaths, `pp` points, `pf` reached the exit).
- **`rp`** (mod → bridge): progress every few seconds and on every death: `ms` run time (pauses excluded), `d`
  deaths in the team (bots included), `pts` monster points.
- **`runend`** (mod → bridge): the run is over (`done: true` at the exit, `false` at the time limit or with no
  hunters left), same fields. The bridge records it and loads the map again for the other team. `score`/`end`
  are not used.

### Typical match sequence

```
bridge: phase vote, vopen/vmap…      players: vote …        (during post-game of the previous match)
bridge: vclose map=DM-Morpheus, travel map=DM-Morpheus mid=W1-2 g=1
        … level change, mod reconnects …
mod:    hello                         bridge: welcome, sync begin, match, acl…, brh/brm…, phase ready, sync end
mod:    join pid=3 role=a, join pid=4 role=b
mod:    ready pid=3, ready pid=4      (bots are ready implicitly; no-show timer runs in the bridge)
bridge: cd sec=5                      mod: live mid=W1-2 g=1
mod:    score … end w=a why=frag      bridge: events match.gameFinished + match.result, phase post, next vote
```
