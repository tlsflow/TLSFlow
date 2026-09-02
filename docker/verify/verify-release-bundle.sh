#!/bin/sh
set -eu

BUNDLE_ROOT=${1:-/opt/gcac/agent-release-bundle}
MANIFEST_PATH="$BUNDLE_ROOT/manifest.json"

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

[ -f "$MANIFEST_PATH" ] || fail "Agent Release Bundle manifest does not exist: $MANIFEST_PATH"

grep -Eq '"items"[[:space:]]*:[[:space:]]*\[' "$MANIFEST_PATH" ||
  fail 'Agent Release Bundle manifest.items must not be empty'
grep -Eq '"path"[[:space:]]*:[[:space:]]*"[^"]+"' "$MANIFEST_PATH" ||
  fail 'Agent Release Bundle manifest.items must contain paths'
grep -Fq '"runtime": "go"' "$MANIFEST_PATH" ||
  fail 'Compatibility Agent manifest runtime must be go'
grep -Fq '"toolchain": "go1.20"' "$MANIFEST_PATH" ||
  fail 'Compatibility Agent manifest toolchain must be go1.20'
grep -Fq '"productLine": "windows-compat-full-agent"' "$MANIFEST_PATH" ||
  fail 'Compatibility Agent manifest productLine is invalid'
compatibility_block=$(awk '
  /"compatibility"[[:space:]]*:/ { in_compatibility=1 }
  in_compatibility { print }
  in_compatibility && /^[[:space:]]*},[[:space:]]*$/ { exit }
' "$MANIFEST_PATH")
printf '%s\n' "$compatibility_block" | grep -Eq '"architectures"[[:space:]]*:[[:space:]]*\[[[:space:]]*"windows/amd64"[[:space:]]*\]' ||
  fail 'Compatibility Agent manifest architectures must be exactly ["windows/amd64"]'

if awk '
  /"items"[[:space:]]*:/ { in_items=1; next }
  in_items && /"path"[[:space:]]*:/ {
    line=$0
    sub(/^[^"]*"path"[[:space:]]*:[[:space:]]*"/, "", line)
    sub(/".*$/, "", line)
    if (line ~ /\.config$/ || line ~ /^windows\/arm64\/compatibility\//) exit 1
  }
' "$MANIFEST_PATH"; then
  :
else
  fail 'Compatibility Release Bundle must not contain .config or arm64 artifacts'
fi

item_count=0
item_path=
item_size=
item_sha256=
in_items=false

while IFS= read -r line; do
  if printf '%s\n' "$line" | grep -Eq '"items"[[:space:]]*:[[:space:]]*\['; then
    in_items=true
    continue
  fi
  [ "$in_items" = true ] || continue
  case "$line" in
    *'"path"'*) item_path=$(printf '%s\n' "$line" | sed -n 's/.*"path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p') ;;
  esac
  case "$line" in
    *'"size"'*) item_size=$(printf '%s\n' "$line" | sed -n 's/.*"size"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p') ;;
  esac
  case "$line" in
    *'"sha256"'*) item_sha256=$(printf '%s\n' "$line" | sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p') ;;
  esac

  if [ -n "$item_path" ] && [ -n "$item_size" ] && [ -n "$item_sha256" ]; then
    case "$item_path" in
      /*|..|../*|*/../*|*/..) fail "Agent Release Bundle path escapes the bundle root: $item_path" ;;
    esac
    file_path="$BUNDLE_ROOT/$item_path"
    [ -f "$file_path" ] || fail "Agent Release Bundle file does not exist: $item_path"
    actual_size=$(wc -c < "$file_path" | tr -d '[:space:]')
    [ "$actual_size" = "$item_size" ] ||
      fail "Agent Release Bundle size mismatch: $item_path"
    actual_sha256=$(sha256sum "$file_path" | awk '{print $1}')
    [ "$actual_sha256" = "$item_sha256" ] ||
      fail "Agent Release Bundle SHA256 mismatch: $item_path"
    item_count=$((item_count + 1))
    item_path=
    item_size=
    item_sha256=
  fi
done < "$MANIFEST_PATH"

[ "$item_count" -gt 0 ] || fail 'Agent Release Bundle manifest.items must not be empty'
version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$MANIFEST_PATH" | head -n 1)
printf 'Agent Release Bundle verification passed: %s, %s files\n' "${version:-unknown}" "$item_count"
