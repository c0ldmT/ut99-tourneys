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
5. installs the systemd units from `deploy/linux` and starts the website.

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

## HTTPS

Discord needs an HTTPS address for logins from outside. Caddy gets certificates automatically:

```sh
sudo apt install -y caddy
sudo cp /opt/tourney/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile        # replace cup.example.com with your domain
sudo systemctl reload caddy
```

Ports 80 and 443 must reach the server. Set `PUBLIC_URL=https://<your domain>` and restart the website. Caddy
passes the bridge WebSocket and the live updates through; the website itself can then listen on localhost only
(`HOST=127.0.0.1` in `website.env`).

## Firewall

| Port          | Who                    | Open?                       |
| ------------- | ---------------------- | --------------------------- |
| UDP 7777–7779 | UT players             | yes (game and server query) |
| TCP 443 (+80) | browsers (Caddy)       | yes, with HTTPS             |
| TCP 8080      | browsers without Caddy | only in a LAN               |
| TCP 7790      | mod → bridge           | **no**, localhost only      |

With ufw: `sudo ufw allow 7777:7779/udp && sudo ufw allow 80,443/tcp`.

## Operation

| Task   | Command                                                                                                                                                                                 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status | `systemctl status tourney-website tourney-bridge --no-pager`                                                                                                                            |
| Logs   | `journalctl -u tourney-website -f`, `journalctl -u tourney-bridge -f`, UT: `/opt/ut99/System/Tourney.log`                                                                               |
| Update | unpack the new bundle and run `sudo bash deploy/linux/install.sh` again (settings and data are kept)                                                                                    |
| Backup | `/etc/tourney` and `/var/lib/tourney`; the database alone while running: `sudo apt install sqlite3`, then `sudo sqlite3 /var/lib/tourney/website/tourney.db ".backup /root/tourney.db"` |
| Remove | `sudo systemctl disable --now tourney-bridge tourney-website`, delete `/opt/tourney`, `/etc/tourney`, `/var/lib/tourney`, the units in `/etc/systemd/system` and the user `tourney`     |

## Without the script

The script only automates the steps above. By hand: Node ≥ 22.12; `npm ci --omit=dev` in `website/` and
`bridge/`; `node --env-file=website.env website/dist/main.js` (serves the web app from `website/web`);
`node bridge/dist/cli.js run -c bridge.json`; build the mod with `mod/build.sh /opt/ut99`.
