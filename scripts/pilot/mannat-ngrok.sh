#!/usr/bin/env bash
# Mannat pilot over one ngrok URL (mobile data / off-LAN). Run in a terminal and leave it open.
# Needs: ngrok logged in, pilot already set up (mannat-local.sh setup).
#
# A free ngrok address changes each time ngrok starts. The table codes stay the same, but printed
# tents open the address they were printed with: this script rewrites .pilot/mannat-tents.pdf for
# the address it starts, and Manage → QR codes on the POS prints the same (P9-07).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="$ROOT/.pilot"
GATE=9080
NGROK_API=http://127.0.0.1:4040

[[ -f "$STATE/mannat.txt" ]] || { echo "Run scripts/pilot/mannat-local.sh setup first." >&2; exit 1; }

echo "== Local stack (relay, site, server)"
"$ROOT/scripts/pilot/mannat-local.sh" start

echo "== Gateway (relay + QR site on :$GATE)"
if [[ -f "$STATE/ngrok-gateway.pid" ]] && kill -0 "$(cat "$STATE/ngrok-gateway.pid")" 2>/dev/null; then
  echo "gateway already running"
else
  nohup node "$ROOT/scripts/pilot/ngrok-gateway.mjs" >> "$STATE/logs/ngrok-gateway.log" 2>&1 &
  echo $! > "$STATE/ngrok-gateway.pid"
  sleep 1
fi

echo "== ngrok (public HTTPS)"
if pgrep -f "ngrok http $GATE" >/dev/null; then
  echo "ngrok already running"
else
  nohup ngrok http "$GATE" >> "$STATE/logs/ngrok-public.log" 2>&1 &
  echo $! > "$STATE/ngrok.pid"
  sleep 4
fi

NGROK="$(curl -s "$NGROK_API/api/tunnels" | python3 -c "import sys,json; t=json.load(sys.stdin).get('tunnels',[]); print(t[0]['public_url'] if t else '')")"
[[ -n "$NGROK" ]] || { echo "ngrok did not start; check .pilot/logs/ngrok-public.log" >&2; exit 1; }
echo "$NGROK" > "$STATE/ngrok-url.txt"

perl -pi -e "s|^RELAY_PUBLIC_URL=.*|RELAY_PUBLIC_URL=$NGROK|" "$STATE/relay-host.env"
# The ngrok address and the Wi-Fi one: a phone on the Wi-Fi link orders too (P9-16).
WIFI_SITE="http://$(ipconfig getifaddr en0 2>/dev/null || echo 127.0.0.1):3100"
perl -pi -e "s|^RELAY_ALLOWED_ORIGINS=.*|RELAY_ALLOWED_ORIGINS=$NGROK,$WIFI_SITE|" "$STATE/relay-host.env"
perl -pi -e "s|^RP_RELAY_URL=.*|RP_RELAY_URL=$NGROK/functions/v1|" "$STATE/server.env"
perl -pi -e "s|^RP_QR_SITE_URL=.*|RP_QR_SITE_URL=$NGROK|" "$STATE/server.env"
# PIN-only sign-in (ADR-0025) for a pilot set up before it existed.
grep -q '^RP_AUTH_PIN_ONLY=' "$STATE/server.env" || echo 'RP_AUTH_PIN_ONLY=1' >> "$STATE/server.env"

echo "== Restart relay, site, server with ngrok URLs"
for name in relay-host qr-site server; do
  [[ -f "$STATE/$name.pid" ]] && kill "$(cat "$STATE/$name.pid")" 2>/dev/null || true
done
sleep 2
docker start rp-pilot-pg >/dev/null 2>&1 || true

set -a
source "$STATE/relay-host.env"
set +a
nohup env RELAY_DB_URL="$RELAY_DB_URL" RELAY_JOBS_DB_URL="$RELAY_JOBS_DB_URL" \
  RELAY_PUBLIC_URL="$RELAY_PUBLIC_URL" RELAY_ALLOWED_ORIGINS="$RELAY_ALLOWED_ORIGINS" \
  RELAY_JWT_SECRET="$RELAY_JWT_SECRET" RELAY_REALTIME_API_KEY="$RELAY_REALTIME_API_KEY" \
  RELAY_PHOTOS_DIR="$RELAY_PHOTOS_DIR" RELAY_HOST="$RELAY_HOST" RELAY_PORT="$RELAY_PORT" \
  node "$ROOT/infra/supabase/dist/relay-host.mjs" >> "$STATE/logs/relay-host.log" 2>&1 &
echo $! > "$STATE/relay-host.pid"

nohup env RELAY_URL="$NGROK/functions/v1" NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production \
  "$ROOT/apps/qr-menu/node_modules/.bin/next" start "$ROOT/apps/qr-menu" -p 3100 -H 0.0.0.0 \
  >> "$STATE/logs/qr-site.log" 2>&1 &
echo $! > "$STATE/qr-site.pid"

set -a
source "$STATE/server.env"
set +a
nohup env NODE_ENV="$NODE_ENV" HOST="$HOST" PORT="$PORT" DATABASE_URL="$DATABASE_URL" \
  RP_DATA_DIR="$RP_DATA_DIR" RP_CONSOLE_DIR="$RP_CONSOLE_DIR" RP_RELAY_URL="$RP_RELAY_URL" \
  RP_QR_SITE_URL="$RP_QR_SITE_URL" RP_TLS="$RP_TLS" RP_TLS_HOSTNAMES="$RP_TLS_HOSTNAMES" \
  RP_MQTT="$RP_MQTT" RP_AUTH_PIN_ONLY="${RP_AUTH_PIN_ONLY:-off}" LOG_LEVEL="$LOG_LEVEL" \
  node "$ROOT/apps/server/dist/main.js" \
  >> "$STATE/logs/server.log" 2>&1 &
echo $! > "$STATE/server.pid"

sleep 8

echo "== Table tents for $NGROK"
PREVIOUS="$(cat "$STATE/tents-url.txt" 2>/dev/null || echo "the Wi-Fi address")"
(set -a; source "$STATE/server.env"; set +a
  node "$ROOT/apps/server/dist/database/pilot-cli.js" --tents-only --site "$NGROK" \
    --tents "$STATE/mannat-tents.pdf" 2>/dev/null | head -n 1)
echo "$NGROK" > "$STATE/tents-url.txt"

echo
echo "Public base URL: $NGROK"
echo "Relay health:    $(curl -s http://127.0.0.1:8787/healthz || echo down)"
echo
echo "Phone — open one table (use mobile data to test ngrok):"
TOKENS=$(grep -o '/t/[A-Za-z0-9_-]\+' "$STATE/mannat.txt" | sed 's|^/t/||')
i=1
for tok in $TOKENS; do
  echo "  Table $i  $NGROK/t/$tok"
  i=$((i + 1))
done
echo
echo "POS on this Mac: https://$(ipconfig getifaddr en0 2>/dev/null || echo 127.0.0.1):8080/pair  (Manager PIN 2222)"
echo
if [[ "$PREVIOUS" != "$NGROK" ]]; then
  echo "!! The address changed (was: $PREVIOUS). Tents printed before open the old address:"
fi
echo "Print the tents again: .pilot/mannat-tents.pdf (just rewritten), or on the POS"
echo "  Manage → QR codes → Download table tents (all), or Print on one table's row."
echo "Leave this Mac awake. Stop: scripts/pilot/mannat-local.sh stop; kill \$(cat .pilot/ngrok.pid) 2>/dev/null"
