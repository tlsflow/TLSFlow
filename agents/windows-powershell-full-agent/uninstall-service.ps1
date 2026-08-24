[CmdletBinding()]
param(
  [string]$ServiceName = "gcac-full-agent-ps"
)

$ErrorActionPreference = "Stop"

$principal = [Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Administrator privileges are required to uninstall the Windows Service."
}

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -ne $service) {
  if ($service.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
  }
  sc.exe delete $ServiceName | Out-Null
  Write-Host "Service deleted: $ServiceName"
} else {
  Write-Host "Service not found, skipping delete: $ServiceName"
}

Write-Host "Note: files under Program Files / ProgramData are preserved by default."
