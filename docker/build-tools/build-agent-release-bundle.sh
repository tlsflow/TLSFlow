#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
OUTPUT_ROOT=${GCAC_AGENT_BUNDLE_OUTPUT:-$REPOSITORY_ROOT/build/agent-release-bundle}
case "$OUTPUT_ROOT" in
  /*) ;;
  *) OUTPUT_ROOT="$REPOSITORY_ROOT/$OUTPUT_ROOT" ;;
esac

RELEASE_VERSION=$(tr -d '[:space:]' < "$REPOSITORY_ROOT/version")
FULL_AGENT_GO=${GCAC_FULL_GO:-go}
COMPATIBILITY_GO=${GCAC_COMPAT_GO:-}
RUNNING_IN_DOCKER=${GCAC_AGENT_BUNDLE_IN_DOCKER:-false}
LINUX_SOURCE="$REPOSITORY_ROOT/agents/linux-go-full-agent"
WINDOWS_GO_SOURCE="$REPOSITORY_ROOT/agents/windows-go-full-agent"
WINDOWS_COMPATIBILITY_SOURCE="$REPOSITORY_ROOT/agents/windows-compat-full-agent"
COMPATIBILITY_DIST="$WINDOWS_COMPATIBILITY_SOURCE/dist"
COMPATIBILITY_ARTIFACTS='
GCAC.WindowsCompatibilityAgent.exe
gcac-agent-updater.exe
plugins/windows-runtime-discovery.exe
web-iis/web-iis-agent-side-plugin.exe'
ITEMS_FILE=$(mktemp)
trap 'rm -f "$ITEMS_FILE"' EXIT INT TERM

fail() {
  printf '错误：%s\n' "$1" >&2
  exit 1
}

case "$OUTPUT_ROOT/" in
  "$REPOSITORY_ROOT"/*) ;;
  *) fail "拒绝写入仓库外部目录：$OUTPUT_ROOT" ;;
esac

read_go_version() {
  command=$1
  "$command" version 2>&1 || true
}

go_minor_version() {
  printf '%s\n' "$1" | sed -n 's/.*go1\.\([0-9][0-9]*\).*/\1/p' | head -n 1
}

can_run_go() {
  command=$1
  minimum_minor=$2
  version=$(read_go_version "$command")
  minor=$(go_minor_version "$version")
  [ -n "$minor" ] && [ "$minor" -ge "$minimum_minor" ] 2>/dev/null
}

assert_full_agent_go() {
  version=$(read_go_version "$FULL_AGENT_GO")
  minor=$(go_minor_version "$version")
  [ -n "$minor" ] && [ "$minor" -ge 23 ] 2>/dev/null ||
    fail "Full Agent 构建需要 Go 1.23.x 或更高版本，当前为 ${version:-未知版本}。请安装独立工具链后设置 GCAC_FULL_GO=/path/to/go，再重新执行。"
}

assert_compatibility_go() {
  version=$(read_go_version "$COMPATIBILITY_GO")
  minor=$(go_minor_version "$version")
  [ -n "$minor" ] && [ "$minor" -eq 20 ] 2>/dev/null ||
    fail "Compatibility Agent 构建必须使用 Go 1.20.x，当前为 ${version:-未知版本}。"
}

has_compatibility_artifacts() {
  for artifact in $COMPATIBILITY_ARTIFACTS; do
    [ -f "$COMPATIBILITY_DIST/$artifact" ] || return 1
  done
}

copy_file() {
  source=$1
  target=$2
  mkdir -p "$(dirname "$target")"
  cp "$source" "$target"
}

copy_files() {
  source_root=$1
  target_root=$2
  shift 2
  for file in "$@"; do
    copy_file "$source_root/$file" "$target_root/$file"
  done
}

