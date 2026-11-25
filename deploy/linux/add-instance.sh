#!/usr/bin/env bash
# Further game servers on this machine (decision 282): every instance is a bridge of its own with a
# UT folder of its own, so several tournaments can run at the same time. The website gives every
# instance a server entry (Servers -> Add a game server) and puts it into the server pool.
#
#   sudo bash add-instance.sh <n> --agent-id <id> --token <token> [--ut /opt/ut99] [--name "..."]
#       makes instance n (2, 3, ...): UT folder /opt/ut99-<n> (System copied, Maps/Textures/...
#       shared with the main folder), /etc/tourney/bridge-<n>.json, service tourney-bridge@<n>.
#       Ports: game 7777 + 10*(n-1) (UDP, +1 and +2 too), mod 7790 + (n-1) (local TCP).
#   sudo bash add-instance.sh --sync        copies the main UT folder's System files (mod update,
#       new maps, SmartStockBots, bots) into every instance; install-ut.sh runs it by itself.
#   sudo bash add-instance.sh --remove <n>  stops and removes instance n (its data stays in
#       /var/lib/tourney/bridge-<n>; remove the server on the website as well).
set -euo pipefail

UT_DIR=/opt/ut99
CONF_DIR=/etc/tourney
DATA_DIR=/var/lib/tourney
SVC_USER=tourney
MODE=add
N=""
AGENT_ID=""
TOKEN=""
NAME=""

while [ $# -gt 0 ]; do
  case "$1" in
    --sync) MODE=sync; shift ;;
    --remove) MODE=remove; N="${2:-}"; shift 2 || shift ;;
    --agent-id) AGENT_ID="$2"; shift 2 ;;
    --token) TOKEN="$2"; shift 2 ;;
    --ut) UT_DIR="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) N="$1"; shift ;;
  esac
done

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"

# The installDir of an instance's settings.
install_dir_of() {
  node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).server.installDir)' "$1"
}

# An instance's UT folder: its own System (Tourney.ini, logs and caches are per server), the rest
# of the main folder linked (maps, textures, sounds, music, ...).
sync_instance() {
  local dir="$1"
  [ -d "$UT_DIR/System" ] || die "no UT server in $UT_DIR (install-ut.sh first)"
  mkdir -p "$dir"
  for entry in "$UT_DIR"/*; do
    local base
    base="$(basename "$entry")"
    # Own System and Cache (Tourney.ini, logs, caches); the rest is shared.
    [ "$base" = System ] || [ "$base" = Cache ] && continue
    [ -e "$dir/$base" ] && [ ! -L "$dir/$base" ] && continue
    ln -sfn "$entry" "$dir/$base"
  done
  mkdir -p "$dir/Cache"
  rsync -a --delete --exclude 'Tourney.ini' --exclude 'TourneyUser.ini' --exclude '*.log' \
    --exclude '*.tmp' "$UT_DIR/System/" "$dir/System/"
  chown -R "$SVC_USER":"$SVC_USER" "$dir"
  chown -h "$SVC_USER":"$SVC_USER" "$dir"/* 2>/dev/null || true
}

instances() {
  find "$CONF_DIR" -maxdepth 1 -name 'bridge-*.json' -printf '%f\n' 2>/dev/null |
    sed -n 's/^bridge-\([0-9]*\)\.json$/\1/p' | sort -n
}

if [ "$MODE" = sync ]; then
  for n in $(instances); do
    dir="$(install_dir_of "$CONF_DIR/bridge-$n.json")"
    sync_instance "$dir"
    echo "instance $n: $dir up to date"
  done
  exit 0
fi

case "$N" in ''|*[!0-9]*) die "the instance number (2, 3, ...) is missing, see --help" ;; esac
[ "$N" -ge 2 ] && [ "$N" -le 9 ] || die "instances are numbered 2 to 9 (1 is the main server)"
INST_DIR="${UT_DIR}-$N"
JSON="$CONF_DIR/bridge-$N.json"

if [ "$MODE" = remove ]; then
  systemctl disable --now "tourney-bridge@$N" >/dev/null 2>&1 || true
  rm -f "$JSON"
  [ -d "$INST_DIR" ] && rm -rf "$INST_DIR"
  echo "instance $N removed (data kept in $DATA_DIR/bridge-$N). Remove its server on the website."
  exit 0
fi

[ -n "$AGENT_ID" ] && [ -n "$TOKEN" ] ||
  die "--agent-id and --token are needed: website -> Servers -> Add a game server"
[ -f "$CONF_DIR/bridge.json" ] || die "no $CONF_DIR/bridge.json: set up the main server first (install.sh)"
[ -f "$JSON" ] && die "$JSON exists already (remove the instance first: --remove $N)"
command -v rsync >/dev/null || die "rsync is missing (apt install rsync)"

GAME_PORT=$((7777 + 10 * (N - 1)))
MOD_PORT=$((7790 + N - 1))

say "UT folder $INST_DIR"
sync_instance "$INST_DIR"

say "Settings $JSON"
install -d -o "$SVC_USER" -g "$SVC_USER" -m 750 "$DATA_DIR/bridge-$N"
AGENT_ID="$AGENT_ID" TOKEN="$TOKEN" N="$N" NAME="$NAME" INST="$INST_DIR" GAME="$GAME_PORT" \
  MOD="$MOD_PORT" DATA="$DATA_DIR/bridge-$N" node -e '
    const fs = require("fs");
    const e = process.env;
    const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    c.agentId = e.AGENT_ID;
    c.website = { ...(c.website || {}), token: e.TOKEN };
    c.mod = { ...c.mod, port: Number(e.MOD) };
    c.dataDir = e.DATA;
    const s = (c.server = { ...(c.server || {}) });
    s.installDir = e.INST;
    s.port = Number(e.GAME);
    const host = String(s.publicAddress || "").replace(/:\d+$/, "");
    if (host) s.publicAddress = host + ":" + e.GAME;
    s.serverName = (e.NAME || (s.serverName || "UT99 Tournament") + " #" + e.N).slice(0, 64);
    fs.writeFileSync(process.argv[2], JSON.stringify(c, null, 2) + "\n");
  ' "$CONF_DIR/bridge.json" "$JSON"
chown root:"$SVC_USER" "$JSON"
chmod 640 "$JSON"

say "Service tourney-bridge@$N"
[ -f /etc/systemd/system/tourney-bridge@.service ] ||
  die "no tourney-bridge@.service: run install.sh of this release first"
systemctl daemon-reload
systemctl enable --now "tourney-bridge@$N" >/dev/null 2>&1
echo "tourney-bridge@$N: $(systemctl is-active "tourney-bridge@$N" || true)"

cat <<TXT

Instance $N: game port $GAME_PORT (UDP $GAME_PORT-$((GAME_PORT + 2))), mod port $MOD_PORT (local), UT folder $INST_DIR.
Firewall:   sudo ufw allow $GAME_PORT:$((GAME_PORT + 2))/udp
Website:    Servers shows "$AGENT_ID" online -> Scan; it is in the server pool.
Log:        journalctl -u tourney-bridge@$N -f
TXT
