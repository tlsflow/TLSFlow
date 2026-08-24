param(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$PublicKeyFile,
    [Parameter(Mandatory = $true)][string]$SignatureFile,
    [Parameter(Mandatory = $true)][string]$SignatureVerifier,
    [switch]$NoStartAfterInstall
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$serviceName = "GCACWindowsCompatibilityAgent"
$binaryPath = Join-Path $InstallRoot "GCAC.WindowsCompatibilityAgent.exe"
if (-not (Test-Path -LiteralPath $binaryPath)) { throw "Agent executable not found: $binaryPath" }
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Agent config not found: $ConfigPath" }
$signatureScript = Join-Path $scriptRoot "release\verify-signature.ps1"
if (-not (Test-Path -LiteralPath $signatureScript)) { throw "Agent release signature verifier not found: $signatureScript" }
& $signatureScript -PublicKeyFile $PublicKeyFile -ArtifactPath $binaryPath -SignatureFile $SignatureFile -SignatureVerifier $SignatureVerifier

$quotedBinary = '"' + $binaryPath + '" --config "' + $ConfigPath + '"'
$serviceLog = Join-Path $InstallRoot "service-install.log"
[System.IO.File]::WriteAllText($serviceLog, "", (New-Object System.Text.UTF8Encoding($false)))

function Write-ServiceLog {
    param(
        [Parameter(Mandatory = $true)][string]$Message
    )

    [System.IO.File]::AppendAllText($serviceLog, ($Message + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
}

function Assert-ServiceRegistration {
    param(
        [Parameter(Mandatory = $true)][string]$ExpectedBinaryPathName
    )

    $registeredService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $registeredService) {
        throw "Service registration failed: $serviceName"
    }

    $serviceInfo = Get-WmiObject -Class Win32_Service -Filter ("Name='" + $serviceName.Replace("'", "''") + "'") -ErrorAction Stop
    if ($null -eq $serviceInfo) {
        throw "Service registration metadata unavailable: $serviceName"
    }
    if (-not [string]::Equals(([string]$serviceInfo.PathName).Trim(), $ExpectedBinaryPathName.Trim(), [StringComparison]::OrdinalIgnoreCase)) {
        throw "Service binary path binding mismatch: $serviceName"
    }
    if (-not [string]::Equals([string]$serviceInfo.StartMode, "Auto", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Service startup mode binding mismatch: $serviceName"
    }
}

$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($null -eq $existing) {
    try {
        New-Service -Name $serviceName -BinaryPathName $quotedBinary -DisplayName "GCAC Windows Compatibility Agent" -StartupType Automatic -ErrorAction Stop | Out-Null
        Write-ServiceLog -Message "Service created."
    } catch {
        Write-ServiceLog -Message $_.Exception.ToString()
        throw ("Service create failed; log=" + $serviceLog)
    }
} else {
    if ([string]$existing.Status -ne "Stopped") { Stop-Service -Name $serviceName -Force -ErrorAction Stop }
    $wmiService = Get-WmiObject -Class Win32_Service -Filter ("Name='" + $serviceName + "'") -ErrorAction Stop
    $changeParameters = $wmiService.GetMethodParameters("Change")
    $changeParameters["DisplayName"] = "GCAC Windows Compatibility Agent"
    $changeParameters["PathName"] = $quotedBinary
    $changeParameters["StartMode"] = "Automatic"
    $changeResult = $wmiService.InvokeMethod("Change", $changeParameters, $null)
    if ($changeResult.ReturnValue -ne 0) {
        Write-ServiceLog -Message ("Win32_Service.Change failed. returnValue=" + $changeResult.ReturnValue)
        throw ("Service update failed. returnValue=" + $changeResult.ReturnValue + "; log=" + $serviceLog)
    }
    Write-ServiceLog -Message "Service configuration updated."
}

$serviceRegistryPath = "HKLM:\SYSTEM\CurrentControlSet\Services\" + $serviceName
Set-ItemProperty -LiteralPath $serviceRegistryPath -Name Description -Value "GCAC compatibility product line for Windows Server 2008 R2 SP1 through 2012 R2" -ErrorAction Stop
& sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000 1>> $serviceLog 2>&1
if ($LASTEXITCODE -ne 0) { Write-ServiceLog -Message ("Service recovery configuration skipped. exitCode=" + $LASTEXITCODE) }
Assert-ServiceRegistration -ExpectedBinaryPathName $quotedBinary
if ($NoStartAfterInstall) {
    Write-ServiceLog -Message "Service installed without starting."
} else {
    Start-Service -Name $serviceName -ErrorAction Stop
    $service = Get-Service -Name $serviceName -ErrorAction Stop
    if ([string]$service.Status -ne "Running") {
        $service.WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
    }
    $service = Get-Service -Name $serviceName -ErrorAction Stop
    if ([string]$service.Status -ne "Running") {
        Write-ServiceLog -Message ("Service did not reach Running after start. status=" + $service.Status)
        throw ("Service start failed; log=" + $serviceLog)
    }
    Write-ServiceLog -Message ("Service started. status=" + $service.Status)
}
