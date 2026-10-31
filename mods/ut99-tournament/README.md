# UT99 Tournament Mod (`UTTourney_v1`)

UnrealScript package for UT99 469f. It turns a dedicated server into a tournament server driven by the bridge
(see [`docs/protocol.md`](../../docs/protocol.md)).

> **Status:** 1v1 and team deathmatch are tested on 469f (mod 0.3.0). Mod 0.4.0 moved the tournament logic into
> `TourneyCore`. Mod 0.5.0 adds Monster Hunt (package `UTTourneyMH_v1`, tested). Mod 0.5.1 only changes the
> message when the organizer restarts a game, sets a winner or calls a match off (instead of "wins by forfeit").
> Mod 0.5.2 shows its version in the game type name (scoreboard, server browser) and in the bracket title.
> Mod 0.5.3: bot skills work as set (0–7 = Novice … Godlike; before, every bot played at most like "Skilled"),
> message when the organizer ends a Monster Hunt run.
> Mod 0.5.4: Monster Hunt lives, monster skill and weapon stay come from the tournament (before, Monster Hunt's
> own defaults applied: 10 lives, monster skill 3).
> Mod 0.5.5: Monster Hunt bots – a virtual captain gives teams without players "Attack" every 45 s (they then
> follow the map's waypoints), and the waypoint fix (tournament option, on by default) sorts the waypoints
> correctly.
> Mod 0.5.6: the waypoint fix becomes the bot helpers (same option): jump routes over JumpSpots, bots keep
> their distance from lifts and gates that turn back on contact, a 3-step unstick, and a bot debug log (server
> log only: every order, each bot's confirmation, goals, waypoints, every helper step).
> Since platform 0.9.0 the Monster Hunt bot AI enhancements (waypoint fix and bot helpers) are always on; the
> tournament option is gone (the bridge always sends `wf: true`, no change in the mod).
> Mod 0.5.7: map bug fix (movers that open only once no longer turn back on contact), bots find out what opens a
> closed gate (monster, trigger, button) and hunt key monsters instead of fearing them, route to the path point
> next to an unreachable waypoint, bots make room at lifts; log shows who made a mover turn back, objectives and key
> monster deaths.
> Mod 0.5.8: bots no longer wait in front of opening doors (only closing ones or those about to move), so
> proximity doors (MH-Trials' big doors) do not close again in front of them; the "turned back" log leaves out
> doors that change direction on purpose (TriggerControl/TriggerToggle/TriggerPound).
> Mod 0.5.9: join tokens are compared without regard to case (short codes typed in the UT console).
> Mod 0.6.0: player statistics - kills, deaths, suicides, team kills, headshots, first blood, sprees, multi kills,
> kills per weapon, time played, Monster Hunt monsters and points, per player and bot, sent to the bridge before
> the end of every game (run). Monster Hunt: the map record (best final time from the statistics) is shown in the
> HUD under the run info (`mrec` line).
> Mod 0.7.0: website bots (bot control center) - look, voice, favourite weapon and play style come from the
> website (`bcfg`/`btr`, like the ini bot settings), chat lines on occasions (start, kill, death, win, loss,
> rival kill/death) with placeholders, talkativeness and a cooldown (`bpers`/`bsay`), rivals the bot prefers as a
> target and a nemesis it hunts down when it sees no other enemy (`brv`, `GameThreatAdd`). Clan tags come as part
> of the name. Bots of the server's ini work as before.
> Mod 0.7.1: bets with Neuro - a website bot whose bet was decided since its last game may say a "bet won" or
> "bet lost" line at the start of its next game (`bbet`, placeholders `{amount}` and `{pick}`).
> Mod 0.7.2: Monster Hunt bots - a monster that takes no damage for seconds (cage, bars, wall) is left alone for a
> while and the bots go to what opens the cage; a bot without ammo switches weapons or fetches ammo.
> Mod 0.7.3: kill feed - every kill of or by a player goes to the bridge (`kf`: killer, victim, sides, weapon,
> headshot, first blood, suicide, team kill, spree, multi kill); the website shows it live on the match page.
> Mod 0.7.4: dedications (Neuro shop) - a player's approved line that website bots say when they frag the player
> or are fragged by them (`ded` after the bot lines of a match, 60% chance, the bot's chat cooldown applies).
> Mod 0.8.0: bot AI help in deathmatch and team deathmatch (`ai` in the `match` line, website setting "Bot AI help") -
> failsafe: a bot that stands still for 8 s without an enemy is sent after the nearest opponent, after 16 s it
> wanders off, without an enemy for 15 s it hunts the nearest opponent; duel mode (one on one): without an enemy for
> 4 s it hunts its opponent. Only roaming or wandering bots with freelance or attack orders; camping bots are left
> alone (duel mode: 10 s at most); the game classes are compared exactly, so later modes (CTF, ...) and Monster Hunt
> keep their own AI. Novice bots (skill 0-3) now really hunt a target set from outside (also the nemesis hunt).
> Mod 0.9.0: Unreal Dream Team game traits (`btrt` after the bot's `btr` line): start armour (25), thick skin (-10 %
> damage taken), adrenaline (30 % faster for 3 s after a kill), glass cannon (+20 % damage dealt and taken), vampire
> (15 % of the damage dealt as health, up to 100), phoenix (once per game a lethal hit leaves 50 health, announced in
> the chat). The mod's mutator is also the damage mutator; bots without game traits play as before.
> Mod 0.10.0: Dream Team behaviour traits (codes in the same `btrt` line): vulture (below 50 health it plays
> cautiously, so it retreats to health and armour), kamikaze (flak cannon as favourite weapon unless one is set, charges
> more), berserker (a little more aggressive, below 40 health it never retreats), revenant (prefers its last killer and
> hunts him when it has no enemy), bounty hunter (prefers the leader and hunts him); the hunts in deathmatch games only.
> Mod 0.10.1: bots that run back and forth or stand stuck (deathmatch games). Hunts the mod starts (AI help, nemesis,
> revenant, bounty hunter) need a path to the target and must bring the bot closer: without progress for 6 s the hunt is
> given up and no hunt from the mod follows for 15 s. With AI help: a bot that tries to move without progress jumps
> aside (3 s, 5 s), takes a detour (8 s, 14 s) and is moved to a start spot without a death (20 s); a bot that has not
> left an area of 300 units for 12 s without a fight takes a far detour (12 s, 24 s), at 36 s it is moved to a start
> spot. Every step is in the server log (`UTTourney: bot [...]`).
> Mod 0.11.0: Dream Team behaviour traits, second group (codes `sn`, `tp`, `sd`, `ic` in the `btrt` line): sniper's nest
> (sniper rifle as favourite weapon unless one is set; with it and no enemy in sight it heads for one of up to 12 high
> points with a view, found once per map, and camps there 8-14 s), team player (team games: prefers what its team mates
> attack and joins a team mate's fight within 2500 units when it has no enemy in sight), shuffle dancer (strafes more;
> in a fight it dodges to alternating sides about once a second), item controller (knows when armour, shield belts and
> damage amplifiers come back and is there in time, waits next to them). The errands only without an enemy in sight;
> the AI help does not send a bot after an opponent while it is on one.
> Mod 0.12.0: the chat lines of website bots also go to the bridge (`bs`), the website shows them in the kill feed of
> the match page.
> Mod 0.12.1: cut-off bots (AI help, deathmatch games). Three hunts in a row refused for lack of a path (about 30 s, no
> fight) and no opponent reachable from there: the bot is moved to a start spot with a path to an opponent (the first
> time none has one it stays, the next time any start spot). The area check ignores heights in the air (a bot bouncing
> on a kicker no longer leaves its area); no far detour → a near one, none → start spot 12 s later. Stuck heading for
> the same point again and again: a detour, the fourth time a start spot. A cleared enemy no longer causes
> `Accessed None` in StakeOut.
> Mod 0.13.0: skill curve instead of UT's novice switch (all game types, website setting "Skill curve", match `sc`).
> Every bot runs the full AI; its level sets speed (Novice 70 %, Average 77 %, Experienced 83 %, Skilled 90 %, from
> Adept 100 %), turn rate, field of view (100°-200°), hearing, dodging (projectiles 10 %-95 %, fighting moves 5 %-30 %,
> while running at least every 6 s-0.4 s), flinches and aim (below Adept a negative accuracy; the aim error drifts
> instead of jumping with every shot, a slight lag behind moving targets). A bot that has not seen its target for
> 0.6-1.5 s stops firing (splash weapons a little longer near the last seen spot; StakeOut -> hunting); a hit from out
> of view turns it after 0.12-0.7 s (low levels sometimes the wrong way first). No damage malus against players. The
> stock bot classes are spawned as `TourneyMale1Bot` etc. (same bot, drifting aim); other classes get everything but
> the aim. SmartStockBots: `MoveWithDodge` and `FixMinigun` are switched off at run time (log line, ini untouched).
> Mod 0.14.0: skill curve v1, tuned with the duel simulator (`pnpm --filter @tourney/api bot:sim`): the level is the
> main strength, the bot's own accuracy counts less (aim error ±19 %-35 %), low levels aim worse, turn slower (26k-100k)
> and take in a new enemy first (0.6 s Novice-0.03 s Godlike: no turning, no firing), hold fire now and then (Novice
> about 30 % of the time, none from Masterful), turn later to hits from behind (1.0-0.12 s). Dream Team values traits
> act as edges on the curve (codes in `btrt`): steady hand / patient hunter / eagle eye aim error -7/-12/-14 %,
> watchdog reacts twice as fast with +40° view and 20 % faster turning, side-stepper dodges twice as often,
> all-rounder a bit of everything. Fire holds work fully on the stock classes (`FireWeapon`); other classes stop
> firing at the next 0.1 s tick.
> Mod 0.14.1: bot class defaults for the website's look picker (decision 173). After connecting outside a game the
> bridge asks (`describe`) about every bot class of the server it has no answer for yet; the mod loads the class and
> reports mesh name, multi-skin flag, voice meta class, own voice and default skin (`model`) - the values UT's own setup
> menu works with. The bridge keeps the answers (`models.json` in its data folder, asked again when a package changes)
> and sends them to the website, so new models (War Boss, Xan Mark II, custom packs) get their skins, faces and voices
> without maintenance. Nothing changes in the game.
> Mod 0.15.0: bot errors and dodging (decision 174, tuned with the duel simulator). The curve dodges projectiles itself
> (UT's own dodge is off): a shot of its enemy it can see coming, after a reaction time (0.35 s Novice … 0.03 s
> Godlike), sometimes to the wrong side (40 % … 5 %), also in fighting moves; low levels sometimes do not lead their
> target (50 % … 0); UT's advanced tactics are kept by level (20 % … 100 %); the strafing value makes bots dodge more
> (up to +60 %). Base accuracy Novice -2.0, Adept -0.2. A bot with only a melee weapon that has not got to its enemy for
> 5 s (DM-SpaceNoxx: both out of ammo on the kickers) leaves it alone for 10 s and looks for a weapon (AI help).
> Dream Team: daredevil reacts 10 % faster, bouncer dodges 20 % more often (codes `dd`, `bo` in `btrt`).
> Mod 0.17.0: trait log and Monster Hunt objectives (decision 237). Every game trait of a website bot reports what it
> did: traits that switch on and off (vulture, berserker, revenant, bounty hunter, sniper's nest, team player, item
> controller, adrenaline, phoenix) send a `tv` line when an episode ends (start, seconds, kills in it, died) and write
> `trait <name> on/off: …` into the server log; at the end of the game (run) one `pt` line per trait with its counters
> (uses, seconds active, kills and deaths while active, values: health healed, damage prevented, extra damage dealt and
> taken, dodges, flak kills, armour) goes out with the statistics, values traits as passive lines. The counters line
> `sx` carries the monsters killed (`mk`). Monster Hunt: the map's objectives (`MonsterHuntObjective`) go to the
> bridge with their state on every change (`ob`), again after a reconnect. Nothing changes in the game.
> Also 0.17.0: the Dream Team Monster Hunt focus (decision 238). The `btrt` line carries `mf` (-2 … 2, the manager's
> setting; also without traits) and `TourneyMHBotExtension` (point 10) plays it: hunters (-2) fight big monsters
> instead of fleeing and attack hostile monsters in sight within 1500 units, thorough bots (-1) the same above 60
> health within 900; brisk bots (1) ignore monsters further than 1200 units and break off a fight with one monster
> after 8 s (leave it alone for 12 s unless it comes within 350 units), sprinters (2) 600 units, 3 s, 20 s. Key
> monsters, shielded targets, waypoints, movers and unstick keep their rules; behaviour traits keep acting (a hurt
> vulture still retreats). Log lines `bot [time] <name>: focus 2 - breaks off from …`.

## Classes

| Class | Role |
|---|---|
| `TourneyCore` | The tournament logic (server only, one per level): bridge messages, token login, roles, ready check, countdown, bots, score, end of game, travel, soft pause, score restore, votes, commands, HUD state. A side can have several players and bots |
| `TournamentDM` | Game type (extends `Botpack.DeathMatchPlus`), 1v1: spawns the core and forwards the engine events (login, logout, timer, end of game) |
| `TourneyCoreTDM` | Core for team games: puts players and bots into the red/blue team, team scores |
| `TournamentTDM` | Team deathmatch (extends `TournamentDM`): red = side a, blue = side b; team scores, friendly fire, team skins, end of game and bot attitude taken over from `TeamGamePlus`; teams come from the access list |
| `TourneyCoreMH` (package `UTTourneyMH_v1`) | Core for the Monster Hunt time race: the running team are the hunters, run clock without pauses, deaths of the team (bots included), time limit, `rp`/`runend` to the bridge, race state for the HUD |
| `TourneyMHBotExtension` (package `UTTourneyMH_v1`) | Monster Hunt's bot extension with the bot AI enhancements that fix bot behaviour in Monster Hunt (sorted waypoints, jump routes, movers, closed doors, unstick); always on |
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
| 27 | **Website bots** (mod 0.7.0) | A bot from the control center has the skin, face and voice set there (team colours in team games) and plays as set (e.g. a camper stays put, "jumpy" jumps a lot). With talkativeness 100 it greets at the start, comments kills/deaths and the end; lines with `{victim}` etc. show the names. A nemesis comes looking for its target when it has no other enemy; server log without `Accessed None` |
| 28 | **Bet lines** (mod 0.7.1) | A website bot with a "Bet won"/"Bet lost" line and talkativeness 100 that won or lost a bet with Neuro says it at the start of its next game, with amount and the backed name |

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
| 45 | Lives | "Unlimited" in the form: nobody is ever "lost"; with a number, hunters are out after that many deaths and a team with everybody out has not reached the exit. Server log: `Monster Hunt: lives 0 (0 = unlimited), monster skill 5` |
| 46 | Bots | Bot-only team: server log `virtual captain: Attack for N bots, every 45 s`; the bots head through the map instead of wandering. With the waypoint fix: `bot waypoints (sorted): 1 2 3 ...` at every level start; also together with SmartStockBots |
| 47 | Bot helpers | Bot-only Monster Hunt run, then `grep "UTTourney: bot" Tourney.log`: per order `order: Attack -> NAME` and a second later `ack: NAME follows Attack, ...`; at the level start `mover ... turns back on contact` and `movers watched: N, lifts: L`; then `goal waypoint N`, `waypoint N reached`, and per helper step `waits at ...`/`goes on`, `stuck ... jumps`/`detour`/`penalty-free respawn`, `only with a jump (JumpSpot)`. Nothing of it appears in the game or console. MH-Trials: the bots cross the lava after the rock (waypoints 7–10) instead of running to the start gate; MH-NaliVillage][: no endless lift loop; MH-Canyon: the bots wait in front of the castle bars until all have opened |
| 48 | Bot helpers 2 | Level start: `map fix: MoverN ... it no longer turns back` (MH-Canyon: Mover9–16, MH-Trials: gateway, beams, final bars) and `key monster: ...` (MH-NaliVillage][: both titans). During the run: `stuck at closed MoverN (tag) ..., opened by: ... -> hunts/goes to/bumps X` and `errand for MoverN ends, ...`; `no route to waypoint N itself, goes via ...`; `makes room at lift ...`; `mover ... turned back ..., nearest pawn ...`; `objective active/completed: ...`; `key monster dead: ...`. MH-Canyon: the castle bars always open; MH-NaliVillage][: the bots kill the second titan; MH-Trials: the bots reach waypoint 10 or the trigger next to it |
| 49 | Statistics | Play a game (or Monster Hunt run) to the end. Tournament page → Events (admin): a `match.playerStats` line right before the game's result with every player and bot and their kills (Monster Hunt: monsters, `12M`). Bridge log without `player statistics ... of ... players arrived` warnings |
| 50 | Map record in the HUD | Monster Hunt tournament with statistics: the run banner at the top shows a third line `Map record: none yet - reach the exit to set it` on a fresh database. Finish a run: the bridge says `New map record on MAP: m:ss.s by TEAM` and the HUD shows it at once; the second run of the game shows `Map record: m:ss.s by TEAM`. A tournament with statistics switched off shows `(this tournament does not count)` and never announces a record. The record also appears on the statistics page (Records → maps) |
| 51 | Caged targets and ammo (mod 0.7.2) | Bot-only Monster Hunt run on MH-NaliVillage][ or MH-Forbidden, then `grep "UTTourney: bot" Tourney.log`: `target X takes no damage (in the way: ...), bots leave it for now` and, with a mover in the way, `target X behind MoverN (tag) ..., opened by: ...`; later `target X is free (MoverN moves)`/`takes damage`/`is tried again`. The bots no longer shoot at the cage for minutes. A bot with an empty weapon: `no ammo for ..., switches to ...`, with no ammo at all `no weapon with ammo left, fetches ...` and `has ammo again` |
| 52 | **Kill feed** (mod 0.7.3) | During a game the match page on the website shows every kill within a second or two: killer and victim in their side's colour, weapon, "HS" for a headshot, "First Blood", sprees ("Killing Spree" at 5) and multi kills ("Double Kill"), suicides and team kills; the live score above it and in the banner of the tournament list. Monster Hunt: kills of monsters and deaths by monsters. Bridge log without `kf` parse errors |
| 53 | **Dedication** (mod 0.7.4) | Buy the dedication in the Neuro shop with both lines, approve it (Shop → Manage), start a tournament with you and website bots that talk. When a bot frags you it says your kill line now and then (`{victim}` = you), when you frag one it says your death line; other kills keep the bots' own lines. Bridge log without `ded` parse errors |
| 54 | **Bot AI help** (mod 0.8.0) | Settings → "Bot AI help" on "Failsafe and duel mode". 1v1 bot-only tournament on maps where bots used to stand still (and a small one like DM-Tempest): the bots look for each other, a game with 10 frags ends in about 4-6 minutes, no bot stands in one place for long. 2on2 bot-only: normal play, a bot that stops moving gets going within ~10 s. Monster Hunt run: bots behave as before. Setting "Off": behaviour as in 0.7.4. Server log without `Accessed None` from `AntiIdle` |
| 55 | **Dream Team game traits** (mod 0.9.0) | Test instance with Dream Team on: give a roster bot a body trait (Packs → craft, My team → add trait), enter it in a Dream Team 1v1 with a real server. Start armour: the bot spawns with 25 armour (spectate: armour in the HUD of the bot view). Phoenix: the first lethal hit of a game leaves it alive, chat `[TAG]Name rises from the ashes!`, server log `game trait phoenix: ... survives`; the second hit kills. Glass cannon/thick skin/vampire: compare damage numbers with `stat` or by feel (a glass cannon bot dies faster, a vampire recovers health). Adrenaline: visibly faster for a few seconds after a frag. Bots without traits and normal tournaments behave as in 0.8.0; server log without `Accessed None` |
| 56 | **Dream Team behaviour traits** (mod 0.10.0) | Dream Team 1v1 or 2on2 with a real server and roster bots with behaviour traits. Revenant: after it was fragged it goes after its killer (spectate it). Bounty hunter: goes after the player or bot with the most frags. Kamikaze without a favourite weapon: picks up and uses the flak cannon, charges. Vulture: below 50 health it runs for health or armour instead of fighting on; berserker: keeps fighting when low. Monster Hunt: no hunts, the rest works. Bots without traits as in 0.9.0; server log without `Accessed None` |
| 57 | **Running on the spot, stuck bots** (mod 0.10.1) | Bot AI help on. Bot-only 1v1 and 2on2 on DM-Curse][ (and maps where bots stood under stairs or ran back and forth), a few games. No bot runs back and forth or stands in one place for more than ~15 s without a fight. `grep "UTTourney: bot" Tourney.log`: lines like `hunt of X without progress for 6 s ..., given up for 15 s`, `no path to X, no hunt for 10 s`, `stuck for 3 s ...: jumps aside`, `detour via PathNodeN`, `has not left (x,y,z) (300 units) for 12 s ...`, `moves again after ...`, rarely `moved to PlayerStartN (no death counted)`. Bots camping on purpose (sniper bots) are left alone; fights in a small room are not touched. Server log without `Accessed None` |
| 58 | **Dream Team behaviour traits, group 2** (mod 0.11.0) | Dream Team games with a real server, roster bots with the new traits. Sniper's nest (DM-Deck16][, DM-Morpheus or another map with heights): the bot picks up the sniper rifle, goes up and camps there for a while (server log `sniper nests on this map: N`, `heads for the sniper's nest PathNodeN`, `... reached, camps`). Team player (2on2 or larger): two bots of a side attack the same opponent, `team player joins X's fight against Y`. Shuffle dancer: dodges left and right in fights (spectate it). Item controller (DM-Deck16][ or a map with shield belt/UDamage): `power items on this map: N`, it heads for the item before it is back (`item controller heads for ..., back in N s`) and waits next to it (`waits N s at ...`). Bots without these traits as in 0.10.1; server log without `Accessed None` |
| 59 | **Bot chat in the kill feed** (mod 0.12.0) | A game with talking website bots (Bots → personality with lines, talkativeness high; Dream Team bots: My team → Look & lines). On the match page the bots' lines appear in the kill feed between the kills (name in its side's colour, the line in quotes). Bridge log without `bad line` for `bs` |
| 60 | **Cut-off bots** (mod 0.12.1) | Bot AI help on. Bot-only 1v1 on DM-SpaceNoxx (upper ring, kickers), a few games. No bot stays on the ring or on a kicker for more than ~40 s without a fight. `grep "UTTourney: bot" Tourney.log`: `no path to X (N in a row)`, then `no path to any opponent (3 hunts in a row) at ..., moved to PlayerStartN (no death counted)` (or `..., stays` once); bouncing bots get `has not left ... for 12 s`. Other maps (DM-Curse][, DM-Deck16][) as in test 57. Server log without `Accessed None` (no more `StakeOut.ContinueStakeOut` / `RelativeStrength`) |
| 61 | **Skill curve** (mod 0.13.0) | Settings → Bot AI help → "Skill curve" on. Bot-only 1v1s at Novice, Skilled, Adept and Godlike (DM-Deck16][, DM-Curse][), one Monster Hunt run. Server log: `skill curve True`, with SmartStockBots `SmartStockBots: MoveWithDodge False (was True), FixMinigun False (was True)`; `spawned bot ... class TourneyMale1Bot` (stock classes). Spectate in first person: Novice clearly slower than before (70 %), Skilled almost full speed; low levels dodge now and then (also forward while running), high levels often. Minigun and pulse gun swing smoothly past the target instead of jittering. A bot that loses sight stops firing after about a second (`has not seen X for N s, stops firing at ..., hunts`); shot from behind it turns round (`hit from out of view by X, turns to it`). Setting off: `skill curve False`, bots as in 0.12.1 (stock classes, SmartStockBots values back). Server log without `Accessed None` |
| 62 | **Skill curve v1 and trait edges** (mod 0.14.0) | Skill curve on. Bot-only 1v1s Novice vs Skilled and Adept vs Godlike (DM-Deck16][): Novice clearly turns slower, pauses a moment before it turns to a new enemy and stops firing now and then; Godlike unchanged (fires at once, no pauses). Skilled with accuracy 100 (control center) vs Masterful with accuracy 0: Masterful should win most games. Dream Team game with a bot with eagle eye and one with watchdog: no script errors; the watchdog bot turns quickly to hits from behind. Impact hammer still charges and fires (no fire pause with melee weapons), shock combos still work. Server log without `Accessed None` |
| 63 | **Bot class defaults** (mod 0.14.1) | Bridge and website updated, then start any tournament (or the lobby) once. Bridge log: no `bad line` / `unknown bridge message describe`; the bridge's data folder has `models.json` with War Boss, Xan Mark II and Skaarj Hybrid. Control center → Bots → new bot: War Boss and Xan Mark II no longer show the "unknown model" hint and offer the skins and voices UT's own bot setup shows for them; Skaarj Hybrid still offers Arena Warrior / Cyborg Trooper / Pit Fighter. Next server start: `models.json` stays unchanged (not asked again). Server log without `Accessed None` |
| 64 | **Bot errors and dodging** (mod 0.15.0) | Skill curve on, AI help on. Bot-only 1v1s Novice vs Skilled with rocket launcher and pulse gun (DM-Deck16][): the Novice dodges rockets late or to the wrong side now and then and does not always lead; Godlike dodges cleanly and leads. A bot with strafing 100 (control center) dodges visibly more than one with 0. DM-SpaceNoxx 1v1 until both are out of ammo: log `only a melee weapon, has not got to X for 5 s ..., leaves it for 10 s and looks for a weapon`, the bots leave the kickers. Impact hammer fights at close range still happen (no log while they hit each other). Dream Team bot with daredevil or bouncer: no script errors. Server log without `Accessed None`; Pi load in a 4-bot game as before |
| 65 | **Live data** (mod 0.16.0) | Bridge and website updated. 1) 1v1 you against a website bot (DM-Deck16][): the match page shows both players' health and armour bars, weapon, AMP with seconds while one has the damage amplifier, GÜRTEL/BELT with the shield belt, your ping; with you in the game the chip "state 20 s delayed" and health, items and bot thoughts arrive about 20 s late, kills at once. Take the amp, the shield belt, body armour and the big keg: one feed line each ("takes Damage Amp"); walk over the keg with full health: no line. Kills show "x health left · y m" and "Amp" when amplified. 2) Bot-only TDM 3on3 or 5on5: everything live (no chip), one row per player, team sum, bot thoughts ("attacks · name", "goes for Shield Belt", at most one per bot every 5 s; with more than four bots switched off in the feed). 3) Monster Hunt 2on2: during run 2 the feed goes on (run 2 open, run 1 closable), the run panel shows run 1's time, the live time, deaths, penalty, points, monsters left (Nali and cows not counted) and the time left to beat run 1; points chart with run 1 dashed. 4) After a game: statistics with damage and items, momentum, the whole feed (open it). Bridge: no `bad line`; `<dataDir>/bot-logs/bot-thoughts-<day>.jsonl` gets lines. Pi load with 10 players (top) |
| 66 | **Trait log, objectives** (mod 0.17.0) | Bridge and website updated. 1) Dream Team game with roster bots carrying behaviour and body traits (vulture, berserker, vampire, thick skin, phoenix, shuffle dancer …): server log lines `trait vulture on: …` / `off: … after 6s, 1 kills` and `trait summary: …` at the end; match page → "Traits in this game": per bot the traits with episodes (time, seconds, kills, died) and effects (health healed, damage prevented, dodges), values traits as passive; feed filter "Traits" shows the episodes live. 2) Settings → Dream Team → Trait report: CSV and JSON download with one row per bot, game and trait. 3) Monster Hunt 2on2 on a map with objectives (MH-NaliVillage, MH-Egypt): the run panel lists the objectives (active bold, done struck through) with "n / m", the live board's "Monsters / deaths" counts monsters. Bridge: no `bad line` |
| 67 | **Monster Hunt focus** (mod 0.17.0) | Website updated. My team → Monster Hunt focus: set Sprinter for one manager, Hunter for another, then a Dream Team Monster Hunt cup 2on2 (MH-NaliVillage or MH-Egypt), bot help (waypoint fix) on. Server log: `bot [..] <name>: focus 2` once per bot, sprinters `focus 2 - breaks off from … and moves on` and they pass monsters further away; hunters `focus -2 - attacks …` and they stay and fight titans/big monsters instead of fleeing. Compare the run times and deaths of both teams; Standard (0) plays as before |

## SmartStockBots (optional)

SmartStockBots makes the stock bots play much better. It runs on the server only; clients need nothing.
Download: [moddb.com/mods/smartstockbots](https://www.moddb.com/mods/smartstockbots/downloads/smartstockbots).
Installation on Linux/Pi (also straight from the zip) and the settings worth a look for tournaments:
[docs/server-extras.md](../../docs/server-extras.md#smartstockbots).

1. Copy `SmartStockBots.u`, `SmartStockBots.int` and `SmartStockBots.ini` into the `System` folder of the
   server installation, then scan the server on the website (Servers → Scan maps and bots).
2. Tick **SmartStockBots** in the match rules of the tournament (or `"smartStockBots": true` in the rules of a
   tournament file). The bridge adds `ServerActors=SmartStockBots.SmartStockBots` to `Tourney.ini` and removes
   it again for tournaments without it. A tournament with the box ticked does not start if `SmartStockBots.u`
   is missing (clear message on the website / in the bridge log).
3. Its settings stay in `SmartStockBots.ini`. The mod keeps held bots held: SmartStockBots' `FastRespawn`
   cannot bring a bot back before the countdown, during a pause or after the game.

## Known limitations

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
