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
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

case "$OUTPUT_ROOT/" in
  "$REPOSITORY_ROOT"/*) ;;
  *) fail "Refusing to write outside repository: $OUTPUT_ROOT" ;;
esac

full_image=$(awk -F'"' '/"full"[[:space:]]*:/ { print $4; exit }' "$VERSIONS_FILE")
compatibility_image=$(awk -F'"' '/"compatibility"[[:space:]]*:/ { print $4; exit }' "$VERSIONS_FILE")
[ -n "$full_image" ] || fail 'versions.json is missing the Full Agent Go builder image version'
[ -n "$compatibility_image" ] || fail 'versions.json is missing the Compatibility Agent Go builder image version'

rm -rf "$OUTPUT_ROOT"
mkdir -p "$OUTPUT_ROOT"

set -- docker buildx build --pull --progress plain \
  --build-arg "GO_FULL_IMAGE=$full_image" \
  --build-arg "GO_COMPAT_IMAGE=$compatibility_image"
[ -n "${GCAC_GO_PROXY:-}" ] && set -- "$@" --build-arg "GO_PROXY=$GCAC_GO_PROXY"
set -- "$@" --file "$REPOSITORY_ROOT/docker/build-tools/Dockerfile.agent-release-bundle" \
  --output "type=local,dest=$OUTPUT_ROOT" "$REPOSITORY_ROOT"

if ! "$@"; then
  fail 'Docker Agent Bundle build failed. Check the Docker daemon, Buildx, and Go base image downloads.'
fi

printf 'Docker generated the Agent Release Bundle: %s\n' "$OUTPUT_ROOT"
