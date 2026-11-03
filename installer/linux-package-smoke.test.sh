#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PACKAGE_DIR="$(find "$REPO_ROOT/dist/linux" -maxdepth 1 -type d -name 'Vyline-linux-x64-*' -print -quit)"
TEMP_ROOT="$(mktemp -d)"
LAUNCHER_PID=""

cleanup() {
  if [[ -n "$LAUNCHER_PID" ]]; then
    kill -TERM -- "-$LAUNCHER_PID" 2>/dev/null || true
    wait "$LAUNCHER_PID" 2>/dev/null || true
  fi
  rm -rf -- "$TEMP_ROOT"
}
trap cleanup EXIT

if [[ -z "$PACKAGE_DIR" || ! -x "$PACKAGE_DIR/Vyline" || ! -x "$PACKAGE_DIR/VylineBackend" ]]; then
  echo "Linux package executables are missing" >&2
  exit 1
fi
test -s "$PACKAGE_DIR/data/desktop-profile.fallback.json"
mkdir -p "$TEMP_ROOT/bin" "$TEMP_ROOT/home" "$TEMP_ROOT/xdg-data"
cat > "$TEMP_ROOT/bin/xdg-open" <<'EOF'
#!/usr/bin/env sh
exit 0
EOF
chmod +x "$TEMP_ROOT/bin/xdg-open"

export HOME="$TEMP_ROOT/home"
export XDG_DATA_HOME="$TEMP_ROOT/xdg-data"
export PATH="$TEMP_ROOT/bin:$PATH"
cd "$PACKAGE_DIR"
setsid ./Vyline >"$TEMP_ROOT/launcher.log" 2>&1 &
LAUNCHER_PID=$!

for attempt in $(seq 1 60); do
  if curl --silent --fail http://127.0.0.1:18765/healthz >"$TEMP_ROOT/health.json"; then
    break
  fi
  if ! kill -0 "$LAUNCHER_PID" 2>/dev/null; then
    cat "$TEMP_ROOT/launcher.log" >&2
    echo "Packaged Linux launcher exited before the backend became healthy" >&2
    exit 1
  fi
  sleep 0.25
done

grep -q '"status":"ready"' "$TEMP_ROOT/health.json" || {
  cat "$TEMP_ROOT/launcher.log" >&2
  echo "Packaged Linux backend did not report ready" >&2
  exit 1
}
echo "Packaged Linux launcher smoke test passed"
