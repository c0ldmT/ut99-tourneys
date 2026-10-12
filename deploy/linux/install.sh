#!/usr/bin/env bash
# Installs or updates Tourney (website + bridge) on Debian, Ubuntu or Raspberry Pi OS (64-bit).
# Run it from the unpacked release bundle:
#   sudo bash deploy/linux/install.sh [--ut /opt/ut99] [--port 8080] [--public-url URL]
#                                  [--no-website] [--no-bridge]
# Running it again updates the program files; settings (/etc/tourney) and data (/var/lib/tourney)
# are kept (--port/--public-url only apply when website.env is created).
set -euo pipefail

UT_DIR=/opt/ut99
PORT=8080
PUBLIC_URL=""
WITH_WEBSITE=1
WITH_BRIDGE=1
APP_DIR=/opt/tourney
CONF_DIR=/etc/tourney
DATA_DIR=/var/lib/tourney
SVC_USER=tourney

while [ $# -gt 0 ]; do
  case "$1" in
    --ut) UT_DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --public-url) PUBLIC_URL="$2"; shift 2 ;;
    --no-website) WITH_WEBSITE=0; shift ;;
    --no-bridge) WITH_BRIDGE=0; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"
command -v apt-get >/dev/null || die "this script needs a Debian-based system (apt-get)"
BUNDLE="$(cd "$(dirname "$0")/../.." && pwd)"
[ -f "$BUNDLE/website/dist/main.js" ] && [ -f "$BUNDLE/bridge/dist/cli.js" ] ||
  die "run this from an unpacked release bundle (tourney-<version>), see docs/install-linux.md"
VERSION="$(cat "$BUNDLE/VERSION" 2>/dev/null || echo '?')"
ARCH="$(uname -m)"
DEB_ARCH="$(dpkg --print-architecture)"
case "$DEB_ARCH" in
  amd64|arm64) ;;
  *) die "a 64-bit system is needed (dpkg architecture is $DEB_ARCH; on a Raspberry Pi use the 64-bit Raspberry Pi OS)" ;;
esac
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$IP" ] || IP=127.0.0.1
[ -n "$PUBLIC_URL" ] || PUBLIC_URL="http://$IP:$PORT"
echo "Tourney $VERSION on $ARCH ($IP)"

# --- system packages and Node.js ------------------------------------------------------------
say "System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# build-essential/python3: only needed if a native npm module has no prebuilt binary for this CPU.
apt-get install -y -qq ca-certificates curl tar bzip2 rsync build-essential python3 >/dev/null

node_ok() {
  command -v node >/dev/null &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'
}
if ! node_ok; then
  say "Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
  node_ok || die "Node.js >= 22.12 could not be installed"
fi
NODE_BIN="$(command -v node)"
echo "node $(node -v) at $NODE_BIN"

# Little memory (Raspberry Pi 3): npm needs some swap.
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 1500 ] && [ "$SWAP_MB" -lt 900 ]; then
  echo "Warning: ${MEM_MB} MB RAM and ${SWAP_MB} MB swap. If npm is killed, add swap (docs/install-raspberry-pi.md)."
fi

# --- user and folders ------------------------------------------------------------------------
say "User $SVC_USER and folders"
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER"
install -d -o "$SVC_USER" -g "$SVC_USER" -m 750 "$DATA_DIR" "$DATA_DIR/website" "$DATA_DIR/bridge"
install -d -o root -g "$SVC_USER" -m 750 "$CONF_DIR"
install -d -m 755 "$APP_DIR"

# --- program files ---------------------------------------------------------------------------
say "Program files -> $APP_DIR"
for s in tourney-bridge tourney-website; do
  systemctl is-active --quiet "$s" 2>/dev/null && systemctl stop "$s" && echo "stopped $s"
done
for d in website bridge mod deploy docs; do
  rsync -a --delete --chown=root:root --exclude node_modules "$BUNDLE/$d/" "$APP_DIR/$d/"
done
cp "$BUNDLE/VERSION" "$BUNDLE/README.md" "$APP_DIR/"
[ -f "$BUNDLE/LICENSE" ] && cp "$BUNDLE/LICENSE" "$APP_DIR/"

say "npm dependencies (a few minutes on a Raspberry Pi)"
for d in website bridge; do
  [ "$d" = website ] && [ "$WITH_WEBSITE" = 0 ] && continue
  [ "$d" = bridge ] && [ "$WITH_BRIDGE" = 0 ] && continue
  (cd "$APP_DIR/$d" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
done

# --- settings --------------------------------------------------------------------------------
random() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32; }

