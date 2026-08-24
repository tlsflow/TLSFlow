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

# 同一工作区只允许一个后端监听者。旧会话已经在提供热重载时，当前脚本
# 直接复用它并退出，避免再创建一个永远抢不到端口的 tsx watcher。
existing_backend_listener_pid() {
  local pid
  local listener_cwd

  command -v lsof >/dev/null 2>&1 || return 0
  while read -r pid; do
    [ -n "$pid" ] || continue
    listener_cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    if [ "$listener_cwd" = "$ROOT_DIR/backend" ]; then
      printf '%s\n' "$pid"
      return 0
    fi
  done < <(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
}

if existing_listener_pid="$(existing_backend_listener_pid)" && [ -n "$existing_listener_pid" ]; then
  echo "[backend] 已有后端进程（PID ${existing_listener_pid}）监听 ${HOST}:${PORT}，复用现有热重载会话"
  exit 0
fi

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

# 直接启动 tsx watcher，避免再套一层 npm 后，组合启动脚本只杀掉 npm
# 而把 watcher 和实际后端进程遗留在后台，下一次启动就会抢占同一端口。
stop_process_tree() {
  local pid="$1"
  local child

  [ -n "$pid" ] || return 0
  while read -r child; do
    [ -n "$child" ] || continue
    stop_process_tree "$child"
  done < <(pgrep -P "$pid" 2>/dev/null || true)

  kill -TERM "$pid" 2>/dev/null || true
}

WATCH_PID=""
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [ -n "$WATCH_PID" ]; then
    stop_process_tree "$WATCH_PID"
    wait "$WATCH_PID" 2>/dev/null || true
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

./node_modules/.bin/tsx watch src/main.ts &
WATCH_PID=$!
wait "$WATCH_PID"
