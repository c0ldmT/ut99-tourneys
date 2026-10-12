#!/usr/bin/env bash
# Builds the tournament packages with ucc make (Linux, UT99 469).
# Usage: ./build.sh /path/to/UnrealTournament
# Result: <UT>/System/UTTourney_v1.u, and UTTourneyMH_v1.u (Monster Hunt) if MonsterHunt.u is installed.
# Does not modify your UnrealTournament.ini.
set -euo pipefail

PKG="UTTourney_v1"
MHPKG="UTTourneyMH_v1"
UT="${1:?usage: ./build.sh /path/to/UnrealTournament}"
HERE="$(cd "$(dirname "$0")" && pwd)"

UCC=""
for c in System/ucc-bin-amd64 System/ucc-bin-arm64 System/ucc-bin-x86 System64/ucc-bin SystemARM64/ucc-bin System/ucc-bin; do
  if [ -x "$UT/$c" ]; then UCC="$UT/$c"; break; fi
done
[ -n "$UCC" ] || { echo "no ucc binary found under $UT" >&2; exit 1; }
SYSDIR="$(dirname "$UCC")"
echo "using $UCC"

# Monster Hunt package only where Monster Hunt 613 is installed.
WITH_MH=0
if [ -f "$SYSDIR/MonsterHunt.u" ] || [ -f "$UT/System/MonsterHunt.u" ]; then WITH_MH=1; fi

rm -rf "${UT:?}/$PKG" "${UT:?}/$MHPKG"
mkdir -p "$UT/$PKG/Classes"
cp "$HERE"/Classes/*.uc "$UT/$PKG/Classes/"
rm -f "$SYSDIR/$PKG.u" "$UT/System/$PKG.u" "$SYSDIR/$MHPKG.u" "$UT/System/$MHPKG.u"
if [ "$WITH_MH" = 1 ]; then
  mkdir -p "$UT/$MHPKG/Classes"
  cp "$HERE"/MH/Classes/*.uc "$UT/$MHPKG/Classes/"
else
  echo "MonsterHunt.u not found: building without the Monster Hunt package ($MHPKG)"
fi

# Build ini = UnrealTournament.ini + our packages at the end of [Editor.EditorEngine]
# (MonsterHunt before the Monster Hunt package, unless it is listed already).
SRCINI="$SYSDIR/UnrealTournament.ini"
[ -f "$SRCINI" ] || SRCINI="$UT/System/UnrealTournament.ini"
awk -v pkg="$PKG" -v mhpkg="$MHPKG" -v withmh="$WITH_MH" '
  function add() {
    print "EditPackages=" pkg
    if (withmh == 1) { if (!hasmh) print "EditPackages=MonsterHunt"; print "EditPackages=" mhpkg }
    done = 1
  }
  { sub(/\r$/, "") }
  /^\[/ { if (insec && !done) add(); insec = ($0 == "[Editor.EditorEngine]") }
  insec && $0 == "EditPackages=MonsterHunt" { hasmh = 1 }
  { if (!(insec && ($0 == "EditPackages=" pkg || $0 == "EditPackages=" mhpkg))) print }
  END { if (insec && !done) add() }
' "$SRCINI" > "$SYSDIR/TourneyMake.ini"

(cd "$SYSDIR" && "$UCC" make ini=TourneyMake.ini)

[ -f "$SYSDIR/$PKG.u" ] || { echo "build failed, see output above" >&2; exit 1; }
echo "built $SYSDIR/$PKG.u"
if [ "$WITH_MH" = 1 ]; then
  [ -f "$SYSDIR/$MHPKG.u" ] || { echo "build of $MHPKG failed, see output above" >&2; exit 1; }
  echo "built $SYSDIR/$MHPKG.u"
fi
