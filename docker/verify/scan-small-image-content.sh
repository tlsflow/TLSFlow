#!/bin/sh
set -eu

FORBIDDEN_PATTERN='chromium|google-chrome|xvfb|x11vnc|novnc|websockify|playwright(-core)?'
SCRIPT_NAME=$(basename "$0")
findings_file=$(mktemp)
trap 'rm -f "$findings_file"' EXIT INT TERM

scan_root() {
  root=$1
  [ -e "$root" ] || return 0

  find "$root" -print 2>/dev/null | while IFS= read -r path; do
    name=$(basename "$path")
    if printf '%s\n' "$name" | grep -Eiq "$FORBIDDEN_PATTERN"; then
      printf '%s\n' "$path" >> "$findings_file"
      continue
    fi

    [ -f "$path" ] || continue
    [ "$name" = "$SCRIPT_NAME" ] && continue
    case "$name" in
      package.json|npm-shrinkwrap.json) ;;
      *) continue ;;
    esac

    if grep -Eiq '"(chromium|google-chrome|xvfb|x11vnc|novnc|websockify|playwright(-core)?)"[[:space:]]*:' "$path" 2>/dev/null; then
      printf '%s\n' "$path" >> "$findings_file"
    fi
  done
}

for root in "$@"; do
  scan_root "$root"
done

if [ -s "$findings_file" ]; then
  printf '%s\n' 'Small image contains browser runtime content:' >&2
  sort -u "$findings_file" | while IFS= read -r finding; do
    printf '%s\n' "- $finding" >&2
  done
  exit 1
fi

printf '%s\n' 'Small image content scan passed: no Chromium, Xvfb, VNC, or Playwright browser dependency found'
