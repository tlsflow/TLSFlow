[CmdletBinding()]
param(
  [string]$ServiceName = 'GCACWindowsCompatibilityAgent'
)
$ErrorActionPreference = 'Stop'
$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -ne $service) {
  if ($service.Status -ne 'Stopped') { Stop-Service -Name $ServiceName -Force }
  & sc.exe delete $ServiceName | Out-Null
}
& netsh.exe advfirewall firewall delete rule name='GCAC Windows Compatibility Agent Management TCP 18932' 2>$null | Out-Null
Write-Output "Compatibility Go Agent service removed: $ServiceName"
