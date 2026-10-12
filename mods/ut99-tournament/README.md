# UT99 Tournament Mod (`UTTourney_v1`)

UnrealScript package for UT99 469f. It turns a dedicated server into a tournament server driven by the bridge
(see [`docs/protocol.md`](../../docs/protocol.md)).

> **Status:** the server part (milestone 4) is tested on 469f. **Milestone 6 (HUD, vote window, spectator
> follow) is written but not compiled yet**: please run `build` and the checklist items 18–25 below.

## Classes

| Class | Role |
|---|---|
| `TournamentDM` | Game type (extends `Botpack.DeathMatchPlus`): token login, roles, ready check, countdown, bots, score, end of game, travel, soft pause, score restore |
| `BridgeLink` | `TcpLink` client to the bridge, line buffering, heartbeat |
| `TourneyMsg` | Flat JSON line parser/writer |
| `TourneyMutator` | Console `mutate tourney <cmd>` (fallback for chat commands) |
| `TourneyChatListener` | Server-only listener for chat commands `!ready !vote !bracket !standings !help` (also from spectators) |
| `TournamentConfig` | Ini settings (bridge host/port/key) and a cache that survives map changes |
| `TourneyGRI` | Tournament state replicated to all clients (phase, match, scores, ready, bracket, standings, vote maps) |
| `TourneyClient` | One per player, client side a HUD mutator: banner, ready/vote panels, bracket, standings, follow hint; opens the vote window; carries the calls between client and server |
| `TourneyVoteWindow`, `TourneyVoteClient` | UWindow map vote dialog (click up to 3 maps, then "Vote") |

**Clients download the package** (it is in `ServerPackages`; the bridge adds it to `Tourney.ini`). Clients
whose HUD did not register get the old text versions (progress messages, console). The HUD is drawn only while
the scoreboard (F1) is closed; with `togglehud` hidden it is not drawn at all.

### In-game commands

| Command | Who | What |
|---|---|---|
| `!ready` / FIRE | match players | ready during the ready check |
| `!vote 2 1 3`, `!v 2 1 3` | match players | vote by number (best first); `!vote` alone opens the vote window |
| `!bracket` | everybody | show/hide the bracket (shown automatically in the lobby, between games and at the end) |
| `!standings` | everybody | show/hide the standings |
| `!follow`, `!follow <name>`, `!follow off` | spectators | follow side A/B (toggle), a player by name prefix, or free camera |
| `!fp` | spectators | switch between first and third person while following |
| `!help` | everybody | list of commands |

All of them also work from the console as `mutate tourney <command>` (e.g. `mutate tourney bracket`, bindable to
a key: `set input F6 mutate tourney bracket`). Spectators follow side A automatically at the start of every game,
in first person by default.

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

   and add the package to the downloads (the bridge does this itself when it manages the server):

   ```ini
   [Engine.GameEngine]
   ServerPackages=UTTourney_v1
   ```

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
| 6 | Map vote | A vote panel in the middle of the screen (maps, seconds left, your vote). `!vote 2 1 3` or `!v 2 1 3` (console fallback: `mutate tourney vote 2 1 3`), also as a spectator; the bridge log shows `vote from <name>`; after both votes the server changes map. Right after a game the scoreboard closes by itself so the panel is visible |
| 7 | **Token after map change** | Players come back automatically after the travel. Does `?tk=` survive the travel? If players are rejected, report it (the address fallback should catch it) |
| 8 | Ready check | Match players are held (invisible, cannot move), see "Press FIRE or type !ready" |
| 9 | Ready | FIRE or `!ready` → countdown with announcer, both spawn together |
| 10 | Bot side | Bot spawns with the configured name and plays. Server log: `UTTourney: spawned bot <name> ...`; if it vanishes: `bot for side ... is missing, spawning it again` |
| 11 | Spectators | Everybody else is a spectator and can watch |
| 12 | Frag limit / time limit | Bridge logs `wins game 1 (20:13)`, next match is called |
| 13 | Tie at time limit | Overtime, next frag wins, bridge records `suddenDeath` |
| 14 | **Disconnect during a game** | Game holds both players, clock stops; on return the score is restored and both respawn normally (HUD, weapons, can shoot). The bot keeps playing after the resume. Without return the bridge forfeits after the grace period |
| 14b | **Reconnect limit** | With `maxReconnects` 2 (default): after the 2nd return a big warning "LAST WARNING" appears; the 3rd disconnect forfeits the match immediately |
| 15 | Long names / umlauts | Names show correctly; no `line too long` warnings in the bridge log |
| 16 | `!bracket`, `!standings` | Text bracket in the console; standings in the middle of the screen for 10 s and in the console |
| 17 | End of the tournament | Scoreboard closes, final standings in the middle of the screen with a 30 s countdown; then the bridge stops the server and exits |
| 18 | **HUD download** | Joining shows the package download once (a few hundred KB). Server log: no errors from `TourneyClient`/`TourneyGRI` |
| 19 | **Banner** | During ready, countdown and the game: names, score, match id, Bo and map at the top centre |
| 20 | **Ready panel** | Both names with READY / not ready, the hint and the seconds left; no more progress-message text for you |
| 21 | **Vote window** | When your vote starts a window opens: click up to 3 maps (numbers appear), "Vote" closes it and your vote is shown in the panel. Esc/console key closes it; `!vote` opens it again. Spectators see the panel only |
| 22 | **Bracket** | In the lobby, between games and at the end the bracket is drawn (winners, losers, grand final, scores, live match in green). `!bracket` hides/shows it, also during a game (20 s) |
| 23 | **Standings** | `!standings` (12 s); at the end next to the bracket with the shutdown countdown |
| 24 | **Follow** | As spectator at game start you look through side A's eyes. FIRE switches players and stays in first person; `!fp` toggles, `!follow Mario`, `!follow off` |
| 25 | **Map change** | After several games and map changes no `Failed to garbage collect` or `Accessed None` in the client log (`UnrealTournament.log`) |
