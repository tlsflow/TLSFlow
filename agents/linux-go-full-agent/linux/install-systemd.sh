#!/usr/bin/env sh
set -eu

SERVICE_NAME="${SERVICE_NAME:-gcac-linux-agent}"
SERVICE_USER="${SERVICE_USER:-gcac-agent}"
SERVICE_GROUP="${SERVICE_GROUP:-gcac-agent}"
DISPLAY_NAME="${DISPLAY_NAME:-GCAC Linux Go Full Agent}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/gcac/linux-agent}"
CONFIG_DIR="${CONFIG_DIR:-/etc/gcac/linux-agent}"
DATA_DIR="${DATA_DIR:-/var/lib/gcac/linux-agent}"
LOG_DIR="${LOG_DIR:-/var/log/gcac/linux-agent}"
START_AFTER_INSTALL="${START_AFTER_INSTALL:-false}"
INSTALL_NGINX_SUDOERS="${INSTALL_NGINX_SUDOERS:-true}"
NGINX_SUDOERS_PATH="${NGINX_SUDOERS_PATH:-/etc/sudoers.d/gcac-nginx}"
NGINX_SERVICE_NAME="${NGINX_SERVICE_NAME:-nginx}"
NGINX_HELPER_INSTALL_PATH="${NGINX_HELPER_INSTALL_PATH:-/usr/local/libexec/gcac-nginx-helper}"

CONFIG_PATH="${CONFIG_DIR}/agent.config.json"
METADATA_PATH="${CONFIG_DIR}/service.install.json"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
BUNDLE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BINARY_SOURCE_PATH="${BUNDLE_DIR}/gcac-linux-agent"
BINARY_TARGET_PATH="${INSTALL_ROOT}/gcac-linux-agent"
HELPER_SOURCE_PATH="${BUNDLE_DIR}/linux/gcac-nginx-helper.sh"
UNIT_TEMPLATE_PATH="${BUNDLE_DIR}/linux/gcac-linux-agent.service"
UNIT_RENDER_PATH="${BUNDLE_DIR}/linux/${SERVICE_NAME}.service.rendered"
SUPPLEMENTARY_GROUPS=""

render_nginx_sudoers() {
  NGINX_BIN="$1"
  SYSTEMCTL_BIN="$2"
  HELPER_BIN="$3"
  cat <<EOF
# /etc/sudoers.d/gcac-nginx
Cmnd_Alias GCAC_NGINX_DIRECT = ${NGINX_BIN} -t, ${SYSTEMCTL_BIN} reload ${NGINX_SERVICE_NAME}
Cmnd_Alias GCAC_NGINX_HELPER = ${HELPER_BIN}
Defaults:${SERVICE_USER} !requiretty
${SERVICE_USER} ALL=(root) NOPASSWD: GCAC_NGINX_DIRECT
${SERVICE_USER} ALL=(root) NOPASSWD: GCAC_NGINX_HELPER
EOF
}

install_nginx_helper() {
  if [ ! -f "${HELPER_SOURCE_PATH}" ]; then
    echo "错误：bundle 中缺少 helper 脚本 ${HELPER_SOURCE_PATH}" >&2
    exit 1
  fi
  install -d -m 0755 -o root -g root "$(dirname -- "${NGINX_HELPER_INSTALL_PATH}")"
  install -m 0755 -o root -g root "${HELPER_SOURCE_PATH}" "${NGINX_HELPER_INSTALL_PATH}"
  echo "已自动安装 NGINX helper：${NGINX_HELPER_INSTALL_PATH}"
}

