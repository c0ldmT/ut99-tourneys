# Server extras: SmartStockBots, your own bots, tick rate

Optional additions to a UT server that is already set up (see the installation guides for
[Raspberry Pi](install-raspberry-pi.md), [Linux](install-linux.md) or [Windows](install-windows.md)).

## Files from your PC (Linux and Raspberry Pi)

`install-ut.sh` takes a folder with files from your PC as third argument and installs whatever of these it finds
there – without rebuilding the mod:

| File in the folder                                                      | What happens                                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `UTTourney_v1.u`, `UTTourneyMH_v1.u`                                    | the tournament mod built on your PC (same version as the bundle)                                         |
| `SmartStockBots.u`, `.int`, `.ini` or the `SmartStockBots…zip` download | SmartStockBots (see below)                                                                               |
| `User.ini`                                                              | only its bots (`[Botpack.ChallengeBotInfo]`) replace the server's bots; nothing else of the file is used |

Example for the Pi (your user and the Pi's address; the paths on the PC are where your files are):

```sh
# 1. on the Pi: a folder for the files
mkdir -p ~/ut-import
# 2. on the PC (PowerShell): copy the files there
scp "SmartStockBots.8 1.zip" C:\UnrealTournament\System\User.ini <user>@<pi-address>:ut-import/
# 3. on the Pi: install
sudo bash /opt/tourney/deploy/linux/install-ut.sh "" /opt/ut99 ~/ut-import
```

Then **Servers → Scan** on the website. Use a folder of its own (not your home folder directly), so nothing old
is installed by accident. Running it again with the same files does no harm.

## SmartStockBots

[SmartStockBots](https://www.moddb.com/mods/smartstockbots/downloads/smartstockbots) makes the stock bots play
much better (dodging, translocator, shock combos, less getting stuck). It runs on the server only; players need
nothing and download nothing.

### Install

- **Linux / Raspberry Pi:** put the downloaded zip (or the three files `SmartStockBots.u`, `SmartStockBots.int`,
  `SmartStockBots.ini`) into a folder and run `install-ut.sh` with it, see above. Alternatively by hand:

  ```sh
  sudo install -o tourney -g tourney -m 644 SmartStockBots.u SmartStockBots.int SmartStockBots.ini /opt/ut99/System/
  ```

  The names must be written exactly like this (Linux tells upper and lower case apart).

- **Windows:** unpack the zip and copy the three files into `C:\UnrealTournament\System`.

Then **Servers → Scan** on the website and tick **SmartStockBots** in the match rules of a tournament. The
bridge then loads it with the server (`ServerActors=SmartStockBots.SmartStockBots` in `Tourney.ini`, removed
again for tournaments without it); you do not add it to any ini yourself. A tournament with the box ticked does
not start while `SmartStockBots.u` is missing.

Check during a tournament with the box ticked: `grep "Spawning: SmartStockBots" /opt/ut99/System/Tourney.log`.

### Settings

All settings are in `System/SmartStockBots.ini` (`True`/`False`). For tournaments worth a look:

- `GoodBotVsPlayersTeam` – adds the best bot to a team if teams are uneven before the match. The tournament
  places all bots itself, so set it to `False` to be safe.
- `NotMarkAsBot`, `FakePing` – bots look like players on the scoreboard (no bot mark, a ping). The website and
  the statistics still show who is a bot.
- `SayHi`, `SayGG` – bots greet and say "gg" in the chat.
- `FastRespawn` – bots respawn at once. The tournament mod keeps bots held before the countdown, during a pause
  and after the game anyway.

`install-ut.sh` installs `SmartStockBots.ini` from a zip only if the server has none yet (your settings stay);
a loose `SmartStockBots.ini` in the folder replaces the server's (backup next to it).

## Your own bots

The bots of a UT installation (Bots menu: names, characters, skins, skill) are in the section
`[Botpack.ChallengeBotInfo]` of `System/User.ini`. The website takes its bot list from there when it scans the
server, and the server uses it for the bots' look. To use the bots you set up on your PC:

- **Linux / Raspberry Pi:** copy your `User.ini` from the PC (`C:\UnrealTournament\System\User.ini`) into the
  folder and run `install-ut.sh` with it (see above). Or directly with the bridge:

  ```sh
  sudo node /opt/tourney/bridge/dist/cli.js import-bots ~/ut-import/User.ini --ut /opt/ut99
  sudo chown tourney:tourney /opt/ut99/System/User.ini*
  ```

- **Windows:** if the server uses the UT folder you play with, your bots are already there. Otherwise:

  ```powershell
  node C:\Tourney\bridge\dist\cli.js import-bots C:\Path\To\User.ini --ut C:\UnrealTournament
  ```

The import replaces the server's whole bot section (backup `User.ini.bak-<time>` next to it) and leaves the rest
of the server's `User.ini` alone (keys, player name and so on are not taken from the PC). It warns if a bot uses
a character or skin package the server does not have (custom models or skins): copy that package into the
server's `System` or `Textures` folder, otherwise the bot cannot use it. Then **Servers → Scan** on the website;
the bots can be imported into the bot control center (**Bots → Import**); tournaments play with the active bots
of the control center (with no active bot there, with the server's bots).

## Tick rate and client rate

The bridge sets both in `Tourney.ini` on every start, independent of the server's `UnrealTournament.ini`. The
defaults are those of the 469f patch:

| `bridge.json` → `server` | Default | ini key (`[IpDrv.TcpNetDriver]`)               | Meaning                                                                                      |
| ------------------------ | ------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `tickRate`               | `50`    | `NetServerMaxTickRate`, `LanServerMaxTickRate` | server updates per second (10–200)                                                           |
| `maxClientRate`          | `20000` | `MaxClientRate`                                | bytes/s per player: the highest netspeed the server accepts, also the download speed from it |

Example for a strong server:

```json
"server": { "...": "...", "tickRate": 65, "maxClientRate": 40000 }
```

Restart the bridge after a change (the next server start uses it). A higher tick rate costs CPU on the server: on
a Raspberry Pi 3, keep 50 or go lower (e.g. 35) if Monster Hunt with many monsters stutters. Players choose their
own netspeed, see [client-settings.md](client-settings.md).
