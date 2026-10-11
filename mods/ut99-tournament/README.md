# UT99 Tournament Mod (`UTTourney_v1`)

UnrealScript package for UT99 469f. It turns a dedicated server into a tournament server driven by the bridge
(see [`docs/protocol.md`](../../docs/protocol.md)).

> **Status (milestone 3): written, not yet compiled.** The code was reviewed against the UT 436 UnrealScript
> API but could not be compiled in the development environment. The first real build and server test happen
> on a real installation, using the checklist below.

## Classes

| Class | Role |
|---|---|
| `TournamentDM` | Game type (extends `Botpack.DeathMatchPlus`): token login, roles, ready check, countdown, bots, score, end of game, travel, soft pause, score restore |
| `BridgeLink` | `TcpLink` client to the bridge, line buffering, heartbeat |
| `TourneyMsg` | Flat JSON line parser/writer |
| `TourneyMutator` | Chat commands `!ready !vote !bracket !standings !help`, console `mutate tourney <cmd>` |
| `TournamentConfig` | Ini settings (bridge host/port/key) and a cache that survives map changes |

Planned for milestone 6: HUD overlay for the bracket, UWindow dialogs for vote and ready.
Until then the bracket is shown as text (`!bracket`) and players vote by chat.

## Build

```sh
./build.sh /path/to/UnrealTournament          # Linux
.\build.ps1 -UT "C:\UnrealTournament"         # Windows (PowerShell)
```

The script copies `Classes/` to `<UT>/UTTourney_v1/Classes`, creates `TourneyMake.ini` (a copy of your
`UnrealTournament.ini` with `EditPackages=UTTourney_v1` added) and runs `ucc make` with it. Your own ini is not
changed. Result: `UTTourney_v1.u` next to the ucc binary.

If `ucc make ini=TourneyMake.ini` is not accepted by your build, add `EditPackages=UTTourney_v1` to the
`[Editor.EditorEngine]` section of `UnrealTournament.ini` by hand and run `ucc make`.

## Manual server setup (until the bridge starts the server itself, milestone 4)

1. Add to the server ini (`UnrealTournament.ini` or the ini you start the server with):

   ```ini
   [UTTourney_v1.TournamentConfig]
   BridgeHost=127.0.0.1
   BridgePort=7790
   SharedKey=change-me-please      ; same value as mod.sharedKey in bridge.json

   [UTTourney_v1.TournamentDM]
   MaxPlayers=4
   ```

   Do **not** add the package to `ServerPackages` yet: nothing in it runs on clients so far, so clients do not
   need to download it.

2. Start the bridge (see `apps/bridge/README.md`):

   ```sh
   node apps/bridge/dist/cli.js run -c bridge.json -t tournament.json
   ```

3. Start the server on any DM map with the tournament game type:

   ```sh
   cd <UT>/System && ./ucc-bin-amd64 server "DM-Deck16][?game=UTTourney_v1.TournamentDM" -log
   ```

4. Players join from the console with their token from `tournament.json`:

   ```
   open <server-ip>:7777?tk=mario-token-1
   ```

Log lines of the mod are tagged `UTTourney`.

## First test checklist

Work through these in order and note what happens. Each item names what to look for.

| # | Check | Expected |
|---|---|---|
| 1 | `ucc make` | `UTTourney_v1.u` is built without errors (please send the full output if not) |
| 2 | Server start | Log shows `connected to bridge`, bridge log shows `mod connected ... level DM-...` |
| 3 | Join without token | Rejected with the tournament message |
| 4 | Join with token | Bridge logs `<name> checked in`; you are a spectator in the lobby |
| 5 | All players checked in | Bridge: `The tournament starts now!`, match players get the vote list |
| 6 | Map vote | A vote panel in the middle of the screen (maps, seconds left, your vote). `!vote 2 1 3` or `!v 2 1 3`; after both votes the server changes map |
| 7 | **Token after map change** | Players come back automatically after the travel. Does `?tk=` survive the travel? If players are rejected, report it (the address fallback should catch it) |
| 8 | Ready check | Match players are held (invisible, cannot move), see "Press FIRE or type !ready" |
| 9 | Ready | FIRE or `!ready` → countdown with announcer, both spawn together |
| 10 | Bot side | Bot spawns with the configured name and plays. Server log: `UTTourney: spawned bot <name> ...`; if it vanishes: `bot for side ... is missing, spawning it again` |
| 11 | Spectators | Everybody else is a spectator and can watch |
| 12 | Frag limit / time limit | Bridge logs `wins game 1 (20:13)`, next match is called |
| 13 | Tie at time limit | Overtime, next frag wins, bridge records `suddenDeath` |
| 14 | **Disconnect during a game** | Game holds both players, clock stops; on return the score is restored and both respawn normally (HUD, weapons, can shoot). Without return the bridge forfeits after the grace period |
| 15 | Long names / umlauts | Names show correctly; no `line too long` warnings in the bridge log |
| 16 | `!bracket`, `!standings` | Text bracket and standings |

## Known limitations

- Bot skill is mapped from 0–7 to UT's 0–3 bot skill; the global novice flag of DeathMatchPlus is not
  changed per bot.
- A tournament pause from the bridge holds the game only while a match is live; during the ready check
  the countdown still runs.
- Players can rename themselves with the `name` command; the bridge identifies them by token anyway.
- The token fallback after a map change (by IP address) cannot tell apart two players behind the same IP.