install_nginx_sudoers() {
  case "${INSTALL_NGINX_SUDOERS}" in
    true|TRUE|1|yes|YES)
      ;;
    *)
      echo "已跳过自动配置 NGINX sudoers：INSTALL_NGINX_SUDOERS=${INSTALL_NGINX_SUDOERS}"
      return 0
      ;;
  esac

  if ! command -v sudo >/dev/null 2>&1; then
    echo "警告：未检测到 sudo，跳过自动配置 NGINX sudoers。" >&2
    return 0
  fi
  if ! command -v visudo >/dev/null 2>&1; then
    echo "警告：未检测到 visudo，跳过自动配置 NGINX sudoers。" >&2
    return 0
  fi

  NGINX_BIN=$(command -v nginx 2>/dev/null || true)
  SYSTEMCTL_BIN=$(command -v systemctl 2>/dev/null || true)
  if [ -z "${NGINX_BIN}" ] || [ -z "${SYSTEMCTL_BIN}" ]; then
    echo "警告：未检测到 nginx 或 systemctl，跳过自动配置 NGINX sudoers。" >&2
    return 0
  fi

  TMP_SUDOERS=$(mktemp /tmp/gcac-nginx-sudoers-XXXXXX)
  render_nginx_sudoers "${NGINX_BIN}" "${SYSTEMCTL_BIN}" "${NGINX_HELPER_INSTALL_PATH}" > "${TMP_SUDOERS}"
  chmod 0440 "${TMP_SUDOERS}"
  if ! visudo -cf "${TMP_SUDOERS}" >/dev/null 2>&1; then
    rm -f "${TMP_SUDOERS}"
    echo "错误：自动生成的 NGINX sudoers 校验失败，已终止安装。" >&2
    exit 1
  fi
  install -m 0440 -o root -g root "${TMP_SUDOERS}" "${NGINX_SUDOERS_PATH}"
  rm -f "${TMP_SUDOERS}"
  echo "已自动安装 NGINX sudoers 白名单：${NGINX_SUDOERS_PATH}"
  echo "验证命令：sudo -u ${SERVICE_USER} sudo -n -- ${NGINX_BIN} -t"
  echo "验证命令：sudo -u ${SERVICE_USER} sudo -n -- ${SYSTEMCTL_BIN} reload ${NGINX_SERVICE_NAME}"
  echo "验证命令：sudo -u ${SERVICE_USER} sudo -n -- ${NGINX_HELPER_INSTALL_PATH} exists /etc/nginx/nginx.conf"
}

append_group() {
  GROUP_NAME="$1"
  if [ -z "${GROUP_NAME}" ]; then
    return 0
  fi
  case ",${SUPPLEMENTARY_GROUPS}," in
    *,"${GROUP_NAME}",*)
      return 0
      ;;
  esac
  if [ -n "${SUPPLEMENTARY_GROUPS}" ]; then
    SUPPLEMENTARY_GROUPS="${SUPPLEMENTARY_GROUPS},${GROUP_NAME}"
  else
    SUPPLEMENTARY_GROUPS="${GROUP_NAME}"
  fi
}

detect_tomcat_groups() {
  for candidate in /etc/tomcat/server.xml /etc/tomcat9/server.xml /etc/tomcat10/server.xml; do
    if [ ! -f "${candidate}" ]; then
      continue
    fi
    GROUP_NAME=$(stat -c "%G" "${candidate}" 2>/dev/null || true)
    case "${GROUP_NAME}" in
      ""|UNKNOWN|root)
        continue
        ;;
    esac
    if getent group "${GROUP_NAME}" >/dev/null 2>&1; then
      append_group "${GROUP_NAME}"
    fi
  done
}

if [ "$(id -u)" -ne 0 ]; then
  echo "错误：安装 systemd 服务需要 root 权限，请使用 sudo 执行。" >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "错误：当前系统缺少 systemctl，不支持这条自动安装路径。" >&2
  exit 1
fi

if [ ! -x "${BINARY_SOURCE_PATH}" ]; then
  echo "错误：bundle 中缺少可执行文件 ${BINARY_SOURCE_PATH}" >&2
  exit 1
fi

if ! getent group "${SERVICE_GROUP}" >/dev/null 2>&1; then
  groupadd --system "${SERVICE_GROUP}"
fi

if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --gid "${SERVICE_GROUP}" --home-dir "${DATA_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

detect_tomcat_groups
if [ -n "${SUPPLEMENTARY_GROUPS}" ]; then
  usermod -a -G "${SUPPLEMENTARY_GROUPS}" "${SERVICE_USER}"
  echo "已为服务账号追加附加组：${SUPPLEMENTARY_GROUPS}"
