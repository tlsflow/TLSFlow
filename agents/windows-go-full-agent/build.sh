#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUTPUT_DIR="$SCRIPT_DIR/dist"

if ! command -v go >/dev/null 2>&1; then
  echo "错误：未找到 Go，请先安装 Go。" >&2
  exit 1
fi

build_target() {
  target_arch="$1"
  output_path="$OUTPUT_DIR/gcac-agent.windows-$target_arch.exe"
  temporary_path="$output_path.tmp.$$"
  rm -f "$temporary_path"
  CGO_ENABLED=0 GOOS=windows GOARCH="$target_arch" go build -trimpath -o "$temporary_path" .
  mv -f "$temporary_path" "$output_path"
  shasum -a 256 "$output_path"
}

build_side_plugin() {

  target_arch="$1"
  plugin_output_dir="$OUTPUT_DIR/plugins"
  output_path="$plugin_output_dir/windows-runtime-discovery.windows-$target_arch.exe"
  temporary_path="$output_path.tmp.$$"
  mkdir -p "$plugin_output_dir"
  rm -f "$temporary_path"
  CGO_ENABLED=0 GOOS=windows GOARCH="$target_arch" go build -trimpath -o "$temporary_path" ./agent-side-plugins/windows-runtime-discovery
  mv -f "$temporary_path" "$output_path"
  shasum -a 256 "$output_path"
}

compile_windows_tests() {
  target_arch="$1"
  test_output="$OUTPUT_DIR/gcac-agent.windows-$target_arch.test.exe"
  CGO_ENABLED=0 GOOS=windows GOARCH="$target_arch" go test -c -o "$test_output" .
  plugin_test_output="$OUTPUT_DIR/plugins/windows-runtime-discovery.windows-$target_arch.test.exe"
  CGO_ENABLED=0 GOOS=windows GOARCH="$target_arch" go test -c -o "$plugin_test_output" ./agent-side-plugins/windows-runtime-discovery
}

mkdir -p "$OUTPUT_DIR"
cd "$SCRIPT_DIR"
if [ "$(go env GOOS)" = "windows" ]; then
  go test ./...
else
  # Windows API 测试在非 Windows 主机只做交叉编译，不能尝试执行 .exe。
  compile_windows_tests amd64
  compile_windows_tests arm64
fi
build_target amd64
build_target arm64
build_side_plugin amd64
build_side_plugin arm64

# 兼容尚未重启的旧后端安装器；新后端只从 dist 读取发布物。
cp "$OUTPUT_DIR/gcac-agent.windows-amd64.exe" "$SCRIPT_DIR/gcac-agent.exe"
cp "$OUTPUT_DIR/plugins/windows-runtime-discovery.windows-amd64.exe" "$OUTPUT_DIR/plugins/windows-runtime-discovery.exe"
