#!/usr/bin/env bash
# Wait for Postgres, Redis, and Temporal, then launch Postiz via pm2.
# `pnpm run pm2-run` handles prisma db push + pm2 start for all 3 node apps,
# then tails pm2 logs to stay in the foreground (supervisord-friendly).
set -euo pipefail

log() { printf '[postiz] %s\n' "$*"; }

cd /app

# ---- wait for postgres ------------------------------------------------------
log "waiting for postgres..."
for i in $(seq 1 120); do
  if PGPASSWORD="${POSTGRES_PASSWORD:-postiz}" pg_isready -h 127.0.0.1 -p 5432 -U "${POSTGRES_USER:-postiz}" -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ---- ensure postiz database exists -----------------------------------------
PGPASSWORD="${POSTGRES_PASSWORD:-postiz}" psql -h 127.0.0.1 -U "${POSTGRES_USER:-postiz}" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB:-postiz}'" | grep -q 1 \
  || PGPASSWORD="${POSTGRES_PASSWORD:-postiz}" psql -h 127.0.0.1 -U "${POSTGRES_USER:-postiz}" -d postgres -c \
       "CREATE DATABASE \"${POSTGRES_DB:-postiz}\""

# ---- wait for redis ---------------------------------------------------------
log "waiting for redis..."
for i in $(seq 1 60); do
  if redis-cli -h 127.0.0.1 -p 6379 ping 2>/dev/null | grep -q PONG; then
    break
  fi
  sleep 1
done

# ---- wait for temporal ------------------------------------------------------
log "waiting for temporal..."
for i in $(seq 1 120); do
  if /usr/local/bin/temporal operator cluster health --address 127.0.0.1:7233 >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

# ---- start postiz -----------------------------------------------------------
# pnpm run pm2-run already:
#   1. pm2 delete all
#   2. prisma db push
#   3. pm2 start all apps
#   4. pm2 logs  (keeps the script alive in the foreground)
log "launching postiz (pm2)"
export PM2_HOME=/data/log/pm2
exec pnpm run pm2-run
