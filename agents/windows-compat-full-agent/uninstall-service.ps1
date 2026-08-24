$ErrorActionPreference = "Stop"
$serviceName = "GCACWindowsCompatibilityAgent"
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($null -eq $service) { return }
if ($service.Status -ne "Stopped") {
    Stop-Service -Name $serviceName -Force -ErrorAction Stop
    $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
}
$service.Close()
& sc.exe delete $serviceName
if ($LASTEXITCODE -ne 0) { throw "Service deletion failed" }

$deleteDeadline = [DateTime]::UtcNow.AddSeconds(30)
do {
    $remainingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $remainingService) { return }
    $remainingService.Close()
    Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $deleteDeadline)

throw "Service deletion timed out"
