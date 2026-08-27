#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
VERSIONS_FILE="$REPOSITORY_ROOT/docker/build-tools/versions.json"
RELEASE_VERSION=$(tr -d '[:space:]' < "$REPOSITORY_ROOT/version")

architecture=all
platform=
tag=
image=
edition=${VITE_PRODUCT_EDITION:-public}

fail() {
  printf '错误：%s\n' "$1" >&2
  exit 1
}

default_platform() {
  case "$(uname -m 2>/dev/null || printf '%s' unknown)" in
    arm64|aarch64) printf '%s\n' linux/arm64 ;;
    *) printf '%s\n' linux/amd64 ;;
  esac
}

normalize_image_name() {
  case "$1" in
    browserRuntime) printf '%s\n' gcac-browser-runtime ;;
    gcac-*) printf '%s\n' "$1" ;;
    *) printf 'gcac-%s\n' "$1" ;;
  esac
}

assert_platform() {
  case "$1" in
    linux/amd64|linux/arm64) ;;
    *) fail "平台不在发布矩阵中：$1" ;;
  esac
}

while [ "$#" -gt 0 ]; do
  argument=$1
  shift
  case "$argument" in
    --architecture=*) architecture=${argument#*=} ;;
    --architecture)
      [ "$#" -gt 0 ] || fail '参数缺少值：--architecture'
      architecture=$1
      shift
      ;;
    --image=*) image=$(normalize_image_name "${argument#*=}") ;;
    --image)
      [ "$#" -gt 0 ] || fail '参数缺少值：--image'
      image=$(normalize_image_name "$1")
      shift
      ;;
    --platform=*) platform=${argument#*=} ;;
    --platform)
      [ "$#" -gt 0 ] || fail '参数缺少值：--platform'
      platform=$1
      shift
      ;;
    --tag=*) tag=${argument#*=} ;;
    --tag)
      [ "$#" -gt 0 ] || fail '参数缺少值：--tag'
      tag=$1
      shift
      ;;
    --edition=*) edition=${argument#*=} ;;
    --edition)
      [ "$#" -gt 0 ] || fail '参数缺少值：--edition'
      edition=$1
      shift
      ;;
    --*) fail "不支持的参数：$argument" ;;
    *) fail "不支持的参数：$argument" ;;
  esac
done

[ -n "$platform" ] || platform=$(default_platform)
[ -n "$tag" ] || tag=$RELEASE_VERSION

case "$architecture" in
  small|standard|all) ;;
  *) fail '--architecture 只允许 small、standard 或 all' ;;
esac
case "$edition" in
  public|enterprise) ;;
  *) fail '--edition 只允许 public 或 enterprise' ;;
esac
assert_platform "$platform"

printf '%s\n' '开始构建 Agent Release Bundle。'
sh "$REPOSITORY_ROOT/docker/build-tools/build-agent-release-bundle-docker.sh"

build_target() {
  target_name=$1
  dockerfile=$2
  uses_product_edition=$3

  printf '开始本地构建 %s:%s (%s，%s 品牌)\n' "$target_name" "$tag" "$platform" "$edition"
  set -- docker buildx build --load --platform "$platform" --tag "$target_name:$tag"
  if [ "$uses_product_edition" = true ]; then
    set -- "$@" --build-arg "VITE_PRODUCT_EDITION=$edition"
  fi
  set -- "$@" --file "$REPOSITORY_ROOT/$dockerfile" "$REPOSITORY_ROOT"
  "$@"
}

build_standard_targets() {
  build_target gcac-db docker/build-tools/Dockerfile.db false
  build_target gcac-backend docker/build-tools/Dockerfile.backend false
  build_target gcac-web docker/build-tools/Dockerfile.web true
  build_target gcac-browser-runtime docker/build-tools/Dockerfile.browser-runtime false
}

resolve_image_target() {
  case "$image" in
    gcac-small) build_target gcac-small docker/build-tools/Dockerfile.small true ;;
    gcac-db) build_target gcac-db docker/build-tools/Dockerfile.db false ;;
    gcac-backend) build_target gcac-backend docker/build-tools/Dockerfile.backend false ;;
    gcac-web) build_target gcac-web docker/build-tools/Dockerfile.web true ;;
    gcac-browser-runtime) build_target gcac-browser-runtime docker/build-tools/Dockerfile.browser-runtime false ;;
    *) fail "未知镜像：$image。可选镜像：gcac-small、gcac-db、gcac-backend、gcac-web、gcac-browser-runtime" ;;
  esac
}

if [ -n "$image" ]; then
  resolve_image_target
else
  case "$architecture" in
    small)
      build_target gcac-small docker/build-tools/Dockerfile.small true
      ;;
    standard)
      build_standard_targets
      ;;
    all)
      build_target gcac-small docker/build-tools/Dockerfile.small true
      build_standard_targets
      ;;
  esac
fi

if [ -n "$image" ]; then
  printf '本地 Docker 构建完成：%s:%s\n' "$image" "$tag"
elif [ "$architecture" = small ]; then
  printf '本地 Docker 构建完成：gcac-small:%s\n' "$tag"
elif [ "$architecture" = standard ]; then
  printf '本地 Docker 构建完成：gcac-db:%s, gcac-backend:%s, gcac-web:%s, gcac-browser-runtime:%s\n' "$tag" "$tag" "$tag" "$tag"
else
  printf '本地 Docker 构建完成：gcac-small:%s, gcac-db:%s, gcac-backend:%s, gcac-web:%s, gcac-browser-runtime:%s\n' "$tag" "$tag" "$tag" "$tag" "$tag"
fi
