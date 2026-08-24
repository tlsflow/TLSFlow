#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUTPUT_DIR="$SCRIPT_DIR/dist"
VERSION_VALUE="${VERSION:-0.1.0}"

if ! command -v go >/dev/null 2>&1; then
  echo "错误：未找到 Go，请先安装 Go。" >&2
  exit 1
fi

cd "$SCRIPT_DIR"
mkdir -p "$OUTPUT_DIR"

build_target() {
  target_os="$1"
  target_arch="$2"
  if [ "$target_os" = "windows" ]; then
    output_path="$OUTPUT_DIR/gcac-gateway-agent.windows-$target_arch.exe"
  else
    output_path="$OUTPUT_DIR/gcac-gateway-agent.linux-$target_arch"
  fi
  temporary_path="$output_path.tmp.$$"
  rm -f "$temporary_path"
  CGO_ENABLED=0 GOOS="$target_os" GOARCH="$target_arch" go build -trimpath -ldflags "-s -w -X main.agentVersion=${VERSION_VALUE}" -o "$temporary_path" .
  mv -f "$temporary_path" "$output_path"
  echo "$output_path"
  shasum -a 256 "$output_path" | awk '{print $1}'
}

# Linux amd64/arm64 + Windows amd64/arm64，单一源码同时支撑两类平台。
build_target linux amd64
build_target linux arm64
build_target windows amd64
build_target windows arm64

# 根目录保留 Linux amd64 可执行文件，供 linux bundle 与本地自检使用。
cp "$OUTPUT_DIR/gcac-gateway-agent.linux-amd64" "$SCRIPT_DIR/gcac-gateway-agent"
chmod +x "$SCRIPT_DIR/gcac-gateway-agent"
echo "构建完成：$SCRIPT_DIR/gcac-gateway-agent"
