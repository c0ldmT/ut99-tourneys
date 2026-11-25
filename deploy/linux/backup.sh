#!/usr/bin/env bash
# Backs up Tourney into one archive: database (consistent copy while it runs), settings, bridge data
# (bot logs, event logs) and the server files that came from your PC (tournament mod, SmartStockBots,
# User.ini, Monster Hunt). restore.sh brings it back, also on another machine (moving to a VPS).
#   sudo bash backup.sh [--out /var/backups/tourney] [--keep 14] [--ut /opt/ut99]
#                       [--game-content] [--final]
#   --game-content  also Maps, Textures, Sounds, Music (a few hundred MB; for moving to a new server)
#   --final         stops and disables website and bridge first (moving: nobody plays on the old server
#                   after the backup, also not after a reboot). Back: systemctl enable --now ...
#   --keep N        keeps the newest N backups in --out (default 14, 0 = all)
# Daily backups: the timer tourney-backup.timer (installed by install.sh) runs this script.
set -euo pipefail
# Work files on disk, not in /tmp: that is a small RAM disk on newer systems (Pi 3: ~0.5 GB),
# and the game content alone is several hundred MB.
export TMPDIR="${TMPDIR:-/var/tmp}"

OUT=/var/backups/tourney
KEEP=14
UT_DIR=/opt/ut99
CONTENT=0
FINAL=0
APP_DIR=/opt/tourney
CONF_DIR=/etc/tourney
DATA_DIR=/var/lib/tourney
SVC_USER=tourney

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --keep) KEEP="$2"; shift 2 ;;
    --ut) UT_DIR="$2"; shift 2 ;;
    --game-content) CONTENT=1; shift ;;
    --final) FINAL=1; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"
case "$KEEP" in ''|*[!0-9]*) die "--keep needs a number" ;; esac
[ -d "$DATA_DIR" ] || die "no $DATA_DIR: is Tourney installed here?"
DB="$DATA_DIR/website/tourney.db"
SQLITE="$APP_DIR/website/node_modules/better-sqlite3"

STAMP="$(date +%Y%m%d-%H%M%S)"
# Regular backups are pruned (--keep); final ones and those with game content are kept.
NAME="tourney-backup-$STAMP"
[ "$CONTENT" = 1 ] && NAME="$NAME-full"
[ "$FINAL" = 1 ] && NAME="$NAME-final"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/$NAME"
B="$WORK/$NAME"

if [ "$FINAL" = 1 ]; then
  say "Stopping bridge and website (they stay off, also after a reboot)"
  INSTANCES="$(systemctl list-units --all --plain --no-legend 'tourney-bridge@*.service' 2>/dev/null | awk '{print $1}' || true)"
  for s in tourney-bridge $INSTANCES tourney-website; do
    systemctl disable --now "$s" >/dev/null 2>&1 && echo "stopped and disabled $s"
  done
fi

# --- database: SQLite's online backup (correct while the website writes; WAL included) -----------
# Runs as the service user, so the -wal/-shm files SQLite may create belong to it, not to root.
DB_VERSION=null
if [ -f "$DB" ]; then
  say "Database"
  [ -d "$SQLITE" ] || die "$SQLITE is missing (website not installed?)"
  DBTMP="$(mktemp -d)"
  chown "$SVC_USER" "$DBTMP"
  DB_VERSION="$(runuser -u "$SVC_USER" -- node -e '
    const Database = require(process.argv[1]);
    const src = new Database(process.argv[2], { fileMustExist: true });
    src.backup(process.argv[3]).then(() => {
      src.close();
      const copy = new Database(process.argv[3]);
      copy.pragma("journal_mode = DELETE");
      const ok = copy.pragma("integrity_check", { simple: true });
      if (ok !== "ok") { console.error("integrity check: " + ok); process.exit(1); }
      console.log(copy.pragma("user_version", { simple: true }));
      copy.close();
    }, (e) => { console.error(e.message); process.exit(1); });
  ' "$SQLITE" "$DB" "$DBTMP/tourney.db")" || { rm -rf "$DBTMP"; die "the database copy failed"; }
  mkdir -p "$B/data/website"
  mv "$DBTMP/tourney.db" "$B/data/website/tourney.db"
  rm -rf "$DBTMP"
  echo "tourney.db: $(du -h "$B/data/website/tourney.db" | cut -f1), $DB_VERSION migrations"
else
  echo "no database at $DB (website not on this machine?)"
fi

# --- the rest of the data: website files besides the database, bridge (bot logs, event logs) ---
say "Data and settings"
rsync -a --exclude '/website/tourney.db' --exclude '/website/tourney.db-wal' \
  --exclude '/website/tourney.db-shm' "$DATA_DIR/" "$B/data/"
[ -d "$CONF_DIR" ] && rsync -a "$CONF_DIR/" "$B/etc/"
du -sh "$B/data" "$B/etc" 2>/dev/null | sed 's/^/  /'

# --- files from the PC in the UT server (same on every CPU; the binaries are not taken) ----------
if [ -d "$UT_DIR/System" ]; then
  say "UT server files ($UT_DIR)"
  mkdir -p "$B/ut-import"
  for f in UTTourney_v1.u UTTourneyMH_v1.u SmartStockBots.u SmartStockBots.int SmartStockBots.ini \
           MonsterHunt.u MonsterHunt.int User.ini; do
    if [ -f "$UT_DIR/System/$f" ]; then
      cp -p "$UT_DIR/System/$f" "$B/ut-import/$f"
      echo "  $f"
    fi
  done
  if [ "$CONTENT" = 1 ]; then
    mkdir -p "$B/ut-content"
    for d in Maps Textures Sounds Music; do
      [ -d "$UT_DIR/$d" ] && cp -a "$UT_DIR/$d" "$B/ut-content/$d"
    done
    du -sh "$B/ut-content" | sed 's/^/  game content: /'
  fi
fi

# --- what is inside ------------------------------------------------------------------------------
VERSION="$(cat "$APP_DIR/VERSION" 2>/dev/null || echo '?')"
cat > "$B/backup.json" <<JSON
{
  "created": "$(date -Iseconds)",
  "host": "$(hostname)",
  "arch": "$(uname -m)",
  "version": "$VERSION",
  "dbMigrations": $DB_VERSION,
  "final": $([ "$FINAL" = 1 ] && echo true || echo false),
  "gameContent": $([ "$CONTENT" = 1 ] && echo true || echo false)
}
JSON

say "Archive"
install -d -m 700 "$OUT"
umask 077
tar -czf "$OUT/$NAME.tgz.part" -C "$WORK" "$NAME"
mv "$OUT/$NAME.tgz.part" "$OUT/$NAME.tgz"
echo "$OUT/$NAME.tgz ($(du -h "$OUT/$NAME.tgz" | cut -f1)) - holds secrets (settings): keep it private"

if [ "$KEEP" -gt 0 ]; then
  find "$OUT" -maxdepth 1 -type f -name 'tourney-backup-????????-??????.tgz' -printf '%f\n' | sort -r |
    tail -n +"$((KEEP + 1))" | while read -r old; do
      rm -f "$OUT/$old" && echo "removed old backup $old"
    done
fi

if [ "$FINAL" = 1 ]; then
  cat <<TXT

Website and bridge are stopped and disabled. Copy the archive to the new server and run restore.sh there
(docs/move-server.md). To go on here instead: sudo systemctl enable --now tourney-website tourney-bridge
TXT
fi
