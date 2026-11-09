#!/usr/bin/env bash
# The QR pilot (Mannat, P9-06, ADR-0024) on one computer (Windows with WSL, a Mac or Linux), for a
# test before the cloud server exists: PostgreSQL 16 (Docker), the QR relay host, the QR menu site
# and the KOT server, all reachable from phones on the same network.
#
#   scripts/pilot/mannat-local.sh setup    # once: databases, build, Mannat, its 5 QR codes, tents
#   scripts/pilot/mannat-local.sh start    # the relay, the site and the server, in the background
#   scripts/pilot/mannat-local.sh restart  # the same three again, with the current settings
#   scripts/pilot/mannat-local.sh status   # what is running, and the addresses
#   scripts/pilot/mannat-local.sh doctor   # checks everything a test needs, says what to fix
#   scripts/pilot/mannat-local.sh links    # each table's QR address as it is now
#   scripts/pilot/mannat-local.sh wifi     # back to Wi-Fi addresses: ends ngrok, follows a new address
#   scripts/pilot/mannat-local.sh printer virtual|folder|stop   # where prints go (remembered)
#   scripts/pilot/mannat-local.sh ports    # WSL: how to let phones reach this computer
#   scripts/pilot/mannat-local.sh stop     # everything, the database too
#   scripts/pilot/mannat-local.sh fresh    # DELETES orders/KOTs/approvals; keeps QR codes and devices
#   scripts/pilot/mannat-local.sh reset    # DELETES everything set up here
#
# Settings (environment): PILOT_IP (this computer's Wi-Fi address; `setup` and `wifi` remember it in
# .pilot/pilot-ip), PILOT_UPI_ID (the restaurant's business UPI ID; without it the bill has no Pay
# button). PILOT_STATE_DIR and PILOT_PG_CONTAINER give a second, throwaway copy. Secrets stay in
# .pilot/ (git-ignored). Needs Docker, Node 24 and pnpm (corepack).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="${PILOT_STATE_DIR:-$ROOT/.pilot}"
PG_PORT="${PILOT_PG_PORT:-55433}"
PG_CONTAINER="${PILOT_PG_CONTAINER:-rp-pilot-pg}"
RELAY_PORT=8787
SITE_PORT=3100
SERVER_PORT=8080
GATE_PORT=9080
PRINTER_PORT=9100
PRINTER_PAGE_PORT=9180
FORWARDED_PORTS="$SERVER_PORT $SITE_PORT $RELAY_PORT"
FIREWALL_RULE=KOT-pilot
SERVICES="relay-host qr-site server"

say_wrap() { printf '%s\n' "$@"; }
die() { say_wrap "$@" >&2; exit 1; }

is_wsl() { grep -qi microsoft /proc/version 2>/dev/null; }

# This computer's address on the network phones use. On WSL that is Windows's, not WSL's own.
windows_ip() {
  powershell.exe -NoProfile -Command '
    $routes = Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Sort-Object {
      $_.RouteMetric + (Get-NetIPInterface -InterfaceIndex $_.ifIndex -AddressFamily IPv4).InterfaceMetric
    }
    (Get-NetIPAddress -InterfaceIndex $routes[0].ifIndex -AddressFamily IPv4)[0].IPAddress
  ' 2>/dev/null | tr -d '\r' | head -n 1
}
detect_ip() {
  if is_wsl; then windows_ip; return; fi
  ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}'
}
remembered_ip() {
  if [[ -s "$STATE/pilot-ip" ]]; then cat "$STATE/pilot-ip"
  elif [[ -f "$STATE/server.env" ]]; then # a pilot set up before the address was remembered
    grep '^RP_TLS_HOSTNAMES=' "$STATE/server.env" | cut -d= -f2
  fi
}
wsl_ip() { hostname -I | tr ' ' '\n' | grep -v '^172\.17\.' | head -n 1; }

IP="${PILOT_IP:-$(remembered_ip)}"
[[ -n "$IP" ]] || IP="$(detect_ip)"

