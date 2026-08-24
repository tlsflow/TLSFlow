[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$legacyRoot = Split-Path -Parent $PSScriptRoot
$goRoot = Join-Path (Split-Path -Parent $legacyRoot) "windows-go-full-agent"
$failures = [System.Collections.Generic.List[string]]::new()

function Add-ContractFailure {
  param([Parameter(Mandatory = $true)][string]$Message)
  $failures.Add($Message)
}

$forwardingContracts = @{
  "install-service.ps1" = "install-service.ps1"
  "uninstall-service.ps1" = "uninstall-service.ps1"
  "service-control.ps1" = "service-control.ps1"
}

foreach ($entryName in $forwardingContracts.Keys) {
  $entryPath = Join-Path $legacyRoot $entryName
  $targetName = $forwardingContracts[$entryName]
  $targetPath = Join-Path $goRoot $targetName

  if (-not (Test-Path -LiteralPath $entryPath -PathType Leaf)) {
    Add-ContractFailure "Compatibility entrypoint is missing: $entryPath"
    continue
  }
  if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
    Add-ContractFailure "Go agent forwarding target is missing: $targetPath"
  }

  $content = [System.IO.File]::ReadAllText($entryPath)
  if ($content -notmatch [regex]::Escape('windows-go-full-agent')) {
    Add-ContractFailure "$entryName does not point to windows-go-full-agent"
  }
  if ($content -notmatch [regex]::Escape($targetName)) {
    Add-ContractFailure "$entryName does not invoke $targetName"
  }
  if ($content -match '(?i)Import-Module|Gcac\.Agent\.|\bmodules\b|Start-GcacFullAgent') {
    Add-ContractFailure "$entryName still references the retired PowerShell runtime"
  }
  if ($content -match '\$LASTEXITCODE') {
    Add-ContractFailure "$entryName incorrectly uses LASTEXITCODE for PowerShell script forwarding"
  }
}

$startPath = Join-Path $legacyRoot "Start-GcacFullAgent.ps1"
if (-not (Test-Path -LiteralPath $startPath -PathType Leaf)) {
  Add-ContractFailure "Retired start entrypoint is missing: $startPath"
} else {
  $startContent = [System.IO.File]::ReadAllText($startPath)
  if ($startContent -notmatch 'LEGACY_RUNTIME_RETIRED') {
    Add-ContractFailure "Start-GcacFullAgent.ps1 does not return the retirement error code"
  }
  if ($startContent -notmatch [regex]::Escape('windows-go-full-agent')) {
    Add-ContractFailure "Start-GcacFullAgent.ps1 does not identify the Go agent migration target"
  }
  if ($startContent -match '(?i)Import-Module|Gcac\.Agent\.|\bmodules\b|Start-GcacAgentService') {
    Add-ContractFailure "Start-GcacFullAgent.ps1 still loads the retired PowerShell runtime"
  }
}

$retiredPaths = @("modules", "service-host", "service-wrapper", "config", "scripts")
foreach ($relativePath in $retiredPaths) {
  $retiredPath = Join-Path $legacyRoot $relativePath
  $remainingFiles = @(Get-ChildItem -LiteralPath $retiredPath -File -Recurse -ErrorAction SilentlyContinue)
  if ($remainingFiles.Count -gt 0) {
    Add-ContractFailure "Retired runtime path still contains files: $retiredPath"
  }
}

foreach ($scriptPath in Get-ChildItem -LiteralPath $legacyRoot -Filter "*.ps1" -Recurse -File) {
  $parseErrors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile(
    $scriptPath.FullName,
    [ref]$null,
    [ref]$parseErrors
  )
  foreach ($parseError in $parseErrors) {
    Add-ContractFailure "$($scriptPath.Name) parse error: $($parseError.Message)"
  }
}

# Run forwarding entries against isolated stubs so the contract test never touches Windows services.
$sandboxRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("gcac-legacy-forwarding-" + [guid]::NewGuid().ToString("N"))
$sandboxLegacyRoot = Join-Path $sandboxRoot "agents\windows-powershell-full-agent"
$sandboxGoRoot = Join-Path $sandboxRoot "agents\windows-go-full-agent"
$markerPath = Join-Path $sandboxRoot "forwarded.txt"

try {
  [void](New-Item -ItemType Directory -Path $sandboxLegacyRoot, $sandboxGoRoot -Force)
  foreach ($entryName in $forwardingContracts.Keys) {
    Copy-Item -LiteralPath (Join-Path $legacyRoot $entryName) -Destination (Join-Path $sandboxLegacyRoot $entryName)
  }

  $stubScripts = @{
    "install-service.ps1" = @'
[CmdletBinding()]
param(
  [string]$ServiceName, [string]$DisplayName, [string]$Description,
  [string]$InstallRoot, [string]$ConfigDir, [string]$DataDir,
  [string]$LogDir, [switch]$StartAfterInstall
)
[System.IO.File]::AppendAllText($env:GCAC_FORWARDING_MARKER, "install-service.ps1`n")
'@
    "uninstall-service.ps1" = @'
[CmdletBinding()]
param([string]$ServiceName)
[System.IO.File]::AppendAllText($env:GCAC_FORWARDING_MARKER, "uninstall-service.ps1`n")
'@
    "service-control.ps1" = @'
[CmdletBinding()]
param(
  [string]$Action, [string]$ServiceName, [string]$BinaryPath,
  [string]$ConfigPath, [string]$MetadataPath
)
[System.IO.File]::AppendAllText($env:GCAC_FORWARDING_MARKER, "service-control.ps1`n")
'@
  }

  foreach ($targetName in $stubScripts.Keys) {
    $targetPath = Join-Path $sandboxGoRoot $targetName
    [System.IO.File]::WriteAllText($targetPath, $stubScripts[$targetName])
  }

  $env:GCAC_FORWARDING_MARKER = $markerPath
  $LASTEXITCODE = 23
  & (Join-Path $sandboxLegacyRoot "install-service.ps1")
  & (Join-Path $sandboxLegacyRoot "uninstall-service.ps1")
  & (Join-Path $sandboxLegacyRoot "service-control.ps1") -Action "status"

  $actualTargets = @([System.IO.File]::ReadAllLines($markerPath) | Sort-Object)
  $expectedTargets = @($forwardingContracts.Values | Sort-Object)
  if (($actualTargets -join "|") -ne ($expectedTargets -join "|")) {
    Add-ContractFailure "Forwarding execution mismatch: $($actualTargets -join ', ')"
  }
} catch {
  Add-ContractFailure "Isolated forwarding execution failed: $($_.Exception.Message)"
} finally {
  Remove-Item Env:\GCAC_FORWARDING_MARKER -ErrorAction SilentlyContinue
  if ($sandboxRoot.StartsWith([System.IO.Path]::GetTempPath(), [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $sandboxRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($failures.Count -gt 0) {
  $failures | ForEach-Object { Write-Error $_ -ErrorAction Continue }
  throw "PowerShell compatibility contract failed: $($failures.Count) violation(s)"
}

Write-Host "PowerShell compatibility contract passed: 3 forwarding entries, 1 retired start entry, 5 empty retired runtime trees."
