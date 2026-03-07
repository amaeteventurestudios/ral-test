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
echo "[serve-static] SPA fallback enabled: unknown routes -> /index.html"

python3 - "$PORT" <<'PY'
import os
import posixpath
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1])
ROOT = os.getcwd()

class SpaHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        path = path.split('?', 1)[0].split('#', 1)[0]
        path = posixpath.normpath(path)
        parts = [p for p in path.split('/') if p and p not in ('.', '..')]
        fs_path = ROOT
        for part in parts:
            fs_path = os.path.join(fs_path, part)
        return fs_path

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            for index in ('index.html', 'index.htm'):
                idx = os.path.join(path, index)
                if os.path.exists(idx):
                    path = idx
                    break
        if not os.path.exists(path):
            self.path = '/index.html'
        return super().send_head()

handler = partial(SpaHandler, directory=ROOT)
httpd = ThreadingHTTPServer(('0.0.0.0', PORT), handler)
print(f"Serving HTTP on 0.0.0.0 port {PORT} (http://0.0.0.0:{PORT}/) ...")
httpd.serve_forever()
PY
