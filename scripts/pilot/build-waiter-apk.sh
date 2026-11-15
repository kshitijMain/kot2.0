#!/usr/bin/env bash
# Builds the pilot's waiter app (APK) with this computer's restaurant PC built in, so phones connect
# by themselves: no pairing, no code (ADR-0025, Business Owner 2026-11-01). Run it after the pilot
# server is up (scripts/pilot/parosaa-local.sh start), and again whenever the Wi-Fi address changes.
#
#   scripts/pilot/build-waiter-apk.sh install-tools  # once: Java and Android's tools, in ~/Android
#   scripts/pilot/build-waiter-apk.sh                # the Wi-Fi address the pilot remembers (PILOT_IP)
#   scripts/pilot/build-waiter-apk.sh 192.168.1.20   # another address (comma-separate several)
#
# It refuses addresses no phone can reach (WSL's own 172.x, 127.x, localhost) and an address the
# server's certificate does not cover, saying what to do (round 3 of testing: the app could not
# connect because its certificate did not cover the Wi-Fi address).
#   scripts/pilot/build-waiter-apk.sh --discover     # no address: the app finds the PC on the
#                                                    # Wi-Fi (mDNS) or by its Connect QR (P9-27)
#   scripts/pilot/build-waiter-apk.sh install        # puts the built app on a phone by USB
#   scripts/pilot/build-waiter-apk.sh log            # saves the phone's log while the app connects
#
# The APK lands in .pilot/apk/parosaa-waiter-preview.apk and, on Windows with WSL, also in your
# Windows Downloads folder.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE="${PILOT_STATE_DIR:-$ROOT/.pilot}"
APK="$STATE/apk/parosaa-waiter-preview.apk"
TOOLS="$HOME/Android"
if [[ "$(uname -s)" == Darwin ]]; then
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
else
  export ANDROID_HOME="${ANDROID_HOME:-$TOOLS/Sdk}"
fi
if [[ -x "$TOOLS/jdk-17/bin/java" ]]; then
  export JAVA_HOME="$TOOLS/jdk-17"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

is_wsl() { grep -qi microsoft /proc/version 2>/dev/null; }

