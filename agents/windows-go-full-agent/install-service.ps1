[CmdletBinding()]
param(
  [string]$ServiceName = "gcac-agent",
  [string]$DisplayName = "GCAC Go Full Agent",
  [string]$Description = "GCAC Windows Go Full Agent service",
  [string]$InstallRoot = "C:\Program Files\GCAC\FullAgentGo",
  [string]$ConfigDir = "C:\ProgramData\GCAC\FullAgentGo\config",
  [string]$DataDir = "C:\ProgramData\GCAC\FullAgentGo\data",
  [string]$LogDir = "C:\ProgramData\GCAC\FullAgentGo\logs",
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

function Remove-ServiceByName {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [Parameter(Mandatory = $false)]
    [string]$NssmExe = ""
  )

  if ([string]::IsNullOrWhiteSpace($Name)) {
    return $false
  }

  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if ($null -eq $service) {
    return $false
  }

  Write-Host "Removing legacy service: $Name"

  if ($service.Status -ne "Stopped") {
    if (-not [string]::IsNullOrWhiteSpace($NssmExe) -and (Test-Path -LiteralPath $NssmExe)) {
      & $NssmExe stop $Name confirm | Out-Null
    }
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }

  if (-not [string]::IsNullOrWhiteSpace($NssmExe) -and (Test-Path -LiteralPath $NssmExe)) {
    & $NssmExe remove $Name confirm | Out-Null
  } else {
    sc.exe delete $Name | Out-Null
  }

  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    $remaining = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $remaining) {
      Write-Host "Legacy service removed: $Name"
      return $true
    }
  }

  throw "Failed to remove service: $Name"
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

  $normalizedInstallRoot = $TargetInstallRoot.ToLowerInvariant()
  $candidateNames = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
  $serviceProcessMap = @{}
  $binaryPathMap = @{}

  $metadataPath = Join-Path (Split-Path -Parent $ConfigDir) "service.install.json"
  if (Test-Path -LiteralPath $metadataPath) {
    try {
      $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
      if (-not [string]::IsNullOrWhiteSpace([string]$metadata.ServiceName)) {
        [void]$candidateNames.Add([string]$metadata.ServiceName)
      }
    } catch {
      Write-Host "Existing Go agent metadata parse failed, fallback to service scan."
    }
  }

  $goServices = Get-CimInstance -ClassName Win32_Service -ErrorAction SilentlyContinue | Where-Object {
    $pathName = [string]$_.PathName
    $name = [string]$_.Name
    $display = [string]$_.DisplayName
    $pathLower = $pathName.ToLowerInvariant()
    $name -like "gcac-windows-go-agent*" -or $display -like "*Windows Go Full Agent*" -or $pathLower.Contains($normalizedInstallRoot.ToLowerInvariant())
  }

  foreach ($service in $goServices) {
    $serviceName = [string]$service.Name
    if ([string]::IsNullOrWhiteSpace($serviceName)) {
      continue
    }
    [void]$candidateNames.Add($serviceName)
    $serviceProcessId = 0
    if ($null -ne $service.ProcessId) {
      $serviceProcessId = [int]$service.ProcessId
    }
    $serviceProcessMap[$serviceName] = [UInt32]$serviceProcessId
    $binaryPathMap[$serviceName] = Join-Path $TargetInstallRoot "gcac-agent.exe"
  }

  foreach ($serviceName in $candidateNames) {
    $existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $existing) {
      continue
    }
    Write-Host "Removing existing Go service: $serviceName"
    if ($existing.Status -ne "Stopped") {
      Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 1
    }
    sc.exe delete $serviceName | Out-Null
    Wait-ServiceProcessReleased -ProcessId ([UInt32]($serviceProcessMap[$serviceName])) -BinaryPath ([string]$binaryPathMap[$serviceName])
  }
}

