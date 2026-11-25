# Installation on a Linux server

For a typical Linux server or VPS with **Debian 12/13 or Ubuntu 22.04/24.04** (x86_64 or ARM64). On a
Raspberry Pi follow [install-raspberry-pi.md](install-raspberry-pi.md), which has a few Pi-specific steps; the
scripts are the same. Windows: [install-windows.md](install-windows.md).

## Layout

| Part      | Path                                                                                                 | Service           |
| --------- | ---------------------------------------------------------------------------------------------------- | ----------------- |
| Program   | `/opt/tourney/{website,bridge,mod,...}`                                                              |                   |
| Settings  | `/etc/tourney/website.env`, `/etc/tourney/bridge.json`                                               |                   |
| Data      | `/var/lib/tourney/website` (SQLite database), `/var/lib/tourney/bridge` (event log copies)           |                   |
| UT server | `/opt/ut99` (owned by the user `tourney`)                                                            |                   |
| Website   | `node /opt/tourney/website/dist/main.js`                                                             | `tourney-website` |
| Bridge    | `node /opt/tourney/bridge/dist/cli.js run -c /etc/tourney/bridge.json` (starts the UT server itself) | `tourney-bridge`  |

Website and bridge can run on one machine (the usual case) or on two: the bridge connects outbound to the
website, so only the website needs to be reachable from the bridge.

## What you need

