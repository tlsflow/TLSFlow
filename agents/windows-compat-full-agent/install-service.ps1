param(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][string]$ConfigPath
)

$ErrorActionPreference = "Stop"
$serviceName = "GCACWindowsCompatibilityAgent"
$binaryPath = Join-Path $InstallRoot "GCAC.WindowsCompatibilityAgent.exe"
if (-not (Test-Path -LiteralPath $binaryPath)) { throw "Agent executable not found: $binaryPath" }
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Agent config not found: $ConfigPath" }

$quotedBinary = '"' + $binaryPath + '" --config "' + $ConfigPath + '"'
$serviceLog = Join-Path $InstallRoot "service-install.log"
[System.IO.File]::WriteAllText($serviceLog, "", (New-Object System.Text.UTF8Encoding($false)))

function Write-ServiceLog {
    param(
        [Parameter(Mandatory = $true)][string]$Message
    )

    [System.IO.File]::AppendAllText($serviceLog, ($Message + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
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
& sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000/none/0 1>> $serviceLog 2>&1
if ($LASTEXITCODE -ne 0) { Write-ServiceLog -Message ("Service recovery configuration skipped. exitCode=" + $LASTEXITCODE) }
Start-Service -Name $serviceName -ErrorAction Stop
$firewallRuleName = "GCAC Windows Compatibility Agent Direct Control"
& netsh.exe advfirewall firewall delete rule name=$firewallRuleName 1>> $serviceLog 2>&1
& netsh.exe advfirewall firewall add rule name=$firewallRuleName dir=in action=allow protocol=TCP localport=18933 program=$binaryPath enable=yes 1>> $serviceLog 2>&1
if ($LASTEXITCODE -ne 0) { throw "Direct Control firewall rule configuration failed" }
