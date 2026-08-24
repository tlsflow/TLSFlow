#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  if [ -n "${BACKEND_PID:-}" ]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
  if [ -n "${WEB_PID:-}" ]; then kill "$WEB_PID" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

"$ROOT_DIR/scripts/dev/dev-backend.sh" &
BACKEND_PID=$!

"$ROOT_DIR/scripts/dev/dev-web.sh" &
WEB_PID=$!

wait -n "$BACKEND_PID" "$WEB_PID"
