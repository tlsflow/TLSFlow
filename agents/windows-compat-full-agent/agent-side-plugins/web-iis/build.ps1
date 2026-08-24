$ErrorActionPreference = 'Stop'
$version = go version
if ($version -notmatch 'go1\.20\.') { throw "web.iis Plugin 必须使用 Go 1.20.x，当前为 $version" }
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$output = Join-Path $root 'dist\web-iis\web-iis-agent-side-plugin.exe'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output) | Out-Null
Push-Location $root
try {
  $env:CGO_ENABLED = '0'; $env:GOOS = 'windows'; $env:GOARCH = 'amd64'
  go build -trimpath -o $output ./agent-side-plugins/web-iis
  Get-FileHash -Algorithm SHA256 -LiteralPath $output
} finally {
  Remove-Item Env:CGO_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:GOOS -ErrorAction SilentlyContinue
  Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
  Pop-Location
}
