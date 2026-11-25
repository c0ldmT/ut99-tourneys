# Backups and moving to another server

Everything Tourney knows lives in three places:

| What                                                                  | Where                                                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Database: players, Neuro, bets, Dream Team, bots, history, replays    | `/var/lib/tourney/website/tourney.db` (SQLite)                             |
| Bridge data: bot logs, event log copies                               | `/var/lib/tourney/bridge`                                                  |
| Settings and secrets: Discord app, the bridge's token, the mod key    | `/etc/tourney/website.env`, `/etc/tourney/bridge.json`                     |
| UT server files from your PC: mod, SmartStockBots, bots, Monster Hunt | `/opt/ut99/System` (`UTTourney_v1.u`, `UTTourneyMH_v1.u`, `User.ini`, ...) |

`deploy/linux/backup.sh` puts all of it into one archive, `deploy/linux/restore.sh` brings it back – on the same
machine or on a new one. Players keep their accounts (Discord login), Neuro, bets, Dream Team, bots and
statistics; their join tokens stay the same.

## Daily backups

`install.sh` installs the timer `tourney-backup.timer`: every night at about 05:17 a backup goes to
`/var/backups/tourney`, the newest 14 are kept. The database is copied with SQLite's online backup, so the
website keeps running.

| Task            | Command                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------- |
| Backup now      | `sudo bash /opt/tourney/deploy/linux/backup.sh`                                                   |
| List            | `sudo ls -lh /var/backups/tourney`                                                                |
| Next run        | `systemctl list-timers tourney-backup.timer`                                                      |
| Copy to your PC | `scp <server>:/var/backups/tourney/tourney-backup-<time>.tgz .` (as root or with `sudo cp` first) |
| Restore         | `sudo bash /opt/tourney/deploy/linux/restore.sh /var/backups/tourney/tourney-backup-<time>.tgz`   |

The archives contain the secrets of `/etc/tourney` (Discord secret, tokens): keep them private. A backup on the
same machine does not help when the machine is lost – copy one to your PC now and then, or use the snapshots of
your hosting provider as well.

## Moving to a new server (e.g. Raspberry Pi → VPS)

Plan a short break without tournaments: from the final backup on, nothing may happen on the old server,
otherwise it is lost. Autostart tournaments wait up to an hour for their server and are called off after that.

### 1. New server: install the same release

Use the **same release bundle** as on the old server (or a newer one; an older program refuses a newer
database). Follow [install-linux.md](install-linux.md) step 1; the UT server (step 2) can come before or after
the restore. On an x86_64 VPS you need the **amd64** OldUnreal patch (the Pi used arm64).

```sh
tar -xzf tourney-<version>.tar.gz && cd tourney-<version>
sudo bash deploy/linux/install.sh --ut /opt/ut99
```

The settings it creates are replaced by the old server's in step 3 – no need to edit them now.

### 2. Old server: final backup

Copy `backup.sh` from the new bundle if the old installation does not have it yet. Then:

```sh
sudo bash backup.sh --final --game-content
```

`--final` stops website and bridge first and disables them (they stay off after a reboot; to go on there
instead: `sudo systemctl enable --now tourney-website tourney-bridge`). `--game-content` also packs `Maps`, `Textures`,
`Sounds` and `Music` (a few hundred MB), so the new server gets exactly the maps the website knows. The archive
is `/var/backups/tourney/tourney-backup-<time>-full-final.tgz`.

### 3. New server: restore

Copy the archive over (e.g. via your PC with `scp`) and run:

```sh
sudo bash /opt/tourney/deploy/linux/restore.sh tourney-backup-<time>-full-final.tgz \
  --public-url https://cup.example.com --game-address cup.example.com:7777
```

It stops the services, moves this machine's data and settings aside (`*.before-restore-<time>`), puts the backup
in place, sets the new `PUBLIC_URL` and the players' game address, installs the mod files, SmartStockBots and
bots from the old server (`install-ut.sh` with the backup's files: clients that downloaded the mod keep the same
package, no "package mismatch") and starts everything. The bridge keeps its id and token, so the website knows it
as the same server; league, series and Dream Team settings that point to it stay valid.

If the UT server was not set up yet, the script prints the `install-ut.sh` command with the patch and the folder
of the old server's files (`/root/tourney-ut-import-<time>`).

### 4. Afterwards

1. DNS: the domain points to the new server (A record, and AAAA if it has IPv6).
2. Discord developer portal → OAuth2 → Redirects: `<new PUBLIC_URL>/api/auth/discord/callback`.
3. HTTPS with Caddy ([install-linux.md](install-linux.md#https)), `HOST=127.0.0.1` in `website.env`.
4. Firewall: UDP 7777–7779 open, TCP 80/443 for Caddy.
5. Log in (everyone logs in once again: the browser cookie belongs to the old address), **Servers** shows the
   server online → **Scan**.
6. Tell the players the new game address; the `open …?tk=` command on the tournament page already shows it.
7. The old server stays off (`--final` disabled its services). Keep its last backup until the new server has
   run for a while.
