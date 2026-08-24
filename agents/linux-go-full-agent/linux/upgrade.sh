#!/usr/bin/env sh
set -eu

INSTALL_ROOT="${INSTALL_ROOT:-/opt/gcac/linux-agent}"
DATA_DIR="${DATA_DIR:-/var/lib/gcac/linux-agent}"
SERVICE_NAME="${SERVICE_NAME:-gcac-linux-agent}"
NEW_BINARY="${1:-}"
CHECKSUM_FILE="${2:-}"
CURRENT_BINARY="${INSTALL_ROOT}/gcac-linux-agent"
BACKUP_DIR="${DATA_DIR}/upgrades"
AUDIT_LOG="${DATA_DIR}/upgrade-audit.jsonl"

fail() {
  echo "错误：$*" >&2
  exit 1
}

[ "${GCAC_TEST_EUID:-$(id -u)}" = "0" ] || fail "升级需要 root 权限"
[ -f "${CURRENT_BINARY}" ] || fail "当前版本不存在：${CURRENT_BINARY}"
[ -f "${NEW_BINARY}" ] || fail "新版本不存在：${NEW_BINARY}"

if [ -n "${CHECKSUM_FILE}" ]; then
  [ -f "${CHECKSUM_FILE}" ] || fail "校验和文件不存在：${CHECKSUM_FILE}"
  expected=$(awk -v name="$(basename "${NEW_BINARY}")" '$2 == name || $2 == "*" name {print $1; exit}' "${CHECKSUM_FILE}")
  [ -n "${expected}" ] || fail "校验和文件未包含新版本"
  actual=$(sha256sum "${NEW_BINARY}" | awk '{print $1}')
  [ "${actual}" = "${expected}" ] || fail "新版本 SHA-256 校验失败"
fi

detect_service_manager() {
  if [ -d "${GCAC_SYSTEMD_RUNTIME_DIR:-/run/systemd/system}" ] && command -v systemctl >/dev/null 2>&1; then echo systemd; return; fi
  if command -v rc-service >/dev/null 2>&1; then echo openrc; return; fi
  if command -v service >/dev/null 2>&1; then echo sysv; return; fi
  fail "未发现受支持的服务管理能力"
}

service_action() {
  action="$1"
  case "${service_manager}" in
    systemd) systemctl "${action}" "${SERVICE_NAME}.service" ;;
    openrc) rc-service "${SERVICE_NAME}" "${action}" ;;
    sysv) service "${SERVICE_NAME}" "${action}" ;;
  esac
}

service_manager=$(detect_service_manager)
timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
mkdir -p "${BACKUP_DIR}"
backup_binary="${BACKUP_DIR}/gcac-linux-agent.${timestamp}"
cp -p "${CURRENT_BINARY}" "${backup_binary}"
printf '{"event":"upgrade_started","observedAt":"%s","backup":"%s"}\n' "${timestamp}" "${backup_binary}" >> "${AUDIT_LOG}"

service_action stop
temporary_binary="${INSTALL_ROOT}/.gcac-linux-agent.upgrade.$$"
install -m 0755 "${NEW_BINARY}" "${temporary_binary}"
mv -f "${temporary_binary}" "${CURRENT_BINARY}"

if service_action start && "${CURRENT_BINARY}" version >/dev/null 2>&1 && service_action status >/dev/null 2>&1; then
  printf '{"event":"upgrade_succeeded","observedAt":"%s","backup":"%s"}\n' "$(date -u '+%Y%m%dT%H%M%SZ')" "${backup_binary}" >> "${AUDIT_LOG}"
  printf '升级成功：backup=%s\n' "${backup_binary}"
  exit 0
fi

echo "新版本启动验证失败，开始自动回滚" >&2
service_action stop >/dev/null 2>&1 || true
install -m 0755 "${backup_binary}" "${temporary_binary}"
mv -f "${temporary_binary}" "${CURRENT_BINARY}"
service_action start
service_action status >/dev/null 2>&1 || fail "回滚后服务仍不可用，需要人工处理；backup=${backup_binary}"
printf '{"event":"upgrade_rolled_back","observedAt":"%s","backup":"%s"}\n' "$(date -u '+%Y%m%dT%H%M%SZ')" "${backup_binary}" >> "${AUDIT_LOG}"
fail "升级失败，已自动回滚到 ${backup_binary}"
