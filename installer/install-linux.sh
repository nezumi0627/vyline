#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PREFIX="${VYLINE_PREFIX:-${HOME}/.local/opt/vyline}"
BIN_DIR="${VYLINE_BIN_DIR:-${HOME}/.local/bin}"
DESKTOP_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/applications"
PREFIX_PARENT="$(dirname -- "$PREFIX")"
mkdir -p -- "$PREFIX_PARENT" "$BIN_DIR" "$DESKTOP_DIR"
STAGE="$(mktemp -d "${PREFIX}.staging.XXXXXX")"
BACKUP="${PREFIX}.previous.$$"
INSTALLED=0

rollback() {
  status=$?
  if [ "$status" -ne 0 ]; then
    if [ -e "$BACKUP" ]; then
      rm -rf -- "$PREFIX"
      mv -- "$BACKUP" "$PREFIX" || printf 'Vyline rollback failed; recover from %s\n' "$BACKUP" >&2
    elif [ "$INSTALLED" -eq 1 ]; then
      rm -rf -- "$PREFIX"
    fi
  fi
  rm -rf -- "$STAGE"
  exit "$status"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cp -R -- "$SCRIPT_DIR"/. "$STAGE"/

# Keep the previous runnable package until the staged replacement and launchers
# are in place. App data lives under XDG_DATA_HOME and is never copied here.
if [ -e "$PREFIX" ]; then mv -- "$PREFIX" "$BACKUP"; fi
mv -- "$STAGE" "$PREFIX"
INSTALLED=1

LINK_TMP="${BIN_DIR}/.vyline.$$"
ln -s -- "$PREFIX/Vyline" "$LINK_TMP"
mv -f -- "$LINK_TMP" "$BIN_DIR/vyline"

DESKTOP_TMP="${DESKTOP_DIR}/.vyline.desktop.$$"
cat > "$DESKTOP_TMP" <<EOF
[Desktop Entry]
Name=Vyline
Comment=LINE third-party client
Exec=$BIN_DIR/vyline
Icon=$PREFIX/icon.png
Terminal=false
Type=Application
Categories=Network;Chat;
EOF
mv -f -- "$DESKTOP_TMP" "$DESKTOP_DIR/vyline.desktop"

rm -rf -- "$BACKUP"
trap - EXIT INT TERM
printf 'Vyline installed. Run: %s\n' "$BIN_DIR/vyline"
