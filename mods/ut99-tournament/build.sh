#!/usr/bin/env bash
# Builds the UTTourney package with ucc make (Linux, UT99 469).
# Usage: ./build.sh /path/to/UnrealTournament
# Result: <UT>/System/UTTourney_v1.u   (does not modify your UnrealTournament.ini)
set -euo pipefail

PKG="UTTourney_v1"
UT="${1:?usage: ./build.sh /path/to/UnrealTournament}"
HERE="$(cd "$(dirname "$0")" && pwd)"

UCC=""
for c in System/ucc-bin-amd64 System/ucc-bin-arm64 System/ucc-bin-x86 System64/ucc-bin SystemARM64/ucc-bin System/ucc-bin; do
  if [ -x "$UT/$c" ]; then UCC="$UT/$c"; break; fi
done
[ -n "$UCC" ] || { echo "no ucc binary found under $UT" >&2; exit 1; }
SYSDIR="$(dirname "$UCC")"
echo "using $UCC"

rm -rf "${UT:?}/$PKG"
mkdir -p "$UT/$PKG/Classes"
cp "$HERE"/Classes/*.uc "$UT/$PKG/Classes/"
rm -f "$SYSDIR/$PKG.u" "$UT/System/$PKG.u"

# Build ini = UnrealTournament.ini + EditPackages=$PKG at the end of [Editor.EditorEngine].
SRCINI="$SYSDIR/UnrealTournament.ini"
[ -f "$SRCINI" ] || SRCINI="$UT/System/UnrealTournament.ini"
awk -v pkg="$PKG" '
  { sub(/\r$/, "") }
  /^\[/ { if (insec && !done) { print "EditPackages=" pkg; done = 1 } insec = ($0 == "[Editor.EditorEngine]") }
  { if (!(insec && $0 == "EditPackages=" pkg)) print }
  END { if (insec && !done) print "EditPackages=" pkg }
' "$SRCINI" > "$SYSDIR/TourneyMake.ini"

(cd "$SYSDIR" && "$UCC" make ini=TourneyMake.ini)

if [ -f "$SYSDIR/$PKG.u" ]; then
  echo "built $SYSDIR/$PKG.u"
else
  echo "build failed, see output above" >&2
  exit 1
fi
