[CmdletBinding()]
param(
  [string]$ServiceName = "gcac-full-agent-ps",
  [string]$DisplayName = "GCAC PowerShell Full Agent",
  [string]$Description = "GCAC Windows PowerShell Full Agent skeleton service",
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

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$entrySource = Join-Path $sourceRoot "Start-GcacFullAgent.ps1"
$moduleSource = Join-Path $sourceRoot "modules"
$configSource = Join-Path $sourceRoot "config"
$scriptSource = Join-Path $sourceRoot "scripts"
$configTemplate = Join-Path $configSource "agent.config.template.json"

if (-not (Test-Path -LiteralPath $entrySource)) {
  throw "Agent entry script not found: $entrySource"
}

if (-not (Test-Path -LiteralPath $moduleSource)) {
  throw "Agent module directory not found: $moduleSource"
}

if (-not (Test-Path -LiteralPath $configTemplate)) {
  throw "Agent config template not found: $configTemplate"
}

New-Item -ItemType Directory -Force -Path $InstallRoot, $ConfigDir, $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "modules"), (Join-Path $InstallRoot "scripts"), (Join-Path $InstallRoot "config") | Out-Null

Copy-Item -LiteralPath $entrySource -Destination (Join-Path $InstallRoot "Start-GcacFullAgent.ps1") -Force
Copy-Item -Path (Join-Path $moduleSource "*") -Destination (Join-Path $InstallRoot "modules") -Recurse -Force
Copy-Item -Path (Join-Path $scriptSource "*") -Destination (Join-Path $InstallRoot "scripts") -Recurse -Force

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
$binaryPath = '"' + $powershellExe + '" -NoProfile -ExecutionPolicy Bypass -File "' + $entryPath + '" -ConfigPath "' + $configTarget + '" -LogDir "' + $LogDir + '"'

& $powershellExe -NoProfile -ExecutionPolicy Bypass -File $entryPath -SelfCheck -ConfigPath $configTarget -LogDir $LogDir | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Self-check failed before service registration."
}

New-Service -Name $ServiceName -BinaryPathName $binaryPath -DisplayName $DisplayName -Description $Description -StartupType Automatic | Out-Null

$metadataPath = Join-Path $ConfigDir "service.install.json"
$metadata = [pscustomobject]@{
  ServiceName = $ServiceName
  DisplayName = $DisplayName
  Description = $Description
  InstallRoot = $InstallRoot
  ConfigPath = $configTarget
  LogDir = $LogDir
  EntryPath = $entryPath
  PowerShellExe = $powershellExe
  InstalledAt = (Get-Date).ToString("o")
  Mode = "skeleton"
}
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($metadataPath, ($metadata | ConvertTo-Json -Depth 6), $utf8Bom)

if ($StartAfterInstall) {
  Start-Service -Name $ServiceName
}

Write-Host "Service registered: $ServiceName"
Write-Host "Config file: $configTarget"
Write-Host "Install metadata: $metadataPath"
Write-Host "Log directory: $LogDir"
Write-Host "Start command: Start-Service -Name '$ServiceName'"
Write-Host "Stop command: Stop-Service -Name '$ServiceName'"
Write-Host "Status command: Get-Service -Name '$ServiceName'"
Write-Host "Self-check command: & '$powershellExe' -NoProfile -ExecutionPolicy Bypass -File '$entryPath' -SelfCheck -ConfigPath '$configTarget' -LogDir '$LogDir'"
Write-Host "Health-check command: & '$powershellExe' -NoProfile -ExecutionPolicy Bypass -File '$entryPath' -HealthCheck -ConfigPath '$configTarget' -LogDir '$LogDir'"
Write-Host "Note: this is still a skeleton host without business deployment logic."
