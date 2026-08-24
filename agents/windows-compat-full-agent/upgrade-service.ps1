param(
    [Parameter(Mandatory = $true)][string]$PackageDirectory,
    [Parameter(Mandatory = $true)][string]$InstallRoot
)

$ErrorActionPreference = "Stop"
$serviceName = "GCACWindowsCompatibilityAgent"
$incoming = Join-Path $PackageDirectory "GCAC.WindowsCompatibilityAgent.exe"
$target = Join-Path $InstallRoot "GCAC.WindowsCompatibilityAgent.exe"
$backup = $target + ".rollback"
$upgradeLog = Join-Path $InstallRoot "service-upgrade.log"
if (-not (Test-Path -LiteralPath $incoming)) { throw "Upgrade package is missing the Agent executable" }

function Write-UpgradeLog {
    param(
        [Parameter(Mandatory = $true)][string]$Message
    )

    [System.IO.File]::AppendAllText($upgradeLog, ($Message + [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false)))
}

function Set-DirectControlFirewallRule {
    param(
        [Parameter(Mandatory = $true)][string]$ProgramPath
    )

    $firewallService = Get-Service -Name "MpsSvc" -ErrorAction SilentlyContinue
    if ($null -eq $firewallService -or [string]$firewallService.Status -ne "Running") {
        Write-UpgradeLog -Message "Windows Firewall service is not running; firewall rule synchronization skipped."
        return
    }

    $firewallRuleName = "GCAC Windows Compatibility Agent Direct Control"
    $deleteOutput = & netsh.exe advfirewall firewall delete rule "name=$firewallRuleName" 2>&1 | Out-String
    Write-UpgradeLog -Message ("Firewall rule cleanup: " + $deleteOutput.Trim())

    $programRuleOutput = & netsh.exe advfirewall firewall add rule "name=$firewallRuleName" dir=in action=allow protocol=TCP localport=18933 "program=$ProgramPath" enable=yes profile=any 2>&1 | Out-String
    $programRuleExitCode = $LASTEXITCODE
    Write-UpgradeLog -Message ("Firewall program rule: exitCode=" + $programRuleExitCode + "; output=" + $programRuleOutput.Trim())
    if ($programRuleExitCode -eq 0) { return }

    Write-UpgradeLog -Message "Firewall program rule failed; trying port-only fallback."
    $portRuleOutput = & netsh.exe advfirewall firewall add rule "name=$firewallRuleName" dir=in action=allow protocol=TCP localport=18933 enable=yes profile=any 2>&1 | Out-String
    $portRuleExitCode = $LASTEXITCODE
    Write-UpgradeLog -Message ("Firewall port-only rule: exitCode=" + $portRuleExitCode + "; output=" + $portRuleOutput.Trim())
    if ($portRuleExitCode -ne 0) {
        Write-UpgradeLog -Message ("Direct Control firewall rule synchronization failed and upgrade will continue; programRuleExitCode=" + $programRuleExitCode + "; portRuleExitCode=" + $portRuleExitCode)
    }
}

$service = Get-Service -Name $serviceName -ErrorAction Stop
if ($service.Status -ne "Stopped") { Stop-Service -Name $serviceName -Force; $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30)) }
if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination $backup -Force }
try {
    Copy-Item -LiteralPath $incoming -Destination $target -Force
    Set-DirectControlFirewallRule -ProgramPath $target
    Start-Service -Name $serviceName
}
catch {
    if (Test-Path -LiteralPath $backup) { Copy-Item -LiteralPath $backup -Destination $target -Force }
    Start-Service -Name $serviceName -ErrorAction SilentlyContinue
    throw
}
