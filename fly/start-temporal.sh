#!/usr/bin/env bash
# Run the Temporal dev server (SQLite-backed, no Elasticsearch).
# Data lives on the Fly volume at /data/temporal.
# Listens on 127.0.0.1 so only in-machine clients can reach it.
set -euo pipefail

mkdir -p /data/temporal

exec /usr/local/bin/temporal server start-dev \
  --ip 127.0.0.1 \
  --port 7233 \
  --ui-port 7234 \
  --db-filename /data/temporal/temporal.db \
  --log-level warn \
  --namespace default
