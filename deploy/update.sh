#!/usr/bin/env bash
# Updates a running Neuro Arena (website, bridges, optionally the UT mod) from your PC (Linux, WSL or
# macOS with ssh/scp) - decision 288. It does not set anything up: the target already runs an
# installation of deploy/linux/install.sh (and install-ut.sh for the game server).
#
#   pnpm release                                  # builds release/tourney-<version>.tar.gz
#   bash deploy/update.sh --target vps            # website + bridges
#   bash deploy/update.sh --target vps --mod-dir "/mnt/c/UnrealTournament/System"   # + the mod
#
# Settings (each also as an option): environment variables, a file deploy/update.env next to this
# script (or --env FILE, lines as in deploy/update.env.example) over them, options over both.
#   TARGET      ssh host or alias of the server (required), e.g. vps or mario@203.0.113.5
#   BUNDLE      the release bundle (default: the newest release/tourney-*.tar.gz of this checkout)
#   MOD_DIR     folder with UTTourney_v1.u (and UTTourneyMH_v1.u) built on the PC; empty = no mod
#   UT_DIR      the UT folder on the server (default /opt/ut99)
#   REMOTE_DIR  folder in the ssh user's home on the server for the files (default tourney-update)
#   BACKUP      1 = a backup (backup.sh) before the update (default 1)
#   FORCE       1 = update even while tournaments run (they break off; default 0)
#   SSH_OPTS    extra options for ssh/scp, e.g. "-p 2222"
# Options: --target, --bundle, --mod-dir, --ut, --remote-dir, --no-backup, --force, --dry-run,
#          --env FILE, -h
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ENV_FILE="$HERE/update.env"
DRY=0
# Options are kept apart and win over the file (plain variables: bash 3 on macOS has no maps).
O_TARGET="" O_BUNDLE="" O_MOD_DIR="" O_UT_DIR="" O_REMOTE_DIR="" O_BACKUP="" O_FORCE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --target) O_TARGET="$2"; shift 2 ;;
    --bundle) O_BUNDLE="$2"; shift 2 ;;
    --mod-dir) O_MOD_DIR="$2"; shift 2 ;;
    --ut) O_UT_DIR="$2"; shift 2 ;;
    --remote-dir) O_REMOTE_DIR="$2"; shift 2 ;;
    --no-backup) O_BACKUP=0; shift ;;
    --force) O_FORCE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --env) ENV_FILE="$2"; shift 2 ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "unknown option $1 (see --help)" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi
[ -n "$O_TARGET" ] && TARGET="$O_TARGET"
[ -n "$O_BUNDLE" ] && BUNDLE="$O_BUNDLE"
[ -n "$O_MOD_DIR" ] && MOD_DIR="$O_MOD_DIR"
[ -n "$O_UT_DIR" ] && UT_DIR="$O_UT_DIR"
[ -n "$O_REMOTE_DIR" ] && REMOTE_DIR="$O_REMOTE_DIR"
[ -n "$O_BACKUP" ] && BACKUP="$O_BACKUP"
[ -n "$O_FORCE" ] && FORCE="$O_FORCE"
TARGET="${TARGET:-}"
BUNDLE="${BUNDLE:-}"
MOD_DIR="${MOD_DIR:-}"
UT_DIR="${UT_DIR:-/opt/ut99}"
REMOTE_DIR="${REMOTE_DIR:-tourney-update}"
BACKUP="${BACKUP:-1}"
FORCE="${FORCE:-0}"
SSH_OPTS="${SSH_OPTS:-}"

[ -n "$TARGET" ] || die "no TARGET: --target vps, or TARGET=... in $ENV_FILE"
if [ -z "$BUNDLE" ]; then
  BUNDLE="$(ls -1t "$ROOT"/release/tourney-*.tar.gz 2>/dev/null | head -n1 || true)"
  [ -n "$BUNDLE" ] || die "no release/tourney-*.tar.gz: run pnpm release first (or --bundle FILE)"
fi
[ -f "$BUNDLE" ] || die "bundle $BUNDLE not found"
TOP="$(tar -tzf "$BUNDLE" | head -n1 | cut -d/ -f1)"
case "$TOP" in tourney-*) ;; *) die "$BUNDLE is not a release bundle (pnpm release)" ;; esac
case "$REMOTE_DIR" in /*|*..*|*\'*|'') die "REMOTE_DIR is a folder name in the home folder, e.g. tourney-update" ;; esac
VERSION="$(tar -xzOf "$BUNDLE" "$TOP/VERSION" 2>/dev/null | tr -d '\r\n' || echo '?')"
MOD_VERSION="$(tar -xzOf "$BUNDLE" "$TOP/mod/Classes/TourneyCore.uc" 2>/dev/null |
  sed -n 's/^const MOD_VERSION = "\([^"]*\)".*/\1/p' | tr -d '\r' || true)"

MOD_FILES=()
if [ -n "$MOD_DIR" ]; then
  [ -f "$MOD_DIR/UTTourney_v1.u" ] || die "no UTTourney_v1.u in $MOD_DIR"
  MOD_FILES+=("$MOD_DIR/UTTourney_v1.u")
  [ -f "$MOD_DIR/UTTourneyMH_v1.u" ] && MOD_FILES+=("$MOD_DIR/UTTourneyMH_v1.u")
  if [ -n "$MOD_VERSION" ] && ! grep -aq "\"$MOD_VERSION\"" "$MOD_DIR/UTTourney_v1.u"; then
    echo "Warning: UTTourney_v1.u in $MOD_DIR does not contain version $MOD_VERSION of this bundle (built from the same source?)"
    [ "$FORCE" = 1 ] || die "build the mod from the same checkout, or --force"
  fi
fi

say "Update"
MOD_TEXT="no (website and bridges only)"
[ -n "$MOD_DIR" ] && MOD_TEXT="${MOD_FILES[*]} (mod $MOD_VERSION)"
cat <<TXT
  target:  $TARGET
  bundle:  $BUNDLE ($TOP, version $VERSION)
  mod:     $MOD_TEXT
  UT:      $UT_DIR
  backup:  $([ "$BACKUP" = 1 ] && echo yes || echo no)
TXT
[ "$DRY" = 1 ] && { echo "(dry run: nothing was changed)"; exit 0; }

# shellcheck disable=SC2086
SSH=(ssh $SSH_OPTS)
# shellcheck disable=SC2086
SCP=(scp $SSH_OPTS)

say "Copying to $TARGET:~/$REMOTE_DIR"
"${SSH[@]}" "$TARGET" "rm -rf ~/'$REMOTE_DIR' && mkdir -p ~/'$REMOTE_DIR/mod'"
"${SCP[@]}" "$BUNDLE" "$TARGET:$REMOTE_DIR/"
if [ "${#MOD_FILES[@]}" -gt 0 ]; then "${SCP[@]}" "${MOD_FILES[@]}" "$TARGET:$REMOTE_DIR/mod/"; fi
"${SCP[@]}" "$HERE/linux/update-remote.sh" "$TARGET:$REMOTE_DIR/"

say "Updating on $TARGET (sudo asks for your password there)"
"${SSH[@]}" -t "$TARGET" "sudo bash ~/'$REMOTE_DIR'/update-remote.sh ~/'$REMOTE_DIR' '$(basename "$BUNDLE")' '$UT_DIR' '$BACKUP' '$FORCE'"
