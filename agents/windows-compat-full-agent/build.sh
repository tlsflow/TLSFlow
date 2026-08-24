#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
OUTPUT_DIR="$SCRIPT_DIR/dist"

if ! command -v go >/dev/null 2>&1; then
  echo "错误：未找到 Go 1.20 工具链。" >&2
  exit 1
fi
GO_VERSION=$(go version)
case "$GO_VERSION" in
  *"go1.20."*) ;;
  *) echo "错误：Compatibility Agent 必须使用 Go 1.20.x，当前为 $GO_VERSION" >&2; exit 1 ;;
esac

mkdir -p "$OUTPUT_DIR/plugins" "$OUTPUT_DIR/web-iis"
cd "$SCRIPT_DIR"

if [ "$(go env GOOS)" = "windows" ]; then
  go test ./...
fi

CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go test -c -o "$OUTPUT_DIR/GCAC.WindowsCompatibilityAgent.tests.exe" .
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go test -c -o "$OUTPUT_DIR/plugins/windows-runtime-discovery.tests.exe" ./agent-side-plugins/windows-runtime-discovery
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go test -c -o "$OUTPUT_DIR/web-iis/web-iis-agent-side-plugin.tests.exe" ./agent-side-plugins/web-iis
for test_binary in "$OUTPUT_DIR/GCAC.WindowsCompatibilityAgent.tests.exe" "$OUTPUT_DIR/plugins/windows-runtime-discovery.tests.exe" "$OUTPUT_DIR/web-iis/web-iis-agent-side-plugin.tests.exe"; do
  sha256sum "$test_binary" 2>/dev/null || shasum -a 256 "$test_binary"
done

build_windows() {
  package="$1"
  output="$2"
  temporary="$output.tmp.$$"
  rm -f "$temporary"
  CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -o "$temporary" "$package"
  mv -f "$temporary" "$output"
  sha256sum "$output" 2>/dev/null || shasum -a 256 "$output"
}

build_windows . "$OUTPUT_DIR/GCAC.WindowsCompatibilityAgent.exe"
build_windows ./cmd/gcac-agent-updater "$OUTPUT_DIR/gcac-agent-updater.exe"
build_windows ./agent-side-plugins/windows-runtime-discovery "$OUTPUT_DIR/plugins/windows-runtime-discovery.exe"
build_windows ./agent-side-plugins/web-iis "$OUTPUT_DIR/web-iis/web-iis-agent-side-plugin.exe"

cp "$OUTPUT_DIR/GCAC.WindowsCompatibilityAgent.exe" "$SCRIPT_DIR/GCAC.WindowsCompatibilityAgent.exe"
cp "$OUTPUT_DIR/gcac-agent-updater.exe" "$SCRIPT_DIR/gcac-agent-updater.exe"
printf '%s\n' "构建完成：Go 1.20 windows/amd64 Compatibility Agent、Web 扫描器和 IIS Plugin。"
