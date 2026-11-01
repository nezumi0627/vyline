#!/bin/sh
set -eu

DATA_DIR="${VYLINE_DATA_DIR:-/app/data}"
STORAGE_DIR="${VYLINE_STORAGE_DIR:-/app/storage}"

mkdir -p "$DATA_DIR" "$STORAGE_DIR"

if [ "$(id -u)" = "0" ]; then
  # Docker bind mounts keep the host-side ownership and therefore hide the
  # ownership prepared in the image.  Vyline runs as the unprivileged `bun`
  # user, so a root-owned ./data bind mount otherwise makes restores appear to
  # work in memory while chatdb/settings silently fail to persist.
  chown -R bun:bun "$DATA_DIR" "$STORAGE_DIR"

  if ! gosu bun test -w "$DATA_DIR"; then
    echo "[vyline] VYLINE_DATA_DIR is not writable by bun: $DATA_DIR" >&2
    exit 1
  fi
  if ! gosu bun test -w "$STORAGE_DIR"; then
    echo "[vyline] VYLINE_STORAGE_DIR is not writable by bun: $STORAGE_DIR" >&2
    exit 1
  fi

  exec gosu bun "$@"
fi

exec "$@"