windows_downloads() {
  wslpath "$(powershell.exe -NoProfile -Command \
    "(New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path" | tr -d '\r')"
}

# A big download over a shaky connection: retries, and carries on from where it stopped.
download() {
  curl -fsSL --retry 8 --retry-all-errors --retry-delay 5 -C - -o "$1" "$2" || {
    echo "The download stopped (is the internet working?). Run the same command again:" >&2
    echo "it carries on from where it stopped." >&2
    exit 1
  }
}

install_tools() {
  [[ "$(uname -s)" != Darwin ]] || { echo "On a Mac, install Android Studio instead."; exit 1; }
  mkdir -p "$TOOLS"
  if [[ -x "$TOOLS/jdk-17/bin/java" ]]; then
    echo "Java 17 is here already."
  else
    echo "Downloading Java 17 (about 200 MB)..."
    download "$TOOLS/jdk.tar.gz" \
      "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
    # Unpacked aside and moved in whole, so a failed attempt never looks like an installed Java.
    rm -rf "${TOOLS:?}/jdk-17.tmp" "${TOOLS:?}/jdk-17"
    mkdir -p "$TOOLS/jdk-17.tmp"
    tar -xzf "$TOOLS/jdk.tar.gz" -C "$TOOLS/jdk-17.tmp" --strip-components=1
    mv "$TOOLS/jdk-17.tmp" "$TOOLS/jdk-17"
    rm -f "${TOOLS:?}/jdk.tar.gz"
  fi
  export JAVA_HOME="$TOOLS/jdk-17"
  export PATH="$JAVA_HOME/bin:$PATH"
  local latest="$ANDROID_HOME/cmdline-tools/latest"
  if [[ -x "$latest/bin/sdkmanager" ]]; then
    echo "Android's tools are here already."
  else
    echo "Downloading Android's tools (about 150 MB)..."
    mkdir -p "$ANDROID_HOME/cmdline-tools"
    download "$ANDROID_HOME/cmdline-tools/tools.zip" \
      https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
    python3 - "$ANDROID_HOME/cmdline-tools" <<'PY'
import os, sys, zipfile
folder = sys.argv[1]
with zipfile.ZipFile(os.path.join(folder, "tools.zip")) as archive:
    for info in archive.infolist():
        path = archive.extract(info, folder)
        mode = info.external_attr >> 16
        if mode:
            os.chmod(path, mode)
os.rename(os.path.join(folder, "cmdline-tools"), os.path.join(folder, "latest"))
os.remove(os.path.join(folder, "tools.zip"))
PY
  fi
  echo "Accepting Android's licences..."
  yes | "$latest/bin/sdkmanager" --licenses >/dev/null 2>&1 || true
  echo "Ready. Next: scripts/pilot/build-waiter-apk.sh"
}

# The adb that sees a USB phone: under WSL, Windows's (USB phones are attached to Windows).
phone_adb() {
  if is_wsl; then
    local adb
    adb="$(command -v adb.exe || true)"
    if [[ -z "$adb" ]]; then
      adb="$(wslpath "$(powershell.exe -NoProfile -Command '$env:LOCALAPPDATA' | tr -d '\r')")/Android/Sdk/platform-tools/adb.exe"
    fi
    if [[ ! -x "$adb" ]]; then
      echo "adb is not installed on Windows. Install Android's platform tools on Windows" >&2
      echo "(https://developer.android.com/tools/releases/platform-tools), or copy the app by hand." >&2
      exit 1
    fi
    echo "$adb"
  else
    echo "$ANDROID_HOME/platform-tools/adb"
  fi
}

install_on_phone() {
  [[ -f "$APK" ]] || { echo "Build the app first: scripts/pilot/build-waiter-apk.sh" >&2; exit 1; }
  local adb
  adb="$(phone_adb)"
  if is_wsl; then
    local file
    file="$(windows_downloads)/parosaa-waiter-preview.apk"
    cp "$APK" "$file"
    "$adb" install -r "$(wslpath -w "$file")"
  else
    "$adb" install -r "$APK"
  fi
}

# The phone's log while the app tries to connect (round 3 of testing): the exact error to send.
phone_log() {
  local adb out
  adb="$(phone_adb)"
  out="$STATE/apk/waiter-log.txt"
  mkdir -p "$STATE/apk"
  "$adb" get-state >/dev/null 2>&1 || { echo "No phone found: connect it by USB with USB debugging on." >&2; exit 1; }
  "$adb" logcat -c
  echo "Now open the app on the phone (or press Try again) and wait until it shows the error."
  read -r -p "Then press Enter here. " _
  "$adb" logcat -d -v time ReactNativeJS:V RpLanTrust:V OkHttp:V ExpoModulesCore:V AndroidRuntime:E '*:S' \
    | tr -d '\r' >"$out"
  echo "== The lines about the connection:"
  grep -iE "ERR_|SSL|certificate|hostname|refused|timeout|unreachable|could not|can.t reach" "$out" | tail -n 20 \
    || echo "(none: send the whole file)"
  if is_wsl; then
    cp "$out" "$(windows_downloads)/waiter-log.txt"
    echo "Saved to $out and to your Windows Downloads folder (waiter-log.txt). Send that file."
  else
    echo "Saved to $out. Send that file."
  fi
}

case "${1:-}" in
  install-tools) install_tools; exit 0 ;;
  install) install_on_phone; exit 0 ;;
  log) phone_log; exit 0 ;;
esac

[[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ]] || { echo "Node 24 is needed: nvm use 24" >&2; exit 1; }
command -v java >/dev/null || { echo "Java is missing. Run: scripts/pilot/build-waiter-apk.sh install-tools" >&2; exit 1; }
[[ -d "$ANDROID_HOME" ]] || { echo "Android's tools are missing. Run: scripts/pilot/build-waiter-apk.sh install-tools" >&2; exit 1; }
[[ -f "$STATE/server.env" ]] || { echo "Run scripts/pilot/parosaa-local.sh setup, then start, first." >&2; exit 1; }

