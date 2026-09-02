#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MANIFEST="$SCRIPT_DIR/versions.json"

fail() {
  printf 'Test failed: %s\n' "$1" >&2
  exit 1
}

assert_asset() {
  arch=$1
  expected_file=$2
  expected_sha256=$3
  actual_file=$(grep -A4 "\"linux/$arch\"" "$MANIFEST" | sed -n 's/.*"file"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  actual_sha256=$(grep -A4 "\"linux/$arch\"" "$MANIFEST" | sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
  [ "$actual_file" = "$expected_file" ] || fail "$arch filename mismatch"
  [ "$actual_sha256" = "$expected_sha256" ] || fail "$arch SHA-256 mismatch"
}

assert_asset amd64 \
  lego_v5.3.1_linux_amd64.tar.gz \
  b3c71b122ee1947eacfe0b809b955647f6377239fe4bfc49f73b1a091ae1252a
assert_asset arm64 \
  lego_v5.3.1_linux_arm64.tar.gz \
  58db563a2b97c2259516fa9910b4a9e1634a0737723d0381a65af1bf93a4b433

if grep -A4 '"linux/386"' "$MANIFEST" >/dev/null 2>&1; then
  fail 'release matrix unexpectedly contains linux/386'
fi

printf '%s\n' 'lego manifest shell test passed'
