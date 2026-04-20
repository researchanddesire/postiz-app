#!/usr/bin/env bash
# Launch nginx in the foreground. The repo's var/docker/nginx.conf proxies
# :5000 -> backend (3000) and frontend (4200), and serves /uploads as static.
set -euo pipefail

# nginx.conf runs as the www user which doesn't exist in this image.
# Rewrite it to run as the root-owned nginx package's default user.
sed -i 's/^user .*$/user www-data;/' /etc/nginx/nginx.conf

# Make sure the static uploads location (alias /uploads/) is readable.
mkdir -p /uploads
chmod 755 /uploads

# Wait for postiz backend to come up before serving, so we don't 502 during boot.
for i in $(seq 1 60); do
  if curl -fsS --max-time 2 http://127.0.0.1:4200 >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

exec nginx -g 'daemon off;'
