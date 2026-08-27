#!/bin/sh
set -eu

MANIFEST_PATH=${1:-}
TARGET_ARCH=${TARGETARCH:-}
ARCHIVE_PATH=/tmp/lego.tar.gz

fail() {
  printf '错误：%s\n' "$1" >&2
  exit 1
}

[ -n "$MANIFEST_PATH" ] || fail '缺少 lego 版本清单路径'

case "$TARGET_ARCH" in
  amd64|arm64) ;;
  *) fail "不支持的 lego Docker 目标架构：${TARGET_ARCH:-未设置}" ;;
esac

lego_version=$(awk '
  /"lego"[[:space:]]*:/ { in_lego=1; next }
  in_lego && /"version"[[:space:]]*:/ {
    line=$0
    sub(/^[^:]*:[[:space:]]*"/, "", line)
    sub(/".*$/, "", line)
    print line
    exit
  }
' "$MANIFEST_PATH")
asset_file=$(grep -A4 "\"linux/$TARGET_ARCH\"" "$MANIFEST_PATH" | sed -n 's/.*"file"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
asset_sha256=$(grep -A4 "\"linux/$TARGET_ARCH\"" "$MANIFEST_PATH" | sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)

printf '%s\n' "$lego_version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' ||
  fail 'lego 版本清单缺少合法版本号'
[ -n "$asset_file" ] && [ -n "$asset_sha256" ] ||
  fail "lego 版本清单缺少 linux/$TARGET_ARCH 资产"
[ "$asset_file" = "lego_v${lego_version}_linux_${TARGET_ARCH}.tar.gz" ] ||
  fail "lego 资产文件名必须为 lego_v${lego_version}_linux_${TARGET_ARCH}.tar.gz"
printf '%s\n' "$asset_sha256" | grep -Eq '^[a-f0-9]{64}$' ||
  fail "lego linux/$TARGET_ARCH SHA-256 格式不合法"

url="https://github.com/go-acme/lego/releases/download/v${lego_version}/${asset_file}"
curl -fsSLo "$ARCHIVE_PATH" "$url"
actual_sha256=$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')
[ "$actual_sha256" = "$asset_sha256" ] ||
  fail "lego 下载文件 SHA-256 不匹配：期望 $asset_sha256，实际 $actual_sha256"

tar -xzf "$ARCHIVE_PATH" -C /usr/local/bin lego
chmod 0755 /usr/local/bin/lego
/usr/local/bin/lego --version
