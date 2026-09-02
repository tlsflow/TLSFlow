#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
BUILD_SCRIPT="$SCRIPT_DIR/build-tools/build-local.sh"
RELEASE_VERSION=$(tr -d '[:space:]' < "$REPOSITORY_ROOT/version")

architecture=
image=
selection=
platform=
edition=
list_only=false
help=false

print_choices() {
  printf '%s\n' "GCAC $RELEASE_VERSION Docker image build targets:"
  printf '%s\n' '  0. Build all images'
  printf '%s\n' '  1. tlsflow-small (standalone)'
  printf '%s\n' '  2. tlsflow-db (standard database)'
  printf '%s\n' '  3. tlsflow-backend (standard backend)'
  printf '%s\n' '  4. tlsflow-web (standard web)'
  printf '%s\n' '  5. tlsflow-browser-runtime (standard browser runtime)'
  printf '%s\n' '  q. Quit'
}

print_help() {
  printf '%s\n' 'Usage: sh docker/build-docker.sh [number] [options]'
  printf '%s\n' 'Without a number, show the interactive build list; the default image tag comes from the root version file.'
  printf '%s\n' 'Options: --all, --architecture small|standard|all, --image <image>, --platform <platform>, --edition public|enterprise, --list, --help'
  print_choices
}

normalize_image_name() {
  case "$1" in
    browserRuntime) printf '%s\n' 'tlsflow-browser-runtime' ;;
    tlsflow-*) printf '%s\n' "$1" ;;
    *) printf 'tlsflow-%s\n' "$1" ;;
  esac
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

while [ "$#" -gt 0 ]; do
  argument=$1
  shift
  case "$argument" in
    --all)
      architecture=all
      ;;
    --list)
      list_only=true
      ;;
    --help|-h)
      help=true
      ;;
    --architecture=*)
      architecture=${argument#*=}
      ;;
    --architecture)
      [ "$#" -gt 0 ] || fail 'Missing value for argument: --architecture'
      architecture=$1
      shift
      ;;
    --image=*)
      image=$(normalize_image_name "${argument#*=}")
      ;;
    --image)
      [ "$#" -gt 0 ] || fail 'Missing value for argument: --image'
      image=$(normalize_image_name "$1")
      shift
      ;;
    --platform=*)
      platform=${argument#*=}
      ;;
    --platform)
      [ "$#" -gt 0 ] || fail 'Missing value for argument: --platform'
      platform=$1
      shift
      ;;
    --edition=*)
      edition=${argument#*=}
      ;;
    --edition)
      [ "$#" -gt 0 ] || fail 'Missing value for argument: --edition'
      edition=$1
      shift
      ;;
    [0-9]*)
      [ -z "$selection" ] || fail 'Only one build menu item may be selected'
      selection=$argument
      ;;
    --*)
      fail "Unsupported argument: $argument"
      ;;
    *)
      fail "Unsupported argument: $argument"
      ;;
  esac
done

[ "$help" = true ] && {
  print_help
  exit 0
}
[ "$list_only" = true ] && {
  print_choices
  exit 0
}

if [ -n "$architecture" ] && { [ -n "$selection" ] || [ -n "$image" ]; }; then
  fail '--architecture/--all cannot be combined with --image or a numeric selection'
fi

if [ -z "$selection" ] && [ -z "$image" ] && [ -z "$architecture" ]; then
  print_choices
  printf '%s' 'Select a build target (number or q): '
  IFS= read -r selection
fi

if [ -n "$selection" ]; then
  case "$selection" in
    q|quit|exit|'')
      printf '%s\n' 'Docker image build exited.'
      exit 0
      ;;
    0)
      architecture=all
      ;;
    1)
      image=tlsflow-small
      ;;
    2)
      image=tlsflow-db
      ;;
    3)
      image=tlsflow-backend
      ;;
    4)
      image=tlsflow-web
      ;;
    5)
      image=tlsflow-browser-runtime
      ;;
    *)
      fail "Invalid selection: $selection; enter 0-5 or q"
      ;;
  esac
fi

if [ -n "$architecture" ]; then
  case "$architecture" in
    small|standard|all) ;;
    *) fail '--architecture must be small, standard, or all' ;;
  esac
  label="Build $architecture architecture images"
  set -- --architecture "$architecture"
elif [ -n "$image" ]; then
  case "$image" in
    tlsflow-small|tlsflow-db|tlsflow-backend|tlsflow-web|tlsflow-browser-runtime) ;;
    *) fail "Unknown image: $image" ;;
  esac
  label="Build $image"
  set -- --image "$image"
else
  fail 'Missing build target'
fi

[ -n "$platform" ] && set -- "$@" --platform "$platform"
[ -n "$edition" ] && set -- "$@" --edition "$edition"

printf 'GCAC %s Docker image build: %s\n' "$RELEASE_VERSION" "$label"
exec sh "$BUILD_SCRIPT" "$@"
