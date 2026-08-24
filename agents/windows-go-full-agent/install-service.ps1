[CmdletBinding()]
param(
  [string]$ServiceName = "gcac-agent",
  [string]$DisplayName = "GCAC Go Full Agent",
  [string]$Description = "GCAC Windows Go Full Agent service",
  [string]$InstallRoot = "C:\Program Files\GCAC\FullAgentGo",
  [string]$ConfigDir = "C:\ProgramData\GCAC\FullAgentGo\config",
  [string]$DataDir = "C:\ProgramData\GCAC\FullAgentGo\data",
  [string]$LogDir = "C:\ProgramData\GCAC\FullAgentGo\logs",
  [Parameter(Mandatory = $true)][string]$PublicKeyFile,
  [Parameter(Mandatory = $true)][string]$SignatureFile,
  [Parameter(Mandatory = $true)][string]$SignatureVerifier,
  [switch]$StartAfterInstall,
  [switch]$NoStartAfterInstall
)

$ErrorActionPreference = "Stop"

if ($StartAfterInstall -and $NoStartAfterInstall) {
  throw "StartAfterInstall and NoStartAfterInstall cannot be used together."
}

$shouldStartAfterInstall = $StartAfterInstall -or (-not $NoStartAfterInstall -and -not $PSBoundParameters.ContainsKey("StartAfterInstall"))

$principal = [Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Administrator privileges are required to install the Windows Service."
}

function Wait-ServiceProcessReleased {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $false)]
    [UInt32]$ProcessId = 0,

    [Parameter(Mandatory = $false)]
    [string]$BinaryPath = ""
  )

  $normalizedBinaryPath = ""
  if (-not [string]::IsNullOrWhiteSpace($BinaryPath)) {
    $normalizedBinaryPath = $BinaryPath.ToLowerInvariant()
  }

  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    $processReleased = $true

    if ($ProcessId -gt 0) {
      $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
      if ($null -ne $process) {
        $processReleased = $false
      }
    }

    if ($processReleased -and -not [string]::IsNullOrWhiteSpace($normalizedBinaryPath)) {
      $matchingProcess = Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $path = [string]$_.ExecutablePath
        -not [string]::IsNullOrWhiteSpace($path) -and $path.ToLowerInvariant() -eq $normalizedBinaryPath
      } | Select-Object -First 1
      if ($null -ne $matchingProcess) {
        $processReleased = $false
      }
    }

    if ($processReleased) {
      return
    }

    Start-Sleep -Milliseconds 500
  }

  if ($ProcessId -gt 0) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }

  if (-not [string]::IsNullOrWhiteSpace($normalizedBinaryPath)) {
    Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $path = [string]$_.ExecutablePath
      -not [string]::IsNullOrWhiteSpace($path) -and $path.ToLowerInvariant() -eq $normalizedBinaryPath
    } | ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  }

  Start-Sleep -Seconds 1
}

