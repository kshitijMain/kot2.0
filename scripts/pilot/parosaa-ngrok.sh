#!/usr/bin/env bash
# The Parosaa pilot over one ngrok URL, for diners on mobile data. The relay and the QR site go behind
# one public address; the KOT server stays on this computer.
#
#   scripts/pilot/parosaa-ngrok.sh install        # once: downloads ngrok into ~/.local/bin
#   scripts/pilot/parosaa-ngrok.sh token <token>  # once: your ngrok account's token
#   scripts/pilot/parosaa-ngrok.sh                # start, or the same as `start`
#   scripts/pilot/parosaa-ngrok.sh stop           # ends ngrok, puts the Wi-Fi addresses back
#
# The address and the printed table tents follow what ngrok gives: `parosaa-local.sh` asks ngrok for
# its address at every start, and rewrites .pilot/parosaa-tents.pdf when it changed (P9-07).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="${PILOT_STATE_DIR:-$ROOT/.pilot}"
LOCAL="$ROOT/scripts/pilot/parosaa-local.sh"
GATE=9080
NGROK_API=http://127.0.0.1:4040
export PATH="$HOME/.local/bin:$PATH"

public_url() {
  curl -s -m 2 "$NGROK_API/api/tunnels" 2>/dev/null | node -e '
    let text = ""; process.stdin.on("data", (chunk) => (text += chunk));
    process.stdin.on("end", () => {
      try {
        const tunnel = JSON.parse(text).tunnels.find((t) => t.config.addr.endsWith(":'"$GATE"'"));
        if (tunnel) process.stdout.write(tunnel.public_url);
      } catch {}
    });' 2>/dev/null || true
}

install_ngrok() {
  if [[ "$(uname -s)" == Darwin ]]; then
    echo "On a Mac: brew install ngrok"
    exit 1
  fi
  local arch=amd64
  [[ "$(uname -m)" == x86_64 ]] || arch=arm64
  mkdir -p "$HOME/.local/bin"
  echo "Downloading ngrok (about 10 MB)..."
  curl -fsSL "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-$arch.tgz" \
    | tar -xz -C "$HOME/.local/bin" ngrok
  echo "Installed: $(ngrok version)"
  echo "Next: scripts/pilot/parosaa-ngrok.sh token <your token>"
}

save_token() {
  [[ -n "${1:-}" ]] || {
    echo "Use: scripts/pilot/parosaa-ngrok.sh token <token>" >&2
    echo "Your token is at https://dashboard.ngrok.com/get-started/your-authtoken" >&2
    exit 1
  }
  command -v ngrok >/dev/null || { echo "Install ngrok first: scripts/pilot/parosaa-ngrok.sh install" >&2; exit 1; }
  ngrok config add-authtoken "$1"
}

start() {
  [[ -f "$STATE/parosaa.txt" ]] || { echo "Run scripts/pilot/parosaa-local.sh setup first." >&2; exit 1; }
  command -v ngrok >/dev/null || { echo "Install ngrok first: scripts/pilot/parosaa-ngrok.sh install" >&2; exit 1; }

  echo "== Gateway (relay and QR site together on port $GATE)"
  if [[ -f "$STATE/ngrok-gateway.pid" ]] && kill -0 "$(cat "$STATE/ngrok-gateway.pid")" 2>/dev/null; then
    echo "gateway already running"
  else
    nohup node "$ROOT/scripts/pilot/ngrok-gateway.mjs" >> "$STATE/logs/ngrok-gateway.log" 2>&1 &
    echo $! > "$STATE/ngrok-gateway.pid"
    sleep 1
  fi

  echo "== ngrok (the public address)"
  if pgrep -f "ngrok http $GATE" >/dev/null; then
    echo "ngrok already running"
  else
    nohup ngrok http "$GATE" --log=stdout > "$STATE/logs/ngrok-public.log" 2>&1 &
    echo $! > "$STATE/ngrok.pid"
  fi

  local url="" tries=0
  while [[ -z "$url" && $tries -lt 20 ]]; do
    sleep 1
    tries=$((tries + 1))
    url="$(public_url)"
  done
  if [[ -z "$url" ]]; then
    echo "ngrok did not start. What it said:" >&2
    tail -n 5 "$STATE/logs/ngrok-public.log" | cut -c1-300 >&2
    echo "If it mentions an authtoken: scripts/pilot/parosaa-ngrok.sh token <your token>" >&2
    exit 1
  fi
  echo "$url" > "$STATE/ngrok-url.txt"

  echo "== Restart the relay, the site and the server with this address"
  "$LOCAL" restart

  echo
  echo "Public address: $url"
  echo "On a phone, open a table (use mobile data):"
  "$LOCAL" links
}

case "${1:-start}" in
  start) start ;;
  stop) exec "$LOCAL" wifi ;;
  install) install_ngrok ;;
  token) save_token "${2:-}" ;;
  *) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