# The public address when ngrok is carrying this pilot now; nothing when it is not. Asked of ngrok
# each time, so a tunnel that died or a restart of the computer falls back to the Wi-Fi addresses.
ngrok_url() {
  curl -s -m 2 http://127.0.0.1:4040/api/tunnels 2>/dev/null | node -e '
    let text = ""; process.stdin.on("data", (chunk) => (text += chunk));
    process.stdin.on("end", () => {
      try {
        const tunnel = JSON.parse(text).tunnels.find((t) => t.config.addr.endsWith(":'"$GATE_PORT"'"));
        if (tunnel) process.stdout.write(tunnel.public_url);
      } catch {}
    });' 2>/dev/null || true
}

# SITE and RELAY: what the QR codes open and how the PC reaches the relay, for the current mode.
load_addresses() {
  [[ -n "$IP" ]] || die "This computer's Wi-Fi address could not be found." \
    "Run: scripts/pilot/mannat-local.sh wifi 192.168.x.y (with your address)."
  NGROK="$(ngrok_url)"
  if [[ -n "$NGROK" ]]; then
    SITE="$NGROK"
    RELAY_PUBLIC="$NGROK"
    RELAY_ORIGINS="$NGROK,http://$IP:$SITE_PORT" # a phone on the Wi-Fi link orders too (P9-16)
  else
    SITE="http://$IP:$SITE_PORT"
    RELAY_PUBLIC="http://$IP:$RELAY_PORT"
    RELAY_ORIGINS="$SITE"
  fi
  RELAY="$RELAY_PUBLIC/functions/v1"
}

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
# PIN-only sign-in (ADR-0025): browsers on this network pair themselves; staff use their PINs.
RP_AUTH_PIN_ONLY=1
# Backups with the database container's own PostgreSQL 16 tools (P9-24): none on the Mac.
RP_PG_BIN=$ROOT/scripts/pilot/pg-bin
RP_PG_CONTAINER=$PG_CONTAINER
LOG_LEVEL=info
EOF
  # TEST ONLY (P9-25): prints are saved in .pilot/printouts instead of printing. `printer virtual`
  # turns this off, so the server prints to the network printer set in Manage.
  if [[ "$(printer_mode)" == folder ]]; then echo "RP_PRINT_TO_FOLDER=$STATE/printouts"; fi
}

printer_mode() { cat "$STATE/printer-mode" 2>/dev/null || echo folder; }
set_line() { perl -pi -e "s|^$2=.*|$2=$3|" "$1"; }

# Both services' settings, written from what is remembered: this is the only place they are made.
write_settings() {
  load_addresses
  (umask 077; { echo "# Written by mannat-local.sh at every start: changes made here are lost."
    server_env; } > "$STATE/server.env")
  if [[ -f "$STATE/relay-host.env" ]]; then
    set_line "$STATE/relay-host.env" RELAY_PUBLIC_URL "$RELAY_PUBLIC"
    set_line "$STATE/relay-host.env" RELAY_ALLOWED_ORIGINS "$RELAY_ORIGINS"
  fi
}

# The QR site the pilot serves, built on its own (.next-pilot): `pnpm check` rebuilding .next for
# tests used to pull the files from under the running site, which then showed "This page couldn't
# load" (P9-23). Run it again after changing the site.
pilot_site_build() {
  (cd "$ROOT/apps/qr-menu" && NEXT_DIST_DIR=.next-pilot NEXT_TELEMETRY_DISABLED=1 \
    ./node_modules/.bin/next build >/dev/null)
}

need_setup() { [[ -f "$STATE/mannat.txt" ]] || die "Run setup first: scripts/pilot/mannat-local.sh setup"; }

need_docker() {
  docker info >/dev/null 2>&1 || die "Docker is not running." \
    "Open Docker Desktop and wait until it says it is running, or run: sudo service docker start" \
    "Then try again."
}

start_database() {
  need_docker
  docker start "$PG_CONTAINER" >/dev/null
  until docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
}

