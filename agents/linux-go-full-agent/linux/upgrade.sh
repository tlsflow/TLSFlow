#!/usr/bin/env sh
set -eu

INSTALL_ROOT="${INSTALL_ROOT:-/opt/gcac/linux-agent}"
DATA_DIR="${DATA_DIR:-/var/lib/gcac/linux-agent}"
SERVICE_NAME="${SERVICE_NAME:-gcac-linux-agent}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NEW_BINARY="${1:-}"
CHECKSUM_FILE="${2:-}"
SIGNATURE_FILE="${3:-${SIGNATURE_FILE:-}}"
PUBLIC_KEY_FILE="${PUBLIC_KEY_FILE:-}"
CURRENT_BINARY="${INSTALL_ROOT}/gcac-linux-agent"
BACKUP_DIR="${DATA_DIR}/upgrades"
AUDIT_LOG="${DATA_DIR}/upgrade-audit.jsonl"
TRANSACTION_FILE="${BACKUP_DIR}/active-transaction"

fail() {
  echo "错误：$*" >&2
  exit 1
}

[ "${GCAC_TEST_EUID:-$(id -u)}" = "0" ] || fail "升级需要 root 权限"
[ -f "${CURRENT_BINARY}" ] || fail "当前版本不存在：${CURRENT_BINARY}"
[ -f "${NEW_BINARY}" ] || fail "新版本不存在：${NEW_BINARY}"

verify_signature() {
  [ -n "${PUBLIC_KEY_FILE}" ] && [ -n "${SIGNATURE_FILE}" ] || fail "PUBLIC_KEY_FILE 与 SIGNATURE_FILE 必须同时提供"
  "${SCRIPT_DIR}/../release/verify-signature.sh" "${PUBLIC_KEY_FILE}" "${NEW_BINARY}" "${SIGNATURE_FILE}" || fail "新版本发布签名验证失败"
}

read_version() {
  binary="$1"
  "${binary}" version 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1
}

major_version() {
  printf '%s' "$1" | sed -n 's/^v*\([0-9][0-9]*\).*/\1/p'
}

check_downgrade_boundary() {
  current_version=$(read_version "${CURRENT_BINARY}")
  new_version=$(read_version "${NEW_BINARY}")
  [ -n "${current_version}" ] && [ -n "${new_version}" ] || fail "无法读取当前或新版本信息"
  current_major=$(major_version "${current_version}")
  new_major=$(major_version "${new_version}")
  [ -n "${current_major}" ] && [ -n "${new_major}" ] || fail "版本号不符合语义版本格式"
  if [ "${new_major}" -lt "${current_major}" ] && [ "${ALLOW_MAJOR_DOWNGRADE:-0}" != "1" ]; then
    fail "禁止从 ${current_version} 降级到 ${new_version}；major 降级需要显式 ALLOW_MAJOR_DOWNGRADE=1"
  fi
}

write_transaction() {
  state="$1"
  mkdir -p "${BACKUP_DIR}"
  temporary="${TRANSACTION_FILE}.tmp.$$"
  printf 'state=%s\nbackup=%s\ncurrent=%s\n' \
    "${state}" "${backup_binary:-}" "${CURRENT_BINARY}" > "${temporary}"
  mv -f "${temporary}" "${TRANSACTION_FILE}"
}

transaction_value() {
  key="$1"
  sed -n "s/^${key}=//p" "${TRANSACTION_FILE}" | head -n 1
}

recover_interrupted_upgrade() {
  [ -f "${TRANSACTION_FILE}" ] || return 0
  state=$(transaction_value state)
  interrupted_backup=$(transaction_value backup)
  if [ "${state}" = "replaced" ] || [ "${state}" = "stopped" ]; then
    [ -f "${interrupted_backup}" ] || fail "发现中断升级但备份不存在：${interrupted_backup}"
    install -m 0755 "${interrupted_backup}" "${CURRENT_BINARY}.recovery.$$"
    mv -f "${CURRENT_BINARY}.recovery.$$" "${CURRENT_BINARY}"
    printf '{"event":"upgrade_power_loss_recovered","observedAt":"%s","backup":"%s"}\n' "$(date -u '+%Y%m%dT%H%M%SZ')" "${interrupted_backup}" >> "${AUDIT_LOG}"
  fi
  rm -f "${TRANSACTION_FILE}"
}

verify_signature
check_downgrade_boundary

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
mkdir -p "${BACKUP_DIR}"
recover_interrupted_upgrade
timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
backup_binary="${BACKUP_DIR}/gcac-linux-agent.${timestamp}"
cp -p "${CURRENT_BINARY}" "${backup_binary}"
write_transaction prepared
printf '{"event":"upgrade_started","observedAt":"%s","backup":"%s"}\n' "${timestamp}" "${backup_binary}" >> "${AUDIT_LOG}"

service_action stop
write_transaction stopped
temporary_binary="${INSTALL_ROOT}/.gcac-linux-agent.upgrade.$$"
install -m 0755 "${NEW_BINARY}" "${temporary_binary}"
mv -f "${temporary_binary}" "${CURRENT_BINARY}"
write_transaction replaced

if [ "${GCAC_TEST_INTERRUPT_AFTER_REPLACE:-0}" = "1" ]; then
  echo "模拟替换后二次启动恢复" >&2
  exit 75
fi

if service_action start && "${CURRENT_BINARY}" version >/dev/null 2>&1 && service_action status >/dev/null 2>&1; then
  write_transaction verified
  printf '{"event":"upgrade_succeeded","observedAt":"%s","backup":"%s"}\n' "$(date -u '+%Y%m%dT%H%M%SZ')" "${backup_binary}" >> "${AUDIT_LOG}"
  rm -f "${TRANSACTION_FILE}"
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
rm -f "${TRANSACTION_FILE}"
fail "升级失败，已自动回滚到 ${backup_binary}"
