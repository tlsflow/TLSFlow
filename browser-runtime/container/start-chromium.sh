#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:99
export HOME=/home/chromium
mkdir -p "$HOME/profile" "$HOME/.vnc"

Xvfb "$DISPLAY" -screen 0 "${SCREEN_SIZE:-1280x800x24}" -nolisten tcp &
fluxbox >/tmp/fluxbox.log 2>&1 &
x11vnc -display "$DISPLAY" -forever -shared -nopw -listen 0.0.0.0 -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc 6080 localhost:5900 >/tmp/novnc.log 2>&1 &

chromium \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/profile" \
  --no-first-run \
  --no-default-browser-check \
  --disable-dev-shm-usage \
  --disable-background-networking \
  --disable-features=TranslateUI \
  "${LOGIN_URL:-about:blank}"
