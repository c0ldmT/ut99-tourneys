#!/usr/bin/env bash
# The server side of deploy/update.sh (decision 288): runs as root on a server that already runs
# Neuro Arena. Not meant to be called by hand:
#   sudo bash update-remote.sh <folder> <bundle file> <UT folder> <backup 0|1> <force 0|1>
# 1. refuses while tournaments run (unless force), 2. backup (backup.sh of the new bundle),
# 3. install.sh of the new bundle (program, npm packages, services; settings and data stay),
# 4. the mod from <folder>/mod (install-ut.sh: every game server uses it), 5. checks.
set -euo pipefail

DIR="$1"
BUNDLE="$2"
UT_DIR="$3"
BACKUP="$4"
FORCE="$5"
CONF_DIR=/etc/tourney
APP_DIR=/opt/tourney
SVC_USER=tourney
export TMPDIR="${TMPDIR:-/var/tmp}"

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"
[ -f "$APP_DIR/website/dist/main.js" ] && [ -f "$CONF_DIR/website.env" ] ||
  die "no Neuro Arena installed here ($APP_DIR, $CONF_DIR): set it up with deploy/linux/install.sh first"
[ -f "$DIR/$BUNDLE" ] || die "$DIR/$BUNDLE not found"

ENV="$CONF_DIR/website.env"
DATA="$(sed -n 's/^DATA_DIR=//p' "$ENV" | tail -n1)"
PORT="$(sed -n 's/^PORT=//p' "$ENV" | tail -n1)"
DB="${DATA:-/var/lib/tourney/website}/tourney.db"
echo "installed: Neuro Arena $(cat "$APP_DIR/VERSION" 2>/dev/null || echo '?')"

# --- 1. running tournaments --------------------------------------------------------------------
if [ -f "$DB" ]; then
  RUNNING="$(runuser -u "$SVC_USER" -- node -e '
    const D = require(process.argv[1]);
    const db = new D(process.argv[2], { readonly: true, fileMustExist: true });
    const rows = db.prepare("SELECT name FROM tournaments WHERE phase IN (?, ?, ?)").all("checkIn", "running", "paused");
    console.log(rows.map((r) => r.name).join(", "));
  ' "$APP_DIR/website/node_modules/better-sqlite3" "$DB" 2>/dev/null || true)"
  if [ -n "$RUNNING" ]; then
    if [ "$FORCE" = 1 ]; then
      echo "Warning: running now (they break off): $RUNNING"
    else
      die "tournaments run right now: $RUNNING - update later, or FORCE=1 / --force"
    fi
  fi
fi

# --- 2. unpack, backup -------------------------------------------------------------------------
say "Unpacking $BUNDLE"
TOP="$(tar -tzf "$DIR/$BUNDLE" | head -n1 | cut -d/ -f1)"
rm -rf "${DIR:?}/$TOP"
tar -xzf "$DIR/$BUNDLE" -C "$DIR"
NEW="$DIR/$TOP"
echo "new: Neuro Arena $(cat "$NEW/VERSION" 2>/dev/null || echo '?')"

if [ "$BACKUP" = 1 ]; then
  say "Backup before the update"
  bash "$NEW/deploy/linux/backup.sh" --ut "$UT_DIR"
fi

# --- 3. program --------------------------------------------------------------------------------
say "Program (install.sh)"
bash "$NEW/deploy/linux/install.sh" --ut "$UT_DIR"

# --- 4. mod ------------------------------------------------------------------------------------
if ls "$DIR/mod/"*.u >/dev/null 2>&1; then
  say "Mod for every game server (install-ut.sh)"
  [ -d "$UT_DIR/System" ] || die "no UT server in $UT_DIR"
  bash "$APP_DIR/deploy/linux/install-ut.sh" "" "$UT_DIR" "$DIR/mod"
fi

# --- 5. checks ---------------------------------------------------------------------------------
say "Checks"
OK=1
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${PORT:-8080}/api/config" >/dev/null 2>&1; then break; fi
  sleep 1
  [ "$i" = 20 ] && OK=0
done
if [ "$OK" = 1 ]; then
  echo "website: answers on port ${PORT:-8080}"
else
  journalctl -u tourney-website -n 30 --no-pager || true
  die "the website does not answer (log above); the backup is in /var/backups/tourney"
fi
for s in tourney-website tourney-bridge \
  $(systemctl list-units --all --plain --no-legend 'tourney-bridge@*.service' 2>/dev/null | awk '{print $1}' || true); do
  printf '  %-26s %s\n' "$s" "$(systemctl is-active "$s" 2>/dev/null || true)"
done
if ls "$DIR/mod/"*.u >/dev/null 2>&1; then
  MV="$(sed -n 's/^const MOD_VERSION = "\([^"]*\)".*/\1/p' "$APP_DIR/mod/Classes/TourneyCore.uc" | tr -d '\r')"
  grep -aq "\"$MV\"" "$UT_DIR/System/UTTourney_v1.u" && echo "mod: $MV installed"
fi
rm -rf "${DIR:?}/$TOP"
say "Updated to Neuro Arena $(cat "$APP_DIR/VERSION" 2>/dev/null || echo '?')"
echo "Game servers load the mod with their next tournament. On the website: Servers -> Scan after new maps."
