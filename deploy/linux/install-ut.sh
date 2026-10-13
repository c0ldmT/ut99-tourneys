#!/usr/bin/env bash
# Sets up a UT99 469f dedicated server for Tourney on Linux (x86_64 or ARM64/Raspberry Pi).
#   sudo bash install-ut.sh <OldUnreal-UTPatch469f-Linux-....tar.bz2> [UT folder, default /opt/ut99] [folder with files from your PC]
#
# 1. unpacks the OldUnreal 469f patch for Linux (binaries + updated System files),
# 2. checks the game content (Maps, Textures, Sounds, Music) you copy from your own UT copy,
# 3. creates UnrealTournament.ini / User.ini from the defaults,
# 4. builds the tournament mod with ucc (mod/build.sh), also the Monster Hunt package if MonsterHunt.u is there.
# With a third argument, a folder with files from your PC, it does not build but installs what is there:
#    - UTTourney_v1.u / UTTourneyMH_v1.u built on the PC (the packages are the same on every platform),
#    - SmartStockBots (SmartStockBots.u/.int/.ini, or the SmartStockBots*.zip download),
#    - User.ini: its bots ([Botpack.ChallengeBotInfo]) replace the server's (backup kept).
# Run it again after copying more content (maps, Monster Hunt) or to rebuild the mod.
#   sudo bash install-ut.sh "" /opt/ut99 ~/ut-import
set -euo pipefail

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run with sudo"
command -v bzip2 >/dev/null || { apt-get install -y -qq bzip2 >/dev/null 2>&1 || die "bzip2 is missing (apt install bzip2)"; }
PATCH="${1:-}"
UT_DIR="${2:-/opt/ut99}"
PREBUILT="${3:-}"
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
SYSDIR="$(dirname "$UCC")"
APP_DIR="$(cd "$HERE/../.." && pwd)"
MOD_VERSION="$(sed -n 's/^const MOD_VERSION = "\([^"]*\)".*/\1/p' "$MOD_DIR/Classes/TourneyCore.uc" 2>/dev/null | tr -d '\r' || true)"
prebuilt_hint() {
  cat <<TXT
Alternative: build the mod on your PC (mod/build.ps1 or build.sh, same version as this bundle${MOD_VERSION:+: $MOD_VERSION}),
copy UTTourney_v1.u (and UTTourneyMH_v1.u) into a folder here, e.g. ~/ut-import, and install them with:
  sudo bash $0 "" $UT_DIR ~/ut-import
TXT
}
if [ -n "$PREBUILT" ]; then
  [ -d "$PREBUILT" ] || die "$PREBUILT is not a folder"
  # A folder with files from your PC: whatever of the mod, SmartStockBots and User.ini (bots) is there.
  if [ -f "$PREBUILT/UTTourney_v1.u" ]; then
    say "Installing the tournament mod from $PREBUILT"
    install -m 644 "$PREBUILT/UTTourney_v1.u" "$SYSDIR/UTTourney_v1.u"
    echo "installed UTTourney_v1.u"
    if [ -n "$MOD_VERSION" ] && ! grep -aq "\"$MOD_VERSION\"" "$SYSDIR/UTTourney_v1.u"; then
      echo "Warning: version $MOD_VERSION (this bundle's mod) not found in UTTourney_v1.u - built from the same source?"
    fi
    if [ -f "$PREBUILT/UTTourneyMH_v1.u" ]; then
      install -m 644 "$PREBUILT/UTTourneyMH_v1.u" "$SYSDIR/UTTourneyMH_v1.u"
      echo "installed UTTourneyMH_v1.u"
    elif [ -f "$SYSDIR/MonsterHunt.u" ]; then
      echo "Warning: no UTTourneyMH_v1.u in $PREBUILT - Monster Hunt tournaments need it."
    fi
  else
    echo "No UTTourney_v1.u in $PREBUILT: the tournament mod stays as it is (not rebuilt)."
  fi
elif [ -z "$MISSING" ] && [ -f "$MOD_DIR/build.sh" ]; then
  say "Building the tournament mod"
  if bash "$MOD_DIR/build.sh" "$UT_DIR"; then
    echo "mod built"
  else
    echo "Warning: the mod build failed (see above). The tournament needs UTTourney_v1.u in $SYSDIR."
    prebuilt_hint
  fi
elif [ -n "$MISSING" ]; then
  echo "The mod is built when the game content is complete (run this script again)."
fi

# --- 5. SmartStockBots and bots from your PC (only with a folder as third argument) ------------
if [ -n "$PREBUILT" ]; then
  SSB_SRC="$PREBUILT"
  SSB_FROM_ZIP=0
  SSB_ZIP="$(find "$PREBUILT" -maxdepth 1 -type f -iname 'SmartStockBots*.zip' | sort | tail -n 1)"
  if [ ! -f "$PREBUILT/SmartStockBots.u" ] && [ -n "$SSB_ZIP" ]; then
    # Only the three files, by name, flat into a temporary folder (nothing else of the zip is used).
    SSB_SRC="$(mktemp -d)"
    SSB_FROM_ZIP=1
    if command -v python3 >/dev/null; then
      python3 -I - "$SSB_ZIP" "$SSB_SRC" <<'PY'
import sys, zipfile, os
want = {"smartstockbots.u", "smartstockbots.int", "smartstockbots.ini"}
with zipfile.ZipFile(sys.argv[1]) as z:
    for info in z.infolist():
        base = os.path.basename(info.filename.replace("\\", "/"))
        if base.lower() in want and not info.is_dir():
            with z.open(info) as src, open(os.path.join(sys.argv[2], base), "wb") as dst:
                dst.write(src.read())
PY
    elif command -v unzip >/dev/null; then
      unzip -q -j -o "$SSB_ZIP" 'SmartStockBots.u' 'SmartStockBots.int' 'SmartStockBots.ini' -d "$SSB_SRC" || true
    else
      echo "Warning: cannot unpack $SSB_ZIP (no python3 or unzip): unpack it and copy the files into $PREBUILT"
    fi
  fi
  if [ -f "$SSB_SRC/SmartStockBots.u" ]; then
    say "Installing SmartStockBots${SSB_ZIP:+ from $(basename "$SSB_ZIP")}"
    install -m 644 "$SSB_SRC/SmartStockBots.u" "$SYSDIR/SmartStockBots.u"
    [ -f "$SSB_SRC/SmartStockBots.int" ] && install -m 644 "$SSB_SRC/SmartStockBots.int" "$SYSDIR/SmartStockBots.int"
    if [ -f "$SSB_SRC/SmartStockBots.ini" ]; then
      if [ ! -f "$SYSDIR/SmartStockBots.ini" ]; then
        install -m 644 "$SSB_SRC/SmartStockBots.ini" "$SYSDIR/SmartStockBots.ini"
      elif [ "$SSB_FROM_ZIP" = 0 ]; then
        # Your own settings from the PC replace the server's (backup kept).
        cp -p "$SYSDIR/SmartStockBots.ini" "$SYSDIR/SmartStockBots.ini.bak-$(date +%Y%m%d-%H%M%S)"
        install -m 644 "$SSB_SRC/SmartStockBots.ini" "$SYSDIR/SmartStockBots.ini"
      else
        echo "kept the server's SmartStockBots.ini (settings); the one from the zip is not used"
      fi
    fi
    echo "SmartStockBots installed: tick SmartStockBots in the match rules of a tournament to use it"
  fi
  [ "$SSB_FROM_ZIP" = 1 ] && rm -rf "$SSB_SRC"

  if [ -f "$PREBUILT/User.ini" ]; then
    say "Importing the bots from $PREBUILT/User.ini"
    CLI="$APP_DIR/bridge/dist/cli.js"
    if command -v node >/dev/null && [ -f "$CLI" ]; then
      node "$CLI" import-bots "$PREBUILT/User.ini" --ut "$UT_DIR" || echo "Warning: the bot import failed (see above)."
    else
      echo "Warning: the bridge is not installed yet (deploy/linux/install.sh): run this script again afterwards."
    fi
  fi
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
