#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[serve-static] cwd: $(pwd)"
if [[ ! -f index.html ]]; then
  echo "[serve-static] ERROR: index.html not found in $(pwd)"
  exit 1
fi

PORT="${1:-8000}"
echo "[serve-static] serving static site from $(pwd) on http://127.0.0.1:${PORT}/"
python3 -m http.server "$PORT"
