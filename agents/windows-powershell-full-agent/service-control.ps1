[CmdletBinding()]
param(
  [ValidateSet("start", "stop", "restart", "status", "selfcheck", "healthcheck")]
  [string]$Action,

  [string]$ServiceName = "gcac-full-agent-ps",
  [string]$InstallRoot = "C:\Program Files\GCAC\FullAgentPS",
  [string]$ConfigDir = "C:\ProgramData\GCAC\FullAgent",
  [string]$LogDir = "C:\ProgramData\GCAC\FullAgent\logs",
  [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"

function Get-GcacInstalledEntryPath {
  param(
    [string]$InstallRootPath
  )

  $entryPath = Join-Path $InstallRootPath "Start-GcacFullAgent.ps1"
  if (-not (Test-Path -LiteralPath $entryPath)) {
    throw "Installed agent entry script not found: $entryPath"
  }

  return $entryPath
}

function Get-GcacInstalledConfigPath {
  param(
    [string]$ConfigRoot,
    [string]$ExplicitConfigPath
  )

  if (-not [string]::IsNullOrWhiteSpace($ExplicitConfigPath)) {
    if (-not (Test-Path -LiteralPath $ExplicitConfigPath)) {
      throw "Specified config file not found: $ExplicitConfigPath"
    }

    return $ExplicitConfigPath
  }

  $configPath = Join-Path $ConfigRoot "agent.config.json"
  if (-not (Test-Path -LiteralPath $configPath)) {
    throw "Installed agent config not found: $configPath"
  }

  return $configPath
}

$powershellExe = Join-Path $PSHOME "powershell.exe"

switch ($Action) {
  "start" {
    Start-Service -Name $ServiceName
    Get-Service -Name $ServiceName
  }
  "stop" {
    Stop-Service -Name $ServiceName
    Get-Service -Name $ServiceName
  }
  "restart" {
    Restart-Service -Name $ServiceName
    Get-Service -Name $ServiceName
  }
  "status" {
    Get-Service -Name $ServiceName
  }
  "selfcheck" {
    $entryPath = Get-GcacInstalledEntryPath -InstallRootPath $InstallRoot
    $configPath = Get-GcacInstalledConfigPath -ConfigRoot $ConfigDir -ExplicitConfigPath $ConfigPath
    & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $entryPath -SelfCheck -ConfigPath $configPath -LogDir $LogDir
  }
  "healthcheck" {
    $entryPath = Get-GcacInstalledEntryPath -InstallRootPath $InstallRoot
    $configPath = Get-GcacInstalledConfigPath -ConfigRoot $ConfigDir -ExplicitConfigPath $ConfigPath
    & $powershellExe -NoProfile -ExecutionPolicy Bypass -File $entryPath -HealthCheck -ConfigPath $configPath -LogDir $LogDir
  }
}
