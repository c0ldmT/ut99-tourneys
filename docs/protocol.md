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
| `entrant.checkedIn`               | bridge          | A human entrant connected with a valid token                                          |
| `entrant.replaced`                | bridge / admin  | A bot takes over a bracket position (no-show at check-in, admin)                      |
| `tournament.started`              | bridge          | All checked in (or forced / check-in window over)                                     |
| `match.called`                    | bridge          | Next match chosen by the scheduler                                                    |
| `match.mapSelected`               | bridge          | Map for a game, with method (`vote`, `random`, `loserPick`, `admin`) and vote details |
| `match.started`                   | bridge          | Countdown over, game is live                                                          |
| `match.gameFinished`              | bridge          | One game of a series is over (scores, end reason)                                     |
| `match.result`                    | bridge / admin  | Final result of a match; a later result for the same match overrides                  |
| `tournament.paused` / `resumed`   | admin / bridge  |                                                                                       |
| `tournament.finished` / `aborted` | bridge / admin  |                                                                                       |

**Concurrency.** The bridge sends `events.append` with `baseSeq` (the head it based its decision on). The
website accepts only if `baseSeq` is still the head and answers `events.ack {accepted:true, events}` with
seq/timestamps assigned. Otherwise it answers `accepted:false` with the events the bridge missed (e.g. an admin
override); the bridge re-projects and decides again. Admin actions therefore always win.

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
| B → W     | `agent.hello`                        | Agent id, version, OS/arch, supported adapters, last known seq per tournament                                                                                           |
| W → B     | `agent.welcome`                      | Accepted, server time                                                                                                                                                   |
| W → B     | `tournament.sync`                    | Full log (`fromSeq: 0`) or delta, plus the access list (tokens)                                                                                                         |
| B → W     | `events.append` / W → B `events.ack` | See concurrency above                                                                                                                                                   |
| W → B     | `command`                            | `inventory.rescan`, `tournament.run`, `tournament.forceStart`, `pause`, `resume`, `abort`, `match.restart`, `server.stop`, `access.upsert`, `access.revoke`, `announce` |
| B → W     | `command.ack`                        | Result of a command                                                                                                                                                     |
| B → W     | `agent.inventory`                    | Maps and bots found in the UT installation                                                                                                                              |
| B → W     | `server.status`                      | Process state, current map, connected players, mod connection                                                                                                           |
| B → W     | `match.live`                         | Non-persistent telemetry: phase, scores, ready flags, deadlines                                                                                                         |
| B → W     | `agent.log`                          | Forwarded log lines for the admin console                                                                                                                               |

The **server profile** (part of `tournament.run` and `inventory.rescan`) carries the OS chosen on the
website (`linux` / `windows`), install directory, optional binary override (e.g. ARM64), port, lobby map and
spectator slots. The bridge derives binary paths, ini handling and command line from it.

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

| `t`      | Fields              | Meaning                                                                              |
| -------- | ------------------- | ------------------------------------------------------------------------------------ |
| `hello`  | `key pv mv eng lvl` | Shared secret, protocol version, mod version, engine version, current map            |
| `join`   | `pid tk name role`  | Player connected; role (`a`/`b`/`s`) already decided by the mod from the access list |
| `leave`  | `pid`               |                                                                                      |
| `reject` | `name why`          | Connection without a valid token was refused                                         |
| `ready`  | `pid`               | Match player is ready (UWindow button or `!ready`)                                   |
| `vote`   | `pid m1 m2 m3`      | Ranked map choices (`""` = none)                                                     |
| `live`   | `mid g`             | Countdown over, players spawned                                                      |
| `score`  | `mid g sa sb tl ot` | Periodic and on every frag                                                           |
| `end`    | `mid g sa sb w why` | Game over: `frag`, `time`, `sd` (sudden death), `forfeit`                            |
| `lost`   | `mid s`             | Match player disconnected during a live game; mod paused the game                    |
| `hb`     | `up`                | Heartbeat every 5 s                                                                  |
| `err`    | `msg`               |                                                                                      |

### Bridge → Mod

| `t`                                  | Meaning                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `welcome`                            | Handshake accepted                                                                            |
| `sync` (`begin`/`end`)               | Frames a snapshot; everything in between replaces the mod's state                             |
| `phase`                              | `lobby`, `vote`, `ready`, `countdown`, `live`, `paused`, `post`, `finished` + timeout seconds |
| `match`                              | Current match: id, game number, best-of, series score, names, frag/time limit, sudden death   |
| `bot`                                | A side played by a bot (name, skill, class)                                                   |
| `acl` / `acle` / `acladd` / `acldel` | Access list: token → name + role (`a`, `b`, `s`)                                              |
| `vopen` / `vmap` / `vclose`          | Map vote options and final choice                                                             |
| `travel`                             | Load map for a match (+ extra URL options); the mod performs the `ServerTravel`               |
| `cd`                                 | Start countdown                                                                               |
| `pause`                              | Pause / unpause                                                                               |
| `abort`                              | End the current game with a given winner (forfeit decided by the bridge)                      |
| `brh` / `brm`                        | Bracket for the HUD                                                                           |
| `sth` / `ste`                        | Standings for the HUD                                                                         |
| `say`                                | Message to all (`pid: -1`) or one player                                                      |

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
