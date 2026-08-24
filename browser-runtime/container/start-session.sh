#!/usr/bin/env bash
set -euo pipefail

umask 077

: "${SESSION_DIR:?SESSION_DIR is required}"
: "${DISPLAY_NUM:?DISPLAY_NUM is required}"
: "${CDP_PORT:?CDP_PORT is required}"
: "${RFB_PORT:?RFB_PORT is required}"

export DISPLAY=":${DISPLAY_NUM}"
export HOME="${SESSION_DIR}/home"
export XDG_CONFIG_HOME="${SESSION_DIR}/config"
export XDG_CACHE_HOME="${SESSION_DIR}/cache"

mkdir -p "${HOME}/profile" "${XDG_CONFIG_HOME}" "${XDG_CACHE_HOME}" "${SESSION_DIR}/logs"

pids=()

cleanup() {
  trap - EXIT TERM INT
  for pid in "${pids[@]:-}"; do
    kill "${pid}" >/dev/null 2>&1 || true
  done
  wait >/dev/null 2>&1 || true
}

trap cleanup EXIT TERM INT

Xvfb "${DISPLAY}" -screen 0 "${SCREEN_SIZE:-1280x800x24}" -nolisten tcp \
  >"${SESSION_DIR}/logs/xvfb.log" 2>&1 &
pids+=("$!")

sleep 0.2

fluxbox -display "${DISPLAY}" \
  >"${SESSION_DIR}/logs/fluxbox.log" 2>&1 &
pids+=("$!")

x11vnc -display "${DISPLAY}" -forever -shared -nopw -localhost -xrandr -rfbport "${RFB_PORT}" \
  >"${SESSION_DIR}/logs/x11vnc.log" 2>&1 &
pids+=("$!")

# Runtime 已通过非 root、只读根文件系统、能力丢弃和 no-new-privileges 隔离，
# Chromium 自带 sandbox 在该约束下无法初始化，因此显式关闭并固定会话目录。
"${CHROMIUM_EXECUTABLE:-chromium}" \
  --no-sandbox \
  --disable-gpu \
  --in-process-gpu \
  --use-gl=swiftshader \
  --disable-crash-reporter \
  --disable-features=TranslateUI,VizDisplayCompositor \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="${CDP_PORT}" \
  --user-data-dir="${HOME}/profile" \
  --no-first-run \
  --no-default-browser-check \
  --disable-dev-shm-usage \
  --disable-background-networking \
  --disable-component-update \
  --disable-default-apps \
  --disable-sync \
  --start-maximized \
  --metrics-recording-only \
  --password-store=basic \
  about:blank \
  >"${SESSION_DIR}/logs/chromium.log" 2>&1 &
chromium_pid="$!"
pids+=("${chromium_pid}")

wait "${chromium_pid}"
