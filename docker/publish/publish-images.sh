#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
VERSIONS_FILE="$REPOSITORY_ROOT/docker/build-tools/versions.json"
RELEASE_VERSION=$(tr -d '[:space:]' < "$REPOSITORY_ROOT/version")

# Publish public TLSFlow images to tlsflow by default; controlled pipelines may override the namespace.
namespace=${DOCKERHUB_NAMESPACE:-tlsflow}
tag=$RELEASE_VERSION
architecture=all
platforms=linux/amd64,linux/arm64
edition=${VITE_PRODUCT_EDITION:-public}
docs_version=${DOCS_VERSION:-1.0.0}
latest=false

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

normalize_image_name() {
  case "$1" in
    browserRuntime) printf '%s\n' tlsflow-browser-runtime ;;
    tlsflow-*) printf '%s\n' "$1" ;;
    *) printf 'tlsflow-%s\n' "$1" ;;
  esac
}

while [ "$#" -gt 0 ]; do
  argument=$1
  shift
  case "$argument" in
    --latest) latest=true ;;
    --namespace=*) namespace=${argument#*=} ;;
    --namespace)
      [ "$#" -gt 0 ] || fail 'Missing value for argument: --namespace'
      namespace=$1
      shift
      ;;
    --tag=*) tag=${argument#*=} ;;
    --tag)
      [ "$#" -gt 0 ] || fail 'Missing value for argument: --tag'
      tag=$1
      shift
      ;;
    --architecture=*) architecture=${argument#*=} ;;
    --architecture)
      [ "$#" -gt 0 ] || fail 'Missing value for argument: --architecture'
      architecture=$1
      shift
      ;;
    --platforms=*) platforms=${argument#*=} ;;
    --platforms)
      [ "$#" -gt 0 ] || fail 'Missing value for argument: --platforms'
      platforms=$1
      shift
      ;;
    --edition=*) edition=${argument#*=} ;;
    --edition)
      [ "$#" -gt 0 ] || fail 'Missing value for argument: --edition'
      edition=$1
      shift
      ;;
    --*) fail "Unsupported argument: $argument" ;;
    *) fail "Unsupported argument: $argument" ;;
  esac
done

printf '%s\n' "$namespace" | grep -Eq '^[a-z0-9][a-z0-9._-]*$' ||
  fail 'Docker Hub namespace has an invalid format'
case "$architecture" in
  small|standard|all) ;;
  *) fail '--architecture must be small, standard, or all' ;;
esac
case "$edition" in
  public|enterprise) ;;
  *) fail '--edition must be public or enterprise' ;;
esac
[ -n "$platforms" ] || fail '--platforms must not be empty'
old_ifs=$IFS
IFS=,
for platform in $platforms; do
  case "$platform" in
    linux/amd64|linux/arm64) ;;
    *) IFS=$old_ifs; fail "Platform is not in the release matrix: $platform" ;;
  esac
done
IFS=$old_ifs

[ "${GCAC_DOCKER_LOGIN_CONFIRMED:-}" = true ] ||
  fail 'The publish script does not handle Docker Hub credentials; log in from a controlled release environment and set GCAC_DOCKER_LOGIN_CONFIRMED=true'

sh "$REPOSITORY_ROOT/docker/build-tools/build-agent-release-bundle-docker.sh"

publish_target() {
  target_name=$1
  dockerfile=$2
  uses_product_edition=$3
  image="$namespace/$target_name"
  printf 'Publishing %s:%s%s (%s, %s edition)\n' \
    "$image" "$tag" "$([ "$latest" = true ] && printf ', latest' || true)" "$platforms" "$edition"

  set -- docker buildx build --platform "$platforms"
  if [ "$uses_product_edition" = true ]; then
    set -- "$@" --build-arg "VITE_PRODUCT_EDITION=$edition"
    set -- "$@" --build-arg "DOCS_VERSION=$docs_version"
  fi
  set -- "$@" --file "$REPOSITORY_ROOT/$dockerfile" --tag "$image:$tag"
  [ "$latest" = true ] && set -- "$@" --tag "$image:latest"
  set -- "$@" --provenance=true --sbom=true --push "$REPOSITORY_ROOT"
  "$@"
}

publish_standard() {
  publish_target tlsflow-db docker/build-tools/Dockerfile.db false
  publish_target tlsflow-backend docker/build-tools/Dockerfile.backend false
  publish_target tlsflow-web docker/build-tools/Dockerfile.web true
  publish_target tlsflow-browser-runtime docker/build-tools/Dockerfile.browser-runtime false
}

case "$architecture" in
  small)
    publish_target tlsflow-small docker/build-tools/Dockerfile.small true
    ;;
  standard)
    publish_standard
    ;;
  all)
    publish_target tlsflow-small docker/build-tools/Dockerfile.small true
    publish_standard
    ;;
esac

printf 'Docker Hub publish complete: %s/%s:%s\n' "$namespace" "$([ "$architecture" = all ] && printf '%s' 'tlsflow-small and standard images' || printf '%s' "$architecture")" "$tag"
