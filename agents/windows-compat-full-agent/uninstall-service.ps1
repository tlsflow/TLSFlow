$ErrorActionPreference = "Stop"
$serviceName = "GCACWindowsCompatibilityAgent"
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($null -eq $service) { return }
if ($service.Status -ne "Stopped") { Stop-Service -Name $serviceName -Force; $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30)) }
& sc.exe delete $serviceName
if ($LASTEXITCODE -ne 0) { throw "Service deletion failed" }