# Warns when the Wi-Fi handed this computer a new address since the pilot remembered it.
warn_if_address_moved() {
  [[ -z "${PILOT_IP:-}" ]] || return 0
  local now
  now="$(detect_ip)"
  if [[ -n "$now" && "$now" != "$IP" ]]; then
    say_wrap "" "WARNING: this computer's Wi-Fi address is now $now, but the pilot remembers $IP." \
      "Phones will not reach it until you run: scripts/pilot/mannat-local.sh wifi" ""
  fi
}

setup() {
  need_docker
  mkdir -p "$STATE/logs" "$STATE/server-data" "$STATE/photos"
  chmod 700 "$STATE"
  [[ -n "$IP" ]] || die "This computer's Wi-Fi address could not be found." \
    "Run again with it: PILOT_IP=192.168.x.y scripts/pilot/mannat-local.sh setup"
  echo "$IP" > "$STATE/pilot-ip"
  [[ -f "$STATE/pg-password" ]] || secret > "$STATE/pg-password"
  chmod 600 "$STATE/pg-password"
  # bash 3.2 (macOS) cannot source a process substitution: the server's settings go in a file.
  write_settings

  echo "== PostgreSQL 16 ($PG_CONTAINER on 127.0.0.1:$PG_PORT)"
  if ! docker container inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    docker run -d --name "$PG_CONTAINER" -e POSTGRES_PASSWORD="$(pg_password)" \
      -p "127.0.0.1:$PG_PORT:5432" -v "$PG_CONTAINER:/var/lib/postgresql/data" postgres:16 >/dev/null
  fi
  start_database
  for db in rp_mannat rp_relay; do
    docker exec "$PG_CONTAINER" psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" \
      | grep -q 1 || docker exec "$PG_CONTAINER" createdb -U postgres "$db"
  done

  echo "== Build (a few minutes)"
  cd "$ROOT"
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile >/dev/null
  COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm turbo run build \
    --filter=@rp/server... --filter=@rp/relay --filter=@rp/qr-menu... --filter=@rp/console... \
    --output-logs=errors-only
  pilot_site_build

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
    cat > "$STATE/relay-host.env" <<EOF2
RELAY_DB_URL=postgresql://relay_edge:$edge@127.0.0.1:$PG_PORT/rp_relay
RELAY_JOBS_DB_URL=postgresql://relay_janitor:$janitor@127.0.0.1:$PG_PORT/rp_relay
RELAY_PUBLIC_URL=$RELAY_PUBLIC
RELAY_ALLOWED_ORIGINS=$RELAY_ORIGINS
RELAY_JWT_SECRET=$(secret)
RELAY_REALTIME_API_KEY=$(secret)
RELAY_PHOTOS_DIR=$STATE/photos
RELAY_HOST=0.0.0.0
RELAY_PORT=$RELAY_PORT
EOF2
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
    echo "$SITE" > "$STATE/tents-url.txt"
    cat "$STATE/mannat.txt"

    echo "== Mannat at the relay, and the PC's credential"
    (set -a; source "$STATE/provision.env"; set +a
      node infra/supabase/scripts/provision-restaurant.mjs --name Mannat --label "Mannat PC") \
      | grep -E '^[A-Za-z0-9_-]{43,}$' > "$STATE/relay-credential.txt"
    chmod 600 "$STATE/relay-credential.txt"
    (set -a; source "$STATE/server.env"; set +a
      node apps/server/dist/relay/relay-cli.js credential < "$STATE/relay-credential.txt")
  fi
  warn_if_address_moved
  echo
  echo "Set up finished. Now: scripts/pilot/mannat-local.sh start"
  if is_wsl; then ports; fi
}

running() { [[ -f "$STATE/$1.pid" ]] && kill -0 "$(cat "$STATE/$1.pid")" 2>/dev/null; }
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
port_owner() {
  local pid
  pid="$(lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true)"
  if [[ -n "$pid" ]]; then ps -o args= -p "$pid" | cut -c1-70; else echo "a program this user cannot see"; fi
}

