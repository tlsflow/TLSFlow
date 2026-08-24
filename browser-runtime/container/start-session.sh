#!/usr/bin/env bash
set -euo pipefail

umask 077

: "${SESSION_DIR:?SESSION_DIR is required}"
: "${DISPLAY_NUM:?DISPLAY_NUM is required}"
: "${CDP_PORT:?CDP_PORT is required}"
: "${RFB_PORT:?RFB_PORT is required}"
: "${VNC_PORT:?VNC_PORT is required}"

export DISPLAY=":${DISPLAY_NUM}"
export HOME="${SESSION_DIR}/home"

mkdir -p "${HOME}/profile" "${SESSION_DIR}/logs"

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

x11vnc -display "${DISPLAY}" -forever -shared -nopw -localhost -rfbport "${RFB_PORT}" \
  >"${SESSION_DIR}/logs/x11vnc.log" 2>&1 &
pids+=("$!")

websockify --web=/usr/share/novnc "${VNC_PORT}" "127.0.0.1:${RFB_PORT}" \
  >"${SESSION_DIR}/logs/novnc.log" 2>&1 &
pids+=("$!")

"${CHROMIUM_EXECUTABLE:-chromium}" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="${CDP_PORT}" \
  --user-data-dir="${HOME}/profile" \
  --no-first-run \
  --no-default-browser-check \
  --disable-dev-shm-usage \
  --disable-background-networking \
  --disable-component-update \
  --disable-default-apps \
  --disable-features=TranslateUI \
  --disable-sync \
  --metrics-recording-only \
  --password-store=basic \
  about:blank \
  >"${SESSION_DIR}/logs/chromium.log" 2>&1 &
chromium_pid="$!"
pids+=("${chromium_pid}")

wait "${chromium_pid}"
