param(
    [Parameter(Mandatory = $true)][string]$PackageDirectory,
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][string]$PublicKeyFile,
    [Parameter(Mandatory = $true)][string]$SignatureFile,
    [Parameter(Mandatory = $true)][string]$SignatureVerifier
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceName = "GCACWindowsCompatibilityAgent"
$incoming = Join-Path $PackageDirectory "GCAC.WindowsCompatibilityAgent.exe"
$target = Join-Path $InstallRoot "GCAC.WindowsCompatibilityAgent.exe"
$backup = $target + ".rollback"
$upgradeLog = Join-Path $InstallRoot "service-upgrade.log"
if (-not (Test-Path -LiteralPath $incoming)) { throw "Upgrade package is missing the Agent executable" }
$signatureScript = Join-Path $scriptRoot "release\verify-signature.ps1"
if (-not (Test-Path -LiteralPath $signatureScript)) { throw "Agent release signature verifier not found: $signatureScript" }
& $signatureScript -PublicKeyFile $PublicKeyFile -ArtifactPath $incoming -SignatureFile $SignatureFile -SignatureVerifier $SignatureVerifier

function Write-UpgradeLog {
    param(
        [Parameter(Mandatory = $true)][string]$Message
    )

    [System.IO.File]::AppendAllText($upgradeLog, ($Message + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
}

function Assert-ServiceRegistration {
    param(
        [Parameter(Mandatory = $true)][string]$ExpectedBinaryPath
    )

    $registeredService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $registeredService) {
        throw "Service registration metadata unavailable: $serviceName"
    }

    $serviceInfo = Get-WmiObject -Class Win32_Service -Filter ("Name='" + $serviceName.Replace("'", "''") + "'") -ErrorAction Stop
    if ($null -eq $serviceInfo) {
        throw "Service registration metadata unavailable: $serviceName"
    }
    $expectedBinaryPrefix = ('"' + $ExpectedBinaryPath.Trim() + '"').ToLowerInvariant()
    $actualBinaryPathName = ([string]$serviceInfo.PathName).Trim().ToLowerInvariant()
    if (-not $actualBinaryPathName.StartsWith($expectedBinaryPrefix, [StringComparison]::Ordinal)) {
        throw "Service binary path binding mismatch: $serviceName"
    }
    if (-not [string]::Equals([string]$serviceInfo.StartMode, "Auto", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Service startup mode binding mismatch: $serviceName"
    }
}

$service = Get-Service -Name $serviceName -ErrorAction Stop
if ($service.Status -ne "Stopped") { Stop-Service -Name $serviceName -Force; $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30)) }
if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination $backup -Force }
try {
    Copy-Item -LiteralPath $incoming -Destination $target -Force
    Assert-ServiceRegistration -ExpectedBinaryPath $target
    Start-Service -Name $serviceName
    $service = Get-Service -Name $serviceName -ErrorAction Stop
    if ([string]$service.Status -ne "Running") {
        $service.WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
    }
    $service = Get-Service -Name $serviceName -ErrorAction Stop
    if ([string]$service.Status -ne "Running") {
        throw "Service did not reach Running after upgrade: $serviceName"
    }
}
catch {
    if (Test-Path -LiteralPath $backup) { Copy-Item -LiteralPath $backup -Destination $target -Force }
    Start-Service -Name $serviceName -ErrorAction SilentlyContinue
    throw
}
