$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$windowsOutput = Join-Path $root 'windows-go-ca-node/gcac-ca-node.exe'
$linuxOutput = Join-Path $root 'linux-go-ca-node/gcac-ca-node'

Push-Location $PSScriptRoot
try {
  go test ./...
  $env:GOOS = 'windows'
  $env:GOARCH = 'amd64'
  go build -trimpath -o $windowsOutput .
  $env:GOOS = 'linux'
  $env:GOARCH = 'amd64'
  go build -trimpath -o $linuxOutput .
} finally {
  Remove-Item Env:GOOS -ErrorAction SilentlyContinue
  Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
  Pop-Location
}
