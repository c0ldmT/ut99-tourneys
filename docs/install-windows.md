# Installation on a Windows server

For Windows 10/11 or Windows Server 2019+ (64-bit): website, bridge and UT99 server on one machine. Linux:
[install-linux.md](install-linux.md), Raspberry Pi: [install-raspberry-pi.md](install-raspberry-pi.md).

## Layout

| Part      | Path                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program   | `C:\Tourney\website`, `C:\Tourney\bridge`, `C:\Tourney\mod`                                                                                                     |
| Settings  | `C:\Tourney\config\website.env`, `C:\Tourney\config\bridge.json`                                                                                                |
| Data      | `C:\Tourney\data\website` (SQLite database), `C:\Tourney\data\bridge`                                                                                           |
| Logs      | `C:\Tourney\logs\website.log`, `C:\Tourney\logs\bridge.log`, UT: `<UT>\System\Tourney.log`                                                                      |
| UT server | e.g. `C:\UnrealTournament` (outside `C:\Program Files`: the bridge writes `Tourney.ini` there)                                                                  |
| Start     | Scheduled tasks **Tourney Website** and **Tourney Bridge** (at system start, as SYSTEM, started again after a crash); control with `deploy\windows\tourney.ps1` |

## 1. Node.js

In an administrator PowerShell:

```powershell
winget install OpenJS.NodeJS.LTS
```

Then open a **new** administrator PowerShell and check `node -v` (22.12 or newer).

## 2. UT99 with the 469f patch

If UT99 is not installed yet: the OldUnreal installer for Windows installs UT99 including the game files and
the 469 patch (see [oldunreal.com](https://www.oldunreal.com/)). Otherwise install the 469f patch from
[github.com/OldUnreal/UnrealTournamentPatches/releases](https://github.com/OldUnreal/UnrealTournamentPatches/releases)
over your installation. Use a folder outside `C:\Program Files`, e.g. `C:\UnrealTournament`. Start
`UnrealTournament.exe` once so that `System\UnrealTournament.ini` exists.

For Monster Hunt copy `MonsterHunt.u`, `MonsterHunt.int` into `System` and the `MH-` maps into `Maps`.

## 3. Install Tourney

Unpack `tourney-<version>.zip` (or `tar -xzf tourney-<version>.tar.gz`), then in an administrator PowerShell
inside the unpacked folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\windows\install.ps1 -UT "C:\UnrealTournament"
```

Options: `-InstallDir C:\Tourney`, `-Port 8080`, `-PublicUrl https://cup.example.com`, `-NoWebsite`,
`-NoBridge`. The script copies the program to `C:\Tourney`, runs `npm ci --omit=dev`, creates the settings
(only if they do not exist), limits access to `C:\Tourney` to administrators (it holds secrets and runs as
SYSTEM), registers the scheduled tasks, starts the website and opens UDP 7777–7779 and the website port in the
Windows firewall.

## 4. Build the mod

```powershell
powershell -ExecutionPolicy Bypass -File C:\Tourney\mod\build.ps1 -UT "C:\UnrealTournament"
```

Builds `UTTourney_v1.u` (and `UTTourneyMH_v1.u` if `MonsterHunt.u` is there) into `C:\UnrealTournament\System`.
If you also play on this PC with the same UT folder, your client uses exactly this build, which is fine.

## 5. Settings

`C:\Tourney\config\website.env` (open with Notepad):

- `PUBLIC_URL` – the address in the browser (preset: `http://<this PC>:8080`).
- Discord login: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, redirect `<PUBLIC_URL>/api/auth/discord/callback`,
  your id in `ADMIN_DISCORD_IDS` – or `DEV_LOGIN=true` for a first test in your own network only.
- Optional notifications: `DISCORD_WEBHOOK_URL`, `DISCORD_BOT_TOKEN`
  ([apps/api/README.md](../apps/api/README.md#discord-notifications-optional)).

Restart the website after changes:

```powershell
powershell -ExecutionPolicy Bypass -File C:\Tourney\deploy\windows\tourney.ps1 restart website
```

## 6. Connect the bridge

1. Website → **Servers → Add a game server** → copy `agentId` and `token` into `C:\Tourney\config\bridge.json`.
2. Check `server.publicAddress` (what players type after `open`: this PC's LAN or internet address, e.g.
   `192.168.0.105:7777`, never `127.0.0.1`) and `server.installDir`. You can connect to your own server with
   that address too.
3. Start it:

   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\Tourney\deploy\windows\tourney.ps1 start bridge
   Get-Content C:\Tourney\logs\bridge.log -Wait
   ```

4. On the website click **Scan**.

Players on Linux whose UT console cannot paste: see the "Linux: start UT with the address" box on the
tournament page.

## HTTPS

For logins from the internet the website needs HTTPS. The simplest way is [Caddy](https://caddyserver.com/)
for Windows with `deploy\Caddyfile` (replace the domain), run as a service or scheduled task, ports 80/443
forwarded to this machine. Then `PUBLIC_URL=https://<your domain>`.

## Operation

`C:\Tourney\deploy\windows\tourney.ps1` controls both parts (administrator PowerShell; Windows blocks
scripts by default, so call it as `powershell -ExecutionPolicy Bypass -File C:\Tourney\deploy\windows\tourney.ps1 <action> [website|bridge|all]`,
shortened to `tourney.ps1` below). The scheduled tasks start both with Windows and start node again if it ends.

| Task    | How                                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status  | `tourney.ps1 status`                                                                                                                                                           |
| Restart | `tourney.ps1 restart website` (or `bridge`, `all`); `stop` / `start` the same way. Stopping the bridge also stops the UT server it started                                     |
| Logs    | `Get-Content C:\Tourney\logs\website.log -Wait` (bridge: `bridge.log`); the files grow, delete them now and then while both are stopped                                        |
| Update  | unpack the new bundle and run `install.ps1` again (config, data and logs are kept)                                                                                             |
| Backup  | `C:\Tourney\config` and `C:\Tourney\data`                                                                                                                                      |
| Remove  | `tourney.ps1 stop`, `Unregister-ScheduledTask 'Tourney Website','Tourney Bridge' -Confirm:$false`, firewall rules "Tourney UT server" / "Tourney website", delete `C:\Tourney` |

## Troubleshooting

- **The website does not start:** `C:\Tourney\logs\website.log`; run it by hand to see errors:
  `cd C:\Tourney\website; node --env-file=..\config\website.env dist\main.js`.
- **The bridge cannot write `Tourney.ini`:** the UT folder must not be under `C:\Program Files`.
- **Players get "package mismatch":** their `System` folder has a different `UTTourney_v1.u` (e.g. an older own
  build); they delete it and download the server's version when connecting.
