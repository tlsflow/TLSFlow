#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
AGENT_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
TEMP_ROOT=$(mktemp -d)
trap 'rm -rf "${TEMP_ROOT}"' EXIT INT TERM

first="${TEMP_ROOT}/first"
second="${TEMP_ROOT}/second"
mkdir -p "${first}" "${second}"

OUTPUT_DIR="${first}" "${SCRIPT_DIR}/build-release.sh"
OUTPUT_DIR="${second}" "${SCRIPT_DIR}/build-release.sh"

cmp "${first}/gcac-linux-agent-linux-amd64" "${second}/gcac-linux-agent-linux-amd64"
cmp "${first}/gcac-linux-agent-linux-arm64" "${second}/gcac-linux-agent-linux-arm64"
cmp "${first}/SHA256SUMS" "${second}/SHA256SUMS"

printf '可重复构建验证通过：%s\n' "${AGENT_DIR}"