- the release bundle `tourney-<version>.tar.gz` (GitHub release, or `pnpm release` in a checkout),
- the OldUnreal 469f patch for Linux from
  [github.com/OldUnreal/UnrealTournamentPatches/releases](https://github.com/OldUnreal/UnrealTournamentPatches/releases)
  (`Linux` + `amd64` for x86_64 servers, `arm64` for ARM servers),
- the UT99 game content (`Maps`, `Textures`, `Sounds`, `Music`) from your own UT99 installation, and for Monster
  Hunt `MonsterHunt.u`, `MonsterHunt.int` and its maps,
- a domain pointing to the server if the website should be reachable from the internet (HTTPS, Discord login).

Moving an existing installation (e.g. from a Raspberry Pi) with all players and data: install as below, then
follow [move-server.md](move-server.md).

## 0. A fresh VPS

Size: 4 vCores and 8 GB RAM (e.g. netcup VPS Lite 2) run the website and the UT server with lots of
room; 2 vCores and 2 GB are enough for one game server. A UT server uses one core while a tournament runs. Pick
**Debian 13** (or 12, Ubuntu 24.04) as image, with IPv4. As root, once:

```sh
apt update && apt full-upgrade -y
apt install -y sudo ufw unattended-upgrades
timedatectl set-timezone Europe/Berlin       # logs and the nightly backup in local time
adduser <name> && usermod -aG sudo <name>    # your own user, then on your PC: ssh-copy-id <name>@<server-ip>
ufw allow OpenSSH                            # FIRST, or the next line locks you out
ufw allow 7777:7779/udp && ufw allow 80,443/tcp && ufw enable
dpkg-reconfigure -f noninteractive unattended-upgrades   # security updates by themselves
```

When the key login works: in `/etc/ssh/sshd_config` set `PasswordAuthentication no` and `PermitRootLogin no`,
then `systemctl restart ssh`. Everything below runs as that user with `sudo`.

## 1. Install Tourney

```sh
tar -xzf tourney-0.9.0.tar.gz
cd tourney-0.9.0
sudo bash deploy/linux/install.sh --ut /opt/ut99 --public-url https://cup.example.com
```

Options (`--port` and `--public-url` only apply when the settings are created the first time): `--port 8080` (website port), `--no-bridge` (website only), `--no-website` (bridge only, on the game
server). The script:

1. installs `curl`, `rsync`, build tools (only used if a native npm module has no prebuilt binary) and
   Node.js 22 from NodeSource if Node ≥ 22.12 is missing,
2. creates the system user `tourney` and the folders above,
3. copies the program to `/opt/tourney` and runs `npm ci --omit=dev`,
4. creates `/etc/tourney/website.env` and `/etc/tourney/bridge.json` (only if they do not exist; random shared
   key for the mod),
5. installs the systemd units from `deploy/linux`, starts the website and the nightly backup
   (`tourney-backup.timer`, see [move-server.md](move-server.md)).

## 2. Install the UT server

Copy the game content to the server (e.g. with `scp -r Maps Textures Sounds Music user@server:/tmp/ut/`), then:

```sh
sudo mkdir -p /opt/ut99 && sudo cp -r /tmp/ut/* /opt/ut99/
sudo bash /opt/tourney/deploy/linux/install-ut.sh ~/OldUnreal-UTPatch469f-Linux-amd64.tar.bz2 /opt/ut99
```

It unpacks the patch, creates `UnrealTournament.ini`, builds the tournament mod (`mod/build.sh` with `ucc`) and
hands the folder to the user `tourney`. Run it again (`sudo bash /opt/tourney/deploy/linux/install-ut.sh "" /opt/ut99`) after adding maps or Monster
Hunt. If the mod build fails or hangs (stopped after 15 minutes), build `UTTourney_v1.u`/`UTTourneyMH_v1.u` on another
PC from the same version and install them with a third argument, the folder that holds them:
`sudo bash /opt/tourney/deploy/linux/install-ut.sh "" /opt/ut99 ~/ut-import`. The same folder can hold
SmartStockBots and a `User.ini` with your bots: see [server-extras.md](server-extras.md) (also tick rate and client
rate). Network settings for players: [client-settings.md](client-settings.md).

## 3. Settings

`/etc/tourney/website.env` (all keys are explained in the file and in [apps/api/README.md](../apps/api/README.md)):

- `PUBLIC_URL` – the address in the browser, e.g. `https://cup.example.com`.
- Discord login: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, redirect `<PUBLIC_URL>/api/auth/discord/callback`,
  your id in `ADMIN_DISCORD_IDS`. Optional: `DISCORD_GUILD_ID`.
- Optional notifications: `DISCORD_WEBHOOK_URL`, `DISCORD_BOT_TOKEN`.
- Never `DEV_LOGIN=true` on a server that is reachable from the internet.

`sudo systemctl restart tourney-website` after changes.

## 4. Connect the bridge

1. Website: **Servers → Add a game server** → copy `agentId` and `token` into `/etc/tourney/bridge.json`.
2. In the same file: `server.publicAddress` (e.g. `cup.example.com:7777`; never `127.0.0.1`, other PCs cannot reach it), `server.serverName`; if the website
   runs on another machine, `website.url` = `wss://cup.example.com/api/agent`.
3. Optional for faster downloads: `server.maxClientRate`, `server.downloadRedirect` (see
   [apps/bridge/README.md](../apps/bridge/README.md#server-section-bridgejson)).
4. `sudo systemctl enable --now tourney-bridge`, then **Scan** on the website.

## 5. More game servers (optional)

With more than one game server several tournaments run at the same time: league games of an evening side by
side, a cup next to a bot series. Every further server is a bridge of its own that starts a second UT server
process from the **same** UT folder `/opt/ut99`: maps, textures, sounds, music, the mod and the bots exist once and
count for all servers; each server only has its own `Tourney-<n>.ini`, `TourneyUser-<n>.ini` and
`Tourney-<n>.log` in `System`. A UT server uses one core while it plays, so 4 vCores carry the website and about
three servers.

1. Website: **Servers → Add a game server**, e.g. id `vps-2` → copy the token.
2. On the server (instance 2, game port 7787, mod port 7791):

   ```sh
   sudo bash /opt/tourney/deploy/linux/add-instance.sh 2 --agent-id vps-2 --token <token>
   sudo ufw allow 7787:7789/udp
   ```

3. Website: the server is online → **Scan**. It is in the **server pool** (switch on the Servers page).

Ports of instance n: game `7777 + 10·(n−1)` (UDP, three ports), mod `7790 + n − 1` (local). Tournaments,
series and the league take a free server of the pool when they start ("Server: automatic" in the tournament
form, on by default); nobody can sign up for two tournaments that overlap in time, and a tournament waits while
one of its players still plays elsewhere. New maps, mod updates and bots go into `/opt/ut99` once
and count for every server; `install.sh` restarts them with an update (and moves servers made with an older
version, which had a copy in `/opt/ut99-<n>`, onto the shared folder). Remove one with
`sudo bash /opt/tourney/deploy/linux/add-instance.sh --remove 2` (and the server on the website). Logs:
`journalctl -u tourney-bridge@2 -f`; the analysis export takes `--bot-logs` once per bridge
(`/var/lib/tourney/bridge-2/bot-logs`).

## HTTPS

Discord needs an HTTPS address for logins from outside. Caddy gets certificates automatically:

```sh
sudo apt install -y caddy
sudo cp /opt/tourney/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # replace cup.example.com with your domain
sudo systemctl reload caddy
```

Ports 80 and 443 must reach the server and the domain must already point to it (Caddy asks Let's Encrypt for the
certificate on the first request). Set `PUBLIC_URL=https://<your domain>` and restart the website. Caddy passes
the bridge WebSocket and the live updates through; the website itself should then listen on localhost only
(`HOST=127.0.0.1` in `website.env`), so port 8080 is not reachable from outside without HTTPS. Add the redirect
`https://<your domain>/api/auth/discord/callback` in the Discord developer portal.

## Firewall

| Port          | Who                          | Open?                       |
| ------------- | ---------------------------- | --------------------------- |
| UDP 7777–7779 | UT players                   | yes (game and server query) |
| UDP 7787–7789 | game server 2 (3: 7797–7799) | yes, per extra game server  |
| TCP 443 (+80) | browsers (Caddy)             | yes, with HTTPS             |
| TCP 8080      | browsers without Caddy       | only in a LAN               |
| TCP 7790(+n)  | mod → bridge                 | **no**, localhost only      |

With ufw: `sudo ufw allow 7777:7779/udp && sudo ufw allow 80,443/tcp`.

## Operation

| Task   | Command                                                                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status | `systemctl status tourney-website tourney-bridge --no-pager`                                                                                                                                             |
| Logs   | `journalctl -u tourney-website -f`, `journalctl -u tourney-bridge -f`, UT: `/opt/ut99/System/Tourney.log`                                                                                                |
| Update | from your PC: `bash deploy/update.sh` ([below](#updates-from-your-pc)); on the server: unpack the new bundle and run `sudo bash deploy/linux/install.sh` again (settings and data are kept)              |
| Backup | nightly to `/var/backups/tourney` (timer `tourney-backup.timer`, 14 kept); now: `sudo bash /opt/tourney/deploy/linux/backup.sh`; restore and moving: [move-server.md](move-server.md)                    |
| Remove | `sudo systemctl disable --now tourney-bridge tourney-website tourney-backup.timer`, delete `/opt/tourney`, `/etc/tourney`, `/var/lib/tourney`, the units in `/etc/systemd/system` and the user `tourney` |

## Updates from your PC

`deploy/update.sh` updates a running installation from your PC (Linux, WSL or macOS with ssh): it copies the
release bundle (and the mod if you give it), refuses while tournaments run, makes a backup, runs `install.sh`
of the new bundle (settings and data stay), installs the mod for every game server and checks that the website
answers.

```sh
pnpm release
cp deploy/update.env.example deploy/update.env     # once: TARGET (ssh host), MOD_DIR, ...
bash deploy/update.sh                              # website and bridges
bash deploy/update.sh --mod-dir /mnt/c/UnrealTournament/System   # also the mod (built on the PC)
```

Options: `--target`, `--bundle`, `--mod-dir`, `--ut`, `--no-backup`, `--force` (update while tournaments run),
`--dry-run`, `--env FILE`; see `bash deploy/update.sh --help`. The mod must come from the same checkout as the
bundle (its version is checked). `sudo` asks for your password on the server once.

## Without the script

The script only automates the steps above. By hand: Node ≥ 22.12; `npm ci --omit=dev` in `website/` and
`bridge/`; `node --env-file=website.env website/dist/main.js` (serves the web app from `website/web`);
`node bridge/dist/cli.js run -c bridge.json`; build the mod with `mod/build.sh /opt/ut99`.
