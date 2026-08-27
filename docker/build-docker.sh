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
  printf '%s\n' "GCAC $RELEASE_VERSION Docker 镜像构建列表："
  printf '%s\n' '  0. 构建全部镜像'
  printf '%s\n' '  1. gcac-small（单机版）'
  printf '%s\n' '  2. gcac-db（标准版数据库）'
  printf '%s\n' '  3. gcac-backend（标准版后端）'
  printf '%s\n' '  4. gcac-web（标准版前端）'
  printf '%s\n' '  5. gcac-browser-runtime（标准版浏览器运行时）'
  printf '%s\n' '  q. 退出'
}

print_help() {
  printf '%s\n' '用法：sh docker/build-docker.sh [数字] [选项]'
  printf '%s\n' '不传数字时显示交互式构建列表；默认镜像标签读取根目录 version 文件。'
  printf '%s\n' '选项：--all、--architecture small|standard|all、--image <镜像>、--platform <平台>、--edition public|enterprise、--list、--help'
  print_choices
}

normalize_image_name() {
  case "$1" in
    browserRuntime) printf '%s\n' 'gcac-browser-runtime' ;;
    gcac-*) printf '%s\n' "$1" ;;
    *) printf 'gcac-%s\n' "$1" ;;
  esac
}

fail() {
  printf '错误：%s\n' "$1" >&2
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
      [ "$#" -gt 0 ] || fail '参数缺少值：--architecture'
      architecture=$1
      shift
      ;;
    --image=*)
      image=$(normalize_image_name "${argument#*=}")
      ;;
    --image)
      [ "$#" -gt 0 ] || fail '参数缺少值：--image'
      image=$(normalize_image_name "$1")
      shift
      ;;
    --platform=*)
      platform=${argument#*=}
      ;;
    --platform)
      [ "$#" -gt 0 ] || fail '参数缺少值：--platform'
      platform=$1
      shift
      ;;
    --edition=*)
      edition=${argument#*=}
      ;;
    --edition)
      [ "$#" -gt 0 ] || fail '参数缺少值：--edition'
      edition=$1
      shift
      ;;
    [0-9]*)
      [ -z "$selection" ] || fail '只能选择一个构建菜单项'
      selection=$argument
      ;;
    --*)
      fail "不支持的参数：$argument"
      ;;
    *)
      fail "不支持的参数：$argument"
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
  fail '--architecture/--all 与 --image/数字选择不能同时使用'
fi

if [ -z "$selection" ] && [ -z "$image" ] && [ -z "$architecture" ]; then
  print_choices
  printf '%s' '请选择构建项（输入数字或 q）：'
  IFS= read -r selection
fi

if [ -n "$selection" ]; then
  case "$selection" in
    q|quit|exit|'')
      printf '%s\n' '已退出 Docker 镜像构建。'
      exit 0
      ;;
    0)
      architecture=all
      ;;
    1)
      image=gcac-small
      ;;
    2)
      image=gcac-db
      ;;
    3)
      image=gcac-backend
      ;;
    4)
      image=gcac-web
      ;;
    5)
      image=gcac-browser-runtime
      ;;
    *)
      fail "无效选择：$selection，请输入 0-5 或 q"
      ;;
  esac
fi

if [ -n "$architecture" ]; then
  case "$architecture" in
    small|standard|all) ;;
    *) fail '--architecture 只允许 small、standard 或 all' ;;
  esac
  label="构建 $architecture 架构镜像"
  set -- --architecture "$architecture"
elif [ -n "$image" ]; then
  case "$image" in
    gcac-small|gcac-db|gcac-backend|gcac-web|gcac-browser-runtime) ;;
    *) fail "未知镜像：$image" ;;
  esac
  label="构建 $image"
  set -- --image "$image"
else
  fail '缺少构建目标'
fi

[ -n "$platform" ] && set -- "$@" --platform "$platform"
[ -n "$edition" ] && set -- "$@" --edition "$edition"

printf 'GCAC %s Docker 镜像构建：%s\n' "$RELEASE_VERSION" "$label"
exec sh "$BUILD_SCRIPT" "$@"
