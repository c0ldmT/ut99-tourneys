# Bridge

Runs on the game server machine. Drives the tournament on the UT server. Two modes:

- **Website mode** (`run -c bridge.json` with a `website` section): connects to the website, reports its server
  profile, maps and bots, and runs the tournaments an admin starts there. Keeps running between tournaments.
- **Standalone mode** (`run -c bridge.json -t tournament.json`): the tournament comes from a JSON file, the
  event log is stored in `dataDir/tournaments/<id>.jsonl`. Handy for LAN parties without a website.

With a `server` section in `bridge.json` the bridge starts the UT server itself, restarts it after a crash and
stops it when the tournament is over.

## Website mode

1. On the website: **Servers → Add a game server**. Copy the shown snippet (agent id + token) into
   `bridge.json`.
2. Add `publicAddress` to the `server` section (what players type after `open`, e.g. `ut.example.com:7777`).
3. Start: `node apps/bridge/dist/cli.js run -c bridge.json`. The website shows the server as online; scan maps
   and bots there.

```json
{
  "agentId": "pi-bridge",
  "mod": { "host": "127.0.0.1", "port": 7790, "sharedKey": "change-me-please" },
  "server": {
    "os": "linux",
    "installDir": "/opt/ut99",
    "lobbyMap": "DM-Deck16][",
    "publicAddress": "ut.example.com:7777",
    "manage": true
  },
  "website": { "url": "wss://cup.example.com/api/agent", "token": "agt_..." }
}
```

The bridge keeps a copy of each tournament log in `dataDir/website/`. If the website is unreachable during a
tournament, the current game goes on and the result is stored as soon as the connection is back. After a
bridge restart the website tells it to resume the running tournament.

## Server section (`bridge.json`)

```json
"server": {
  "os": "windows",
  "installDir": "C:\\UnrealTournament",
  "lobbyMap": "DM-Deck16][",
  "port": 7777,
  "serverName": "Friday Cup",
  "maxSpectators": 32,
  "manage": true
}
```

- The bridge writes `Tourney.ini` and `TourneyUser.ini` next to the server binary: copies of your
  `UnrealTournament.ini` / `User.ini` plus the tournament settings (port, server name, weapon stay, the
  `[UTTourney_v1.TournamentConfig]` connection to the bridge). Your own ini files stay untouched.
- The binary is found automatically (`System/ucc-bin-amd64`, `System/ucc-bin-arm64`, `System/UCC.exe`, ...);
  set `"binary"` to override.
- Before the start the map pool is checked against the `Maps` folder.
- `"manage": false` keeps the old behaviour: you start the server yourself.
- The bridge needs write access to the UT `System` folder (not the case under `C:\Program Files` without
  admin rights).

## Inventory

```sh
node apps/bridge/dist/cli.js inventory -c bridge.json          # maps with title/author, bots
node apps/bridge/dist/cli.js inventory -c bridge.json --fast   # file names only
```

## Run

```sh
pnpm install && pnpm build
node apps/bridge/dist/cli.js example            # prints example bridge.json and tournament.json
node apps/bridge/dist/cli.js run -c bridge.json -t tournament.json
```

Console commands while running: `start` (force start, missing players are replaced by bots), `pause [reason]`,
`resume`, `status` (incl. what the tournament is waiting for), `quit` (also stops a managed server).

Team tournaments in standalone mode: set `"teamSize": 2` (3, 5) in the settings and list the teams; the first
`teamSize` members start, the rest are substitutes, every player has to be in a team:

```json
"teams": [
  { "name": "Red Devils", "tag": "[RD]", "members": ["mario", "anna", "jonas"], "captain": "mario" },
  { "name": "Blue Steel", "members": ["lea", "tim"] }
]
```

Monster Hunt (time race, teams only, Monster Hunt 613 and the mod's `UTTourneyMH_v1.u` on the server): set
`"game": { "adapter": "ut99-mh", "rules": { "mapPool": ["MH-NaliVillage", …], "timeLimitMin": 20, "penaltySec": 5,
"monsterSkill": 5 } }`. The inventory lists `DM-` and `MH-` maps.

Restarting the bridge with the same files resumes the tournament from the event log. Delete the `.jsonl` file
to start over.

## Try it without UT

The simulator plays the UT server and the human players over the real protocol:

```sh
node apps/bridge/dist/cli.js run -c bridge.json -t tournament.json      # terminal 1
node apps/bridge/dist/sim-cli.js -c bridge.json -t tournament.json --game 5   # terminal 2
```

## Code map

| File                          | Role                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/director.ts`             | Match director: check-in, scheduling, map vote, travel, ready check, countdown, live, forfeits, best-of, finish |
| `src/teams.ts`                | Team games: line-up, acting captain, bots for free places                                                       |
| `test/race.test.ts`           | Monster Hunt time race end to end (two runs per game, order, penalty, DNF, restart)                             |
| `src/mod-server.ts`           | TCP server for the mod (handshake, line protocol)                                                               |
| `src/event-store.ts`          | Event log with optimistic concurrency (local JSONL, standalone mode)                                            |
| `src/website/link.ts`         | WebSocket client to the website (hello, reconnect, request/answer)                                              |
| `src/website/remote-store.ts` | Event store backed by the website, with a local mirror                                                          |
| `src/website/agent.ts`        | Website mode: commands, one tournament runtime at a time, status/inventory/live reports                         |
| `src/snapshot.ts`             | Builds the lines sent to the mod from the tournament projection                                                 |
| `src/bootstrap.ts`            | Standalone tournament file → initial events                                                                     |
| `src/sim/mod-simulator.ts`    | Simulated UT server for tests and demos                                                                         |
| `src/ut99/prepare.ts`         | Finds the binary, writes Tourney.ini / TourneyUser.ini, builds the command line                                 |
| `src/ut99/server-process.ts`  | Starts, supervises and restarts the UT server process                                                           |
| `src/ut99/inventory.ts`       | Maps (with title/author from the package) and bots of the installation                                          |
| `src/ut99/ini.ts`             | Unreal ini reader/writer                                                                                        |
