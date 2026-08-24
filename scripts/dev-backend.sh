#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/backend"

skip_plugin_check=false
retry_failed_migrations=false
for arg in "$@"; do
  case "$arg" in
    --skip-plugin-check)
      skip_plugin_check=true
      ;;
    --retry-failed-migrations)
      retry_failed_migrations=true
      ;;
    -h|--help)
      cat <<'EOF'
用法：./scripts/dev-backend.sh [选项]

选项：
  --skip-plugin-check  跳过内置插件版本和最终包指纹检查
  --retry-failed-migrations
                       按当前文件重试失败数据库迁移（仅处理 FAILED 记录）
  -h, --help          显示帮助信息
EOF
      exit 0
      ;;
    *)
      echo "[backend] 未知参数：$arg" >&2
      echo "[backend] 用法：./scripts/dev-backend.sh [选项]" >&2
      exit 2
      ;;
  esac
done

if [ ! -x node_modules/.bin/tsx ] && [ ! -f node_modules/.bin/tsx.cmd ]; then
  echo "[backend] 依赖未安装完整，执行 npm install"
  npm install
fi

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-3003}"
export API_PREFIX="${API_PREFIX:-/api/v1}"
if [ "$retry_failed_migrations" = true ]; then
  export GCAC_RETRY_FAILED_MIGRATIONS=1
else
  export GCAC_RETRY_FAILED_MIGRATIONS=0
fi

if [ "$skip_plugin_check" = true ]; then
  echo "[backend] 已跳过内置插件版本不可变规则检查"
else
  echo "[backend] 检查内置插件版本不可变规则"
  npm run check:builtin-plugin-versions
fi

if [ "$retry_failed_migrations" = true ]; then
  echo "[backend] 已启用失败迁移重试（按当前文件重试 FAILED 记录）"
fi

echo "[backend] 执行数据库迁移"
npm run migrate

echo "[backend] 启动热重载服务：http://${HOST}:${PORT}"
exec npm run dev
