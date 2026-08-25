[CmdletBinding()]
param([ValidateSet('start','stop','restart','status')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'; $serviceName = 'GCACWindowsAdcsAgent'
switch ($Action) {
  'start' { Start-Service -Name $serviceName }
  'stop' { Stop-Service -Name $serviceName -Force }
  'restart' { Restart-Service -Name $serviceName -Force }
  'status' { Get-Service -Name $serviceName }
}
