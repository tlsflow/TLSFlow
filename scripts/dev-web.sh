#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/web"

if [ ! -d node_modules ]; then
  echo "[web] node_modules 不存在，执行 npm install"
  npm install
fi

echo "[web] 启动 Vite 热重载服务：http://0.0.0.0:5172"
exec npm run dev
