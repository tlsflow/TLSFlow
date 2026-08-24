#!/usr/bin/env sh
set -eu

ACTION="${1:-}"
SERVICE_NAME="${SERVICE_NAME:-gcac-linux-agent}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/gcac/linux-agent}"
CONFIG_DIR="${CONFIG_DIR:-/etc/gcac/linux-agent}"
CONFIG_PATH="${CONFIG_PATH:-${CONFIG_DIR}/agent.config.json}"
METADATA_PATH="${METADATA_PATH:-${CONFIG_DIR}/service.install.json}"
BINARY_PATH="${INSTALL_ROOT}/gcac-linux-agent"

if [ -z "${ACTION}" ]; then
  echo "用法：./service-control.sh {start|stop|restart|status|selfcheck|healthcheck|service-info}" >&2
  exit 1
fi

case "${ACTION}" in
  start)
    sudo systemctl start "${SERVICE_NAME}.service"
    sudo systemctl status "${SERVICE_NAME}.service" --no-pager
    ;;
  stop)
    sudo systemctl stop "${SERVICE_NAME}.service"
    sudo systemctl status "${SERVICE_NAME}.service" --no-pager || true
    ;;
  restart)
    sudo systemctl restart "${SERVICE_NAME}.service"
    sudo systemctl status "${SERVICE_NAME}.service" --no-pager
    ;;
  status)
    systemctl status "${SERVICE_NAME}.service" --no-pager
    ;;
  selfcheck)
    "${BINARY_PATH}" self-check --config="${CONFIG_PATH}"
    ;;
  healthcheck)
    "${BINARY_PATH}" health --config="${CONFIG_PATH}"
    ;;
  service-info)
    "${BINARY_PATH}" service-info --config="${CONFIG_PATH}" --metadata="${METADATA_PATH}"
    ;;
  *)
    echo "不支持的动作：${ACTION}" >&2
    exit 1
    ;;
esac
