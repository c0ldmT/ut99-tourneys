# UT99 Tournament Mod (`UTTourney_v1`)

UnrealScript package for UT99 469f. It turns a dedicated server into a tournament server driven by the bridge
(see [`docs/protocol.md`](../../docs/protocol.md)).

> **Status:** 1v1 and team deathmatch are tested on 469f (mod 0.3.0). Mod 0.4.0 moved the tournament logic into
> `TourneyCore`. **Mod 0.5.0 adds Monster Hunt (package `UTTourneyMH_v1`) and is not compiled yet**: run `build`,
> play a short 1v1 and 2on2 (should behave as before), then the Monster Hunt checklist below.

## Classes

| Class | Role |
|---|---|
| `TourneyCore` | The tournament logic (server only, one per level): bridge messages, token login, roles, ready check, countdown, bots, score, end of game, travel, soft pause, score restore, votes, commands, HUD state. A side can have several players and bots |
| `TournamentDM` | Game type (extends `Botpack.DeathMatchPlus`), 1v1: spawns the core and forwards the engine events (login, logout, timer, end of game) |
| `TourneyCoreTDM` | Core for team games: puts players and bots into the red/blue team, team scores |
| `TournamentTDM` | Team deathmatch (extends `TournamentDM`): red = side a, blue = side b; team scores, friendly fire, team skins, end of game and bot attitude taken over from `TeamGamePlus`; teams come from the access list |
| `TourneyCoreMH` (package `UTTourneyMH_v1`) | Core for the Monster Hunt time race: the running team are the hunters, run clock without pauses, deaths of the team (bots included), time limit, `rp`/`runend` to the bridge, race state for the HUD |
| `TournamentMH` (package `UTTourneyMH_v1`) | Game type (extends `MonsterHunt.MonsterHunt`, Monster Hunt 613): spawns the core and forwards the engine events like `TournamentDM`; hunters only, counts deaths (`Killed`) |
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
| `!start` | team captains | during the ready check (after 60 s): play now, bots fill missing places; also in team chat |
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

If `MonsterHunt.u` (Monster Hunt 613) is in the `System` folder, the script also builds the Monster Hunt package
from `MH/Classes/` (`EditPackages=MonsterHunt` and `EditPackages=UTTourneyMH_v1` are added after
`UTTourney_v1`). Result: `UTTourneyMH_v1.u`. It runs on the server only: clients do not download it (they need
`UTTourney_v1` and `MonsterHunt`, which the bridge puts into `ServerPackages`).

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
| 21 | **Vote window** | When your vote starts a window opens with the mouse cursor (like the Esc menu; it waits while you are typing). Click up to 3 maps (numbers appear), "Vote" closes it and your vote is shown in the panel. Esc closes it without voting and gives the controls back; `!vote` opens it again. Spectators see the panel only |
| 22 | **Bracket** | In the lobby, between games and at the end the bracket is drawn (winners, losers, grand final, scores, live match in green). `!bracket` hides/shows it, also during a game (20 s) |
| 23 | **Standings** | `!standings` (12 s); at the end next to the bracket with the shutdown countdown |
| 24 | **Follow** | As spectator at game start you look through side A's eyes. FIRE switches players and stays in first person; `!fp` toggles, `!follow Mario`, `!follow off` |
| 25 | **Map change** | After several games and map changes no `Failed to garbage collect` or `Accessed None` in the client log (`UnrealTournament.log`) |
| 26 | **SmartStockBots** (optional, see below) | Server log at start: SmartStockBots loaded; bots dodge, translocate and combo visibly better; before the countdown and during a pause the bot stays invisible and does not move |

### Team deathmatch (2on2, 3on3, 5on5)

Create a team tournament on the website (mode "2 on 2", bracket of 4), make two teams with at least one human
each; empty places and bracket slots are filled with bots. With two clients a 2on2 of "you + bot vs. friend +
bot" is enough to see everything.

| # | Check | Expected |
|---|---|---|
| 27 | Server start | Server log: `game=UTTourney_v1.TournamentTDM`, no errors from `TournamentTDM` |
| 28 | Check-in | Bridge: `<name> (<team>) checked in`; check-in ends as soon as every team has its starters here (or after the check-in time; a team with nobody here becomes a bot team) |
| 29 | Map vote | Every member of both teams gets the vote window; the vote closes when all have voted |
| 30 | Line-up | After the travel the players of the line-up are held as players, substitutes join as spectators. Bridge log: `line-up <team>: ...` |
| 31 | Ready panel | Team names in red/blue, "x/y ready" per team, READY when a team is ready; your own hint |
| 32 | Captain start | With a team mate missing: after 60 s the captain gets "type !start"; `!start` (also in team chat, Y) → countdown, a bot takes the free place |
| 33 | Game | Red/blue skins, team HUD and team scoreboard (F1), score at the top = team score; the game ends at the frag limit as team score; with friendly fire 0 % team mates take no damage |
| 34 | Disconnect | No pause. After 20 s a bot joins your team (`... plays for <name>`); when you reconnect the bot leaves and you play again with your score |
| 35 | Tie / end | Tie at the time limit → overtime, next frag wins; the bridge records the team scores |

