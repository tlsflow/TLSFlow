#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/tls-inspector"

if [ ! -d node_modules ]; then
  echo "[tls-inspector] node_modules 不存在，执行 npm install"
  npm install
fi

export TLS_INSPECTOR_HOST="${TLS_INSPECTOR_HOST:-0.0.0.0}"
export TLS_INSPECTOR_PORT="${TLS_INSPECTOR_PORT:-8788}"
export TLS_INSPECTOR_DATA_DIR="${TLS_INSPECTOR_DATA_DIR:-$ROOT_DIR/data/tls-inspector}"
export TLS_INSPECTOR_SCAN_TIMEOUT_MS="${TLS_INSPECTOR_SCAN_TIMEOUT_MS:-20000}"
export TLS_INSPECTOR_SCHEDULER_INTERVAL_MS="${TLS_INSPECTOR_SCHEDULER_INTERVAL_MS:-30000}"

echo "[tls-inspector] 启动热重载服务：http://${TLS_INSPECTOR_HOST}:${TLS_INSPECTOR_PORT}"
exec npm run dev
