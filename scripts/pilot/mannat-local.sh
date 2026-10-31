#!/usr/bin/env bash
# The QR pilot (Mannat, P9-06, ADR-0024) on one Mac, for a test on the restaurant's Wi-Fi before the
# cloud server exists: PostgreSQL 16 (Docker), the QR relay host, the QR menu site and the KOT
# server, all reachable from phones on the same network.
#
#   scripts/pilot/mannat-local.sh setup    # once: databases, build, Mannat, its 5 QR codes, tents
#   scripts/pilot/mannat-local.sh start    # the relay, the site and the server, in the background
#   scripts/pilot/mannat-local.sh status   # what is running, and the addresses
#   scripts/pilot/mannat-local.sh pair     # a pairing code for the first screen (POS), on this PC
#   scripts/pilot/mannat-local.sh stop
#   scripts/pilot/mannat-local.sh reset    # stop and delete everything set up here
#
# Settings (environment): PILOT_IP (default: this Mac's Wi-Fi address), PILOT_UPI_ID (the
# restaurant's business UPI ID; without it the bill has no Pay button). Secrets stay in .pilot/
# (git-ignored). Needs Docker, Node 24 and pnpm (corepack).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="$ROOT/.pilot"
IP="${PILOT_IP:-$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')}"
PG_PORT="${PILOT_PG_PORT:-55433}"
PG_CONTAINER=rp-pilot-pg
RELAY_PORT=8787
SITE_PORT=3100
SERVER_PORT=8080

[[ -n "$IP" ]] || { echo "Set PILOT_IP to this computer's address on the Wi-Fi." >&2; exit 1; }
SITE="http://$IP:$SITE_PORT"
RELAY="http://$IP:$RELAY_PORT/functions/v1"

secret() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40; }
pg_password() { cat "$STATE/pg-password"; }
pg_url() { echo "postgresql://postgres:$(pg_password)@127.0.0.1:$PG_PORT/$1"; }
psql_in() { docker exec -i "$PG_CONTAINER" psql -q -v ON_ERROR_STOP=1 -U postgres -d "$1"; }

server_env() {
  cat <<EOF
NODE_ENV=development
HOST=0.0.0.0
PORT=$SERVER_PORT
DATABASE_URL=$(pg_url rp_mannat)
RP_DATA_DIR=$STATE/server-data
RP_CONSOLE_DIR=$ROOT/apps/console/dist
RP_RELAY_URL=$RELAY
RP_QR_SITE_URL=$SITE
RP_TLS=on
RP_TLS_HOSTNAMES=$IP
RP_MQTT=off
LOG_LEVEL=info
EOF
}

setup() {
  mkdir -p "$STATE/logs" "$STATE/server-data" "$STATE/photos"
  chmod 700 "$STATE"
  [[ -f "$STATE/pg-password" ]] || secret > "$STATE/pg-password"
  # bash 3.2 (macOS) cannot source a process substitution: the server's settings go in a file.
  server_env > "$STATE/server.env"
  chmod 600 "$STATE/server.env"

  echo "== PostgreSQL 16 ($PG_CONTAINER on 127.0.0.1:$PG_PORT)"
  if ! docker container inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    docker run -d --name "$PG_CONTAINER" -e POSTGRES_PASSWORD="$(pg_password)" \
      -p "127.0.0.1:$PG_PORT:5432" -v rp-pilot-pg:/var/lib/postgresql/data postgres:16 >/dev/null
  fi
  docker start "$PG_CONTAINER" >/dev/null
  until docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
  for db in rp_mannat rp_relay; do
    docker exec "$PG_CONTAINER" psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" \
      | grep -q 1 || docker exec "$PG_CONTAINER" createdb -U postgres "$db"
  done

  echo "== Build"
  cd "$ROOT"
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile >/dev/null
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm turbo run build \
    --filter=@rp/server... --filter=@rp/relay --filter=@rp/qr-menu... --filter=@rp/console... \
    --output-logs=errors-only

  echo "== The KOT server's database"
  (cd apps/server && DATABASE_URL="$(pg_url rp_mannat)" pnpm exec prisma migrate deploy >/dev/null)

  echo "== The QR relay's database"
  RELAY_ADMIN_DB_URL="$(pg_url rp_relay)" node infra/supabase/scripts/migrate.mjs
  if [[ ! -f "$STATE/relay-host.env" ]]; then
    local edge janitor cp
    edge=$(secret); janitor=$(secret); cp=$(secret)
    psql_in rp_relay <<SQL
ALTER ROLE relay_edge WITH LOGIN PASSWORD '$edge';
ALTER ROLE relay_janitor WITH LOGIN PASSWORD '$janitor';
ALTER ROLE relay_control_plane WITH LOGIN PASSWORD '$cp';
SQL
    umask 077
    cat > "$STATE/relay-host.env" <<EOF
RELAY_DB_URL=postgresql://relay_edge:$edge@127.0.0.1:$PG_PORT/rp_relay
RELAY_JOBS_DB_URL=postgresql://relay_janitor:$janitor@127.0.0.1:$PG_PORT/rp_relay
RELAY_PUBLIC_URL=http://$IP:$RELAY_PORT
RELAY_ALLOWED_ORIGINS=$SITE
RELAY_JWT_SECRET=$(secret)
RELAY_REALTIME_API_KEY=$(secret)
RELAY_PHOTOS_DIR=$STATE/photos
RELAY_HOST=0.0.0.0
RELAY_PORT=$RELAY_PORT
EOF
    echo "RELAY_PROVISION_DB_URL=postgresql://relay_control_plane:$cp@127.0.0.1:$PG_PORT/rp_relay" \
      > "$STATE/provision.env"
    umask 022
  fi

  if [[ ! -f "$STATE/mannat.txt" ]]; then
    echo "== Mannat: the restaurant, 5 tables and their QR codes, the menu, staff"
    local upi=()
    [[ -n "${PILOT_UPI_ID:-}" ]] && upi=(--upi-id "$PILOT_UPI_ID")
    # Written only once it has worked, so a failed set-up runs this again.
    (set -a; source "$STATE/server.env"; set +a
      node apps/server/dist/database/pilot-cli.js --site "$SITE" --tents "$STATE/mannat-tents.pdf" \
        ${upi[@]+"${upi[@]}"}) > "$STATE/mannat.tmp"
    mv "$STATE/mannat.tmp" "$STATE/mannat.txt"
    cat "$STATE/mannat.txt"

    echo "== Mannat at the relay, and the PC's credential"
    (set -a; source "$STATE/provision.env"; set +a
      node infra/supabase/scripts/provision-restaurant.mjs --name Mannat --label "Mannat PC") \
      | grep -E '^[A-Za-z0-9_-]{43,}$' > "$STATE/relay-credential.txt"
    chmod 600 "$STATE/relay-credential.txt"
    (set -a; source "$STATE/server.env"; set +a
      node apps/server/dist/relay/relay-cli.js credential < "$STATE/relay-credential.txt")
  fi
  echo
  echo "Set up. Now: scripts/pilot/mannat-local.sh start"
}

