#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUTPUT_NAME="${OUTPUT_NAME:-gcac-linux-agent}"
GOOS_VALUE="${GOOS:-linux}"
GOARCH_VALUE="${GOARCH:-amd64}"

if ! command -v go >/dev/null 2>&1; then
  echo "错误：未找到 Go，请先安装 Go。" >&2
  exit 1
fi

cd "${SCRIPT_DIR}"
CGO_ENABLED=0 GOOS="${GOOS_VALUE}" GOARCH="${GOARCH_VALUE}" go build -o "${OUTPUT_NAME}" .
echo "构建完成：${SCRIPT_DIR}/${OUTPUT_NAME}"