launch() {
  local name=$1; shift
  if running "$name"; then
    echo "$name is running already"; return
  fi
  nohup "$@" > "$STATE/logs/$name.log" 2>&1 &
  echo $! > "$STATE/$name.pid"
  echo "$name started (log: $STATE/logs/$name.log)"
}

stop_one() {
  local name=$1 pid tries=0
  [[ -f "$STATE/$name.pid" ]] || return 0
  pid="$(cat "$STATE/$name.pid")"
  if kill "$pid" 2>/dev/null; then
    while kill -0 "$pid" 2>/dev/null && (( tries < 40 )); do sleep 0.5; tries=$((tries + 1)); done
    kill -9 "$pid" 2>/dev/null || true
    echo "$name stopped"
  fi
  rm -f "${STATE:?}/${name:?}.pid"
}
stop_services() { local name; for name in server qr-site relay-host; do stop_one "$name"; done; }

stop_tunnel() {
  stop_one ngrok
  pkill -f "ngrok http $GATE_PORT" 2>/dev/null || true
  stop_one ngrok-gateway
}

# A port another program holds: said in plain words before anything starts and fails silently.
refuse_busy_port() {
  local name=$1 port=$2
  if running "$name"; then return 0; fi
  if ! port_busy "$port"; then return 0; fi
  die "Port $port is already in use, so $name cannot start." "It is held by: $(port_owner "$port")" \
    "If that is the development server, press Ctrl+C in its window, then try again."
}

launch_server() {
  launch server env $(grep -v "^#" "$STATE/server.env" | xargs) node "$ROOT/apps/server/dist/main.js"
}

wait_for_server() {
  local tries=0
  until curl -sk -m 2 -o /dev/null "https://127.0.0.1:$SERVER_PORT/"; do
    tries=$((tries + 1))
    if ! running server || (( tries > 60 )); then
      say_wrap "" "The KOT server did not start. The end of its log:" >&2
      tail -n 5 "$STATE/logs/server.log" | cut -c1-300 >&2
      exit 1
    fi
    sleep 1
  done
}

launch_printer() {
  refuse_busy_port virtual-printer "$PRINTER_PORT"
  refuse_busy_port virtual-printer "$PRINTER_PAGE_PORT"
  launch virtual-printer node "$ROOT/scripts/virtual-printer/virtual-printer.mjs"
}

# The printed tents and .pilot/mannat.txt hold the whole address: they follow it when it changes.
refresh_tents() {
  [[ "$(cat "$STATE/tents-url.txt" 2>/dev/null)" != "$SITE" ]] || return 0
  if (set -a; source "$STATE/server.env"; set +a
    node "$ROOT/apps/server/dist/database/pilot-cli.js" --tents-only --site "$SITE" \
      --tents "$STATE/mannat-tents.pdf" >/dev/null 2>&1); then
    perl -pi -e "s#\\S+/t/#$SITE/t/#" "$STATE/mannat.txt"
    echo "$SITE" > "$STATE/tents-url.txt"
    echo "The QR codes now open $SITE: print them again (.pilot/mannat-tents.pdf)."
  fi
}

start() {
  need_setup
  need_docker
  warn_if_address_moved
  refuse_busy_port server "$SERVER_PORT"
  refuse_busy_port qr-site "$SITE_PORT"
  refuse_busy_port relay-host "$RELAY_PORT"
  start_database
  cd "$ROOT"
  [[ -d "$ROOT/apps/qr-menu/.next-pilot" ]] || pilot_site_build
  write_settings
  launch relay-host env $(grep -v '^#' "$STATE/relay-host.env" | xargs) \
    node infra/supabase/dist/relay-host.mjs
  launch qr-site env RELAY_URL="$RELAY" NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production \
    NEXT_DIST_DIR=.next-pilot "$ROOT/apps/qr-menu/node_modules/.bin/next" start "$ROOT/apps/qr-menu" -p "$SITE_PORT" -H 0.0.0.0
  launch_server
  if [[ "$(printer_mode)" == virtual ]]; then launch_printer; fi
  wait_for_server
  sleep 2
  refresh_tents
  status
}

