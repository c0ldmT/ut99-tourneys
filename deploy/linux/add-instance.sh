#!/usr/bin/env bash
# Further game servers on this machine (decisions 282, 284): every instance is a bridge of its own
# that starts its own UT server process from the SAME UT folder as the main server (one copy of
# Maps, Textures, Sounds, Music, System and the mod for all; each server has its own
# Tourney-<n>.ini, TourneyUser-<n>.ini and Tourney-<n>.log). So several tournaments can run at
# the same time. The website gives every instance a server entry (Servers -> Add a game server)
# and puts it into the server pool.
#
#   sudo bash add-instance.sh <n> --agent-id <id> --token <token> [--ut /opt/ut99] [--name "..."]
#       makes instance n (2, 3, ...): /etc/tourney/bridge-<n>.json, service tourney-bridge@<n>.
#       Ports: game 7777 + 10*(n-1) (UDP, +1 and +2 too), mod 7790 + (n-1) (local TCP).
#   sudo bash add-instance.sh --sync        brings older instances (own UT folder /opt/ut99-<n>)
#       onto the shared folder and removes their copies; install.sh and install-ut.sh run it.
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
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) N="$1"; shift ;;
  esac
done

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"

instances() {
  find "$CONF_DIR" -maxdepth 1 -name 'bridge-*.json' -printf '%f\n' 2>/dev/null |
    sed -n 's/^bridge-\([0-9]*\)\.json$/\1/p' | sort -n
}

# Points an instance's settings at the shared UT folder with its own file names.
share() {
  local n="$1" json="$CONF_DIR/bridge-$1.json"
  local old
  old="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).server?.installDir ?? "")' "$json")"
  UT="$UT_DIR" N="$n" node -e '
    const fs = require("fs");
    const f = process.argv[1];
    const c = JSON.parse(fs.readFileSync(f, "utf8"));
    c.server = { ...(c.server || {}), installDir: process.env.UT, instance: process.env.N };
    delete c.server.binary;
    fs.writeFileSync(f, JSON.stringify(c, null, 2) + "\n");
  ' "$json"
  # An own copy of an older version (/opt/ut99-<n>): no longer used.
  if [ -n "$old" ] && [ "$old" != "$UT_DIR" ] && [ "$old" = "$UT_DIR-$n" ] && [ -d "$old/System" ]; then
    rm -rf "$old"
    echo "instance $n: removed its own copy $old (it uses $UT_DIR now)"
    systemctl is-active --quiet "tourney-bridge@$n" 2>/dev/null && systemctl restart "tourney-bridge@$n"
  fi
  return 0
}

if [ "$MODE" = sync ]; then
  for n in $(instances); do
    share "$n"
    echo "instance $n: uses $UT_DIR (Tourney-$n.ini)"
  done
  exit 0
fi

case "$N" in ''|*[!0-9]*) die "the instance number (2, 3, ...) is missing, see --help" ;; esac
[ "$N" -ge 2 ] && [ "$N" -le 9 ] || die "instances are numbered 2 to 9 (1 is the main server)"
JSON="$CONF_DIR/bridge-$N.json"

if [ "$MODE" = remove ]; then
  systemctl disable --now "tourney-bridge@$N" >/dev/null 2>&1 || true
  rm -f "$JSON" "$UT_DIR/System/Tourney-$N.ini" "$UT_DIR/System/TourneyUser-$N.ini"
  [ -d "$UT_DIR-$N/System" ] && rm -rf "$UT_DIR-$N"
  echo "instance $N removed (data kept in $DATA_DIR/bridge-$N). Remove its server on the website."
  exit 0
fi

[ -n "$AGENT_ID" ] && [ -n "$TOKEN" ] ||
  die "--agent-id and --token are needed: website -> Servers -> Add a game server"
[ -f "$CONF_DIR/bridge.json" ] || die "no $CONF_DIR/bridge.json: set up the main server first (install.sh)"
[ -d "$UT_DIR/System" ] || die "no UT server in $UT_DIR (install-ut.sh first)"
[ -f "$JSON" ] && die "$JSON exists already (remove the instance first: --remove $N)"

GAME_PORT=$((7777 + 10 * (N - 1)))
MOD_PORT=$((7790 + N - 1))

say "Settings $JSON"
install -d -o "$SVC_USER" -g "$SVC_USER" -m 750 "$DATA_DIR/bridge-$N"
AGENT_ID="$AGENT_ID" TOKEN="$TOKEN" N="$N" NAME="$NAME" UT="$UT_DIR" GAME="$GAME_PORT" \
  MOD="$MOD_PORT" DATA="$DATA_DIR/bridge-$N" node -e '
    const fs = require("fs");
    const e = process.env;
    const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    c.agentId = e.AGENT_ID;
    c.website = { ...(c.website || {}), token: e.TOKEN };
    c.mod = { ...c.mod, port: Number(e.MOD) };
    c.dataDir = e.DATA;
    const s = (c.server = { ...(c.server || {}) });
    s.installDir = e.UT;
    s.instance = e.N;
    delete s.binary;
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

Instance $N: game port $GAME_PORT (UDP $GAME_PORT-$((GAME_PORT + 2))), mod port $MOD_PORT (local).
It plays from $UT_DIR like the main server: maps, mod updates and bots there count for all servers.
Firewall:   sudo ufw allow $GAME_PORT:$((GAME_PORT + 2))/udp
Website:    Servers shows "$AGENT_ID" online -> Scan; it is in the server pool.
Log:        journalctl -u tourney-bridge@$N -f
TXT