run_compatibility_tests_and_build() {
  rm -rf "$COMPATIBILITY_DIST"
  mkdir -p "$COMPATIBILITY_DIST/plugins" "$COMPATIBILITY_DIST/web-iis"
  test_root=/tmp/gcac-compatibility-tests.$$
  mkdir -p "$test_root"
  trap 'rm -rf "$test_root"; rm -f "$ITEMS_FILE"' EXIT INT TERM

  set -- \
    '.|GCAC.WindowsCompatibilityAgent.tests.exe' \
    './agent-side-plugins/windows-runtime-discovery|windows-runtime-discovery.tests.exe' \
    './agent-side-plugins/web-iis|web-iis-agent-side-plugin.tests.exe'
  for target in "$@"; do
    package_path=${target%%|*}
    test_name=${target#*|}
    test_path="$test_root/$test_name"
    (
      cd "$WINDOWS_COMPATIBILITY_SOURCE"
      GOOS=windows GOARCH=amd64 CGO_ENABLED=0 "$COMPATIBILITY_GO" test -c -o "$test_path" "$package_path"
    )
    test_hash=$(sha256sum "$test_path" | awk '{print $1}')
    printf 'Compatibility 测试程序通过：%s，SHA256=%s\n' "$test_path" "$test_hash"
    rm -f "$test_path"
  done
  rm -rf "$test_root"

  (
    cd "$WINDOWS_COMPATIBILITY_SOURCE"
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 "$COMPATIBILITY_GO" build -trimpath -ldflags='-s -w -buildid=' -o "$COMPATIBILITY_DIST/GCAC.WindowsCompatibilityAgent.exe" .
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 "$COMPATIBILITY_GO" build -trimpath -ldflags='-s -w -buildid=' -o "$COMPATIBILITY_DIST/gcac-agent-updater.exe" ./cmd/gcac-agent-updater
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 "$COMPATIBILITY_GO" build -trimpath -ldflags='-s -w -buildid=' -o "$COMPATIBILITY_DIST/plugins/windows-runtime-discovery.exe" ./agent-side-plugins/windows-runtime-discovery
    GOOS=windows GOARCH=amd64 CGO_ENABLED=0 "$COMPATIBILITY_GO" build -trimpath -ldflags='-s -w -buildid=' -o "$COMPATIBILITY_DIST/web-iis/web-iis-agent-side-plugin.exe" ./agent-side-plugins/web-iis
  )
}

if [ "$RUNNING_IN_DOCKER" != true ] && { ! can_run_go "$FULL_AGENT_GO" 23 || ! has_compatibility_artifacts; }; then
  exec sh "$REPOSITORY_ROOT/docker/build-tools/build-agent-release-bundle-docker.sh"
fi

case "$OUTPUT_ROOT/" in
  "$REPOSITORY_ROOT"/*) ;;
  *) fail "拒绝写入仓库外部目录：$OUTPUT_ROOT" ;;
esac
assert_full_agent_go
[ -z "$COMPATIBILITY_GO" ] || assert_compatibility_go
rm -rf "$OUTPUT_ROOT"
mkdir -p "$OUTPUT_ROOT"

[ -z "$COMPATIBILITY_GO" ] || run_compatibility_tests_and_build

for target in 'amd64|amd64' 'arm64|arm64'; do
  go_arch=${target%%|*}
  bundle_arch=${target#*|}
  linux_target="$OUTPUT_ROOT/linux/$bundle_arch"
  mkdir -p "$linux_target"
  (
    cd "$LINUX_SOURCE"
    GOOS=linux GOARCH="$go_arch" CGO_ENABLED=0 "$FULL_AGENT_GO" build -trimpath -ldflags='-s -w -buildid=' -o "$linux_target/gcac-linux-agent" .
  )
  copy_files "$LINUX_SOURCE" "$linux_target" \
    build.sh \
    service-control.sh \
    config/agent.config.template.json \
    linux/gcac-linux-agent.service \
    linux/upgrade.sh \
    linux/rollback.sh \
    release/verify-signature.sh \
    linux/install-systemd.sh \
    linux/uninstall-systemd.sh \
    README.md

  windows_target="$OUTPUT_ROOT/windows/$bundle_arch/full-agent"
  mkdir -p "$windows_target/plugins"
  (
    cd "$WINDOWS_GO_SOURCE"
    GOOS=windows GOARCH="$go_arch" CGO_ENABLED=0 "$FULL_AGENT_GO" build -trimpath -ldflags='-s -w -buildid=' -o "$windows_target/gcac-agent.exe" .
    GOOS=windows GOARCH="$go_arch" CGO_ENABLED=0 "$FULL_AGENT_GO" build -trimpath -ldflags='-s -w -buildid=' -o "$windows_target/gcac-agent-updater.exe" ./cmd/gcac-agent-updater
    GOOS=windows GOARCH="$go_arch" CGO_ENABLED=0 "$FULL_AGENT_GO" build -trimpath -ldflags='-s -w -buildid=' -o "$windows_target/plugins/windows-runtime-discovery.exe" ./agent-side-plugins/windows-runtime-discovery
  )
  copy_files "$WINDOWS_GO_SOURCE" "$windows_target" \
    config/agent.config.template.json \
    install-service.ps1 \
    uninstall-service.ps1 \
    service-control.ps1 \
    release/verify-signature.ps1 \
    README.md
done

for artifact in $COMPATIBILITY_ARTIFACTS; do
  source="$COMPATIBILITY_DIST/$artifact"
  [ -f "$source" ] || fail "Compatibility Go 产物缺失：$source。请准备 Go 1.20.x 后执行 agents/windows-compat-full-agent/build.sh（该结果仅是交叉编译检查）。"
done

compatibility_target="$OUTPUT_ROOT/windows/amd64/compatibility"
mkdir -p "$compatibility_target"
for artifact in $COMPATIBILITY_ARTIFACTS; do
  copy_file "$COMPATIBILITY_DIST/$artifact" "$compatibility_target/$artifact"
done
copy_files "$WINDOWS_COMPATIBILITY_SOURCE" "$compatibility_target" \
  install-service.ps1 \
  uninstall-service.ps1 \
  upgrade-service.ps1 \
  config/agent.config.template.json \
  release/verify-signature.ps1 \
  README.md

first_item=true
item_count=0
find "$OUTPUT_ROOT" -type f -print | LC_ALL=C sort | while IFS= read -r file; do
  relative_path=${file#"$OUTPUT_ROOT"/}
  size=$(wc -c < "$file" | tr -d '[:space:]')
  sha256=$(sha256sum "$file" | awk '{print $1}')
  if [ "$first_item" = true ]; then
    first_item=false
  else
    printf ',\n' >> "$ITEMS_FILE"
  fi
  printf '    {"path":"%s","size":%s,"sha256":"%s"}' "$relative_path" "$size" "$sha256" >> "$ITEMS_FILE"
  item_count=$((item_count + 1))
done

# 管道中的 while 在部分 POSIX shell 中运行于子 shell，文件内容是事实来源。
[ -s "$ITEMS_FILE" ] || fail 'Agent Release Bundle 没有可记录的文件'
generated_at=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
{
  printf '{\n'
  printf '  "schemaVersion": "gcac.agent-release-bundle/v1",\n'
  printf '  "version": "%s",\n' "$RELEASE_VERSION"
  printf '  "generatedAt": "%s",\n' "$generated_at"
  printf '  "architectures": ["linux/amd64", "linux/arm64", "windows/amd64", "windows/arm64"],\n'
  printf '  "compatibility": {\n'
  printf '    "runtime": "go",\n'
  printf '    "toolchain": "go1.20",\n'
  printf '    "productLine": "windows-compat-full-agent",\n'
  printf '    "architectures": ["windows/amd64"],\n'
  printf '    "path": "windows/amd64/compatibility"\n'
  printf '  },\n'
  printf '  "items": [\n'
  cat "$ITEMS_FILE"
  printf '\n  ]\n'
  printf '}\n'
} > "$OUTPUT_ROOT/manifest.json"

printf 'Agent Release Bundle 已生成：%s\n' "$OUTPUT_ROOT"
