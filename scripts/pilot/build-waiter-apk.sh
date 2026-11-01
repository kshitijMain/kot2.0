#!/usr/bin/env bash
# Builds the pilot's waiter app (APK) with this Mac's restaurant PC built in, so phones connect by
# themselves: no pairing, no code (ADR-0025, Business Owner 2026-11-01). Run it after the pilot
# server is up (scripts/pilot/mannat-ngrok.sh or mannat-local.sh), and again whenever the Mac's
# Wi-Fi address changes.
#
#   scripts/pilot/build-waiter-apk.sh            # the address in .pilot/server.env (RP_TLS_HOSTNAMES)
#   scripts/pilot/build-waiter-apk.sh 192.168.1.20   # another address (comma-separate several)
#
# The APK lands in .pilot/apk/parossa-waiter-preview.apk. To put it on a phone over USB:
#   ~/Library/Android/sdk/platform-tools/adb install -r .pilot/apk/parossa-waiter-preview.apk
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="$ROOT/.pilot"
export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

PORT="$(grep '^PORT=' "$STATE/server.env" | cut -d= -f2)"
HOSTS="${1:-$(grep '^RP_TLS_HOSTNAMES=' "$STATE/server.env" | cut -d= -f2)}"
SERVERS=""
IFS=',' read -ra NAMES <<<"$HOSTS"
for name in "${NAMES[@]}"; do
  name="$(echo "$name" | tr -d ' ')"
  [ -z "$name" ] && continue
  SERVERS="${SERVERS:+$SERVERS,}https://$name:$PORT"
done
[ -z "$SERVERS" ] && { echo "No address: pass one, e.g. $0 192.168.1.20"; exit 1; }

# The certificate's fingerprint, read from the running server (public, not a secret).
CA="$(curl -sk "https://127.0.0.1:$PORT/api/v1/tls/ca" | node -e '
  let text = ""; process.stdin.on("data", (chunk) => (text += chunk));
  process.stdin.on("end", () => process.stdout.write(JSON.parse(text).sha256));')"
[ -z "$CA" ] && { echo "The pilot server is not running on port $PORT: start it first."; exit 1; }

echo "== Restaurant PC built in: $SERVERS"
echo "== Certificate: $CA"
cd "$ROOT/apps/waiter-app"
APP_ENV=preview RP_RESTAURANT_SERVERS="$SERVERS" RP_RESTAURANT_CA="$CA" pnpm prebuild >/dev/null
cd android
APP_ENV=preview NODE_ENV=production RP_RESTAURANT_SERVERS="$SERVERS" RP_RESTAURANT_CA="$CA" \
  ./gradlew assembleRelease -q
mkdir -p "$STATE/apk"
cp app/build/outputs/apk/release/app-release.apk "$STATE/apk/parossa-waiter-preview.apk"
echo "== Built: $STATE/apk/parossa-waiter-preview.apk"
