# Network settings for players (UT99 469)

Nothing here is required: the tournament works with UT's defaults. This page explains the one network setting a
player can choose, so everybody can decide for themselves.

## Netspeed

Netspeed is the most data per second (bytes/s) the server may send you. Too low, and with many players or
monsters on screen they jerk or jump; higher than the server allows has no effect, because the server sends at
most its own limit (`MaxClientRate`).

| Setting                   | 469f default | Where                                                    |
| ------------------------- | ------------ | -------------------------------------------------------- |
| `ConfiguredInternetSpeed` | `20000`      | `[Engine.Player]` in `UnrealTournament.ini` (internet)   |
| `ConfiguredLanSpeed`      | `20000`      | `[Engine.Player]` in `UnrealTournament.ini` (LAN games)  |
| server limit              | `20000`      | `maxClientRate` of the tournament server (`bridge.json`) |

The tournament server uses 20000 unless its admin set another `maxClientRate` (see
[server-extras.md](server-extras.md#tick-rate-and-client-rate)). A netspeed at or above the server's limit gets
everything the server sends; today's connections handle these amounts easily.

### Change it

- **For the running game:** console (`~` or `Tab`), type `netspeed 20000` (your value). Typing works on every
  client, also the native Linux one that cannot paste.
- **For good:** close UT, open `UnrealTournament.ini` and set the two lines under `[Engine.Player]`:

  ```ini
  [Engine.Player]
  ConfiguredInternetSpeed=20000
  ConfiguredLanSpeed=20000
  ```

  The file is in UT's `System` folder. Which file UT really uses is printed when it starts (`Using system ini
file: ...`, in the terminal on Linux or at the top of `UnrealTournament.log`).

### Check it

`stat net` in the console shows the connection while you play (ping, packet loss, data in and out); type it
again to hide it.
