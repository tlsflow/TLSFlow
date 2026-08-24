#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AGENT_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
SOURCE_BINARY="${SOURCE_BINARY:-${AGENT_DIR}/gcac-linux-agent}"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/gcac/linux-agent}"
CONFIG_DIR="${CONFIG_DIR:-/etc/gcac/linux-agent}"
DATA_DIR="${DATA_DIR:-/var/lib/gcac/linux-agent}"
LOG_DIR="${LOG_DIR:-/var/log/gcac/linux-agent}"
SERVICE_NAME="${SERVICE_NAME:-gcac-linux-agent}"
METADATA_PATH="${CONFIG_DIR}/service.install.json"
PRECHECK_ONLY=0
SIGNATURE_FILE="${SIGNATURE_FILE:-}"
PUBLIC_KEY_FILE="${PUBLIC_KEY_FILE:-}"

if [ "${1:-}" = "--preflight-only" ]; then
  PRECHECK_ONLY=1
fi

fail() {
  echo "错误：$*" >&2
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

detect_arch() {
  machine="${GCAC_TEST_MACHINE:-$(uname -m)}"
  case "${machine}" in
    x86_64|amd64) echo amd64 ;;
    aarch64|arm64) echo arm64 ;;
    *) fail "不支持的 CPU 架构：${machine}" ;;
  esac
}

version_at_least() {
  current="$1"
  minimum="$2"
  first=$(printf '%s\n%s\n' "${minimum}" "${current}" | sort -V | head -n 1)
  [ "${first}" = "${minimum}" ]
}

detect_service_manager() {
  if [ -d "${GCAC_SYSTEMD_RUNTIME_DIR:-/run/systemd/system}" ] && command_exists systemctl; then
    echo systemd
    return
  fi
  if command_exists rc-service && command_exists rc-update; then
    echo openrc
    return
  fi
  if [ -d "${GCAC_INIT_DIR:-/etc/init.d}" ] && command_exists service; then
    echo sysv
    return
  fi
  fail "未发现受支持的服务管理能力"
}

check_root() {
  effective_uid="${GCAC_TEST_EUID:-$(id -u)}"
  [ "${effective_uid}" = "0" ] || fail "安装需要 root 权限，请通过受控 sudo/doas 执行"
}

check_space() {
  required_kb="${REQUIRED_SPACE_KB:-32768}"
  probe_path=$(dirname "${INSTALL_ROOT}")
  while [ ! -e "${probe_path}" ] && [ "${probe_path}" != "/" ]; do
    probe_path=$(dirname "${probe_path}")
  done
  available_kb=$(df -Pk "${probe_path}" | awk 'NR==2 {print $4}')
  [ -n "${available_kb}" ] || fail "无法读取磁盘空间"
  [ "${available_kb}" -ge "${required_kb}" ] || fail "磁盘空间不足：需要 ${required_kb}KB，可用 ${available_kb}KB"
}

check_conflicts() {
  conflict_count=0
  for path in "/usr/local/bin/gcac-linux-agent" "/usr/bin/gcac-linux-agent"; do
    if [ -e "${path}" ] && [ "${path}" != "${INSTALL_ROOT}/gcac-linux-agent" ]; then
      conflict_count=$((conflict_count + 1))
    fi
  done
  [ "${conflict_count}" -eq 0 ] || fail "发现冲突安装，请先清理旧路径"
}

check_binary_arch() {
  command_exists file || fail "安装前检查需要 file 命令"
  description=$(file -b "${SOURCE_BINARY}")
  case "${arch}" in
    amd64)
      echo "${description}" | grep -Eiq 'x86-64|x86_64|amd64' || fail "二进制架构与目标 amd64 不匹配"
      ;;
    arm64)
      echo "${description}" | grep -Eiq 'aarch64|arm64' || fail "二进制架构与目标 arm64 不匹配"
      ;;
  esac
}

