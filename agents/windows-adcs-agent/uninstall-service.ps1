[CmdletBinding()]
param([string]$InstallRoot = 'C:\Program Files\GCAC\WindowsAdcsAgent')
$ErrorActionPreference = 'Stop'
if ($InstallRoot -ne 'C:\Program Files\GCAC\WindowsAdcsAgent') { throw 'AD CS Agent installation path is fixed and isolated.' }
$serviceName = 'GCACWindowsAdcsAgent'
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($null -ne $existing) { if ($existing.Status -ne 'Stopped') { Stop-Service -Name $serviceName -Force }; & sc.exe delete $serviceName | Out-Null }
$binaryPath = Join-Path $InstallRoot 'gcac-adcs-agent.exe'
& netsh.exe advfirewall firewall delete rule name='GCAC Windows AD CS Agent Management TCP 18933' 2>$null | Out-Null
if (Test-Path -LiteralPath $binaryPath) { Remove-Item -LiteralPath $binaryPath -Force }
Write-Host 'GCAC Windows AD CS Agent service removed.'