PORT="$(grep '^PORT=' "$STATE/server.env" | cut -d= -f2)"
SERVERS=""
if [ "${1:-}" = "--discover" ]; then
  # P9-27: nothing built in but the PC's certificate fingerprint, so the app only accepts this PC.
  echo "== No address built in: the app finds the PC by itself"
else
  # The Wi-Fi address the pilot remembers (`parosaa-local.sh wifi`), never one read from WSL.
  REMEMBERED="${PILOT_IP:-$(cat "$STATE/pilot-ip" 2>/dev/null || grep '^RP_TLS_HOSTNAMES=' "$STATE/server.env" | cut -d= -f2)}"
  HOSTS="${1:-$REMEMBERED}"
  IFS=',' read -ra NAMES <<<"$HOSTS"
  for name in "${NAMES[@]}"; do
    name="$(echo "$name" | tr -d ' ')"
    [ -z "$name" ] && continue
    node "$ROOT/scripts/pilot/apk-checks.mjs" address "$name" || {
      echo "Not built: the app would try an address no phone can reach." >&2
      exit 1
    }
    SERVERS="${SERVERS:+$SERVERS,}https://$name:$PORT"
  done
  [ -z "$SERVERS" ] && { echo "No address: pass one, e.g. $0 192.168.1.20, or --discover"; exit 1; }
fi

# The certificate's fingerprint, read from the running server (public, not a secret).
CA="$(curl -sk "https://127.0.0.1:$PORT/api/v1/tls/ca" | node -e '
  let text = ""; process.stdin.on("data", (chunk) => (text += chunk));
  process.stdin.on("end", () => { try { process.stdout.write(JSON.parse(text).sha256); } catch {} });')"
[ -z "$CA" ] && { echo "The pilot server is not running on port $PORT. Run: scripts/pilot/parosaa-local.sh start"; exit 1; }

# Phones check the address against the certificate's names: one it does not cover fails on the
# phone with no clear error (Chrome only warns), so the app is not built for it.
NAMES_COVERED="$(echo | openssl s_client -connect "127.0.0.1:$PORT" 2>/dev/null |
  openssl x509 -noout -ext subjectAltName 2>/dev/null | tail -n +2)"
if [ "${1:-}" != "--discover" ]; then
  for name in "${NAMES[@]}"; do
    name="$(echo "$name" | tr -d ' ')"
    [ -z "$name" ] && continue
    node "$ROOT/scripts/pilot/apk-checks.mjs" covers "$NAMES_COVERED" "$name" || {
      echo "Not built: the server's certificate does not cover $name, so phones would refuse it." >&2
      echo "Remember the address and restart the server, which renews the certificate (the app's" >&2
      echo "fingerprint stays the same), then build again:" >&2
      echo "    scripts/pilot/parosaa-local.sh wifi $name" >&2
      exit 1
    }
  done
fi

echo "== Restaurant PC built in: $SERVERS"
echo "== Certificate: $CA"
echo "== Building. The first time takes 20 minutes or more and downloads several GB."
# The app bundles the shared packages' built output: rebuilt here so it never ships an old look.
cd "$ROOT"
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm turbo run build --filter='@rp/waiter-app^...' \
  --output-logs=errors-only
cd "$ROOT/apps/waiter-app"
APP_ENV=preview RP_RESTAURANT_SERVERS="$SERVERS" RP_RESTAURANT_CA="$CA" pnpm prebuild >/dev/null
cd android
APP_ENV=preview NODE_ENV=production RP_RESTAURANT_SERVERS="$SERVERS" RP_RESTAURANT_CA="$CA" \
  ./gradlew assembleRelease -q
mkdir -p "$STATE/apk"
cp app/build/outputs/apk/release/app-release.apk "$APK"
echo "== Built: $APK"
echo "== Built in: $(node "$ROOT/scripts/pilot/apk-checks.mjs" apk "$APK")"
if is_wsl; then
  DOWNLOADS="$(windows_downloads)"
  cp "$APK" "$DOWNLOADS/parosaa-waiter-preview.apk"
  echo "== Copied to your Windows Downloads folder: parosaa-waiter-preview.apk"
fi
