#!/bin/sh
set -eu

MANIFEST_PATH=${1:-}
TARGET_ARCH=${TARGETARCH:-}
ARCHIVE_PATH=/tmp/lego.tar.gz

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

[ -n "$MANIFEST_PATH" ] || fail 'lego manifest path is required'

case "$TARGET_ARCH" in
  amd64|arm64) ;;
  *) fail "Unsupported lego Docker target architecture: ${TARGET_ARCH:-unset}" ;;
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
  fail 'lego manifest is missing a valid version'
[ -n "$asset_file" ] && [ -n "$asset_sha256" ] ||
  fail "lego manifest is missing the linux/$TARGET_ARCH asset"
[ "$asset_file" = "lego_v${lego_version}_linux_${TARGET_ARCH}.tar.gz" ] ||
  fail "lego asset filename must be lego_v${lego_version}_linux_${TARGET_ARCH}.tar.gz"
printf '%s\n' "$asset_sha256" | grep -Eq '^[a-f0-9]{64}$' ||
  fail "lego linux/$TARGET_ARCH SHA-256 has an invalid format"

url="https://github.com/go-acme/lego/releases/download/v${lego_version}/${asset_file}"
curl -fsSLo "$ARCHIVE_PATH" "$url"
actual_sha256=$(sha256sum "$ARCHIVE_PATH" | awk '{print $1}')
[ "$actual_sha256" = "$asset_sha256" ] ||
  fail "lego download SHA-256 mismatch: expected $asset_sha256, got $actual_sha256"

tar -xzf "$ARCHIVE_PATH" -C /usr/local/bin lego
chmod 0755 /usr/local/bin/lego
/usr/local/bin/lego --version
