#!/usr/bin/env sh
set -eu

SERVICE_NAME="${SERVICE_NAME:-gcac-gateway-agent}"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
CONFIG_DIR="${CONFIG_DIR:-/etc/gcac/gateway}"
DATA_DIR="${DATA_DIR:-/var/lib/gcac/gateway}"
LOG_DIR="${LOG_DIR:-/var/log/gcac/gateway}"

if [ "$(id -u)" -ne 0 ]; then
  echo "错误：卸载 systemd 服务需要 root 权限，请使用 sudo 执行。" >&2
  exit 1
fi

systemctl disable --now "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
rm -f "${UNIT_PATH}"
systemctl daemon-reload
systemctl reset-failed "${SERVICE_NAME}.service" >/dev/null 2>&1 || true

echo "已卸载 systemd 服务：${SERVICE_NAME}"
echo "默认保留配置、数据和日志目录："
echo "  配置目录：${CONFIG_DIR}"
echo "  数据目录：${DATA_DIR}"
echo "  日志目录：${LOG_DIR}"
echo "如需彻底清理，请确认后手工执行：sudo rm -rf '${CONFIG_DIR}' '${DATA_DIR}' '${LOG_DIR}'"
