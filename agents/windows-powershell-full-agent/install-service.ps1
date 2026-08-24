[CmdletBinding()]
param(
  [string]$ServiceName = "gcac-full-agent-ps",
  [string]$DisplayName = "GCAC PowerShell Full Agent",
  [string]$Description = "GCAC Windows PowerShell Full Agent service",
  [string]$InstallRoot = "C:\Program Files\GCAC\FullAgentPS",
  [string]$ConfigDir = "C:\ProgramData\GCAC\FullAgent",
  [string]$LogDir = "C:\ProgramData\GCAC\FullAgent\logs",
  [switch]$StartAfterInstall
)

$ErrorActionPreference = "Stop"

$principal = [Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Administrator privileges are required to install the Windows Service."
}

function Remove-GcacServiceIfExists {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [Parameter(Mandatory = $false)]
    [string]$NssmExe = ""
  )

  if ([string]::IsNullOrWhiteSpace($Name)) {
    return
  }

  $service = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if ($null -eq $service) {
    return
  }

  Write-Host "Cleaning existing service: $Name"

  if ($service.Status -ne "Stopped") {
    if (-not [string]::IsNullOrWhiteSpace($NssmExe) -and (Test-Path -LiteralPath $NssmExe)) {
      & $NssmExe stop $Name confirm | Out-Null
    }
    Stop-Service -Name $Name -Force -ErrorAction SilentlyContinue
  }

  if (-not [string]::IsNullOrWhiteSpace($NssmExe) -and (Test-Path -LiteralPath $NssmExe)) {
    & $NssmExe remove $Name confirm | Out-Null
  } else {
    sc.exe delete $Name | Out-Null
  }

  for ($attempt = 0; $attempt -lt 15; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    $remaining = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $remaining) {
      Write-Host "Existing service removed: $Name"
      return
    }
  }

  throw "Failed to remove existing service: $Name"
}

function Get-GcacServiceNamePrefix {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  if ($Name -match '^(.*-)[A-Za-z0-9]{6}$') {
    return $matches[1]
  }

  return $Name
}

function Get-GcacCleanupServiceNames {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$CurrentServiceName,

    [Parameter(Mandatory = $true)]
    [string]$CurrentDisplayName,

    [Parameter(Mandatory = $true)]
    [string]$InstallRootPath,

    [Parameter(Mandatory = $false)]
    [string]$MetadataServiceName = ""
  )

  $result = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

  [void]$result.Add($CurrentServiceName)
  if (-not [string]::IsNullOrWhiteSpace($MetadataServiceName)) {
    [void]$result.Add($MetadataServiceName)
  }

  $servicePrefix = Get-GcacServiceNamePrefix -Name $CurrentServiceName
  $normalizedInstallRoot = $InstallRootPath.ToLowerInvariant()

  try {
    $services = Get-CimInstance -ClassName Win32_Service -ErrorAction Stop
    foreach ($serviceItem in $services) {
      $candidateName = [string]$serviceItem.Name
      $candidateDisplayName = [string]$serviceItem.DisplayName
      $candidatePath = [string]$serviceItem.PathName

      if ([string]::IsNullOrWhiteSpace($candidateName)) {
        continue
      }

      $matchesPrefix = (-not [string]::IsNullOrWhiteSpace($servicePrefix)) -and $candidateName.StartsWith($servicePrefix, [System.StringComparison]::OrdinalIgnoreCase)
      $matchesDisplayName = (-not [string]::IsNullOrWhiteSpace($CurrentDisplayName)) -and $candidateDisplayName -eq $CurrentDisplayName
      $matchesInstallRoot = (-not [string]::IsNullOrWhiteSpace($candidatePath)) -and $candidatePath.ToLowerInvariant().Contains($normalizedInstallRoot)

      if ($matchesPrefix -or $matchesDisplayName -or $matchesInstallRoot) {
        [void]$result.Add($candidateName)
      }
    }
  } catch {
    $fallbackServices = Get-Service -ErrorAction SilentlyContinue | Where-Object {
      $_.Name.StartsWith($servicePrefix, [System.StringComparison]::OrdinalIgnoreCase) -or $_.DisplayName -eq $CurrentDisplayName
    }
    foreach ($serviceItem in $fallbackServices) {
      [void]$result.Add([string]$serviceItem.Name)
    }
  }

  return @($result)
}

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$entrySource = Join-Path $sourceRoot "Start-GcacFullAgent.ps1"
$moduleSource = Join-Path $sourceRoot "modules"
$configSource = Join-Path $sourceRoot "config"
$scriptSource = Join-Path $sourceRoot "scripts"
$vendorSource = Join-Path $sourceRoot "vendor\nssm"
$configTemplate = Join-Path $configSource "agent.config.template.json"
$metadataPath = Join-Path $ConfigDir "service.install.json"

