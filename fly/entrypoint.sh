#!/usr/bin/env bash
# First-boot orchestration for the Postiz Fly machine.
# Prepares persistent directories on /data, initializes Postgres if needed,
# then hands control to supervisord which runs every service.
set -euo pipefail

log() { printf '[entrypoint] %s\n' "$*"; }

# ---- layout -----------------------------------------------------------------
mkdir -p /data/pg /data/redis /data/temporal /data/uploads /data/log
chown -R postgres:postgres /data/pg
chmod 700 /data/pg
chown -R redis:redis /data/redis || true

# nginx.conf expects /uploads/ to exist as a filesystem alias; symlink it.
rm -rf /uploads
ln -s /data/uploads /uploads

# pm2 + logs on the volume so they survive restarts.
mkdir -p /data/log/pm2 /data/log/nginx
ln -sfn /data/log/nginx /var/log/nginx || true

# ---- postgres first-boot init ----------------------------------------------
if [ ! -s "/data/pg/PG_VERSION" ]; then
  # If a previous attempt left partial files behind, wipe them — initdb
  # refuses to run into a non-empty directory.
  if [ -n "$(ls -A /data/pg 2>/dev/null)" ]; then
    log "clearing partial postgres init at /data/pg"
    rm -rf /data/pg/* /data/pg/.[!.]* 2>/dev/null || true
  fi

  log "initializing postgres cluster at /data/pg"
  # Trust auth on loopback. The machine's only network is Fly's private
  # 6pn interface; the postgres listener is bound to 127.0.0.1, so no
  # external clients can reach it. DATABASE_URL still carries a password
  # for Prisma's benefit; postgres ignores it under trust.
  gosu postgres /usr/lib/postgresql/15/bin/initdb \
    --pgdata=/data/pg \
    --username="${POSTGRES_USER}" \
    --encoding=UTF8 \
    --auth-local=trust \
    --auth-host=trust

  {
    echo "listen_addresses = '127.0.0.1'"
    echo "port = 5432"
    echo "shared_buffers = 256MB"
    echo "max_connections = 100"
    echo "logging_collector = off"
  } >> /data/pg/postgresql.conf
fi

# ---- hand off to supervisord -----------------------------------------------
log "starting supervisord"
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
