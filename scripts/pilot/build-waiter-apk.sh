#!/usr/bin/env bash
# Builds the pilot's waiter app (APK) with this computer's restaurant PC built in, so phones connect
# by themselves: no pairing, no code (ADR-0025, Business Owner 2026-11-01). Run it after the pilot
# server is up (scripts/pilot/parosaa-local.sh start), and again whenever the Wi-Fi address changes.
#
#   scripts/pilot/build-waiter-apk.sh install-tools  # once: Java and Android's tools, in ~/Android
#   scripts/pilot/build-waiter-apk.sh                # the address the pilot remembers
#   scripts/pilot/build-waiter-apk.sh 192.168.1.20   # another address (comma-separate several)
#   scripts/pilot/build-waiter-apk.sh --discover     # no address: the app finds the PC on the
#                                                    # Wi-Fi (mDNS) or by its Connect QR (P9-27)
#   scripts/pilot/build-waiter-apk.sh install        # puts the built app on a phone by USB
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

install_on_phone() {
  [[ -f "$APK" ]] || { echo "Build the app first: scripts/pilot/build-waiter-apk.sh" >&2; exit 1; }
  if is_wsl; then
    # USB phones are attached to Windows, so this is Windows's adb, given a Windows path.
    local adb file
    adb="$(command -v adb.exe || true)"
    if [[ -z "$adb" ]]; then
      adb="$(wslpath "$(powershell.exe -NoProfile -Command '$env:LOCALAPPDATA' | tr -d '\r')")/Android/Sdk/platform-tools/adb.exe"
    fi
    if [[ ! -x "$adb" ]]; then
      echo "adb is not installed on Windows. Copy parosaa-waiter-preview.apk from your" >&2
      echo "Downloads folder to the phone (cable, Drive or WhatsApp), and tap it there." >&2
      exit 1
    fi
    file="$(windows_downloads)/parosaa-waiter-preview.apk"
    cp "$APK" "$file"
    "$adb" install -r "$(wslpath -w "$file")"
  else
    "$ANDROID_HOME/platform-tools/adb" install -r "$APK"
  fi
}

case "${1:-}" in
  install-tools) install_tools; exit 0 ;;
  install) install_on_phone; exit 0 ;;
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
  HOSTS="${1:-$(grep '^RP_TLS_HOSTNAMES=' "$STATE/server.env" | cut -d= -f2)}"
  IFS=',' read -ra NAMES <<<"$HOSTS"
  for name in "${NAMES[@]}"; do
    name="$(echo "$name" | tr -d ' ')"
    [ -z "$name" ] && continue
    SERVERS="${SERVERS:+$SERVERS,}https://$name:$PORT"
  done
  [ -z "$SERVERS" ] && { echo "No address: pass one, e.g. $0 192.168.1.20, or --discover"; exit 1; }
fi

# The certificate's fingerprint, read from the running server (public, not a secret).
CA="$(curl -sk "https://127.0.0.1:$PORT/api/v1/tls/ca" | node -e '
  let text = ""; process.stdin.on("data", (chunk) => (text += chunk));
  process.stdin.on("end", () => { try { process.stdout.write(JSON.parse(text).sha256); } catch {} });')"
[ -z "$CA" ] && { echo "The pilot server is not running on port $PORT. Run: scripts/pilot/parosaa-local.sh start"; exit 1; }

echo "== Restaurant PC built in: $SERVERS"
echo "== Certificate: $CA"
echo "== Building. The first time takes 20 minutes or more and downloads several GB."
cd "$ROOT/apps/waiter-app"
APP_ENV=preview RP_RESTAURANT_SERVERS="$SERVERS" RP_RESTAURANT_CA="$CA" pnpm prebuild >/dev/null
cd android
APP_ENV=preview NODE_ENV=production RP_RESTAURANT_SERVERS="$SERVERS" RP_RESTAURANT_CA="$CA" \
  ./gradlew assembleRelease -q
mkdir -p "$STATE/apk"
cp app/build/outputs/apk/release/app-release.apk "$APK"
echo "== Built: $APK"
if is_wsl; then
  DOWNLOADS="$(windows_downloads)"
  cp "$APK" "$DOWNLOADS/parosaa-waiter-preview.apk"
  echo "== Copied to your Windows Downloads folder: parosaa-waiter-preview.apk"
fi
