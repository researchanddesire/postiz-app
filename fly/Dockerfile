# syntax=docker/dockerfile:1.7
# Single-container Postiz image for Fly.io.
# Bundles: Postgres 16, Redis 7, Temporal dev server (SQLite), nginx, and the
# Postiz backend + frontend + orchestrator (via pm2).
# Persistent state lives on a Fly volume mounted at /data.

ARG NODE_VERSION=22.20
ARG TEMPORAL_CLI_VERSION=1.4.0

# -----------------------------------------------------------------------------
# Build stage — pnpm install + pnpm build for all apps.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
      g++ make python3 python3-pip bash ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN npm --no-update-notifier --no-fund --global install pnpm@10.6.1

WORKDIR /app
COPY . /app

RUN pnpm install --frozen-lockfile
RUN NODE_OPTIONS="--max-old-space-size=4096" pnpm run build

# -----------------------------------------------------------------------------
# Runtime stage — tiny base + postgres/redis/temporal/nginx/pm2.
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ARG TEMPORAL_CLI_VERSION

ENV DEBIAN_FRONTEND=noninteractive \
    PNPM_HOME=/root/.local/share/pnpm \
    PATH=/root/.local/share/pnpm:/usr/lib/postgresql/15/bin:/usr/local/bin:$PATH \
    PGDATA=/data/pg \
    POSTGRES_USER=postiz \
    POSTGRES_PASSWORD=postiz \
    POSTGRES_DB=postiz

RUN apt-get update && apt-get install -y --no-install-recommends \
      bash ca-certificates curl gosu supervisor \
      nginx \
      postgresql-15 postgresql-client-15 \
      redis-server \
      tini \
    && rm -rf /var/lib/apt/lists/*

# Temporal CLI ships a `server start-dev` subcommand that runs the full
# Temporal server backed by SQLite — perfect for a single-machine VPS.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) tarch=amd64 ;; \
      arm64) tarch=arm64 ;; \
      *) echo "unsupported arch: $arch"; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/temporal.tgz \
      "https://github.com/temporalio/cli/releases/download/v${TEMPORAL_CLI_VERSION}/temporal_cli_${TEMPORAL_CLI_VERSION}_linux_${tarch}.tar.gz"; \
    tar -xzf /tmp/temporal.tgz -C /usr/local/bin temporal; \
    rm /tmp/temporal.tgz; \
    chmod +x /usr/local/bin/temporal; \
    temporal --version

RUN npm --no-update-notifier --no-fund --global install pnpm@10.6.1 pm2

WORKDIR /app

# Bring the built monorepo across. We copy the whole tree because pm2 invokes
# `pnpm start` from each app's package.json which resolves workspace packages
# at runtime.
COPY --from=build /app /app

# Postgres 15 from the Debian repos. We keep PGDATA on the Fly volume at /data/pg.
# Nginx will be reconfigured on every deploy from the repo copy.
COPY var/docker/nginx.conf /etc/nginx/nginx.conf

# Fly-specific runtime glue (supervisord, entrypoint, service scripts).
COPY fly/supervisord.conf /etc/supervisor/supervisord.conf
COPY fly/entrypoint.sh    /usr/local/bin/entrypoint.sh
COPY fly/start-postgres.sh /usr/local/bin/start-postgres.sh
COPY fly/start-redis.sh    /usr/local/bin/start-redis.sh
COPY fly/start-temporal.sh /usr/local/bin/start-temporal.sh
COPY fly/start-postiz.sh   /usr/local/bin/start-postiz.sh
COPY fly/start-nginx.sh    /usr/local/bin/start-nginx.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
             /usr/local/bin/start-postgres.sh \
             /usr/local/bin/start-redis.sh \
             /usr/local/bin/start-temporal.sh \
             /usr/local/bin/start-postiz.sh \
             /usr/local/bin/start-nginx.sh

EXPOSE 5000
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
