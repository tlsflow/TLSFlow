[CmdletBinding()]
param(
  [string]$ServiceName = "gcac-full-agent-ps"
)

$ErrorActionPreference = "Stop"

$principal = [Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Administrator privileges are required to uninstall the Windows Service."
}

$metadataPath = "C:\ProgramData\GCAC\FullAgent\service.install.json"
$installedNssmExe = "C:\Program Files\GCAC\FullAgentPS\vendor\nssm\win64\nssm.exe"
if (Test-Path -LiteralPath $metadataPath) {
  try {
    $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    if (-not [string]::IsNullOrWhiteSpace([string]$metadata.NssmExe)) {
      $installedNssmExe = [string]$metadata.NssmExe
    }
  } catch {
  }
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -ne $service) {
  if ($service.Status -ne "Stopped") {
    if (Test-Path -LiteralPath $installedNssmExe) {
      & $installedNssmExe stop $ServiceName confirm | Out-Null
    }
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $installedNssmExe) {
    & $installedNssmExe remove $ServiceName confirm | Out-Null
  } else {
    sc.exe delete $ServiceName | Out-Null
  }
  Write-Host "Service deleted: $ServiceName"
} else {
  Write-Host "Service not found, skipping delete: $ServiceName"
}

Write-Host "Note: files under Program Files / ProgramData are preserved by default."