if (-not (Test-Path -LiteralPath $entrySource)) {
  throw "Agent entry script not found: $entrySource"
}

if (-not (Test-Path -LiteralPath $moduleSource)) {
  throw "Agent module directory not found: $moduleSource"
}

if (-not (Test-Path -LiteralPath $configTemplate)) {
  throw "Agent config template not found: $configTemplate"
}

if (-not (Test-Path -LiteralPath $vendorSource)) {
  throw "NSSM vendor directory not found: $vendorSource"
}

$existingMetadata = $null
if (Test-Path -LiteralPath $metadataPath) {
  try {
    $existingMetadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
  } catch {
    $existingMetadata = $null
  }
}

$existingNssmExe = ""
if ($null -ne $existingMetadata -and -not [string]::IsNullOrWhiteSpace([string]$existingMetadata.NssmExe)) {
  $existingNssmExe = [string]$existingMetadata.NssmExe
}

$cleanupServiceNames = Get-GcacCleanupServiceNames `
  -CurrentServiceName $ServiceName `
  -CurrentDisplayName $DisplayName `
  -InstallRootPath $InstallRoot `
  -MetadataServiceName $(if ($null -ne $existingMetadata) { [string]$existingMetadata.ServiceName } else { "" })

foreach ($cleanupServiceName in $cleanupServiceNames) {
  Remove-GcacServiceIfExists -Name $cleanupServiceName -NssmExe $existingNssmExe
}

New-Item -ItemType Directory -Force -Path $InstallRoot, $ConfigDir, $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "modules"), (Join-Path $InstallRoot "scripts"), (Join-Path $InstallRoot "config"), (Join-Path $InstallRoot "vendor\nssm") | Out-Null

Copy-Item -LiteralPath $entrySource -Destination (Join-Path $InstallRoot "Start-GcacFullAgent.ps1") -Force
Copy-Item -Path (Join-Path $moduleSource "*") -Destination (Join-Path $InstallRoot "modules") -Recurse -Force
Copy-Item -Path (Join-Path $scriptSource "*") -Destination (Join-Path $InstallRoot "scripts") -Recurse -Force

$vendorTarget = Join-Path $InstallRoot "vendor\nssm"
Get-ChildItem -LiteralPath $vendorSource -Recurse | ForEach-Object {
  $relativePath = $_.FullName.Substring($vendorSource.Length).TrimStart('\')
  if ([string]::IsNullOrWhiteSpace($relativePath)) {
    return
  }

  $destinationPath = Join-Path $vendorTarget $relativePath
  if ($_.PSIsContainer) {
    New-Item -ItemType Directory -Force -Path $destinationPath | Out-Null
    return
  }

  $destinationDir = Split-Path -Parent $destinationPath
  New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null

  if ((Test-Path -LiteralPath $destinationPath) -and $_.Extension -ieq ".exe") {
    return
  }

  Copy-Item -LiteralPath $_.FullName -Destination $destinationPath -Force
}

$configTarget = Join-Path $ConfigDir "agent.config.json"
if (-not (Test-Path -LiteralPath $configTarget)) {
  Copy-Item -LiteralPath $configTemplate -Destination $configTarget -Force
}

$installedConfigTemplate = Join-Path $InstallRoot "config\agent.config.template.json"
Copy-Item -LiteralPath $configTemplate -Destination $installedConfigTemplate -Force

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -ne $service) {
  throw "Service already exists: $ServiceName"
}

$powershellExe = Join-Path $PSHOME "powershell.exe"
$entryPath = Join-Path $InstallRoot "Start-GcacFullAgent.ps1"
$nssmRelativePath = if ([Environment]::Is64BitOperatingSystem) { "vendor\nssm\win64\nssm.exe" } else { "vendor\nssm\win32\nssm.exe" }
$nssmExe = Join-Path $InstallRoot $nssmRelativePath
if (-not (Test-Path -LiteralPath $nssmExe)) {
  throw "NSSM executable not found: $nssmExe"
}

