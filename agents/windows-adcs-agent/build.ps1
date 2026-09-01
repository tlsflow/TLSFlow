$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$version = if ($env:VERSION) { $env:VERSION } else { '0.1.27' }
New-Item -ItemType Directory -Force -Path (Join-Path $scriptDir 'dist') | Out-Null
$env:GOOS = 'windows'; $env:GOARCH = 'amd64'; $env:CGO_ENABLED = '0'
go build -trimpath -ldflags "-s -w -X main.agentVersion=$version" -o (Join-Path $scriptDir 'dist/gcac-adcs-agent.windows-amd64.exe') $scriptDir
Copy-Item (Join-Path $scriptDir 'dist/gcac-adcs-agent.windows-amd64.exe') (Join-Path $scriptDir 'gcac-adcs-agent.exe') -Force
Get-FileHash (Join-Path $scriptDir 'dist/gcac-adcs-agent.windows-amd64.exe') -Algorithm SHA256
