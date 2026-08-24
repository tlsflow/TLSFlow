#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

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

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  stop_process_tree "${BACKEND_PID:-}"
  stop_process_tree "${WEB_PID:-}"
  wait "${BACKEND_PID:-}" 2>/dev/null || true
  wait "${WEB_PID:-}" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

process_running() {
  local pid="$1"
  local state

  kill -0 "$pid" 2>/dev/null || return 1
  state="$(ps -o stat= -p "$pid" 2>/dev/null | tr -d ' ')"
  [ -n "$state" ] && [ "${state#Z}" = "$state" ]
}

"$ROOT_DIR/scripts/dev-backend.sh" "$@" &
BACKEND_PID=$!

"$ROOT_DIR/scripts/dev-web.sh" &
WEB_PID=$!

# macOS 自带 Bash 3.2 不支持等待任一子进程先退出的选项；轮询两个直接子进程，任一退出即进入清理。
while process_running "$BACKEND_PID" && process_running "$WEB_PID"; do
  sleep 0.2
done

if process_running "$BACKEND_PID"; then
  wait "$WEB_PID"
else
  wait "$BACKEND_PID"
fi
