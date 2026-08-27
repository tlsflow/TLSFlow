#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
VERSIONS_FILE="$REPOSITORY_ROOT/docker/build-tools/versions.json"
RELEASE_VERSION=$(tr -d '[:space:]' < "$REPOSITORY_ROOT/version")

namespace=${DOCKERHUB_NAMESPACE:-}
tag=$RELEASE_VERSION
architecture=all
platforms=linux/amd64,linux/arm64
edition=${VITE_PRODUCT_EDITION:-public}
latest=false

fail() {
  printf '错误：%s\n' "$1" >&2
  exit 1
}

normalize_image_name() {
  case "$1" in
    browserRuntime) printf '%s\n' gcac-browser-runtime ;;
    gcac-*) printf '%s\n' "$1" ;;
    *) printf 'gcac-%s\n' "$1" ;;
  esac
}

while [ "$#" -gt 0 ]; do
  argument=$1
  shift
  case "$argument" in
    --latest) latest=true ;;
    --namespace=*) namespace=${argument#*=} ;;
    --namespace)
      [ "$#" -gt 0 ] || fail '参数缺少值：--namespace'
      namespace=$1
      shift
      ;;
    --tag=*) tag=${argument#*=} ;;
    --tag)
      [ "$#" -gt 0 ] || fail '参数缺少值：--tag'
      tag=$1
      shift
      ;;
    --architecture=*) architecture=${argument#*=} ;;
    --architecture)
      [ "$#" -gt 0 ] || fail '参数缺少值：--architecture'
      architecture=$1
      shift
      ;;
    --platforms=*) platforms=${argument#*=} ;;
    --platforms)
      [ "$#" -gt 0 ] || fail '参数缺少值：--platforms'
      platforms=$1
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

[ -n "$namespace" ] || fail '必须通过 --namespace 或 DOCKERHUB_NAMESPACE 指定 Docker Hub 命名空间'
printf '%s\n' "$namespace" | grep -Eq '^[a-z0-9][a-z0-9._-]*$' ||
  fail 'Docker Hub 命名空间格式不合法'
case "$architecture" in
  small|standard|all) ;;
  *) fail '--architecture 只允许 small、standard 或 all' ;;
esac
case "$edition" in
  public|enterprise) ;;
  *) fail '--edition 只允许 public 或 enterprise' ;;
esac
[ -n "$platforms" ] || fail '--platforms 不能为空'
old_ifs=$IFS
IFS=,
for platform in $platforms; do
  case "$platform" in
    linux/amd64|linux/arm64) ;;
    *) IFS=$old_ifs; fail "平台不在发布矩阵中：$platform" ;;
  esac
done
IFS=$old_ifs

[ "${GCAC_DOCKER_LOGIN_CONFIRMED:-}" = true ] ||
  fail '发布脚本不会处理 Docker Hub 凭据；请由受控发布环境先完成 docker login，并设置 GCAC_DOCKER_LOGIN_CONFIRMED=true'

sh "$REPOSITORY_ROOT/docker/build-tools/build-agent-release-bundle-docker.sh"

publish_target() {
  target_name=$1
  dockerfile=$2
  uses_product_edition=$3
  image="$namespace/$target_name"
  printf '开始发布 %s:%s%s (%s，%s 品牌)\n' \
    "$image" "$tag" "$([ "$latest" = true ] && printf ', latest' || true)" "$platforms" "$edition"

  set -- docker buildx build --platform "$platforms"
  if [ "$uses_product_edition" = true ]; then
    set -- "$@" --build-arg "VITE_PRODUCT_EDITION=$edition"
  fi
  set -- "$@" --file "$REPOSITORY_ROOT/$dockerfile" --tag "$image:$tag"
  [ "$latest" = true ] && set -- "$@" --tag "$image:latest"
  set -- "$@" --provenance=true --sbom=true --push "$REPOSITORY_ROOT"
  "$@"
}

publish_standard() {
  publish_target gcac-db docker/build-tools/Dockerfile.db false
  publish_target gcac-backend docker/build-tools/Dockerfile.backend false
  publish_target gcac-web docker/build-tools/Dockerfile.web true
  publish_target gcac-browser-runtime docker/build-tools/Dockerfile.browser-runtime false
}

case "$architecture" in
  small)
    publish_target gcac-small docker/build-tools/Dockerfile.small true
    ;;
  standard)
    publish_standard
    ;;
  all)
    publish_target gcac-small docker/build-tools/Dockerfile.small true
    publish_standard
    ;;
esac

printf 'Docker Hub 发布完成：%s/%s:%s\n' "$namespace" "$([ "$architecture" = all ] && printf '%s' 'gcac-small 等标准镜像' || printf '%s' "$architecture")" "$tag"
