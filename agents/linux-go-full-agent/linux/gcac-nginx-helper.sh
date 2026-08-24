#!/usr/bin/env sh
set -eu

NGINX_BIN="${NGINX_BIN:-/usr/sbin/nginx}"
SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-/usr/bin/systemctl}"
NGINX_SERVICE="${NGINX_SERVICE:-nginx}"

fail() {
  echo "$1" >&2
  exit "${2:-1}"
}

require_absolute_path() {
  TARGET_PATH="$1"
  case "${TARGET_PATH}" in
    /*) ;;
    *)
      fail "target path must be absolute" 64
      ;;
  esac
  case "${TARGET_PATH}" in
    *".."*)
      fail "target path must not contain parent traversal" 64
      ;;
  esac
}

ensure_parent_dir() {
  TARGET_PATH="$1"
  PARENT_DIR=$(dirname -- "${TARGET_PATH}")
  [ -d "${PARENT_DIR}" ] || fail "target parent directory does not exist: ${PARENT_DIR}" 66
}

cmd_test() {
  exec "${NGINX_BIN}" -t
}

cmd_reload() {
  "${NGINX_BIN}" -t
  exec "${SYSTEMCTL_BIN}" reload "${NGINX_SERVICE}"
}

cmd_exists() {
  TARGET_PATH="$1"
  require_absolute_path "${TARGET_PATH}"
  if [ -e "${TARGET_PATH}" ]; then
    exit 0
  fi
  exit 1
}

cmd_read_file() {
  TARGET_PATH="$1"
  require_absolute_path "${TARGET_PATH}"
  exec cat -- "${TARGET_PATH}"
}

cmd_check_readable() {
  TARGET_PATH="$1"
  require_absolute_path "${TARGET_PATH}"
  [ -f "${TARGET_PATH}" ] || fail "target file does not exist: ${TARGET_PATH}" 66
  cat -- "${TARGET_PATH}" >/dev/null
}

cmd_check_writable() {
  TARGET_PATH="$1"
  require_absolute_path "${TARGET_PATH}"
  ensure_parent_dir "${TARGET_PATH}"
  [ ! -L "${TARGET_PATH}" ] || fail "symbolic link is not allowed: ${TARGET_PATH}" 65
  PARENT_DIR=$(dirname -- "${TARGET_PATH}")
  [ -w "${PARENT_DIR}" ] || fail "target parent directory is not writable: ${PARENT_DIR}" 77
}

cmd_write_file() {
  TARGET_PATH="$1"
  TARGET_MODE="$2"
  require_absolute_path "${TARGET_PATH}"
  ensure_parent_dir "${TARGET_PATH}"
  case "${TARGET_MODE}" in
    600|640|644)
      ;;
    *)
      fail "unsupported file mode: ${TARGET_MODE}" 64
      ;;
  esac
  PARENT_DIR=$(dirname -- "${TARGET_PATH}")
  TMP_FILE=$(mktemp "${PARENT_DIR}/.gcac-helper-XXXXXX")
  trap 'rm -f "${TMP_FILE}"' EXIT INT TERM
  cat > "${TMP_FILE}"
  chmod "${TARGET_MODE}" "${TMP_FILE}"
  mv -f "${TMP_FILE}" "${TARGET_PATH}"
  trap - EXIT INT TERM
}

cmd_remove_file() {
  TARGET_PATH="$1"
  require_absolute_path "${TARGET_PATH}"
  rm -f -- "${TARGET_PATH}"
}

ACTION="${1:-}"
case "${ACTION}" in
  test)
    shift
    [ "$#" -eq 0 ] || fail "test does not accept extra arguments" 64
    cmd_test
    ;;
  reload)
    shift
    [ "$#" -eq 0 ] || fail "reload does not accept extra arguments" 64
    cmd_reload
    ;;
  exists)
    shift
    [ "$#" -eq 1 ] || fail "exists requires <path>" 64
    cmd_exists "$1"
    ;;
  read-file)
    shift
    [ "$#" -eq 1 ] || fail "read-file requires <path>" 64
    cmd_read_file "$1"
    ;;
  check-readable)
    shift
    [ "$#" -eq 1 ] || fail "check-readable requires <path>" 64
    cmd_check_readable "$1"
    ;;
  check-writable)
    shift
    [ "$#" -eq 1 ] || fail "check-writable requires <path>" 64
    cmd_check_writable "$1"
    ;;
  write-file)
    shift
    [ "$#" -eq 2 ] || fail "write-file requires <path> <mode>" 64
    cmd_write_file "$1" "$2"
    ;;
  remove-file)
    shift
    [ "$#" -eq 1 ] || fail "remove-file requires <path>" 64
    cmd_remove_file "$1"
    ;;
  *)
    fail "usage: $0 {test|reload|exists|check-readable|check-writable|read-file|write-file|remove-file}" 64
    ;;
esac
