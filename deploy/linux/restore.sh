#!/usr/bin/env bash
# Restores a backup of backup.sh: database, settings, bridge data and the UT server files from the PC.
# Also for moving to another machine (Raspberry Pi -> VPS, see docs/move-server.md): install Tourney
# there first (install.sh), then run this script with the archive.
#   sudo bash restore.sh <tourney-backup-....tgz> [--public-url https://cup.example.com]
#                        [--game-address cup.example.com:7777] [--ut /opt/ut99] [--keep-settings]
#   --public-url     new PUBLIC_URL in website.env (the address in the browser)
#   --game-address   new server.publicAddress in bridge.json (what players type after "open")
#   --keep-settings  keeps this machine's /etc/tourney instead of the backup's (then the bridge needs a
#                    new token from the website: Servers -> rotate token)
# What is replaced is kept next to it (/var/lib/tourney.before-restore-<time>, /etc/tourney.before-...).
set -euo pipefail

ARCHIVE=""
PUBLIC_URL=""
GAME_ADDRESS=""
UT_DIR=/opt/ut99
KEEP_SETTINGS=0
APP_DIR=/opt/tourney
CONF_DIR=/etc/tourney
DATA_DIR=/var/lib/tourney
SVC_USER=tourney

while [ $# -gt 0 ]; do
  case "$1" in
    --public-url) PUBLIC_URL="$2"; shift 2 ;;
    --game-address) GAME_ADDRESS="$2"; shift 2 ;;
    --ut) UT_DIR="$2"; shift 2 ;;
    --keep-settings) KEEP_SETTINGS=1; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) [ -z "$ARCHIVE" ] || { echo "only one archive" >&2; exit 2; }; ARCHIVE="$1"; shift ;;
  esac
done

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"
[ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ] || die "usage: sudo bash restore.sh <tourney-backup-....tgz> (see --help)"
[ -f "$APP_DIR/website/dist/main.js" ] || [ -f "$APP_DIR/bridge/dist/cli.js" ] ||
  die "Tourney is not installed here: run deploy/linux/install.sh from the release bundle first"
id "$SVC_USER" >/dev/null 2>&1 || die "no user $SVC_USER: run install.sh first"

STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

say "Unpacking $(basename "$ARCHIVE")"
tar -xzf "$ARCHIVE" -C "$WORK"
B="$(find "$WORK" -mindepth 2 -maxdepth 2 -name backup.json -printf '%h\n' -quit)"
[ -n "$B" ] || die "$ARCHIVE is not a backup of backup.sh (no backup.json)"
sed 's/^/  /' "$B/backup.json"

# A database of a newer release than the installed one stops the website with a clear message (the
# old data stays next to it): install the same release here as on the old machine.
echo "installed here: Tourney $(cat "$APP_DIR/VERSION" 2>/dev/null || echo '?')"

say "Stopping bridge and website"
for s in tourney-bridge tourney-website; do
  systemctl is-active --quiet "$s" 2>/dev/null && systemctl stop "$s" && echo "stopped $s"
done

# --- data ------------------------------------------------------------------------------------------
say "Data -> $DATA_DIR"
if [ -d "$DATA_DIR" ] && [ -n "$(ls -A "$DATA_DIR" 2>/dev/null)" ]; then
  mv "$DATA_DIR" "$DATA_DIR.before-restore-$STAMP"
  echo "the old data is in $DATA_DIR.before-restore-$STAMP"
fi
install -d -o "$SVC_USER" -g "$SVC_USER" -m 750 "$DATA_DIR"
rsync -a "$B/data/" "$DATA_DIR/"
install -d -o "$SVC_USER" -g "$SVC_USER" -m 750 "$DATA_DIR/website" "$DATA_DIR/bridge"
# The user ids of the old machine mean nothing here.
chown -R "$SVC_USER":"$SVC_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

