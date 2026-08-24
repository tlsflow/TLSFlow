#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AGENT_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
SIGNING_PRIVATE_KEY_FILE="${SIGNING_PRIVATE_KEY_FILE:-}"
[ -n "${SIGNING_PRIVATE_KEY_FILE}" ] || { echo "错误：可重复正式发布验证必须提供 Ed25519 签名私钥" >&2; exit 1; }
[ -f "${SIGNING_PRIVATE_KEY_FILE}" ] || { echo "错误：签名私钥不存在" >&2; exit 1; }
TEMP_ROOT=$(mktemp -d)
trap 'rm -rf "${TEMP_ROOT}"' EXIT INT TERM

first="${TEMP_ROOT}/first"
second="${TEMP_ROOT}/second"
mkdir -p "${first}" "${second}"

SIGNING_PRIVATE_KEY_FILE="${SIGNING_PRIVATE_KEY_FILE}" OUTPUT_DIR="${first}" "${SCRIPT_DIR}/build-release.sh"
SIGNING_PRIVATE_KEY_FILE="${SIGNING_PRIVATE_KEY_FILE}" OUTPUT_DIR="${second}" "${SCRIPT_DIR}/build-release.sh"

cmp "${first}/gcac-linux-agent-linux-amd64" "${second}/gcac-linux-agent-linux-amd64"
cmp "${first}/gcac-linux-agent-linux-arm64" "${second}/gcac-linux-agent-linux-arm64"
cmp "${first}/gcac-linux-agent-linux-amd64.sig" "${second}/gcac-linux-agent-linux-amd64.sig"
cmp "${first}/gcac-linux-agent-linux-arm64.sig" "${second}/gcac-linux-agent-linux-arm64.sig"
cmp "${first}/SHA256SUMS" "${second}/SHA256SUMS"

printf '可重复构建验证通过：%s\n' "${AGENT_DIR}"
