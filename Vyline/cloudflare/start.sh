#!/bin/sh
set -eu

: "${AWS_ACCESS_KEY_ID:?Set the R2 API access key as a Worker secret}"
: "${AWS_SECRET_ACCESS_KEY:?Set the R2 API secret as a Worker secret}"
: "${R2_ACCOUNT_ID:?Set R2_ACCOUNT_ID in Wrangler variables}"
: "${R2_BUCKET_NAME:?Set R2_BUCKET_NAME in Wrangler variables}"

mkdir -p /mnt/vyline
/usr/local/bin/tigrisfs \
  --endpoint "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  --region auto -f "${R2_BUCKET_NAME}" /mnt/vyline &
fuse_pid=$!

attempt=0
until mountpoint -q /mnt/vyline; do
  if ! kill -0 "$fuse_pid" 2>/dev/null; then
    echo "R2 filesystem exited before mounting" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "Timed out mounting the Vyline R2 bucket" >&2
    exit 1
  fi
  sleep 1
done

cd /app
bun run server &
backend_pid=$!

shutdown() {
  kill -TERM "$backend_pid" 2>/dev/null || true
  wait "$backend_pid" || true
  fusermount3 -u /mnt/vyline 2>/dev/null || fusermount -u /mnt/vyline 2>/dev/null || true
  kill -TERM "$fuse_pid" 2>/dev/null || true
  wait "$fuse_pid" 2>/dev/null || true
}
trap shutdown INT TERM EXIT

wait "$backend_pid"