# --- settings --------------------------------------------------------------------------------------
if [ "$KEEP_SETTINGS" = 0 ] && [ -d "$B/etc" ]; then
  say "Settings -> $CONF_DIR"
  if [ -d "$CONF_DIR" ]; then
    cp -a "$CONF_DIR" "$CONF_DIR.before-restore-$STAMP"
    echo "this machine's settings are in $CONF_DIR.before-restore-$STAMP"
  fi
  install -d -o root -g "$SVC_USER" -m 750 "$CONF_DIR"
  rsync -a "$B/etc/" "$CONF_DIR/"
  chown -R root:"$SVC_USER" "$CONF_DIR"
  chmod 750 "$CONF_DIR"
  chmod 640 "$CONF_DIR"/* 2>/dev/null || true
else
  say "Settings: this machine's $CONF_DIR stays"
fi

ENV="$CONF_DIR/website.env"
if [ -f "$ENV" ]; then
  if [ -n "$PUBLIC_URL" ]; then
    if grep -q '^PUBLIC_URL=' "$ENV"; then
      sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=$PUBLIC_URL|" "$ENV"
    else
      echo "PUBLIC_URL=$PUBLIC_URL" >> "$ENV"
    fi
  fi
  # The paths of this installation (the backup may come from a machine with others).
  sed -i "s|^DATA_DIR=.*|DATA_DIR=$DATA_DIR/website|" "$ENV"
  chown root:"$SVC_USER" "$ENV" && chmod 640 "$ENV"
fi
PORT="$(sed -n 's/^PORT=//p' "$ENV" 2>/dev/null | tail -n1)"

BRIDGE_JSON="$CONF_DIR/bridge.json"
if [ -f "$BRIDGE_JSON" ]; then
  UT_DIR="$UT_DIR" GAME="$GAME_ADDRESS" DATA="$DATA_DIR/bridge" PORT="${PORT:-8080}" node -e '
    const fs = require("fs");
    const f = process.argv[1];
    const c = JSON.parse(fs.readFileSync(f, "utf8"));
    c.dataDir = process.env.DATA;
    c.server = c.server || {};
    c.server.installDir = process.env.UT_DIR;
    if (process.env.GAME) c.server.publicAddress = process.env.GAME;
    // Website and bridge on one machine: the bridge talks to the website locally.
    if (c.website && /^wss?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(c.website.url || ""))
      c.website.url = "ws://127.0.0.1:" + process.env.PORT + "/api/agent";
    fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");
  ' "$BRIDGE_JSON"
  chown root:"$SVC_USER" "$BRIDGE_JSON" && chmod 640 "$BRIDGE_JSON"
fi

# --- UT server -------------------------------------------------------------------------------------
UT_PENDING=0
if [ -d "$B/ut-content" ]; then
  say "Game content -> $UT_DIR"
  mkdir -p "$UT_DIR"
  for d in Maps Textures Sounds Music; do
    [ -d "$B/ut-content/$d" ] && rsync -a "$B/ut-content/$d/" "$UT_DIR/$d/" && echo "  $d"
  done
fi
if [ -d "$B/ut-import" ] && [ -n "$(ls -A "$B/ut-import")" ]; then
  KEEP_IMPORT="/root/tourney-ut-import-$STAMP"
  cp -a "$B/ut-import" "$KEEP_IMPORT"
  if [ -d "$UT_DIR/System" ] && [ -f "$APP_DIR/deploy/linux/install-ut.sh" ]; then
    say "UT server files from the backup (mod, SmartStockBots, bots)"
    bash "$APP_DIR/deploy/linux/install-ut.sh" "" "$UT_DIR" "$KEEP_IMPORT" ||
      echo "Warning: install-ut.sh failed (see above); the files are in $KEEP_IMPORT"
  else
    UT_PENDING=1
  fi
fi
[ -d "$UT_DIR" ] && chown -R "$SVC_USER":"$SVC_USER" "$UT_DIR"

# --- start -----------------------------------------------------------------------------------------
say "Starting"
if [ -f "$ENV" ] && [ -f "$APP_DIR/website/dist/main.js" ]; then
  systemctl enable --now tourney-website >/dev/null 2>&1 || true
  sleep 5
  if systemctl is-active --quiet tourney-website; then
    echo "tourney-website: active"
  else
    journalctl -u tourney-website -n 30 --no-pager || true
    die "the website did not start (log above). The old data is in $DATA_DIR.before-restore-$STAMP"
  fi
fi
if [ -f "$BRIDGE_JSON" ] && [ -d "$UT_DIR/System" ] && ! grep -q 'PASTE-THE-TOKEN' "$BRIDGE_JSON"; then
  systemctl enable --now tourney-bridge >/dev/null 2>&1 || true
  echo "tourney-bridge: $(systemctl is-active tourney-bridge || true)"
else
  echo "tourney-bridge: not started (no UT server in $UT_DIR yet, or no token in $BRIDGE_JSON)"
fi

say "Restored"
URL_NOW="$(sed -n 's/^PUBLIC_URL=//p' "$ENV" 2>/dev/null | tail -n1)"
echo "Website: ${URL_NOW:-?}"
[ -f "$BRIDGE_JSON" ] && echo "Game:    $(node -e 'console.log(require(process.argv[1]).server?.publicAddress ?? "?")' "$BRIDGE_JSON")"
if [ "$UT_PENDING" = 1 ]; then
  cat <<TXT

The UT server is not set up yet. Unpack the 469f patch for this CPU and install the files from the backup:
  sudo bash $APP_DIR/deploy/linux/install-ut.sh <OldUnreal-UTPatch469f-Linux-....tar.bz2> $UT_DIR $KEEP_IMPORT
  sudo systemctl enable --now tourney-bridge
TXT
fi
cat <<TXT

Check: PUBLIC_URL and the Discord redirect <PUBLIC_URL>/api/auth/discord/callback (Discord developer portal),
HTTPS (Caddy), the firewall (UDP 7777-7779), then log in and look at Servers (online, Scan).
TXT
