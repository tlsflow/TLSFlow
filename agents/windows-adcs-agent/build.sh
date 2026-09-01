#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION="${VERSION:-0.1.20}"
mkdir -p "$SCRIPT_DIR/dist"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.agentVersion=$VERSION" -o "$SCRIPT_DIR/dist/gcac-adcs-agent.windows-amd64.exe" "$SCRIPT_DIR"
cp "$SCRIPT_DIR/dist/gcac-adcs-agent.windows-amd64.exe" "$SCRIPT_DIR/gcac-adcs-agent.exe"
sha256sum "$SCRIPT_DIR/dist/gcac-adcs-agent.windows-amd64.exe"
