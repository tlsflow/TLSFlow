#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUTPUT_NAME="${OUTPUT_NAME:-gcac-linux-agent}"
GOOS_VALUE="${GOOS:-linux}"
GOARCH_VALUE="${GOARCH:-amd64}"
VERSION_VALUE="${VERSION:-0.1.16}"
COMMIT_VALUE="${COMMIT:-$(git -C "${SCRIPT_DIR}" rev-parse HEAD 2>/dev/null || printf 'unknown')}"
SOURCE_DATE_EPOCH_VALUE="${SOURCE_DATE_EPOCH:-$(git -C "${SCRIPT_DIR}" log -1 --format=%ct 2>/dev/null || printf '0')}"
BUILD_TIME_VALUE="${BUILD_TIME:-$(date -u -d "@${SOURCE_DATE_EPOCH_VALUE}" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || printf 'unknown')}"
LDFLAGS="-s -w -buildid= -X gcac/linux-go-full-agent/internal/buildinfo.Version=${VERSION_VALUE} -X gcac/linux-go-full-agent/internal/buildinfo.Commit=${COMMIT_VALUE} -X gcac/linux-go-full-agent/internal/buildinfo.BuildTime=${BUILD_TIME_VALUE} -X gcac/linux-go-full-agent/internal/buildinfo.SourceDateEpoch=${SOURCE_DATE_EPOCH_VALUE}"

if ! command -v go >/dev/null 2>&1; then
  echo "错误：未找到 Go，请先安装 Go。" >&2
  exit 1
fi

cd "${SCRIPT_DIR}"
CGO_ENABLED=0 GOOS="${GOOS_VALUE}" GOARCH="${GOARCH_VALUE}" go build -trimpath -ldflags "${LDFLAGS}" -o "${OUTPUT_NAME}" .
case "${OUTPUT_NAME}" in
  /*) OUTPUT_PATH="${OUTPUT_NAME}" ;;
  *) OUTPUT_PATH="${SCRIPT_DIR}/${OUTPUT_NAME}" ;;
esac
echo "构建完成：${OUTPUT_PATH}"
