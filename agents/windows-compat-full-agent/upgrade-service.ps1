param(
    [Parameter(Mandatory = $true)][string]$PackageDirectory,
    [Parameter(Mandatory = $true)][string]$InstallRoot
)

$ErrorActionPreference = "Stop"
$serviceName = "GCACWindowsCompatibilityAgent"
$incoming = Join-Path $PackageDirectory "GCAC.WindowsCompatibilityAgent.exe"
$target = Join-Path $InstallRoot "GCAC.WindowsCompatibilityAgent.exe"
$backup = $target + ".rollback"
if (-not (Test-Path -LiteralPath $incoming)) { throw "Upgrade package is missing the Agent executable" }

$service = Get-Service -Name $serviceName -ErrorAction Stop
if ($service.Status -ne "Stopped") { Stop-Service -Name $serviceName -Force; $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30)) }
if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination $backup -Force }
try {
    Copy-Item -LiteralPath $incoming -Destination $target -Force
    Start-Service -Name $serviceName
}
catch {
    if (Test-Path -LiteralPath $backup) { Copy-Item -LiteralPath $backup -Destination $target -Force }
    Start-Service -Name $serviceName -ErrorAction SilentlyContinue
    throw
}
