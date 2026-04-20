# Postiz on Fly.io

This folder contains the Fly deployment glue for running Postiz as a
**single always-on Fly machine** that bundles every service it needs.

## Architecture

```
Fly machine (performance-2x, 4GB RAM)
└── supervisord (PID 1 via tini)
    ├── postgres (127.0.0.1:5432, data at /data/pg)
    ├── redis    (127.0.0.1:6379, AOF at /data/redis)
    ├── temporal (127.0.0.1:7233, SQLite at /data/temporal/temporal.db)
    ├── nginx    (:5000 — internal, fronted by Fly's HTTP proxy at :443)
    └── postiz via pm2
        ├── backend      (:3000, NestJS)
        ├── frontend     (:4200, NextJS)
        └── orchestrator (Temporal worker)
```

Persistent state lives on the `postiz_data` Fly volume mounted at `/data`.

## Trade-offs

- **No Elasticsearch.** Temporal runs its dev server (SQLite, no ES) to keep
  memory under 4GB. Temporal's "visibility" features are limited; for Postiz
  usage this is fine.
- **Local uploads.** `STORAGE_PROVIDER=local`. Files go in `/data/uploads`.
  Switch to Cloudflare R2 later by overriding env via `flyctl secrets set`.
- **One machine = single point of failure.** If the machine's volume dies you
  lose Postgres + Redis + Temporal state + uploads. Take volume snapshots:
  `flyctl volumes snapshots create <volume-id>`.

## Common operations

### Tail logs
```bash
flyctl logs -a postiz-rad
```

### SSH into the machine
```bash
flyctl ssh console -a postiz-rad
```

### Open psql
```bash
flyctl ssh console -a postiz-rad -C "psql postgresql://postiz:postiz@127.0.0.1:5432/postiz"
```

### Set / rotate a secret
```bash
flyctl secrets set JWT_SECRET="$(openssl rand -hex 48)" -a postiz-rad
flyctl secrets set X_API_KEY=... X_API_SECRET=... -a postiz-rad
```

### Force a redeploy
```bash
flyctl deploy -a postiz-rad --remote-only
```
Or just push to `main` — the `fly-deploy.yml` GH Action handles it.

### Snapshot the volume
```bash
flyctl volumes list -a postiz-rad
flyctl volumes snapshots create <volume-id>
flyctl volumes snapshots list <volume-id>
```

### Scale memory
```bash
flyctl scale vm performance-4x --memory 8192 -a postiz-rad
```

### Add a custom domain
```bash
flyctl certs add yourdomain.com -a postiz-rad
# Point DNS A/AAAA (or CNAME to postiz-rad.fly.dev) per `flyctl certs show`.
# Then update FRONTEND_URL / NEXT_PUBLIC_BACKEND_URL / MAIN_URL in fly.toml.
```

## Required Fly secrets

Minimum to boot:
- `JWT_SECRET` — long random string

Optional per social platform (add as you wire each one):
- `X_API_KEY`, `X_API_SECRET`
- `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`
- `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`
- ...see `.env.example` for the full list.

DATABASE_URL, REDIS_URL, TEMPORAL_ADDRESS, FRONTEND_URL, etc. are set in
`fly.toml [env]` — don't duplicate them as secrets.

## GitHub Actions

- `.github/workflows/fly-deploy.yml` — auto-deploy on push to `main`.
  Requires `FLY_API_TOKEN` repo secret:
  ```bash
  gh secret set FLY_API_TOKEN \
    --body "$(flyctl tokens create deploy -a postiz-rad -x 87600h)" \
    --repo researchanddesire/postiz-app
  ```

- `.github/workflows/upstream-sync.yml` — opens a PR every Monday with the
  latest `gitroomhq/postiz-app` main merged in. Review, resolve conflicts,
  merge. Runs on default `GITHUB_TOKEN`.
