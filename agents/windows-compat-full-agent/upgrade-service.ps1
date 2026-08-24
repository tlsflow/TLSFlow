[CmdletBinding()]
param(
  [string]$ServiceName = 'GCACWindowsCompatibilityAgent',
  [string]$InstallRoot = 'C:\Program Files\GCAC\WindowsCompatibilityAgent',
  [Parameter(Mandatory = $true)][string]$PackageRoot,
  [Parameter(Mandatory = $true)][string]$PublicKeyFile,
  [Parameter(Mandatory = $true)][string]$SignatureFile,
  [Parameter(Mandatory = $true)][string]$SignatureVerifier
)
$ErrorActionPreference = 'Stop'
$binary = Join-Path $PackageRoot 'GCAC.WindowsCompatibilityAgent.exe'
$scanner = Join-Path $PackageRoot 'plugins\windows-runtime-discovery.exe'
$iisPlugin = Join-Path $PackageRoot 'web-iis\web-iis-agent-side-plugin.exe'
$updater = Join-Path $PackageRoot 'gcac-agent-updater.exe'
$verify = Join-Path $PackageRoot 'release\verify-signature.ps1'
foreach ($artifact in @($binary, $scanner, $iisPlugin, $updater, $verify)) {
  if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw "Compatibility Go artifact is missing: $artifact" }
}
& $verify -PublicKeyFile $PublicKeyFile -ArtifactPath $binary -SignatureFile $SignatureFile -SignatureVerifier $SignatureVerifier
$service = Get-Service -Name $ServiceName -ErrorAction Stop
$targets = @{
  (Join-Path $InstallRoot 'GCAC.WindowsCompatibilityAgent.exe') = $binary
  (Join-Path $InstallRoot 'plugins\windows-runtime-discovery.exe') = $scanner
  (Join-Path $InstallRoot 'plugins\web-iis-agent-side-plugin.exe') = $iisPlugin
  (Join-Path $InstallRoot 'gcac-agent-updater.exe') = $updater
}
$backups = @{}
if ($service.Status -ne 'Stopped') { Stop-Service -Name $ServiceName -Force }
try {
  New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot 'plugins') | Out-Null
  foreach ($target in $targets.Keys) {
    $backup = "$target.rollback"
    $backups[$target] = $backup
    if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination $backup -Force }
    Copy-Item -LiteralPath $targets[$target] -Destination $target -Force
  }
  Start-Service -Name $ServiceName
} catch {
  foreach ($target in $targets.Keys) {
    $backup = $backups[$target]
    if ($backup -and (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $backup -Destination $target -Force }
  }
  Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
  throw
}
Write-Output "Compatibility Go Agent upgraded: $InstallRoot"
