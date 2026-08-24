#!/usr/bin/env sh
set -eu

SERVICE_NAME="${SERVICE_NAME:-gcac-linux-agent}"
# Full Agent 需要像 Windows Service 的 LocalSystem 一样拥有替换自身制品和
# 控制服务生命周期的权限；普通任务仍通过 Agent v2 的受控动作执行。
SERVICE_USER="${SERVICE_USER:-root}"
SERVICE_GROUP="${SERVICE_GROUP:-root}"
DISPLAY_NAME="${DISPLAY_NAME:-GCAC Linux Go Full Agent}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/gcac/linux-agent}"
CONFIG_DIR="${CONFIG_DIR:-/etc/gcac/linux-agent}"
DATA_DIR="${DATA_DIR:-/var/lib/gcac/linux-agent}"
LOG_DIR="${LOG_DIR:-/var/log/gcac/linux-agent}"
START_AFTER_INSTALL="${START_AFTER_INSTALL:-false}"

CONFIG_PATH="${CONFIG_DIR}/agent.config.json"
METADATA_PATH="${CONFIG_DIR}/service.install.json"
UNIT_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
BUNDLE_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BINARY_SOURCE_PATH="${BUNDLE_DIR}/gcac-linux-agent"
BINARY_TARGET_PATH="${INSTALL_ROOT}/gcac-linux-agent"
UNIT_TEMPLATE_PATH="${BUNDLE_DIR}/linux/gcac-linux-agent.service"
UNIT_RENDER_PATH="${BUNDLE_DIR}/linux/${SERVICE_NAME}.service.rendered"
SUPPLEMENTARY_GROUPS=""
PUBLIC_KEY_FILE="${PUBLIC_KEY_FILE:-}"
SIGNATURE_FILE="${SIGNATURE_FILE:-${BINARY_SOURCE_PATH}.sig}"
SIGNATURE_VERIFIER="${SIGNATURE_VERIFIER:-}"

verify_signature() {
  if [ "${GCAC_SKIP_RELEASE_SIGNATURE_VERIFY:-}" = "bootstrap-fixed-bundle" ]; then
    echo "警告：本次通过控制面固定 bootstrap bundle 安装，跳过本地发布签名文件校验。"
    return
  fi
  [ -n "${PUBLIC_KEY_FILE}" ] || { echo "错误：systemd 安装必须提供发布公钥" >&2; exit 1; }
  [ -n "${SIGNATURE_FILE}" ] || { echo "错误：systemd 安装必须提供发布签名" >&2; exit 1; }
  SIGNATURE_VERIFIER="${SIGNATURE_VERIFIER}" "${BUNDLE_DIR}/release/verify-signature.sh" "${PUBLIC_KEY_FILE}" "${BINARY_SOURCE_PATH}" "${SIGNATURE_FILE}" || {
    echo "错误：Agent 发布签名验证失败，禁止安装或注册服务" >&2
    exit 1
  }
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

# 控制面 bundle 固定为 Linux x86_64；在远端启动前再次拒绝错误平台文件。
elf_magic=$(od -An -tx1 -N4 "${BINARY_SOURCE_PATH}" | tr -d '[:space:]')
elf_class=$(od -An -tu1 -j4 -N1 "${BINARY_SOURCE_PATH}" | tr -d '[:space:]')
elf_data=$(od -An -tu1 -j5 -N1 "${BINARY_SOURCE_PATH}" | tr -d '[:space:]')
elf_machine=$(od -An -tu2 -j18 -N2 "${BINARY_SOURCE_PATH}" | tr -d '[:space:]')
if [ "${elf_magic}" != "7f454c46" ] || [ "${elf_class}" != "2" ] || [ "${elf_data}" != "1" ] || [ "${elf_machine}" != "62" ]; then
  echo "错误：Linux Agent bundle 不是可执行的 Linux x86_64 ELF 文件，已拒绝安装。" >&2
  exit 1
fi

verify_signature

if ! getent group "${SERVICE_GROUP}" >/dev/null 2>&1; then
  groupadd --system "${SERVICE_GROUP}"
fi

if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --gid "${SERVICE_GROUP}" --home-dir "${DATA_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

install -d -m 0755 -o root -g root "${INSTALL_ROOT}"
install -d -m 0750 -o root -g "${SERVICE_GROUP}" "${CONFIG_DIR}"
install -d -m 0750 -o "${SERVICE_USER}" -g "${SERVICE_GROUP}" "${DATA_DIR}" "${LOG_DIR}"
install -m 0755 -o root -g root "${BINARY_SOURCE_PATH}" "${BINARY_TARGET_PATH}"
install -d -m 0755 -o root -g root "${INSTALL_ROOT}/linux" "${INSTALL_ROOT}/release"
install -m 0755 -o root -g root "${BUNDLE_DIR}/linux/upgrade.sh" "${INSTALL_ROOT}/linux/upgrade.sh"
install -m 0755 -o root -g root "${BUNDLE_DIR}/linux/rollback.sh" "${INSTALL_ROOT}/linux/rollback.sh"
install -m 0755 -o root -g root "${BUNDLE_DIR}/release/verify-signature.sh" "${INSTALL_ROOT}/release/verify-signature.sh"
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