$selfCheckResultPath = Join-Path $LogDir "install-selfcheck.json"
& $powershellExe -NoProfile -ExecutionPolicy Bypass -File $entryPath -SelfCheck -ConfigPath $configTarget -LogDir $LogDir -OutputPath $selfCheckResultPath
if ($LASTEXITCODE -ne 0) {
  if (Test-Path -LiteralPath $selfCheckResultPath) {
    Write-Host "Install self-check result:"
    Get-Content -LiteralPath $selfCheckResultPath -Raw | Write-Host
  }
  $agentLogPath = Join-Path $LogDir "agent.log"
  if (Test-Path -LiteralPath $agentLogPath) {
    Write-Host "Agent log:"
    Get-Content -LiteralPath $agentLogPath -Raw | Write-Host
  }
  $runtimeLogPath = Join-Path $LogDir "runtime.log"
  if (Test-Path -LiteralPath $runtimeLogPath) {
    Write-Host "Runtime log:"
    Get-Content -LiteralPath $runtimeLogPath -Raw | Write-Host
  }
  throw "Self-check failed before service registration."
}

$stdoutLog = Join-Path $LogDir "service-stdout.log"
$stderrLog = Join-Path $LogDir "service-stderr.log"
$serviceCommand = "& '$entryPath' -ConfigPath '$configTarget' -LogDir '$LogDir'"
$serviceCommandBytes = [System.Text.Encoding]::Unicode.GetBytes($serviceCommand)
$serviceCommandEncoded = [System.Convert]::ToBase64String($serviceCommandBytes)
$serviceArgs = "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $serviceCommandEncoded"

& $nssmExe install $ServiceName $powershellExe | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to install service via NSSM."
}

$nssmConfigCommands = @(
  @("set", $ServiceName, "AppDirectory", $InstallRoot),
  @("set", $ServiceName, "AppParameters", $serviceArgs),
  @("set", $ServiceName, "AppStdout", $stdoutLog),
  @("set", $ServiceName, "AppStderr", $stderrLog),
  @("set", $ServiceName, "AppRotateFiles", "1"),
  @("set", $ServiceName, "AppRotateOnline", "1"),
  @("set", $ServiceName, "Description", $Description),
  @("set", $ServiceName, "DisplayName", $DisplayName),
  @("set", $ServiceName, "Start", "SERVICE_AUTO_START")
)

foreach ($commandArgs in $nssmConfigCommands) {
  & $nssmExe @commandArgs | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to configure service via NSSM."
  }
}

$metadata = [pscustomobject]@{
  ServiceName = $ServiceName
  DisplayName = $DisplayName
  Description = $Description
  InstallRoot = $InstallRoot
  ConfigPath = $configTarget
  LogDir = $LogDir
  EntryPath = $entryPath
  PowerShellExe = $powershellExe
  ServiceBinary = $powershellExe
  ServiceArguments = $serviceArgs
  ServiceCommand = $serviceCommand
  NssmExe = $nssmExe
  InstalledAt = (Get-Date).ToString("o")
  Mode = "nssm"
  LastBootstrapSelfCheckPath = $null
  LastBootstrapRunOncePath = $null
}
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($metadataPath, ($metadata | ConvertTo-Json -Depth 6), $utf8Bom)

Write-Host "Service registered: $ServiceName"
Write-Host "Config file: $configTarget"
Write-Host "Install metadata: $metadataPath"
Write-Host "Log directory: $LogDir"
Write-Host "Start command: Start-Service -Name '$ServiceName'"
Write-Host "Stop command: Stop-Service -Name '$ServiceName'"
Write-Host "Status command: Get-Service -Name '$ServiceName'"
Write-Host "Self-check command: & '$powershellExe' -NoProfile -ExecutionPolicy Bypass -File '$entryPath' -SelfCheck -ConfigPath '$configTarget' -LogDir '$LogDir'"
Write-Host "Health-check command: & '$powershellExe' -NoProfile -ExecutionPolicy Bypass -File '$entryPath' -HealthCheck -ConfigPath '$configTarget' -LogDir '$LogDir'"
Write-Host "Service host executable: $nssmExe"
Write-Host "Service stdout log: $stdoutLog"
Write-Host "Service stderr log: $stderrLog"
Write-Host "Note: PowerShell remains the agent runtime; Windows service hosting now uses NSSM."
