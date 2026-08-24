$ErrorActionPreference = 'Stop'

$outputDirectory = Join-Path $PSScriptRoot 'dist'
$pluginOutputDirectory = Join-Path $outputDirectory 'plugins'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $pluginOutputDirectory | Out-Null
$originalCgoEnabled = $env:CGO_ENABLED
$originalGoos = $env:GOOS
$originalGoarch = $env:GOARCH

Push-Location $PSScriptRoot
try {
  go test ./...
  foreach ($architecture in @('amd64', 'arm64')) {
    $outputPath = Join-Path $outputDirectory "gcac-agent.windows-$architecture.exe"
    $temporaryPath = "$outputPath.tmp.$PID"
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    $env:CGO_ENABLED = '0'
    $env:GOOS = 'windows'
    $env:GOARCH = $architecture
    go build -trimpath -o $temporaryPath .
    Move-Item -LiteralPath $temporaryPath -Destination $outputPath -Force
    Get-FileHash -Algorithm SHA256 -LiteralPath $outputPath

    $pluginOutputPath = Join-Path $pluginOutputDirectory "windows-runtime-discovery.windows-$architecture.exe"
    $pluginTemporaryPath = "$pluginOutputPath.tmp.$PID"
    Remove-Item -LiteralPath $pluginTemporaryPath -Force -ErrorAction SilentlyContinue
    $env:CGO_ENABLED = '0'
    $env:GOOS = 'windows'
    $env:GOARCH = $architecture
    go build -trimpath -o $pluginTemporaryPath ./agent-side-plugins/windows-runtime-discovery
    Move-Item -LiteralPath $pluginTemporaryPath -Destination $pluginOutputPath -Force
    Get-FileHash -Algorithm SHA256 -LiteralPath $pluginOutputPath
  }
  # 兼容尚未重启的旧后端安装器；新后端只从 dist 读取发布物。
  Copy-Item -LiteralPath (Join-Path $outputDirectory 'gcac-agent.windows-amd64.exe') -Destination (Join-Path $PSScriptRoot 'gcac-agent.exe') -Force
  Copy-Item -LiteralPath (Join-Path $pluginOutputDirectory 'windows-runtime-discovery.windows-amd64.exe') -Destination (Join-Path $pluginOutputDirectory 'windows-runtime-discovery.exe') -Force
} finally {
  if ($null -eq $originalCgoEnabled) { Remove-Item Env:CGO_ENABLED -ErrorAction SilentlyContinue } else { $env:CGO_ENABLED = $originalCgoEnabled }
  if ($null -eq $originalGoos) { Remove-Item Env:GOOS -ErrorAction SilentlyContinue } else { $env:GOOS = $originalGoos }
  if ($null -eq $originalGoarch) { Remove-Item Env:GOARCH -ErrorAction SilentlyContinue } else { $env:GOARCH = $originalGoarch }
  Pop-Location
}
