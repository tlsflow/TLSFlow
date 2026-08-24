[CmdletBinding()]
param(
  [ValidateSet("start", "stop", "restart", "status", "selfcheck", "healthcheck", "service-info")]
  [string]$Action,

  [string]$ServiceName = "gcac-agent",
  [string]$BinaryPath = "C:\Program Files\GCAC\FullAgentGo\gcac-agent.exe",
  [string]$ConfigDir = "C:\ProgramData\GCAC\FullAgentGo\config",
  [string]$LogDir = "C:\ProgramData\GCAC\FullAgentGo\logs",
  [string]$ConfigPath = "",
  [string]$MetadataPath = "C:\ProgramData\GCAC\FullAgentGo\service.install.json"
)

$ErrorActionPreference = "Stop"

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $sourceRoot)
$goAgentRoot = Join-Path $repoRoot "agents\windows-go-full-agent"
$goController = Join-Path $goAgentRoot "service-control.ps1"

if (-not (Test-Path -LiteralPath $goController)) {
  throw "Go agent service control script not found: $goController"
}

Write-Host "Legacy PowerShell service-control entry detected."
Write-Host "This entry now delegates to the Go agent service-control script."
Write-Host "Target controller: $goController"

if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $ConfigDir "agent.config.json"
}

& $goController `
  -Action $Action `
  -ServiceName $ServiceName `
  -BinaryPath $BinaryPath `
  -ConfigPath $ConfigPath `
  -MetadataPath $MetadataPath
