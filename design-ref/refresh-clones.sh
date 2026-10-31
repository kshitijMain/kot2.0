#!/usr/bin/env bash
# Pull latest default branch for each existing clone (shallow).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

find . -mindepth 2 -maxdepth 3 -type d -name .git | while read -r gitdir; do
  repo="$(dirname "$gitdir")"
  echo "fetch: $repo"
  (cd "$repo" && git fetch --depth 1 origin && git reset --hard "@{u}" 2>/dev/null || git pull --ff-only) || echo "FAILED: $repo"
done

echo "Refresh complete."
