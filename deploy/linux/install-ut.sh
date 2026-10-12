#!/usr/bin/env bash
# Sets up a UT99 469f dedicated server for Tourney on Linux (x86_64 or ARM64/Raspberry Pi).
#   sudo bash install-ut.sh <OldUnreal-UTPatch469f-Linux-....tar.bz2> [UT folder, default /opt/ut99]
#
# 1. unpacks the OldUnreal 469f patch for Linux (binaries + updated System files),
# 2. checks the game content (Maps, Textures, Sounds, Music) you copy from your own UT copy,
# 3. creates UnrealTournament.ini / User.ini from the defaults,
# 4. builds the tournament mod with ucc (mod/build.sh), also the Monster Hunt package if MonsterHunt.u is there.
# Run it again after copying more content (maps, Monster Hunt) or to rebuild the mod.
set -euo pipefail

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"
command -v bzip2 >/dev/null || { apt-get install -y -qq bzip2 >/dev/null 2>&1 || die "bzip2 is missing (apt install bzip2)"; }
PATCH="${1:-}"
UT_DIR="${2:-/opt/ut99}"
SVC_USER=tourney
HERE="$(cd "$(dirname "$0")" && pwd)"
MOD_DIR="$(cd "$HERE/../.." && pwd)/mod"

mkdir -p "$UT_DIR"

# --- 1. patch ----------------------------------------------------------------------------------
if [ -n "$PATCH" ]; then
  [ -f "$PATCH" ] || die "$PATCH not found"
  say "Unpacking $PATCH -> $UT_DIR"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  tar -xf "$PATCH" -C "$TMP"
  # The archive may or may not have a top folder: find the folder that contains System/.
  SRC="$(find "$TMP" -maxdepth 3 -type d -name System -printf '%h\n' -quit)"
  [ -n "$SRC" ] || die "no System folder in $PATCH (is it the Linux patch?)"
  cp -a "$SRC/." "$UT_DIR/"
fi
[ -d "$UT_DIR/System" ] || die "no $UT_DIR/System: pass the OldUnreal 469f Linux patch archive as first argument"

# --- server binary for this CPU -----------------------------------------------------------------
case "$(uname -m)" in
  aarch64|arm64) CANDIDATES="System/ucc-bin-arm64 SystemARM64/ucc-bin System/ucc-bin" ;;
  x86_64|amd64) CANDIDATES="System/ucc-bin-amd64 System64/ucc-bin System/ucc-bin" ;;
  *) CANDIDATES="System/ucc-bin-x86 System/ucc-bin" ;;
esac
UCC=""
for c in $CANDIDATES; do
  if [ -f "$UT_DIR/$c" ]; then UCC="$UT_DIR/$c"; break; fi
done
[ -n "$UCC" ] || die "no server binary for $(uname -m) in $UT_DIR (looked for: $CANDIDATES). Wrong patch archive?"
chmod +x "$UCC" "$UT_DIR"/System/*-bin* 2>/dev/null || true
echo "server binary: $UCC"

# --- 2. game content ---------------------------------------------------------------------------
say "Game content"
MISSING=""
for d in Maps Textures Sounds Music; do
  n=$({ find "$UT_DIR/$d" -maxdepth 1 -type f 2>/dev/null || true; } | wc -l)
  printf '  %-9s %5s files\n' "$d" "$n"
  [ "$n" -gt 0 ] || MISSING="$MISSING $d"
done
if [ -n "$MISSING" ]; then
  cat <<TXT

Missing:$MISSING
Copy these folders from your own UT99 installation (e.g. C:\\UnrealTournament on Windows) into $UT_DIR,
for example from the Windows PC:
  scp -r Maps Textures Sounds Music <user>@<this-machine>:/tmp/ut/
and here:
  sudo cp -r /tmp/ut/* $UT_DIR/ && sudo bash $0 "" $UT_DIR
Do NOT copy the System folder from Windows (the Linux patch brings its own).
Monster Hunt: MonsterHunt.u and MonsterHunt.int into $UT_DIR/System, the MH- maps into $UT_DIR/Maps.
TXT
fi

# --- 3. ini files ------------------------------------------------------------------------------
cd "$UT_DIR/System"
[ -f UnrealTournament.ini ] || { [ -f Default.ini ] && cp Default.ini UnrealTournament.ini && echo "created UnrealTournament.ini"; }
[ -f User.ini ] || { [ -f DefUser.ini ] && cp DefUser.ini User.ini && echo "created User.ini"; }

# --- 4. tournament mod -------------------------------------------------------------------------
if [ -z "$MISSING" ] && [ -f "$MOD_DIR/build.sh" ]; then
  say "Building the tournament mod"
  if bash "$MOD_DIR/build.sh" "$UT_DIR"; then
    echo "mod built"
  else
    echo "Warning: the mod build failed (see above). The tournament needs UTTourney_v1.u in $UT_DIR/System."
  fi
elif [ -n "$MISSING" ]; then
  echo "The mod is built when the game content is complete (run this script again)."
fi

if id "$SVC_USER" >/dev/null 2>&1; then
  chown -R "$SVC_USER":"$SVC_USER" "$UT_DIR"
fi

say "UT server folder: $UT_DIR"
cat <<TXT
Ports to open/forward for players: UDP 7777-7779 (game, query). TCP 7790 (mod <-> bridge) stays local.
Quick test of the server alone (Ctrl+C to stop; normally the bridge starts it):
  cd $(dirname "$UCC") && sudo -u $SVC_USER ./$(basename "$UCC") server DM-Deck16][
If it stops with "Illegal instruction", the patch build does not support this CPU.
TXT
