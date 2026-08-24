#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AGENT_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
TEMP_ROOT=$(mktemp -d)
trap 'rm -rf "${TEMP_ROOT}"' EXIT INT TERM

mkdir -p "${TEMP_ROOT}/bin" "${TEMP_ROOT}/systemd" "${TEMP_ROOT}/install-parent"
cp "${AGENT_DIR}/gcac-linux-agent" "${TEMP_ROOT}/agent"
go run "${AGENT_DIR}/cmd/release-sign" keygen "${TEMP_ROOT}/release-private.key" "${TEMP_ROOT}/release-public.key"
go run "${AGENT_DIR}/cmd/release-sign" sign "${TEMP_ROOT}/release-private.key" "${TEMP_ROOT}/agent" "${TEMP_ROOT}/agent.sig"
go build -o "${TEMP_ROOT}/release-sign" "${AGENT_DIR}/cmd/release-sign"

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
PUBLIC_KEY_FILE="${TEMP_ROOT}/release-public.key" \
SIGNATURE_FILE="${TEMP_ROOT}/agent.sig" \
SIGNATURE_VERIFIER="${TEMP_ROOT}/release-sign" \
INSTALL_ROOT="${TEMP_ROOT}/install-parent/agent" \
CONFIG_DIR="${TEMP_ROOT}/config" \
DATA_DIR="${TEMP_ROOT}/data" \
LOG_DIR="${TEMP_ROOT}/log" \
"${AGENT_DIR}/linux/install.sh" --preflight-only

if PATH="${TEMP_ROOT}/bin:${PATH}" GCAC_TEST_UNAME_S=Linux GCAC_TEST_MACHINE=mips64 GCAC_TEST_KERNEL=6.1 GCAC_TEST_EUID=0 GCAC_SYSTEMD_RUNTIME_DIR="${TEMP_ROOT}/systemd" SOURCE_BINARY="${TEMP_ROOT}/agent" PUBLIC_KEY_FILE="${TEMP_ROOT}/release-public.key" SIGNATURE_FILE="${TEMP_ROOT}/agent.sig" SIGNATURE_VERIFIER="${TEMP_ROOT}/release-sign" INSTALL_ROOT="${TEMP_ROOT}/install-parent/agent" "${AGENT_DIR}/linux/install.sh" --preflight-only >/dev/null 2>&1; then
  echo "不支持架构必须被拒绝" >&2
  exit 1
fi

if PATH="${TEMP_ROOT}/bin:${PATH}" GCAC_TEST_UNAME_S=Linux GCAC_TEST_MACHINE=x86_64 GCAC_TEST_KERNEL=3.1 GCAC_TEST_EUID=0 GCAC_SYSTEMD_RUNTIME_DIR="${TEMP_ROOT}/systemd" SOURCE_BINARY="${TEMP_ROOT}/agent" PUBLIC_KEY_FILE="${TEMP_ROOT}/release-public.key" SIGNATURE_FILE="${TEMP_ROOT}/agent.sig" SIGNATURE_VERIFIER="${TEMP_ROOT}/release-sign" INSTALL_ROOT="${TEMP_ROOT}/install-parent/agent" "${AGENT_DIR}/linux/install.sh" --preflight-only >/dev/null 2>&1; then
  echo "低于 Runtime Baseline 的 Kernel 必须被拒绝" >&2
  exit 1
fi

echo "安装预检测试通过"

cp "${TEMP_ROOT}/agent" "${TEMP_ROOT}/tampered-agent"
printf 'tampered' >> "${TEMP_ROOT}/tampered-agent"
if PATH="${TEMP_ROOT}/bin:${PATH}" GCAC_TEST_UNAME_S=Linux GCAC_TEST_MACHINE=x86_64 GCAC_TEST_KERNEL=3.2 GCAC_TEST_EUID=0 GCAC_SYSTEMD_RUNTIME_DIR="${TEMP_ROOT}/systemd" SOURCE_BINARY="${TEMP_ROOT}/tampered-agent" PUBLIC_KEY_FILE="${TEMP_ROOT}/release-public.key" SIGNATURE_FILE="${TEMP_ROOT}/agent.sig" SIGNATURE_VERIFIER="${TEMP_ROOT}/release-sign" INSTALL_ROOT="${TEMP_ROOT}/install-parent/agent" "${AGENT_DIR}/linux/install.sh" --preflight-only >/dev/null 2>&1; then
  echo "篡改产物必须被签名验证拒绝" >&2
  exit 1
fi
echo "发布签名验证测试通过"

