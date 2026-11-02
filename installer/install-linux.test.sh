#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
INSTALLER="$REPO_ROOT/installer/install-linux.sh"
TEMP_ROOT="$(mktemp -d)"
cleanup() { rm -rf -- "$TEMP_ROOT"; }
trap cleanup EXIT

make_package() {
  local source="$1" version="$2"
  mkdir -p "$source"
  printf '%s\n' "$version" > "$source/Vyline"
  printf '%s\n' "$version" > "$source/VylineBackend"
  mkdir -p "$source/data"
  printf '%s\n' 'fallback profile' > "$source/data/desktop-profile.fallback.json"
  cp "$INSTALLER" "$source/install.sh"
}

run_install() {
  local source="$1" prefix="$2" bin="$3" data="$4" path_prefix="${5:-}"
  HOME="$TEMP_ROOT/home" \
    VYLINE_PREFIX="$prefix" \
    VYLINE_BIN_DIR="$bin" \
    XDG_DATA_HOME="$data" \
    PATH="${path_prefix:+$path_prefix:}$PATH" \
    bash "$source/install.sh"
}

mkdir -p "$TEMP_ROOT/home"
make_package "$TEMP_ROOT/package-old" old
make_package "$TEMP_ROOT/package-new" new
PREFIX="$TEMP_ROOT/opt/vyline"
BIN="$TEMP_ROOT/bin"
DATA="$TEMP_ROOT/data"

run_install "$TEMP_ROOT/package-old" "$PREFIX" "$BIN" "$DATA"
test "$(cat "$PREFIX/Vyline")" = old
mkdir -p "$DATA/Vyline"
printf 'existing user data\n' > "$DATA/Vyline/user-data.db"
printf 'stale package file\n' > "$PREFIX/obsolete-file"

run_install "$TEMP_ROOT/package-new" "$PREFIX" "$BIN" "$DATA"
test "$(cat "$PREFIX/Vyline")" = new
test "$(cat "$PREFIX/data/desktop-profile.fallback.json")" = 'fallback profile'
test ! -e "$PREFIX/obsolete-file"
test "$(cat "$DATA/Vyline/user-data.db")" = 'existing user data'
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *) test "$(readlink "$BIN/vyline")" = "$PREFIX/Vyline" ;;
esac
test -f "$DATA/applications/vyline.desktop"
if compgen -G "$TEMP_ROOT/opt/vyline.previous.*" >/dev/null; then
  echo "stale installer backup was left behind" >&2
  exit 1
fi

# Fail after the new files are swapped in; the previous runnable package must return.
mkdir -p "$TEMP_ROOT/failing-bin" "$TEMP_ROOT/mock-bin"
run_install "$TEMP_ROOT/package-old" "$PREFIX" "$BIN" "$DATA"
cat > "$TEMP_ROOT/mock-bin/ln" <<'EOF'
#!/usr/bin/env sh
exit 23
EOF
chmod +x "$TEMP_ROOT/mock-bin/ln"
if run_install "$TEMP_ROOT/package-new" "$PREFIX" "$TEMP_ROOT/failing-bin" "$DATA" "$TEMP_ROOT/mock-bin"; then
  echo "expected simulated launcher failure" >&2
  exit 1
fi
test "$(cat "$PREFIX/Vyline")" = old
test "$(cat "$DATA/Vyline/user-data.db")" = 'existing user data'

echo "Linux installer integration checks passed"
