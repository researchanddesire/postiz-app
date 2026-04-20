#!/usr/bin/env bash
# Run Redis 7 in the foreground with AOF persistence on the Fly volume.
set -euo pipefail

mkdir -p /data/redis
chown -R redis:redis /data/redis || true

exec gosu redis:redis redis-server \
  --dir /data/redis \
  --bind 127.0.0.1 \
  --port 6379 \
  --appendonly yes \
  --save "" \
  --protected-mode no \
  --maxmemory-policy noeviction
