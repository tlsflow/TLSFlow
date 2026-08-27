#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
VERSIONS_FILE="$REPOSITORY_ROOT/docker/build-tools/versions.json"
OUTPUT_ROOT=${GCAC_AGENT_BUNDLE_OUTPUT:-$REPOSITORY_ROOT/build/agent-release-bundle}
case "$OUTPUT_ROOT" in
  /*) ;;
  *) OUTPUT_ROOT="$REPOSITORY_ROOT/$OUTPUT_ROOT" ;;
esac

json_value() {
  key=$1
  file=$2
  awk -v key="$key" '
    $0 ~ "\"" key "\"[[:space:]]*:" {
      line = $0
      sub(/^[^:]*:[[:space:]]*/, "", line)
      gsub(/[",]/, "", line)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      print line
      exit
    }
  ' "$file"
}

fail() {
  printf '错误：%s\n' "$1" >&2
  exit 1
}

case "$OUTPUT_ROOT/" in
  "$REPOSITORY_ROOT"/*) ;;
  *) fail "拒绝写入仓库外部目录：$OUTPUT_ROOT" ;;
esac

full_image=$(awk -F'"' '/"full"[[:space:]]*:/ { print $4; exit }' "$VERSIONS_FILE")
compatibility_image=$(awk -F'"' '/"compatibility"[[:space:]]*:/ { print $4; exit }' "$VERSIONS_FILE")
[ -n "$full_image" ] || fail 'versions.json 缺少 Full Agent Go builder 镜像版本'
[ -n "$compatibility_image" ] || fail 'versions.json 缺少 Compatibility Agent Go builder 镜像版本'

rm -rf "$OUTPUT_ROOT"
mkdir -p "$OUTPUT_ROOT"

set -- docker buildx build --pull --progress plain \
  --build-arg "GO_FULL_IMAGE=$full_image" \
  --build-arg "GO_COMPAT_IMAGE=$compatibility_image"
[ -n "${GCAC_GO_PROXY:-}" ] && set -- "$@" --build-arg "GO_PROXY=$GCAC_GO_PROXY"
set -- "$@" --file "$REPOSITORY_ROOT/docker/build-tools/Dockerfile.agent-release-bundle" \
  --output "type=local,dest=$OUTPUT_ROOT" "$REPOSITORY_ROOT"

if ! "$@"; then
  fail 'Docker Agent Bundle 构建失败。请检查 Docker daemon、Buildx 和 Go 基础镜像下载。'
fi

printf 'Docker 已生成 Agent Release Bundle：%s\n' "$OUTPUT_ROOT"