function Remove-GoServiceByInstallRoot {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetInstallRoot
  )

  $candidateNames = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  $binaryPathMap = @{}
  [void]$candidateNames.Add($ServiceName)
  $defaultBinaryPath = Join-Path $TargetInstallRoot "gcac-agent.exe"
  $binaryPathMap[$ServiceName] = $defaultBinaryPath

  $metadataPath = Join-Path (Split-Path -Parent $ConfigDir) "service.install.json"
  if (Test-Path -LiteralPath $metadataPath) {
    try {
      $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
      $metadataServiceName = [string]$metadata.ServiceName
      if ([string]::IsNullOrWhiteSpace($metadataServiceName)) {
        throw "serviceName 为空"
      }
      [void]$candidateNames.Add($metadataServiceName)
      $binaryPathMap[$metadataServiceName] = $defaultBinaryPath
    } catch {
      throw "现有 Go Agent 安装元数据无效，拒绝扫描或删除未知服务：$($_.Exception.Message)"
    }
  }

  $escapedBinaryPath = [regex]::Escape($defaultBinaryPath)
  $servicesUsingAgentBinary = Get-CimInstance -ClassName Win32_Service -ErrorAction SilentlyContinue | Where-Object {
    $path = [string]$_.PathName
    $path -match ("(?i)^\s*(?:" + [char]34 + $escapedBinaryPath + [char]34 + "|" + $escapedBinaryPath + ")(?:\s|$)")
  }
  foreach ($serviceUsingAgentBinary in $servicesUsingAgentBinary) {
    $discoveredServiceName = [string]$serviceUsingAgentBinary.Name
    if (-not [string]::IsNullOrWhiteSpace($discoveredServiceName)) {
      [void]$candidateNames.Add($discoveredServiceName)
      $binaryPathMap[$discoveredServiceName] = $defaultBinaryPath
    }
  }

  foreach ($serviceName in $candidateNames) {
    $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $existing) {
      continue
    }
    Write-Host "Removing existing Go service: $serviceName"
    $serviceInfo = Get-CimInstance -ClassName Win32_Service -Filter ("Name='" + $serviceName.Replace("'", "''") + "'") -ErrorAction SilentlyContinue
    $serviceProcessId = 0
    if ($null -ne $serviceInfo -and $null -ne $serviceInfo.ProcessId) {
      $serviceProcessId = [UInt32]$serviceInfo.ProcessId
    }
    if ($existing.Status -ne "Stopped") {
      Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 1
    }
    sc.exe delete $serviceName | Out-Null
    Wait-ServiceProcessReleased -ProcessId $serviceProcessId -BinaryPath ([string]$binaryPathMap[$serviceName])
  }
}

function Assert-ServiceRegistration {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$ExpectedBinaryPathName
  )

  $registeredService = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if ($null -eq $registeredService) {
    throw "Windows Service registration failed: $Name"
  }

  $serviceInfo = Get-CimInstance -ClassName Win32_Service -Filter ("Name='" + $Name.Replace("'", "''") + "'") -ErrorAction Stop
  if ($null -eq $serviceInfo) {
    throw "Windows Service registration metadata unavailable: $Name"
  }
  $actualBinaryPathName = ([string]$serviceInfo.PathName).Trim()
  if (-not [string]::Equals($actualBinaryPathName, $ExpectedBinaryPathName.Trim(), [StringComparison]::OrdinalIgnoreCase)) {
    throw "Windows Service binary path binding mismatch: $Name"
  }
  if (-not [string]::Equals([string]$serviceInfo.StartMode, "Auto", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Windows Service startup mode binding mismatch: $Name"
  }
}

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$binarySource = Join-Path $sourceRoot "gcac-agent.exe"
$runtimeDiscoveryPluginSource = Join-Path $sourceRoot "plugins\windows-runtime-discovery.exe"
$configTemplate = Join-Path $sourceRoot "config\agent.config.template.json"
$metadataPath = Join-Path (Split-Path -Parent $ConfigDir) "service.install.json"

if (-not (Test-Path -LiteralPath $binarySource)) {
  throw "Go agent binary not found: $binarySource"
}

if (-not (Test-Path -LiteralPath $runtimeDiscoveryPluginSource)) {
  throw "Windows Agent-side runtime discovery plugin not found: $runtimeDiscoveryPluginSource"
}

if (-not (Test-Path -LiteralPath $configTemplate)) {
  throw "Agent config template not found: $configTemplate"
}

$signatureScript = Join-Path $sourceRoot "release\verify-signature.ps1"
if (-not (Test-Path -LiteralPath $signatureScript)) {
  throw "Agent release signature verifier not found: $signatureScript"
}
& $signatureScript -PublicKeyFile $PublicKeyFile -ArtifactPath $binarySource -SignatureFile $SignatureFile -SignatureVerifier $SignatureVerifier

Remove-GoServiceByInstallRoot -TargetInstallRoot $InstallRoot