launch() {
  local name=$1; shift
  if [[ -f "$STATE/$name.pid" ]] && kill -0 "$(cat "$STATE/$name.pid")" 2>/dev/null; then
    echo "$name is running already"; return
  fi
  nohup "$@" > "$STATE/logs/$name.log" 2>&1 &
  echo $! > "$STATE/$name.pid"
  echo "$name started (log: .pilot/logs/$name.log)"
}

start() {
  [[ -f "$STATE/mannat.txt" ]] || { echo "Run setup first." >&2; exit 1; }
  docker start "$PG_CONTAINER" >/dev/null
  until docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
  cd "$ROOT"
  launch relay-host env $(grep -v '^#' "$STATE/relay-host.env" | xargs) \
    node infra/supabase/dist/relay-host.mjs
  launch qr-site env RELAY_URL="$RELAY" NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production \
    "$ROOT/apps/qr-menu/node_modules/.bin/next" start "$ROOT/apps/qr-menu" -p "$SITE_PORT" -H 0.0.0.0
  launch server env $(server_env | xargs) node apps/server/dist/main.js
  sleep 4
  status
}

stop() {
  for name in server qr-site relay-host; do
    if [[ -f "$STATE/$name.pid" ]]; then
      kill "$(cat "$STATE/$name.pid")" 2>/dev/null || true
      rm -f "$STATE/$name.pid"
      echo "$name stopped"
    fi
  done
}

status() {
  for name in relay-host qr-site server; do
    if [[ -f "$STATE/$name.pid" ]] && kill -0 "$(cat "$STATE/$name.pid")" 2>/dev/null; then
      echo "$name: running"
    else
      echo "$name: stopped"
    fi
  done
  echo "relay: $(curl -s "http://127.0.0.1:$RELAY_PORT/healthz" || echo 'not answering')"
  cat <<EOF

QR menu site:      $SITE   (each table: see .pilot/mannat.txt; tents: .pilot/mannat-tents.pdf)
POS and dashboard: https://$IP:$SERVER_PORT   (the browser warns about the restaurant's own certificate)
First screen not paired yet: scripts/pilot/mannat-local.sh pair
Waiter / manager phone: pair the waiter app with the code from Manage → Devices.
EOF
}

# The first screen's pairing code, made by the server for this PC only (AUTH-007, ONB-001): type
# it into the POS opened at the PC's address on any browser. Once one screen is paired, codes for
# the others (the manager's phone, the kitchen screen) come from Manage → Devices on it.
pair() {
  local answer code
  answer="$(curl -sk -X POST "https://127.0.0.1:$SERVER_PORT/api/v1/devices/pairing-codes/bootstrap")" || {
    echo "The server is not answering: scripts/pilot/mannat-local.sh start" >&2
    exit 1
  }
  code="$(printf '%s' "$answer" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{process.stdout.write(JSON.parse(s).code ?? "")}catch{}})')"
  if [[ -z "$code" ]]; then
    echo "No code: a screen is paired already. On it, open Manage → Devices → Pair a device." >&2
    echo "(Server said: $answer)" >&2
    exit 1
  fi
  echo "Pairing code for the first POS screen: $code   (one use, expires soon)"
  echo
  echo "1. Open https://$IP:$SERVER_PORT on this PC or any computer on the Wi-Fi"
  echo "   (the browser warns about the restaurant's own certificate: continue)."
  echo "2. Type the code in \"Pairing code\" and press Pair device. Then sign in: Manager, PIN 2222."
  echo "3. Every other screen or phone: Manage → Devices → Pair a device, on that POS."
}

reset() {
  stop
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  docker volume rm rp-pilot-pg >/dev/null 2>&1 || true
  rm -rf "$STATE"
  echo "Everything set up here is gone."
}

case "${1:-}" in
  setup) setup ;;
  start) start ;;
  stop) stop ;;
  status) status ;;
  pair) pair ;;
  reset) reset ;;
  *) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
