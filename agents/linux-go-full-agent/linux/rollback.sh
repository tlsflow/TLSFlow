#!/usr/bin/env sh
set -eu

INSTALL_ROOT="${INSTALL_ROOT:-/opt/gcac/linux-agent}"
DATA_DIR="${DATA_DIR:-/var/lib/gcac/linux-agent}"
SERVICE_NAME="${SERVICE_NAME:-gcac-linux-agent}"
BACKUP_BINARY="${1:-}"

[ "${GCAC_TEST_EUID:-$(id -u)}" = "0" ] || { echo "错误：回滚需要 root 权限" >&2; exit 1; }
if [ -z "${BACKUP_BINARY}" ]; then
  BACKUP_BINARY=$(find "${DATA_DIR}/upgrades" -maxdepth 1 -type f -name 'gcac-linux-agent.*' | sort | tail -n 1)
fi
[ -f "${BACKUP_BINARY}" ] || { echo "错误：未找到可用备份" >&2; exit 1; }

if ! printf '%s' "${SERVICE_NAME}" | grep -Eq '^[A-Za-z0-9_.@-]+$'; then
  echo "错误：服务名包含不允许的字符" >&2
  exit 1
fi

if [ -d "${GCAC_SYSTEMD_RUNTIME_DIR:-/run/systemd/system}" ] && command -v systemctl >/dev/null 2>&1; then
  service_manager="systemd"
elif command -v rc-service >/dev/null 2>&1; then
  service_manager="openrc"
elif command -v service >/dev/null 2>&1; then
  service_manager="service"
else
  echo "错误：未发现受支持的服务管理能力" >&2
  exit 1
fi

case "${service_manager}" in
  systemd) systemctl stop "${SERVICE_NAME}.service" || true ;;
  openrc) rc-service "${SERVICE_NAME}" stop || true ;;
  service) service "${SERVICE_NAME}" stop || true ;;
esac
temporary_binary="${INSTALL_ROOT}/.gcac-linux-agent.rollback.$$"
install -m 0755 "${BACKUP_BINARY}" "${temporary_binary}"
mv -f "${temporary_binary}" "${INSTALL_ROOT}/gcac-linux-agent"
case "${service_manager}" in
  systemd) systemctl start "${SERVICE_NAME}.service" ;;
  openrc) rc-service "${SERVICE_NAME}" start ;;
  service) service "${SERVICE_NAME}" start ;;
esac
"${INSTALL_ROOT}/gcac-linux-agent" version >/dev/null
printf '回滚完成：%s\n' "${BACKUP_BINARY}"
