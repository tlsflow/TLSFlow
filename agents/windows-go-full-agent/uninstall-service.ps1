[CmdletBinding()]
param(
  [string]$ServiceName = "gcac-agent"
)

$ErrorActionPreference = "Stop"

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -eq $service) {
  Write-Host "Service not found: $ServiceName"
  exit 0
}

if ($service.Status -ne "Stopped") {
  Stop-Service -Name $ServiceName -Force
  Start-Sleep -Seconds 1
}

sc.exe delete $ServiceName | Out-Null
Write-Host "Service removed: $ServiceName"
