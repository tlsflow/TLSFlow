#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/backend"

if [ ! -d node_modules ]; then
  echo "[backend] node_modules 不存在，执行 npm install"
  npm install
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3003}"
export API_PREFIX="${API_PREFIX:-/api/v1}"

echo "[backend] 启动热重载服务：http://${HOST}:${PORT}"
exec npm run dev
