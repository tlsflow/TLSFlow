#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/web"

if [ ! -d node_modules ]; then
  echo "[web] node_modules 不存在，执行 npm install"
  npm install
fi

DOCS_DIR="$ROOT_DIR/docs/Documentation"
DOCS_PORT="${DOCS_DEV_PORT:-5173}"
if [ ! -d "$DOCS_DIR/node_modules" ]; then
  echo "[docs] node_modules 不存在，执行 npm install"
  npm --prefix "$DOCS_DIR" install
fi

echo "[docs] 启动 VitePress 实时文档服务：http://127.0.0.1:${DOCS_PORT}"
npm --prefix "$DOCS_DIR" run docs:dev -- --host 127.0.0.1 --port "$DOCS_PORT" --strictPort &
DOCS_PID=$!

cleanup() {
  kill "$DOCS_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[web] 启动 Vite 热重载服务：http://0.0.0.0:5172（/docs 代理到实时文档）"
VITE_DOCS_DEV_PORT="$DOCS_PORT" npm run dev