function Remove-LegacyPowerShellAgentIfExists {
  [CmdletBinding()]
  param()

  $legacyMetadataPath = "C:\ProgramData\GCAC\FullAgent\service.install.json"
  $legacyNssmExe = "C:\Program Files\GCAC\FullAgentPS\vendor\nssm\win64\nssm.exe"
  $legacyInstallRoot = "c:\program files\gcac\fullagentps"
  $candidateNames = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

  [void]$candidateNames.Add("gcac-full-agent-ps")

  if (Test-Path -LiteralPath $legacyMetadataPath) {
    try {
      $metadata = Get-Content -LiteralPath $legacyMetadataPath -Raw | ConvertFrom-Json
      if (-not [string]::IsNullOrWhiteSpace([string]$metadata.ServiceName)) {
        [void]$candidateNames.Add([string]$metadata.ServiceName)
      }
      if (-not [string]::IsNullOrWhiteSpace([string]$metadata.NssmExe)) {
        $legacyNssmExe = [string]$metadata.NssmExe
      }
      if (-not [string]::IsNullOrWhiteSpace([string]$metadata.InstallRoot)) {
        $legacyInstallRoot = ([string]$metadata.InstallRoot).ToLowerInvariant()
      }
    } catch {
      Write-Host "Legacy metadata parse failed, fallback to service scan."
    }
  }

  try {
    $legacyServices = Get-CimInstance -ClassName Win32_Service -ErrorAction Stop | Where-Object {
      $path = [string]$_.PathName
      $display = [string]$_.DisplayName
      $name = [string]$_.Name
      $pathLower = $path.ToLowerInvariant()
      $displayLike = $display -like "*PowerShell Full Agent*"
      $nameLike = $name -like "gcac-full-agent-ps*"
      $pathLike = $pathLower.Contains("start-gcacfullagent.ps1") -or $pathLower.Contains($legacyInstallRoot) -or $pathLower.Contains("gcac\\fullagent\\agent.config.json")
      $displayLike -or $nameLike -or $pathLike
    }
    foreach ($legacyService in $legacyServices) {
      if (-not [string]::IsNullOrWhiteSpace([string]$legacyService.Name)) {
        [void]$candidateNames.Add([string]$legacyService.Name)
      }
    }
  } catch {
    $fallbackServices = Get-Service -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -like "gcac-full-agent-ps*" -or $_.DisplayName -like "*PowerShell Full Agent*"
    }
    foreach ($legacyService in $fallbackServices) {
      [void]$candidateNames.Add([string]$legacyService.Name)
    }
  }

  $removed = $false
  foreach ($legacyServiceName in $candidateNames) {
    if (Remove-ServiceByName -Name $legacyServiceName -NssmExe $legacyNssmExe) {
      $removed = $true
    }
  }

  if ($removed) {
    Write-Host "Legacy PowerShell agent cleanup completed."
  }
}

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$binarySource = Join-Path $sourceRoot "gcac-agent.exe"
$legacyBinarySource = Join-Path $sourceRoot "windows-go-full-agent.exe"
$configTemplate = Join-Path $sourceRoot "config\agent.config.template.json"
$metadataPath = Join-Path (Split-Path -Parent $ConfigDir) "service.install.json"

if (-not (Test-Path -LiteralPath $binarySource)) {
  if (Test-Path -LiteralPath $legacyBinarySource) {
    $binarySource = $legacyBinarySource
  } else {
    throw "Go agent binary not found: $binarySource"
  }
}

if (-not (Test-Path -LiteralPath $configTemplate)) {
  throw "Agent config template not found: $configTemplate"
}

Remove-LegacyPowerShellAgentIfExists
Remove-GoServiceByInstallRoot -TargetInstallRoot $InstallRoot

New-Item -ItemType Directory -Force -Path $InstallRoot, $ConfigDir, $DataDir, $LogDir | Out-Null

$binaryTarget = Join-Path $InstallRoot "gcac-agent.exe"
$configTarget = Join-Path $ConfigDir "agent.config.json"

if (Test-Path -LiteralPath $binaryTarget) {
  Remove-Item -LiteralPath $binaryTarget -Force -ErrorAction SilentlyContinue
}

Copy-Item -LiteralPath $binarySource -Destination $binaryTarget -Force
if (-not (Test-Path -LiteralPath $configTarget)) {
  Copy-Item -LiteralPath $configTemplate -Destination $configTarget -Force
}

$serviceCommand = "`"$binaryTarget`" service run --config=`"$configTarget`""
New-Service -Name $ServiceName -BinaryPathName $serviceCommand -DisplayName $DisplayName -Description $Description -StartupType Automatic | Out-Null
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
sc.exe failureflag $ServiceName 1 | Out-Null

$registeredService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -eq $registeredService) {
  throw "Windows Service registration failed: $ServiceName"
}

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