mkdir -p "${TEMP_ROOT}/upgrade/install" "${TEMP_ROOT}/upgrade/data" "${TEMP_ROOT}/upgrade/systemd"
cat > "${TEMP_ROOT}/upgrade/install/gcac-linux-agent" <<'EOF'
#!/usr/bin/env sh
[ "${1:-}" = version ] && { echo '{"version":"2.1.0"}'; exit 0; }
exit 0
EOF
cat > "${TEMP_ROOT}/upgrade/good-agent" <<'EOF'
#!/usr/bin/env sh
[ "${1:-}" = version ] && { echo '{"version":"2.2.0"}'; exit 0; }
exit 0
EOF
cat > "${TEMP_ROOT}/upgrade/bad-agent" <<'EOF'
#!/usr/bin/env sh
[ "${1:-}" = version ] && { echo '{"version":"2.3.0"}'; exit 1; }
exit 1
EOF
cat > "${TEMP_ROOT}/upgrade/downgrade-agent" <<'EOF'
#!/usr/bin/env sh
[ "${1:-}" = version ] && { echo '{"version":"1.9.0"}'; exit 0; }
exit 0
EOF
chmod +x "${TEMP_ROOT}/upgrade/install/gcac-linux-agent" "${TEMP_ROOT}/upgrade/good-agent" "${TEMP_ROOT}/upgrade/bad-agent" "${TEMP_ROOT}/upgrade/downgrade-agent"
for artifact in good-agent bad-agent downgrade-agent; do
  go run "${AGENT_DIR}/cmd/release-sign" sign "${TEMP_ROOT}/release-private.key" "${TEMP_ROOT}/upgrade/${artifact}" "${TEMP_ROOT}/upgrade/${artifact}.sig"
done

PATH="${TEMP_ROOT}/bin:${PATH}" \
GCAC_TEST_EUID=0 \
GCAC_SYSTEMD_RUNTIME_DIR="${TEMP_ROOT}/upgrade/systemd" \
INSTALL_ROOT="${TEMP_ROOT}/upgrade/install" \
DATA_DIR="${TEMP_ROOT}/upgrade/data" \
PUBLIC_KEY_FILE="${TEMP_ROOT}/release-public.key" \
SIGNATURE_VERIFIER="${TEMP_ROOT}/release-sign" \
    "${AGENT_DIR}/linux/upgrade.sh" "${TEMP_ROOT}/upgrade/good-agent" "" "${TEMP_ROOT}/upgrade/good-agent.sig"

if PATH="${TEMP_ROOT}/bin:${PATH}" GCAC_TEST_EUID=0 GCAC_SYSTEMD_RUNTIME_DIR="${TEMP_ROOT}/upgrade/systemd" INSTALL_ROOT="${TEMP_ROOT}/upgrade/install" DATA_DIR="${TEMP_ROOT}/upgrade/data" PUBLIC_KEY_FILE="${TEMP_ROOT}/release-public.key" SIGNATURE_VERIFIER="${TEMP_ROOT}/release-sign" "${AGENT_DIR}/linux/upgrade.sh" "${TEMP_ROOT}/upgrade/bad-agent" "" "${TEMP_ROOT}/upgrade/bad-agent.sig" >/dev/null 2>&1; then
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

if PATH="${TEMP_ROOT}/bin:${PATH}" GCAC_TEST_EUID=0 GCAC_SYSTEMD_RUNTIME_DIR="${TEMP_ROOT}/upgrade/systemd" INSTALL_ROOT="${TEMP_ROOT}/upgrade/install" DATA_DIR="${TEMP_ROOT}/upgrade/data" PUBLIC_KEY_FILE="${TEMP_ROOT}/release-public.key" SIGNATURE_VERIFIER="${TEMP_ROOT}/release-sign" "${AGENT_DIR}/linux/upgrade.sh" "${TEMP_ROOT}/upgrade/downgrade-agent" "" "${TEMP_ROOT}/upgrade/downgrade-agent.sig" >/dev/null 2>&1; then
  echo "major 降级必须默认拒绝" >&2
  exit 1
fi
echo "major 降级边界测试通过"

if PATH="${TEMP_ROOT}/bin:${PATH}" GCAC_TEST_EUID=0 GCAC_TEST_INTERRUPT_AFTER_REPLACE=1 GCAC_SYSTEMD_RUNTIME_DIR="${TEMP_ROOT}/upgrade/systemd" INSTALL_ROOT="${TEMP_ROOT}/upgrade/install" DATA_DIR="${TEMP_ROOT}/upgrade/data" PUBLIC_KEY_FILE="${TEMP_ROOT}/release-public.key" SIGNATURE_VERIFIER="${TEMP_ROOT}/release-sign" "${AGENT_DIR}/linux/upgrade.sh" "${TEMP_ROOT}/upgrade/good-agent" "" "${TEMP_ROOT}/upgrade/good-agent.sig" >/dev/null 2>&1; then
  echo "中断注入必须返回非零" >&2
  exit 1
fi
PATH="${TEMP_ROOT}/bin:${PATH}" GCAC_TEST_EUID=0 GCAC_SYSTEMD_RUNTIME_DIR="${TEMP_ROOT}/upgrade/systemd" INSTALL_ROOT="${TEMP_ROOT}/upgrade/install" DATA_DIR="${TEMP_ROOT}/upgrade/data" PUBLIC_KEY_FILE="${TEMP_ROOT}/release-public.key" SIGNATURE_VERIFIER="${TEMP_ROOT}/release-sign" "${AGENT_DIR}/linux/upgrade.sh" "${TEMP_ROOT}/upgrade/good-agent" "" "${TEMP_ROOT}/upgrade/good-agent.sig"
grep -q 'upgrade_power_loss_recovered' "${TEMP_ROOT}/upgrade/data/upgrade-audit.jsonl"
echo "升级断电恢复测试通过"
