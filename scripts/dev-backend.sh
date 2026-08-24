#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/backend"

if [ ! -x node_modules/.bin/tsx ] && [ ! -f node_modules/.bin/tsx.cmd ]; then
  echo "[backend] 依赖未安装完整，执行 npm install"
  npm install
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3003}"
export API_PREFIX="${API_PREFIX:-/api/v1}"

echo "[backend] 检查内置插件版本不可变规则"
npm run check:builtin-plugin-versions

echo "[backend] 执行数据库迁移"
npm run migrate

echo "[backend] 启动热重载服务：http://${HOST}:${PORT}"
exec npm run dev
