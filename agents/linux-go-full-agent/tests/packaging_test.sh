#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AGENT_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
TEMP_ROOT=$(mktemp -d)
trap 'rm -rf "${TEMP_ROOT}"' EXIT INT TERM

mkdir -p "${TEMP_ROOT}/bin" "${TEMP_ROOT}/systemd" "${TEMP_ROOT}/install-parent"
cp "${AGENT_DIR}/gcac-linux-agent" "${TEMP_ROOT}/agent"

cat > "${TEMP_ROOT}/bin/systemctl" <<'EOF'
#!/usr/bin/env sh
exit 0
EOF
chmod +x "${TEMP_ROOT}/bin/systemctl"

PATH="${TEMP_ROOT}/bin:${PATH}" \
GCAC_TEST_UNAME_S=Linux \
GCAC_TEST_MACHINE=x86_64 \
GCAC_TEST_KERNEL=3.2.0 \
GCAC_TEST_EUID=0 \
GCAC_SYSTEMD_RUNTIME_DIR="${TEMP_ROOT}/systemd" \
SOURCE_BINARY="${TEMP_ROOT}/agent" \
INSTALL_ROOT="${TEMP_ROOT}/install-parent/agent" \
CONFIG_DIR="${TEMP_ROOT}/config" \
DATA_DIR="${TEMP_ROOT}/data" \
LOG_DIR="${TEMP_ROOT}/log" \
"${AGENT_DIR}/linux/install.sh" --preflight-only

if PATH="${TEMP_ROOT}/bin:${PATH}" GCAC_TEST_UNAME_S=Linux GCAC_TEST_MACHINE=mips64 GCAC_TEST_KERNEL=6.1 GCAC_TEST_EUID=0 GCAC_SYSTEMD_RUNTIME_DIR="${TEMP_ROOT}/systemd" SOURCE_BINARY="${TEMP_ROOT}/agent" INSTALL_ROOT="${TEMP_ROOT}/install-parent/agent" "${AGENT_DIR}/linux/install.sh" --preflight-only >/dev/null 2>&1; then
  echo "不支持架构必须被拒绝" >&2
  exit 1
fi

if PATH="${TEMP_ROOT}/bin:${PATH}" GCAC_TEST_UNAME_S=Linux GCAC_TEST_MACHINE=x86_64 GCAC_TEST_KERNEL=3.1 GCAC_TEST_EUID=0 GCAC_SYSTEMD_RUNTIME_DIR="${TEMP_ROOT}/systemd" SOURCE_BINARY="${TEMP_ROOT}/agent" INSTALL_ROOT="${TEMP_ROOT}/install-parent/agent" "${AGENT_DIR}/linux/install.sh" --preflight-only >/dev/null 2>&1; then
  echo "低于 Runtime Baseline 的 Kernel 必须被拒绝" >&2
  exit 1
fi

echo "安装预检测试通过"

mkdir -p "${TEMP_ROOT}/upgrade/install" "${TEMP_ROOT}/upgrade/data" "${TEMP_ROOT}/upgrade/systemd"
cat > "${TEMP_ROOT}/upgrade/install/gcac-linux-agent" <<'EOF'
#!/usr/bin/env sh
[ "${1:-}" = version ] && exit 0
exit 0
EOF
cat > "${TEMP_ROOT}/upgrade/good-agent" <<'EOF'
#!/usr/bin/env sh
[ "${1:-}" = version ] && exit 0
exit 0
EOF
cat > "${TEMP_ROOT}/upgrade/bad-agent" <<'EOF'
#!/usr/bin/env sh
[ "${1:-}" = version ] && exit 1
exit 1
EOF
chmod +x "${TEMP_ROOT}/upgrade/install/gcac-linux-agent" "${TEMP_ROOT}/upgrade/good-agent" "${TEMP_ROOT}/upgrade/bad-agent"

PATH="${TEMP_ROOT}/bin:${PATH}" \
GCAC_TEST_EUID=0 \
GCAC_SYSTEMD_RUNTIME_DIR="${TEMP_ROOT}/upgrade/systemd" \
INSTALL_ROOT="${TEMP_ROOT}/upgrade/install" \
DATA_DIR="${TEMP_ROOT}/upgrade/data" \
"${AGENT_DIR}/linux/upgrade.sh" "${TEMP_ROOT}/upgrade/good-agent"

if PATH="${TEMP_ROOT}/bin:${PATH}" GCAC_TEST_EUID=0 GCAC_SYSTEMD_RUNTIME_DIR="${TEMP_ROOT}/upgrade/systemd" INSTALL_ROOT="${TEMP_ROOT}/upgrade/install" DATA_DIR="${TEMP_ROOT}/upgrade/data" "${AGENT_DIR}/linux/upgrade.sh" "${TEMP_ROOT}/upgrade/bad-agent" >/dev/null 2>&1; then
  echo "坏版本升级必须失败" >&2
  exit 1
fi

if ! "${TEMP_ROOT}/upgrade/install/gcac-linux-agent" version; then
  echo "失败升级后旧版本未恢复" >&2
  exit 1
fi

grep -q 'upgrade_succeeded' "${TEMP_ROOT}/upgrade/data/upgrade-audit.jsonl"
grep -q 'upgrade_rolled_back' "${TEMP_ROOT}/upgrade/data/upgrade-audit.jsonl"
echo "升级和自动回滚测试通过"