fi

install -d -m 0755 -o root -g root "${INSTALL_ROOT}"
install -d -m 0750 -o root -g "${SERVICE_GROUP}" "${CONFIG_DIR}"
install -d -m 0750 -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" "${DATA_DIR}" "${LOG_DIR}"
install -m 0755 -o root -g root "${BINARY_SOURCE_PATH}" "${BINARY_TARGET_PATH}"
install_nginx_helper
binary_version=$("${BINARY_TARGET_PATH}" version 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
binary_version="${binary_version:-unknown}"

if [ -f "${CONFIG_PATH}" ]; then
  BACKUP_PATH="${CONFIG_PATH}.bak.$(date -u +"%Y%m%dT%H%M%SZ")"
  cp "${CONFIG_PATH}" "${BACKUP_PATH}"
  chown root:"${SERVICE_GROUP}" "${BACKUP_PATH}"
  chmod 0640 "${BACKUP_PATH}"
  echo "已备份旧配置：${BACKUP_PATH}"
fi

install -m 0640 -o root -g "${SERVICE_GROUP}" "${BUNDLE_DIR}/config/agent.config.template.json" "${CONFIG_PATH}"
echo "已刷新配置文件：${CONFIG_PATH}"

cat > "${METADATA_PATH}" <<EOF
{
  "serviceName": "${SERVICE_NAME}",
  "displayName": "${DISPLAY_NAME}",
  "installRoot": "${INSTALL_ROOT}",
  "configPath": "${CONFIG_PATH}",
  "dataDir": "${DATA_DIR}",
  "logDir": "${LOG_DIR}",
  "binaryPath": "${BINARY_TARGET_PATH}",
  "binaryVersion": "${binary_version}",
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "mode": "linux-go-systemd"
}
EOF
chown root:"${SERVICE_GROUP}" "${METADATA_PATH}"
chmod 0640 "${METADATA_PATH}"

install_nginx_sudoers

sed \
  -e "s|__DISPLAY_NAME__|${DISPLAY_NAME}|g" \
  -e "s|__SERVICE_USER__|${SERVICE_USER}|g" \
  -e "s|__SERVICE_GROUP__|${SERVICE_GROUP}|g" \
  -e "s|__SUPPLEMENTARY_GROUPS__|${SUPPLEMENTARY_GROUPS}|g" \
  -e "s|__INSTALL_ROOT__|${INSTALL_ROOT}|g" \
  -e "s|__CONFIG_DIR__|${CONFIG_DIR}|g" \
  "${UNIT_TEMPLATE_PATH}" > "${UNIT_RENDER_PATH}"
if [ -z "${SUPPLEMENTARY_GROUPS}" ]; then
  sed -i '/^SupplementaryGroups=$/d' "${UNIT_RENDER_PATH}"
fi
install -m 0644 -o root -g root "${UNIT_RENDER_PATH}" "${UNIT_PATH}"
rm -f "${UNIT_RENDER_PATH}"

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"

if [ "${START_AFTER_INSTALL}" = "true" ]; then
  systemctl restart "${SERVICE_NAME}.service"
fi

echo "安装完成。"
echo "已安装版本：${binary_version}"
echo "自检命令：${BINARY_TARGET_PATH} self-check --config ${CONFIG_PATH}"
echo "健康检查：${BINARY_TARGET_PATH} health --config ${CONFIG_PATH}"
echo "服务信息：${BINARY_TARGET_PATH} service-info --config ${CONFIG_PATH} --metadata ${METADATA_PATH}"
if [ "${START_AFTER_INSTALL}" = "true" ]; then
  echo "服务已启动：systemctl status ${SERVICE_NAME}.service --no-pager"
else
  echo "启动命令：sudo systemctl start ${SERVICE_NAME}.service"
  echo "状态命令：systemctl status ${SERVICE_NAME}.service --no-pager"
fi
echo "卸载命令：sudo bash ./linux/uninstall-systemd.sh"