restart() {
  need_setup
  stop_services
  start
}

stop() {
  stop_services
  stop_one virtual-printer
  stop_tunnel
  if docker stop "$PG_CONTAINER" >/dev/null 2>&1; then echo "database stopped"; fi
  echo "Everything is stopped."
}

status() {
  load_addresses
  for name in $SERVICES; do
    if running "$name"; then echo "$name: running"; else echo "$name: stopped"; fi
  done
  echo "relay: $(curl -s -m 3 "http://127.0.0.1:$RELAY_PORT/healthz" || echo 'not answering')"
  if [[ -n "$NGROK" ]]; then echo "QR codes: through ngrok, $NGROK"; else echo "QR codes: Wi-Fi only"; fi
  if [[ "$(printer_mode)" == virtual ]]; then
    if running virtual-printer; then echo "printer: virtual printer, tickets at http://127.0.0.1:$PRINTER_PAGE_PORT"
    else echo "printer: virtual printer, switched off"; fi
  else
    echo "printer: saved in a folder, $STATE/printouts"
  fi
  cat <<EOF

QR menu site:      $SITE   (each table: scripts/pilot/mannat-local.sh links)
POS and dashboard: https://localhost:$SERVER_PORT on this computer
                   https://$IP:$SERVER_PORT from other devices on the Wi-Fi
The browser warns about the restaurant's own certificate. Tap a name, then the PIN.
EOF
}

links() {
  need_setup
  start_database
  load_addresses
  docker exec "$PG_CONTAINER" psql -U postgres -d rp_mannat -tA -F ' ' -c \
    "SELECT label, qr_token FROM tables WHERE archived_at IS NULL AND qr_token IS NOT NULL ORDER BY display_order, label" |
    while read -r label token; do
      if [[ -n "$token" ]]; then echo "Table $label: $SITE/t/$token"; fi
    done
}

# Back to Wi-Fi addresses: ends ngrok and its gateway, and follows the address the Wi-Fi gave.
wifi() {
  need_setup
  local address="${1:-${PILOT_IP:-$(detect_ip)}}"
  [[ "$address" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "\"$address\" is not an address like 192.168.1.20."
  stop_tunnel
  if [[ "$address" != "$IP" ]]; then echo "The Wi-Fi address changed: $IP is now $address."; fi
  IP="$address"
  echo "$IP" > "$STATE/pilot-ip"
  stop_services
  PILOT_IP="$IP" start
  if is_wsl; then ports; fi
}

printer() {
  need_setup
  local before
  before="$(printer_mode)"
  case "${1:-}" in
    virtual) echo virtual > "$STATE/printer-mode"; launch_printer
      echo "Tickets appear at http://127.0.0.1:$PRINTER_PAGE_PORT" ;;
    folder) echo folder > "$STATE/printer-mode"; stop_one virtual-printer
      echo "Prints are saved in $STATE/printouts" ;;
    stop) stop_one virtual-printer
      echo "The virtual printer is switched off, as if unplugged. Back on: printer virtual"
      return ;;
    *) die "Use: scripts/pilot/mannat-local.sh printer virtual|folder|stop" "It is now: $before" ;;
  esac
  if [[ "$(printer_mode)" == "$before" ]]; then return 0; fi
  if running server; then
    echo "Restarting the KOT server so it prints the new way..."
    stop_one server
    write_settings
    cd "$ROOT"
    launch_server
    wait_for_server
    echo "Done."
  else
    echo "It will apply the next time you start."
  fi
}

