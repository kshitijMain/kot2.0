#!/usr/bin/env bash
# Sets up the QR menu site and the QR relay on a fresh Ubuntu 24.04 server (P9-01, ADR-0024):
# PostgreSQL 16, Node 24, Caddy (HTTPS by itself), the relay host and the site as services, and a
# firewall that lets in only SSH, HTTP and HTTPS. Run as root from the repository copied to /opt/rp:
#
#   sudo bash /opt/rp/infra/relay-host/setup-ubuntu.sh menu.mannat.in
#
# Safe to run again (after `git pull`, to update): it keeps the passwords and secrets it made.
set -euo pipefail

DOMAIN="${1:?Usage: setup-ubuntu.sh <site address, e.g. menu.mannat.in>}"
REPO=/opt/rp
ETC=/etc/rp-relay
DATA=/var/lib/rp-relay

[[ $EUID -eq 0 ]] || { echo "Run as root (sudo)." >&2; exit 1; }
[[ -f "$REPO/pnpm-workspace.yaml" ]] || { echo "Copy or clone the repository to $REPO first." >&2; exit 1; }

secret() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40; }

echo "== Packages"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg debian-keyring debian-archive-keyring \
  apt-transport-https postgresql postgresql-contrib ufw git openssl >/dev/null
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi
corepack enable

echo "== User and folders"
id rp-relay >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin rp-relay
install -d -o rp-relay -g rp-relay -m 755 "$DATA" "$DATA/photos"
install -d -o root -g root -m 700 "$ETC"

echo "== Build"
cd "$REPO"
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm turbo run build --filter=@rp/relay --filter=@rp/qr-menu...
chown -R rp-relay:rp-relay "$REPO/apps/qr-menu/.next"

echo "== Database"
# PostgreSQL listens on this server only (Ubuntu's default); nothing outside reaches it.
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = 'rp_relay'" | grep -q 1 \
  || sudo -u postgres createdb rp_relay
sudo -u postgres env RELAY_ADMIN_DB_URL='postgresql:///rp_relay?host=/var/run/postgresql' \
  node "$REPO/infra/supabase/scripts/migrate.mjs"

if [[ ! -f "$ETC/relay-host.env" ]]; then
  EDGE=$(secret); JANITOR=$(secret); CP=$(secret)
  sudo -u postgres psql -q -d rp_relay -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE relay_edge WITH LOGIN PASSWORD '$EDGE'" \
    -c "ALTER ROLE relay_janitor WITH LOGIN PASSWORD '$JANITOR'" \
    -c "ALTER ROLE relay_control_plane WITH LOGIN PASSWORD '$CP'"
  umask 077
  cat > "$ETC/relay-host.env" <<EOF
RELAY_DB_URL=postgresql://relay_edge:$EDGE@127.0.0.1:5432/rp_relay
RELAY_JOBS_DB_URL=postgresql://relay_janitor:$JANITOR@127.0.0.1:5432/rp_relay
RELAY_PUBLIC_URL=https://$DOMAIN
RELAY_ALLOWED_ORIGINS=https://$DOMAIN
RELAY_JWT_SECRET=$(secret)
RELAY_REALTIME_API_KEY=$(secret)
RELAY_PHOTOS_DIR=$DATA/photos
RELAY_HOST=127.0.0.1
RELAY_PORT=8787
EOF
  cat > "$ETC/provision.env" <<EOF
RELAY_PROVISION_DB_URL=postgresql://relay_control_plane:$CP@127.0.0.1:5432/rp_relay
EOF
  umask 022
fi
echo "RELAY_URL=https://$DOMAIN/functions/v1" > "$ETC/qr-menu.env"
chmod 600 "$ETC"/*.env

echo "== Caddy and services"
sed "s/menu\.example\.in/$DOMAIN/" "$REPO/infra/relay-host/Caddyfile" > /etc/caddy/Caddyfile
sed -i "s#/var/lib/rp-relay/photos#$DATA/photos#" /etc/caddy/Caddyfile
install -d -o caddy -g caddy /var/log/caddy
cp "$REPO/infra/relay-host/relay-host.service" "$REPO/infra/relay-host/qr-menu.service" \
  /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now relay-host qr-menu >/dev/null
systemctl restart relay-host qr-menu caddy

echo "== Firewall: SSH, HTTP and HTTPS only"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

sleep 2
curl -fsS http://127.0.0.1:8787/healthz && echo
cat <<EOF

Done. The site is https://$DOMAIN (the certificate arrives within a minute once DNS points here).

Next, add each restaurant (once) and give its PC the credential this prints:

  sudo bash -c 'set -a; . $ETC/provision.env; node $REPO/infra/supabase/scripts/provision-restaurant.mjs --name "Mannat"'
EOF
