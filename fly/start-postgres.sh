#!/usr/bin/env bash
# Run Postgres 15 in the foreground as the postgres user.
# Cluster data lives on the Fly volume at /data/pg.
set -euo pipefail

exec gosu postgres /usr/lib/postgresql/15/bin/postgres \
  -D /data/pg \
  -c config_file=/data/pg/postgresql.conf