New-Item -ItemType Directory -Force -Path $InstallRoot, (Join-Path $InstallRoot "plugins"), $ConfigDir, $DataDir, $LogDir | Out-Null

$binaryTarget = Join-Path $InstallRoot "gcac-agent.exe"
$runtimeDiscoveryPluginTarget = Join-Path $InstallRoot "plugins\windows-runtime-discovery.exe"
$configTarget = Join-Path $ConfigDir "agent.config.json"

if (Test-Path -LiteralPath $binaryTarget) {
  Remove-Item -LiteralPath $binaryTarget -Force -ErrorAction SilentlyContinue
}

Copy-Item -LiteralPath $binarySource -Destination $binaryTarget -Force
Copy-Item -LiteralPath $runtimeDiscoveryPluginSource -Destination $runtimeDiscoveryPluginTarget -Force
if (-not (Test-Path -LiteralPath $configTarget)) {
  Copy-Item -LiteralPath $configTemplate -Destination $configTarget -Force
}

if ((Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue) -and (Get-Command Remove-NetFirewallRule -ErrorAction SilentlyContinue)) {
  Get-NetFirewallRule -ErrorAction SilentlyContinue |
    Where-Object { [string]$_.DisplayName -like "GCAC Agent Direct Control (*)" } |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
}
if (Get-Command Get-NetFirewallRule -ErrorAction SilentlyContinue) {
  Get-NetFirewallRule -ErrorAction SilentlyContinue |
    Where-Object { [string]$_.DisplayName -eq "GCAC Go Full Agent Management TCP 18930" } |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
} else {
  $deleteOutput = (& netsh.exe advfirewall firewall delete rule name="GCAC Go Full Agent Management TCP 18930" 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0 -and $deleteOutput -notmatch "(?i)no rules match|没有规则匹配|找不到规则") { throw "Go Agent firewall rule cleanup failed: 18930`n$deleteOutput" }
}
& netsh.exe advfirewall firewall add rule name="GCAC Go Full Agent Management TCP 18930" dir=in action=allow protocol=TCP localport=18930 program=$binaryTarget profile=any | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Go Agent firewall rule creation failed: 18930" }

$serviceCommand = "`"$binaryTarget`" service run --config=`"$configTarget`""
New-Service -Name $ServiceName -BinaryPathName $serviceCommand -DisplayName $DisplayName -Description $Description -StartupType Automatic | Out-Null
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
sc.exe failureflag $ServiceName 1 | Out-Null

Assert-ServiceRegistration -Name $ServiceName -ExpectedBinaryPathName $serviceCommand

$metadata = [pscustomobject]@{
  ServiceName = $ServiceName
  DisplayName = $DisplayName
  InstallRoot = $InstallRoot
  ConfigPath = $configTarget
  DataDir = $DataDir
  LogDir = $LogDir
  BinaryPath = $binaryTarget
  InstalledAt = (Get-Date).ToString("o")
  Mode = "windows-service-go"
}

$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($metadataPath, ($metadata | ConvertTo-Json -Depth 5), $utf8Bom)

Write-Host "Service registered: $ServiceName"
Write-Host "Binary target: $binaryTarget"
Write-Host "Config file: $configTarget"
Write-Host "Metadata: $metadataPath"
Write-Host "Start command: Start-Service -Name '$ServiceName'"
Write-Host "Stop command: Stop-Service -Name '$ServiceName'"
Write-Host "Status command: Get-Service -Name '$ServiceName'"

if ($shouldStartAfterInstall) {
  Start-Sleep -Seconds 1
  $service = Get-Service -Name $ServiceName -ErrorAction Stop
  if ([string]$service.Status -ne "Running") {
    Start-Service -Name $ServiceName -ErrorAction Stop
    $service.WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
  }
  $service = Get-Service -Name $ServiceName -ErrorAction Stop
  if ([string]$service.Status -ne "Running") {
    throw "Windows Service did not reach Running after install: $ServiceName status=$($service.Status)"
  }
  $service
}
