#!/bin/sh
set -eu

NODE_BINARY=${NODE_BINARY:-node}
TLS_INSPECTOR_ENTRY=/opt/gcac/tls-inspector/src/index.js
GCAC_TOKEN_SECRET_FILE=${GCAC_TOKEN_SECRET_FILE:-/app/data/runtime/token-secret}

ensure_token_secret() {
  if [ -n "${GCAC_TOKEN_SECRET:-}" ]; then
    export GCAC_TOKEN_SECRET
    return 0
  fi

  if [ -s "$GCAC_TOKEN_SECRET_FILE" ]; then
    GCAC_TOKEN_SECRET=$(tr -d '\r\n' < "$GCAC_TOKEN_SECRET_FILE")
  fi

  if [ -z "${GCAC_TOKEN_SECRET:-}" ]; then
    token_secret_dir=$(dirname "$GCAC_TOKEN_SECRET_FILE")
    mkdir -p "$token_secret_dir"
    token_secret_tmp=$(mktemp "$token_secret_dir/.token-secret.XXXXXX")
    GCAC_TOKEN_SECRET=$(openssl rand -base64 48 | tr -d '\r\n')
    printf '%s' "$GCAC_TOKEN_SECRET" > "$token_secret_tmp"
    chmod 600 "$token_secret_tmp"
    mv "$token_secret_tmp" "$GCAC_TOKEN_SECRET_FILE"
  fi

  export GCAC_TOKEN_SECRET
}

if [ "${GCAC_DEPLOYMENT_ARCHITECTURE:-standard}" = small ]; then
  # Small deployments require only the KEK and public URL; the entrypoint generates and persists the remaining secrets.
  : "${GCAC_SECRET_KEK:?GCAC_SECRET_KEK is required}"
  : "${GCAC_PUBLIC_BASE_URL:?GCAC_PUBLIC_BASE_URL is required}"
  ensure_token_secret
fi

stopping=false
exit_code=0
tls_done=false
backend_done=false
shutdown_timer_pid=

start_child() {
  name=$1
  shift
  "$@" &
  pid=$!
  case "$name" in
    tls-inspector) tls_pid=$pid ;;
    backend) backend_pid=$pid ;;
  esac
}

request_shutdown() {
  next_exit_code=$1
  [ "$stopping" = true ] && return 0
  stopping=true
  exit_code=$next_exit_code
  kill -TERM "${tls_pid:-}" "${backend_pid:-}" 2>/dev/null || true
  (
    sleep 10
    kill -KILL "${tls_pid:-}" "${backend_pid:-}" 2>/dev/null || true
  ) &
  shutdown_timer_pid=$!
}

start_child tls-inspector "$NODE_BINARY" "$TLS_INSPECTOR_ENTRY"
start_child backend npm start

trap 'request_shutdown 0' INT TERM

while [ "$tls_done" = false ] || [ "$backend_done" = false ]; do
  if [ "$tls_done" = false ] && ! kill -0 "$tls_pid" 2>/dev/null; then
    tls_status=0
    wait "$tls_pid" || tls_status=$?
    tls_done=true
    if [ "$stopping" = false ]; then
      [ "$tls_status" -eq 0 ] && tls_status=1
      printf '[runtime] tls-inspector exited unexpectedly (code=%s)\n' "$tls_status" >&2
      request_shutdown "$tls_status"
    fi
  fi

  if [ "$backend_done" = false ] && ! kill -0 "$backend_pid" 2>/dev/null; then
    backend_status=0
    wait "$backend_pid" || backend_status=$?
    backend_done=true
    if [ "$stopping" = false ]; then
      [ "$backend_status" -eq 0 ] && backend_status=1
      printf '[runtime] backend exited unexpectedly (code=%s)\n' "$backend_status" >&2
      request_shutdown "$backend_status"
    fi
  fi

  [ "$tls_done" = true ] && [ "$backend_done" = true ] || sleep 1
done

[ -n "$shutdown_timer_pid" ] && kill "$shutdown_timer_pid" 2>/dev/null || true
exit "$exit_code"