if [ "$WITH_WEBSITE" = 1 ] && [ ! -f "$CONF_DIR/website.env" ]; then
  say "Settings $CONF_DIR/website.env"
  sed -e "s|^PUBLIC_URL=.*|PUBLIC_URL=$PUBLIC_URL|" \
      -e "s|^PORT=.*|PORT=$PORT|" \
      -e "s|^DATA_DIR=.*|DATA_DIR=$DATA_DIR/website|" \
      "$APP_DIR/website/.env.example" > "$CONF_DIR/website.env"
  chown root:"$SVC_USER" "$CONF_DIR/website.env"
  chmod 640 "$CONF_DIR/website.env"
  echo "created (add your Discord application there, see docs)"
fi

if [ "$WITH_BRIDGE" = 1 ] && [ ! -f "$CONF_DIR/bridge.json" ]; then
  say "Settings $CONF_DIR/bridge.json"
  KEY="$(random)" UT_DIR="$UT_DIR" PUB="$IP:7777" DATA="$DATA_DIR/bridge" WSURL="ws://127.0.0.1:$PORT/api/agent" \
    node -e '
      const fs = require("fs");
      const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      c.mod.sharedKey = process.env.KEY;
      c.dataDir = process.env.DATA;
      c.server.installDir = process.env.UT_DIR;
      c.server.publicAddress = process.env.PUB;
      c.website.url = process.env.WSURL;
      fs.writeFileSync(process.argv[2], JSON.stringify(c, null, 2) + "\n");
    ' "$APP_DIR/bridge/bridge.example.json" "$CONF_DIR/bridge.json"
  chown root:"$SVC_USER" "$CONF_DIR/bridge.json"
  chmod 640 "$CONF_DIR/bridge.json"
  echo "created (agentId and token come from the website, see below)"
fi

# The bridge writes Tourney.ini into the UT System folder and starts the server as $SVC_USER.
if [ "$WITH_BRIDGE" = 1 ] && [ -d "$UT_DIR" ]; then
  chown -R "$SVC_USER":"$SVC_USER" "$UT_DIR"
fi

# --- services --------------------------------------------------------------------------------
say "systemd services"
for s in tourney-website tourney-bridge; do
  sed "s|/usr/bin/node|$NODE_BIN|" "$APP_DIR/deploy/linux/$s.service" > "/etc/systemd/system/$s.service"
done
systemctl daemon-reload
if [ "$WITH_WEBSITE" = 1 ]; then
  systemctl enable --now tourney-website >/dev/null 2>&1
  echo "tourney-website: $(systemctl is-active tourney-website)"
fi
BRIDGE_READY=0
if [ "$WITH_BRIDGE" = 1 ]; then
  if grep -q 'PASTE-THE-TOKEN' "$CONF_DIR/bridge.json"; then
    echo "tourney-bridge: not started yet (no website token in $CONF_DIR/bridge.json)"
  elif [ ! -d "$UT_DIR/System" ]; then
    echo "tourney-bridge: not started yet (no UT installation in $UT_DIR, see deploy/linux/install-ut.sh)"
  else
    systemctl enable --now tourney-bridge >/dev/null 2>&1
    BRIDGE_READY=1
    echo "tourney-bridge: $(systemctl is-active tourney-bridge)"
  fi
fi

say "Done: Tourney $VERSION"
if [ "$WITH_WEBSITE" = 1 ]; then
  # An existing website.env is kept: show what it says, not the options of this run.
  URL_NOW="$(sed -n 's/^PUBLIC_URL=//p' "$CONF_DIR/website.env" | tail -n1)"
  echo "Website:  ${URL_NOW:-$PUBLIC_URL}   (settings: $CONF_DIR/website.env, log: journalctl -u tourney-website -f)"
fi
if [ "$WITH_BRIDGE" = 1 ] && [ "$BRIDGE_READY" = 0 ]; then
  cat <<NEXT
Next steps for the bridge:
  1. UT server:   sudo bash $APP_DIR/deploy/linux/install-ut.sh <OldUnreal 469f Linux patch .tar.bz2> $UT_DIR
  2. Website:     Servers -> Add a game server; put "agentId" and "token" into $CONF_DIR/bridge.json
  3. Start:       sudo systemctl enable --now tourney-bridge   (log: journalctl -u tourney-bridge -f)
NEXT
fi
