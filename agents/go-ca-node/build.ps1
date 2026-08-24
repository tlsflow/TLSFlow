$ErrorActionPreference = 'Stop'

$outputDirectory = Join-Path $PSScriptRoot 'dist'
$windowsOutput = Join-Path $outputDirectory 'gcac-ca-node.windows-amd64.exe'
$linuxOutput = Join-Path $outputDirectory 'gcac-ca-node.linux-amd64'

New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

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