verify_signature() {
  if [ -z "${PUBLIC_KEY_FILE}" ] && [ -z "${SIGNATURE_FILE}" ]; then
    [ "${ALLOW_UNSIGNED_INSTALL:-0}" = "1" ] || fail "安装需要 Ed25519 发布签名；测试或受控离线场景可显式设置 ALLOW_UNSIGNED_INSTALL=1"
    return
  fi
  [ -n "${PUBLIC_KEY_FILE}" ] && [ -n "${SIGNATURE_FILE}" ] || fail "PUBLIC_KEY_FILE 与 SIGNATURE_FILE 必须同时提供"
  "${AGENT_DIR}/release/verify-signature.sh" "${PUBLIC_KEY_FILE}" "${SOURCE_BINARY}" "${SIGNATURE_FILE}" || fail "Agent 发布签名验证失败"
}

preflight() {
  [ "${GCAC_TEST_UNAME_S:-$(uname -s)}" = "Linux" ] || fail "安装器仅支持 Linux"
  arch=$(detect_arch)
  kernel="${GCAC_TEST_KERNEL:-$(uname -r | cut -d- -f1)}"
  version_at_least "${kernel}" "3.2" || fail "Kernel ${kernel} 低于最低基线 3.2"
  [ -f "${SOURCE_BINARY}" ] || fail "找不到 Agent 二进制：${SOURCE_BINARY}"
  [ -r "${SOURCE_BINARY}" ] || fail "Agent 二进制不可读：${SOURCE_BINARY}"
  verify_signature
  check_binary_arch
  check_root
  check_space
  check_conflicts
  service_manager=$(detect_service_manager)
  printf '预检通过：arch=%s kernel=%s serviceManager=%s installRoot=%s\n' "${arch}" "${kernel}" "${service_manager}" "${INSTALL_ROOT}"
}

install_service() {
  case "${service_manager}" in
    systemd)
      install -m 0644 "${SCRIPT_DIR}/gcac-linux-agent.service" "/etc/systemd/system/${SERVICE_NAME}.service"
      systemctl daemon-reload
      systemctl enable "${SERVICE_NAME}.service"
      ;;
    openrc)
      install -m 0755 "${SCRIPT_DIR}/gcac-linux-agent.openrc" "/etc/init.d/${SERVICE_NAME}"
      rc-update add "${SERVICE_NAME}" default
      ;;
    sysv)
      command_exists start-stop-daemon || fail "SysV 安装需要 start-stop-daemon"
      install -m 0755 "${SCRIPT_DIR}/gcac-linux-agent.sysv" "/etc/init.d/${SERVICE_NAME}"
      if command_exists update-rc.d; then
        update-rc.d "${SERVICE_NAME}" defaults
      elif command_exists chkconfig; then
        chkconfig --add "${SERVICE_NAME}"
      else
        fail "未发现 SysV 服务注册工具"
      fi
      ;;
  esac
}

preflight
[ "${PRECHECK_ONLY}" -eq 1 ] && exit 0

install -d -m 0755 "${INSTALL_ROOT}" "${CONFIG_DIR}" "${DATA_DIR}" "${LOG_DIR}"
temporary_binary="${INSTALL_ROOT}/.gcac-linux-agent.new.$$"
install -m 0755 "${SOURCE_BINARY}" "${temporary_binary}"
mv -f "${temporary_binary}" "${INSTALL_ROOT}/gcac-linux-agent"
binary_version=$("${INSTALL_ROOT}/gcac-linux-agent" version 2>/dev/null | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
binary_version="${binary_version:-unknown}"
if [ ! -e "${CONFIG_DIR}/agent.config.json" ]; then
  install -m 0600 "${AGENT_DIR}/config/agent.config.template.json" "${CONFIG_DIR}/agent.config.json"
fi
install_service
cat > "${METADATA_PATH}" <<EOF
{
  "serviceName": "${SERVICE_NAME}",
  "installRoot": "${INSTALL_ROOT}",
  "configPath": "${CONFIG_DIR}/agent.config.json",
  "dataDir": "${DATA_DIR}",
  "logDir": "${LOG_DIR}",
  "binaryPath": "${INSTALL_ROOT}/gcac-linux-agent",
  "binaryVersion": "${binary_version}",
  "installedAt": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "mode": "linux-go-${service_manager}"
}
EOF
chmod 0644 "${METADATA_PATH}"
printf '安装完成，服务未自动启动：%s\n' "${SERVICE_NAME}"
printf '已安装版本：%s\n' "${binary_version}"
