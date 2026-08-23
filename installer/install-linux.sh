#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PREFIX="${VYLINE_PREFIX:-${HOME}/.local/opt/vyline}"
BIN_DIR="${VYLINE_BIN_DIR:-${HOME}/.local/bin}"
DESKTOP_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/applications"
mkdir -p "$PREFIX" "$BIN_DIR" "$DESKTOP_DIR"
cp -R "$SCRIPT_DIR"/. "$PREFIX"/
ln -sfn "$PREFIX/Vyline" "$BIN_DIR/vyline"
cat > "$DESKTOP_DIR/vyline.desktop" <<EOF
[Desktop Entry]
Name=Vyline
Comment=LINE third-party client
Exec=$BIN_DIR/vyline
Terminal=false
Type=Application
Categories=Network;Chat;
EOF
printf 'Vyline installed. Run: %s\n' "$BIN_DIR/vyline"
