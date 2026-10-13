# Installation on a Raspberry Pi

Everything on one Raspberry Pi: website, bridge and UT99 server. Written for a **Raspberry Pi 3 Model B+ with
64-bit Raspberry Pi OS** (`uname -m` shows `aarch64`); a Pi 4 or 5 works the same and has more headroom.
Other Linux servers: [install-linux.md](install-linux.md), Windows: [install-windows.md](install-windows.md).

## What you need

| What                                      | Where from                                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Release bundle `tourney-<version>.tar.gz` | GitHub release of this project, or built yourself with `pnpm release` (folder `release/`)                                                                                                                                |
| OldUnreal 469f patch for Linux ARM64      | [github.com/OldUnreal/UnrealTournamentPatches/releases](https://github.com/OldUnreal/UnrealTournamentPatches/releases): the asset whose name contains `Linux` and `arm64` (a `.tar.bz2`)                                 |
| UT99 game content                         | Your own UT99 installation (e.g. `C:\UnrealTournament` on your Windows PC): the folders `Maps`, `Textures`, `Sounds`, `Music`. For Monster Hunt also `System\MonsterHunt.u`, `System\MonsterHunt.int` and the `MH-` maps |
| SSH access to the Pi                      | `ssh pi@<pi-address>` (user name as set when the image was written)                                                                                                                                                      |

The Pi 3 B+ has 1 GB of RAM. That is enough for website + bridge + a UT server with bots, but not for a desktop
on top: use Raspberry Pi OS **Lite** or switch the desktop off (`sudo raspi-config` → System → Boot → Console).

In the commands below, replace `<pi-address>` with the address of your Pi (`hostname -I` on the Pi) and `pi`
with your user name. Lines starting with `PS>` run in PowerShell on your Windows PC, all others on the Pi.

## 1. Update the Pi

```sh
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```

## 2. Enough swap (Pi 3)

`npm` needs more than 1 GB while it installs. Check the swap:

```sh
free -h
```

If the `Swap` line shows less than about 1 GB and the file `/etc/dphys-swapfile` exists, raise it to 1 GB:

```sh
sudo dphys-swapfile swapoff
sudo sed -i 's/^#\?CONF_SWAPSIZE=.*/CONF_SWAPSIZE=1024/' /etc/dphys-swapfile
sudo dphys-swapfile setup && sudo dphys-swapfile swapon
free -h
```

(Newer images that manage swap differently usually have enough already; then skip this step.)

## 3. Copy the files to the Pi

From your Windows PC (Windows 10/11 have `scp` built in). The game content is a few hundred MB:

```powershell
PS> scp tourney-0.9.0.tar.gz OldUnreal-UTPatch469f-Linux-arm64.tar.bz2 pi@<pi-address>:~
PS> ssh pi@<pi-address> "mkdir -p ~/ut/System"
PS> cd C:\UnrealTournament
PS> scp -r Maps Textures Sounds Music pi@<pi-address>:~/ut/
PS> scp System\MonsterHunt.u System\MonsterHunt.int pi@<pi-address>:~/ut/System/   # only for Monster Hunt
```

Use the actual file names of what you downloaded. Do **not** copy your Windows `System` folder (only the two
Monster Hunt files): the Linux patch brings its own.

## 4. Install Tourney (website + bridge)

```sh
cd ~
tar -xzf tourney-0.9.0.tar.gz
cd tourney-0.9.0
sudo bash deploy/linux/install.sh --ut /opt/ut99
```

The script installs Node.js 22, creates the system user `tourney`, copies the program to `/opt/tourney`,
installs the npm packages (takes a few minutes on a Pi 3), creates the settings in `/etc/tourney` and starts
the website as the service `tourney-website`. The bridge waits until the UT server and its token are there.

## 5. Install the UT server

```sh
sudo mkdir -p /opt/ut99
sudo cp -r ~/ut/* /opt/ut99/
sudo bash /opt/tourney/deploy/linux/install-ut.sh ~/OldUnreal-UTPatch469f-Linux-arm64.tar.bz2 /opt/ut99
```

The script unpacks the patch, checks the content folders, creates `UnrealTournament.ini`, and builds the
tournament mod with `ucc` (`UTTourney_v1.u`, plus `UTTourneyMH_v1.u` if Monster Hunt is there). It ends with a
command for a quick test of the server alone. If that test stops with `Illegal instruction`, the patch build
does not run on this CPU (Pi 3 = Cortex-A53).

**If the mod build hangs** (`ucc` stays at `Analyzing...` with one core at 100 %, seen on a Pi): the script stops
it after 15 minutes. The packages are the same on every platform, so build them on your PC instead
(`mod/build.ps1` on Windows, `build.sh` on Linux, from the **same** version as this bundle), copy
`UTTourney_v1.u` and `UTTourneyMH_v1.u` to the Pi (e.g. with `scp` into your home folder) and install them:

```sh
sudo bash /opt/tourney/deploy/linux/install-ut.sh "" /opt/ut99 ~/
```

Your own UT client then has exactly the server's files (no "package mismatch").

More maps or Monster Hunt later: copy them into `/opt/ut99/Maps` (and `System`), then run
`sudo bash /opt/tourney/deploy/linux/install-ut.sh "" /opt/ut99` again (rebuilds the mod; with the PC-built files:
`... /opt/ut99 ~/`) and rescan the server on the website. A new mod version (update) is installed the same way.

## 6. Website settings

```sh
sudo nano /etc/tourney/website.env
```

- `PUBLIC_URL`: the address you open in the browser, preset to `http://<pi-address>:8080`.
- **Login** – one of:
  - **Discord** (normal case): create an application at https://discord.com/developers/applications, add the
    redirect `<PUBLIC_URL>/api/auth/discord/callback` under OAuth2, enter `DISCORD_CLIENT_ID`,
    `DISCORD_CLIENT_SECRET` and your Discord user id in `ADMIN_DISCORD_IDS`. If Discord refuses the `http://`
    address, use HTTPS (see [install-linux.md](install-linux.md#https)) or DEV_LOGIN for a first test.
  - **DEV_LOGIN=true**: login by name, only for a first test in your home network, never reachable from the
    internet. The first login with "admin" ticked becomes admin.
- Optional: Discord notifications (`DISCORD_WEBHOOK_URL`, `DISCORD_BOT_TOKEN`), see
  [apps/api/README.md](../apps/api/README.md#discord-notifications-optional).

Apply and check:

```sh
sudo systemctl restart tourney-website
systemctl status tourney-website --no-pager
```

Open `http://<pi-address>:8080` and log in.

## 7. Connect the bridge

1. On the website: **Servers → Add a game server**. It shows `agentId` and `token` once.
2. Put both into the bridge settings and check `publicAddress` (what players type after `open`; the Pi's LAN or
   internet address, never `127.0.0.1` – other PCs cannot reach that):

   ```sh
   sudo nano /etc/tourney/bridge.json
   ```

3. Start the bridge:

   ```sh
   sudo systemctl enable --now tourney-bridge
   journalctl -u tourney-bridge -f        # Ctrl+C to leave the log
   ```

The website now shows the server as online. Click **Scan** there, so maps and bots appear in the tournament form.

## 8. Players

- Players connect with the command from the tournament page (`open <pi-address>:7777?tk=...`). Missing files
  (the map, Monster Hunt, the tournament mod) are downloaded automatically when they connect.
- **If you compiled the mod on your own PC before:** delete `UTTourney_v1.u` from the `System` folder of your
  UT client. Otherwise your client has a different build than the server and UT refuses to connect
  ("package mismatch"); without the file it downloads the server's version.
- **Linux players whose UT console cannot paste** (native client): the tournament page has a "Linux: start UT
  with the address" box with a ready terminal command (`cd <folder with ut-bin> && ./ut-bin '<address>?tk=...'`).
  Join tokens are short (10 lower-case characters) so they can also be typed; older long tokens are replaced
  with "New token" in the profile.
- Playing over the internet: forward **UDP 7777–7779** on your router to the Pi. For the website from outside
  you need HTTPS (see [install-linux.md](install-linux.md#https)).

## Operation

| Task        | Command                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| Status      | `systemctl status tourney-website tourney-bridge --no-pager`                                              |
| Logs        | `journalctl -u tourney-website -f`, `journalctl -u tourney-bridge -f`, UT: `/opt/ut99/System/Tourney.log` |
| Restart     | `sudo systemctl restart tourney-website` (or `tourney-bridge`)                                            |
| Update      | unpack the new bundle, `sudo bash deploy/linux/install.sh --ut /opt/ut99` (settings and data are kept)    |
| Backup      | `/etc/tourney` (settings) and `/var/lib/tourney` (database, bridge logs)                                  |
| Free memory | `free -h`; the UT server only runs while a tournament runs                                                |

## Troubleshooting

- **npm is "Killed" during the installation:** too little memory, see step 2, then run `install.sh` again.
- **`npm ci` compiles better-sqlite3 for a long time:** no prebuilt binary for this Node version/CPU; it
  builds from source (10+ minutes on a Pi 3). Let it finish.
- **Website not reachable:** `systemctl status tourney-website`; port in `/etc/tourney/website.env`; on the Pi
  itself `curl -s localhost:8080/api/config`.
- **Bridge offline on the website:** `journalctl -u tourney-bridge -n 50`; `agentId`/`token` must match the
  website; `website.url` is `ws://127.0.0.1:8080/api/agent` when both run on the Pi.
- **Tournament does not start / "map not installed":** the map pool must match `/opt/ut99/Maps` (rescan on the
  website). Monster Hunt needs `MonsterHunt.u` and `UTTourneyMH_v1.u` in `/opt/ut99/System`.
- **The server does not start:** `/opt/ut99/System/Tourney.log`; run the quick test from the end of
  `install-ut.sh`.
- **Mod build hangs or fails:** see step 5 (build on the PC, install with the third argument). Check the version:
  `journalctl -u tourney-bridge | grep "mod connected"` shows `mod 0.x.y`, which must match
  `grep MOD_VERSION /opt/tourney/mod/Classes/TourneyCore.uc`.