# WSL only: puts the port-forwarding script where Windows can run it, and says how.
ports() {
  is_wsl || { echo "Only needed on Windows with WSL."; return; }
  local home
  home="$(wslpath "$(powershell.exe -NoProfile -Command '[Environment]::GetFolderPath("UserProfile")' | tr -d '\r')")"
  sed "s/__WSL_DISTRO__/${WSL_DISTRO_NAME:-}/" "$ROOT/scripts/pilot/wsl-ports.ps1" > "$home/kot-ports.ps1"
  say_wrap "" "So phones can reach this computer: open PowerShell as Administrator and run" \
    "    powershell -ep bypass ~\\kot-ports.ps1" \
    "Run it again after every restart of Windows or change of Wi-Fi address."
}

doctor() {
  local problems=0 name port now wsl forwards
  heading() { printf '\n%s\n' "$1"; }
  ok() { printf '  OK   %s\n' "$1"; }
  fix() { printf '  FIX  %s\n' "$1"; shift; local line; for line in "$@"; do printf '       %s\n' "$line"; done
    problems=$((problems + 1)); }

  heading "Set-up"
  if ! [[ -f "$STATE/mannat.txt" ]]; then
    fix "The pilot is not set up." "Run: scripts/pilot/mannat-local.sh setup"
    printf '\nSet it up first, then run this again.\n'
    return 1
  fi
  ok "The test restaurant is set up"
  if [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 24 ]]; then
    ok "Node $(node -v)"
  else
    fix "Node 24 is needed, and this terminal has $(node -v 2>/dev/null || echo none)." "Run: nvm use 24"
  fi
  if [[ -f "$ROOT/apps/server/dist/main.js" && -d "$ROOT/apps/qr-menu/.next-pilot" ]]; then
    local built changed
    built="$(stat -c %Y "$ROOT/apps/console/dist/index.html" 2>/dev/null || stat -f %m "$ROOT/apps/console/dist/index.html")"
    changed="$(git -C "$ROOT" log -1 --format=%ct -- apps/server/src apps/console/src apps/qr-menu/src packages infra/supabase/src)"
    if (( changed > built )); then
      fix "The programs are older than the latest code, so you would test old screens." \
        "Run: scripts/pilot/mannat-local.sh setup (it keeps your test data)"
    else ok "The programs are built from the latest code"; fi
  else
    fix "The programs are not built." "Run: scripts/pilot/mannat-local.sh setup"
  fi

  heading "Docker and the database"
  if ! docker info >/dev/null 2>&1; then
    fix "Docker is not running." "Open Docker Desktop and wait, or run: sudo service docker start"
  elif docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    ok "Docker is running and the database answers"
  else
    fix "The database is stopped." "Run: scripts/pilot/mannat-local.sh start"
  fi

  heading "The Wi-Fi address"
  now="$(detect_ip)"
  if [[ -z "$now" ]]; then
    fix "This computer's network address could not be read. Is the Wi-Fi on?"
  elif [[ "$now" == "$IP" ]]; then
    ok "Still $IP"
  else
    fix "The Wi-Fi address is now $now, but the pilot remembers $IP." \
      "Run: scripts/pilot/mannat-local.sh wifi"
  fi

  if is_wsl; then
    heading "Windows letting phones in (port forwarding)"
    wsl="$(wsl_ip)"
    forwards="$(netsh.exe interface portproxy show v4tov4 2>/dev/null | tr -d '\r')"
    local missing=""
    for port in $FORWARDED_PORTS; do
      echo "$forwards" | grep -Eq "^ *${now//./\\.} +$port +${wsl//./\\.} +$port *$" || missing="$missing $port"
    done
    if [[ -z "$missing" ]]; then
      ok "Ports $FORWARDED_PORTS go from $now to WSL ($wsl)"
    else
      fix "Port forwarding is missing or out of date for port(s):$missing." \
        "This is normal after a restart. In PowerShell as Administrator run:" \
        "    powershell -ep bypass ~\\kot-ports.ps1" \
        "(If that file is not found, first run: scripts/pilot/mannat-local.sh ports)"
    fi
    if netsh.exe advfirewall firewall show rule name="$FIREWALL_RULE" >/dev/null 2>&1; then
      ok "The Windows firewall lets phones in"
    else
      fix "The Windows firewall rule is missing." \
        "The same PowerShell command as above adds it."
    fi
  fi

  heading "Ports and programs"
  for name in "server $SERVER_PORT" "qr-site $SITE_PORT" "relay-host $RELAY_PORT"; do
    set -- $name
    if running "$1"; then
      if port_busy "$2"; then ok "$1 is running on port $2"
      else fix "$1 is running but does not answer on port $2 yet." "Wait a minute. If it stays: scripts/pilot/mannat-local.sh restart"; fi
    elif port_busy "$2"; then
      fix "Another program holds port $2, so $1 cannot start: $(port_owner "$2")" \
        "If it is the development server, press Ctrl+C in its window."
    else
      fix "$1 is not running (port $2 is free)." "Run: scripts/pilot/mannat-local.sh start"
    fi
  done

  heading "The QR relay"
  local health
  health="$(curl -s -m 3 "http://127.0.0.1:$RELAY_PORT/healthz" || true)"
  if [[ "$health" != *'"ok":true'* ]]; then
    fix "The relay does not answer." "Run: scripts/pilot/mannat-local.sh restart"
  elif [[ "$health" == *'"restaurantsOnLine":0'* ]]; then
    fix "The relay answers, but the laptop's line to it is not open yet." \
      "Wait a minute and run this again. If it stays, check the port forwarding above, then restart."
  else
    ok "The relay answers and the laptop's line to it is open"
  fi

  heading "QR ordering"
  load_addresses
  if [[ -n "$NGROK" ]]; then
    if port_busy "$GATE_PORT"; then ok "The gateway is running on port $GATE_PORT"
    else fix "ngrok is on but its gateway is not." "Run: scripts/pilot/mannat-ngrok.sh"; fi
    if curl -s -m 10 "$NGROK/healthz" | grep -q '"ok":true'; then ok "ngrok reaches this computer: $NGROK"
    else fix "ngrok is on, but its public address does not reach this computer." "Run: scripts/pilot/mannat-ngrok.sh"; fi
  else
    ok "Wi-Fi only (ngrok is off). For diners on mobile data run: scripts/pilot/mannat-ngrok.sh"
  fi

  heading "Printing"
  if [[ "$(printer_mode)" == virtual ]]; then
    if running virtual-printer; then ok "Virtual printer on, tickets at http://127.0.0.1:$PRINTER_PAGE_PORT"
    else fix "The virtual printer is off." "Run: scripts/pilot/mannat-local.sh printer virtual"; fi
  else
    ok "Prints are saved in the folder $STATE/printouts"
  fi

  echo
  if (( problems == 0 )); then echo "All good: nothing to fix."; return 0; fi
  echo "$problems thing(s) to fix: see the FIX lines above."
  return 1
}

reset() {
  stop
  docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$PG_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "${STATE:?}"
  echo "Everything set up here is gone."
}

fresh() {
  [[ -f "$STATE/server.env" ]] || die "Run setup first."
  stop_services
  start_database
  echo "== Clear relay QR queues and table bills"
  psql_in rp_relay < "$ROOT/scripts/pilot/mannat-fresh-relay.sql"
  echo "== Clear KOT server orders, kitchen, approvals, open tables"
  psql_in rp_mannat < "$ROOT/scripts/pilot/mannat-fresh-mannat.sql"
  start
  echo
  echo "Service data cleared. Same table QR codes (.pilot/mannat.txt) and devices remain."
  echo "On each phone: close the QR tab or clear site data for $SITE so cart and phone cache reset."
}

case "${1:-}" in
  setup) setup ;;
  start) start ;;
  restart) restart ;;
  stop) stop ;;
  status) status ;;
  doctor) doctor ;;
  links) links ;;
  wifi) wifi "${2:-}" ;;
  printer) printer "${2:-}" ;;
  ports) ports ;;
  reset) reset ;;
  fresh) fresh ;;
  *) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
