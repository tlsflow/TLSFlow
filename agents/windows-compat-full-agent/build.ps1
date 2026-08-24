$ErrorActionPreference = 'Stop'

$version = (go version)
if ($version -notmatch 'go1\.20\.') {
  throw "Compatibility Agent 必须使用 Go 1.20.x，当前为 $version"
}

$root = $PSScriptRoot
$output = Join-Path $root 'dist'
$pluginOutput = Join-Path $output 'plugins'
$iisOutput = Join-Path $output 'web-iis'
New-Item -ItemType Directory -Force -Path $output, $pluginOutput, $iisOutput | Out-Null

Push-Location $root
try {
  go test ./...
  $env:CGO_ENABLED = '0'
  $env:GOOS = 'windows'
  $env:GOARCH = 'amd64'

  $testTargets = @(
    @{ Package = '.'; Path = (Join-Path $output 'GCAC.WindowsCompatibilityAgent.tests.exe') },
    @{ Package = './agent-side-plugins/windows-runtime-discovery'; Path = (Join-Path $pluginOutput 'windows-runtime-discovery.tests.exe') },
    @{ Package = './agent-side-plugins/web-iis'; Path = (Join-Path $iisOutput 'web-iis-agent-side-plugin.tests.exe') }
  )
  foreach ($target in $testTargets) {
    $temporary = "$($target.Path).tmp.$PID"
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    go test -c -o $temporary $target.Package
    Move-Item -LiteralPath $temporary -Destination $target.Path -Force
    Get-FileHash -Algorithm SHA256 -LiteralPath $target.Path
  }

  $targets = @(
    @{ Package = '.'; Path = (Join-Path $output 'GCAC.WindowsCompatibilityAgent.exe') },
    @{ Package = './cmd/gcac-agent-updater'; Path = (Join-Path $output 'gcac-agent-updater.exe') },
    @{ Package = './agent-side-plugins/windows-runtime-discovery'; Path = (Join-Path $pluginOutput 'windows-runtime-discovery.exe') },
    @{ Package = './agent-side-plugins/web-iis'; Path = (Join-Path $iisOutput 'web-iis-agent-side-plugin.exe') }
  )
  foreach ($target in $targets) {
    $temporary = "$($target.Path).tmp.$PID"
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    go build -trimpath -o $temporary $target.Package
    Move-Item -LiteralPath $temporary -Destination $target.Path -Force
    Get-FileHash -Algorithm SHA256 -LiteralPath $target.Path
  }
  Copy-Item -LiteralPath (Join-Path $output 'GCAC.WindowsCompatibilityAgent.exe') -Destination (Join-Path $root 'GCAC.WindowsCompatibilityAgent.exe') -Force
  Copy-Item -LiteralPath (Join-Path $output 'gcac-agent-updater.exe') -Destination (Join-Path $root 'gcac-agent-updater.exe') -Force
} finally {
  Remove-Item Env:CGO_ENABLED -ErrorAction SilentlyContinue
  Remove-Item Env:GOOS -ErrorAction SilentlyContinue
  Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
  Pop-Location
}