### Monster Hunt time race (mod 0.5.0)

Needs Monster Hunt 613 and `UTTourneyMH_v1.u` on the server. Create a tournament with game "Monster Hunt (time
race)", mode 2on2, a bracket of 4 and two or three `MH-` maps; a short time limit per run (e.g. 3 minutes) makes
the test quicker. "You + bot" against a bot team is enough.

| # | Check | Expected |
|---|---|---|
| 36 | Server start | Server log: `game=UTTourneyMH_v1.TournamentMH`, no errors from `TournamentMH`/`TourneyCoreMH`; the bridge's ini check accepts `MonsterHunt.u` and `UTTourneyMH_v1.u` |
| 37 | Map vote | As in team games; the bridge says `Map: MH-... <team> runs first, then <team>` |
| 38 | Run 1 | Only the running team plays (Monster Hunt hunters), the other team joins as spectators and follows the runners. Ready panel: the watching team shows "watching" |
| 39 | HUD | Top: `Run 1/2: <team>  m:ss.t` (with penalty), below raw time, deaths x penalty, limit; Monster Hunt's own HUD and scoreboard otherwise |
| 40 | Deaths | Every death (yours and the bot's) adds the penalty to the time in the banner; monsters dying do not |
| 41 | Exit | At the exit: `Exit reached: ...` and the end screen; the website shows the run in "Run times" |
| 42 | Run 2 | The same map loads again for the other team; the banner shows "Time to beat: <team> m:ss.t" |
| 43 | Time limit | A run that does not reach the exit ends at the limit (`Run over: ...`); the website shows it as not finished; a team at the exit beats it |
| 44 | Pause | `pause` from the website during a run: the run clock stops and continues on resume |
| 45 | Lives | Unlimited lives (`Lives=0` in `[UTTourneyMH_v1.TournamentMH]` of `Tourney.ini`); if Monster Hunt still eliminates players, please tell me |

## SmartStockBots (optional)

SmartStockBots makes the stock bots play much better. It runs on the server only; clients need nothing.

1. Copy `SmartStockBots.u`, `SmartStockBots.int` and `SmartStockBots.ini` into the `System` folder of the
   server installation, then scan the server on the website (Servers → Scan maps and bots).
2. Tick **SmartStockBots** in the match rules of the tournament (or `"smartStockBots": true` in the rules of a
   tournament file). The bridge adds `ServerActors=SmartStockBots.SmartStockBots` to `Tourney.ini` and removes
   it again for tournaments without it. A tournament with the box ticked does not start if `SmartStockBots.u`
   is missing (clear message on the website / in the bridge log).
3. Its settings stay in `SmartStockBots.ini`. The mod keeps held bots held: SmartStockBots' `FastRespawn`
   cannot bring a bot back before the countdown, during a pause or after the game.

## Known limitations

- Bot skill is mapped from 0–7 to UT's 0–3 bot skill; the global novice flag of DeathMatchPlus is not
  changed per bot.
- A tournament pause from the bridge holds the game only while a match is live; during the ready check
  the countdown still runs.
- Players can rename themselves with the `name` command; the bridge identifies them by token anyway.
- The token fallback after a map change (by IP address) cannot tell apart two players behind the same IP.
- The HUD is only drawn while the scoreboard is closed (UT draws HUD mutators after the scoreboard check).
- Team games: `TournamentTDM` is not a `TeamGamePlus` subclass. If a human gives a bot the order "Follow me"
  (orders menu), the server log shows `Accessed None` warnings from `Bot.CloseToPointMan`; the bot keeps
  playing. Mods that check `IsA('TeamGamePlus')` may treat the game as a non-team game.
- Team games: players on the bench (substitutes not in the line-up) are spectators for the whole game; line-up
  changes apply from the next game.
- Monster Hunt: `TournamentMH` switches Monster Hunt's own time limit off and measures the run itself (game
  seconds, pauses excluded). Monster Hunt's HUD therefore shows no remaining time; the tournament banner does.
- Monster Hunt: the run counts as "exit reached" for every end of game except the time limit and "no hunters
  left". Map scripts that end the game in another way count as reaching the exit.
