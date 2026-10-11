# Bridge

Runs on the game server machine. Drives the tournament on the UT server and (from milestone 5) syncs with the
website.

Current state (milestone 3): **standalone mode**. The tournament is defined in a JSON file, the event log is
stored in `dataDir/tournaments/<id>.jsonl`, and the UT server is started by hand.

## Run

```sh
pnpm install && pnpm build
node apps/bridge/dist/cli.js example            # prints example bridge.json and tournament.json
node apps/bridge/dist/cli.js run -c bridge.json -t tournament.json
```

Console commands while running: `start` (force start, missing players are replaced by bots), `pause [reason]`,
`resume`, `status`, `quit`.

Restarting the bridge with the same files resumes the tournament from the event log. Delete the `.jsonl` file
to start over.

## Try it without UT

The simulator plays the UT server and the human players over the real protocol:

```sh
node apps/bridge/dist/cli.js run -c bridge.json -t tournament.json      # terminal 1
node apps/bridge/dist/sim-cli.js -c bridge.json -t tournament.json --game 5   # terminal 2
```

## Code map

| File                       | Role                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/director.ts`          | Match director: check-in, scheduling, map vote, travel, ready check, countdown, live, forfeits, best-of, finish |
| `src/mod-server.ts`        | TCP server for the mod (handshake, line protocol)                                                               |
| `src/event-store.ts`       | Event log with optimistic concurrency (local JSONL now, website later)                                          |
| `src/snapshot.ts`          | Builds the lines sent to the mod from the tournament projection                                                 |
| `src/bootstrap.ts`         | Standalone tournament file → initial events                                                                     |
| `src/sim/mod-simulator.ts` | Simulated UT server for tests and demos                                                                         |
