# Bridge

Runs on the game server machine. Drives the tournament on the UT server and (from milestone 5) syncs with the
website.

Current state (milestone 4): **standalone mode**. The tournament is defined in a JSON file, the event log is
stored in `dataDir/tournaments/<id>.jsonl`. With a `server` section in `bridge.json` the bridge starts the UT
server itself, restarts it after a crash and stops it when the tournament is over.

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

Restarting the bridge with the same files resumes the tournament from the event log. Delete the `.jsonl` file
to start over.

## Try it without UT

The simulator plays the UT server and the human players over the real protocol:

```sh
node apps/bridge/dist/cli.js run -c bridge.json -t tournament.json      # terminal 1
node apps/bridge/dist/sim-cli.js -c bridge.json -t tournament.json --game 5   # terminal 2
```

## Code map

| File                         | Role                                                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/director.ts`            | Match director: check-in, scheduling, map vote, travel, ready check, countdown, live, forfeits, best-of, finish |
| `src/mod-server.ts`          | TCP server for the mod (handshake, line protocol)                                                               |
| `src/event-store.ts`         | Event log with optimistic concurrency (local JSONL now, website later)                                          |
| `src/snapshot.ts`            | Builds the lines sent to the mod from the tournament projection                                                 |
| `src/bootstrap.ts`           | Standalone tournament file → initial events                                                                     |
| `src/sim/mod-simulator.ts`   | Simulated UT server for tests and demos                                                                         |
| `src/ut99/prepare.ts`        | Finds the binary, writes Tourney.ini / TourneyUser.ini, builds the command line                                 |
| `src/ut99/server-process.ts` | Starts, supervises and restarts the UT server process                                                           |
| `src/ut99/inventory.ts`      | Maps (with title/author from the package) and bots of the installation                                          |
| `src/ut99/ini.ts`            | Unreal ini reader/writer                                                                                        |
