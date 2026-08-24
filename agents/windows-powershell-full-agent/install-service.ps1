[CmdletBinding()]
param(
  [string]$ServiceName = "gcac-agent",
  [string]$DisplayName = "GCAC Go Full Agent",
  [string]$Description = "GCAC Windows Go Full Agent service",
  [string]$InstallRoot = "C:\Program Files\GCAC\FullAgentGo",
  [string]$ConfigDir = "C:\ProgramData\GCAC\FullAgentGo\config",
  [string]$DataDir = "C:\ProgramData\GCAC\FullAgentGo\data",
  [string]$LogDir = "C:\ProgramData\GCAC\FullAgentGo\logs",
  [switch]$StartAfterInstall
)

$ErrorActionPreference = "Stop"

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $sourceRoot)
$goAgentRoot = Join-Path $repoRoot "agents\windows-go-full-agent"
$goInstaller = Join-Path $goAgentRoot "install-service.ps1"

if (-not (Test-Path -LiteralPath $goInstaller)) {
  throw "Go agent installer not found: $goInstaller"
}

Write-Host "Legacy PowerShell installer entry detected."
Write-Host "This entry now delegates to the Go agent installer."
Write-Host "Target installer: $goInstaller"

& $goInstaller `
  -ServiceName $ServiceName `
  -DisplayName $DisplayName `
  -Description $Description `
  -InstallRoot $InstallRoot `
  -ConfigDir $ConfigDir `
  -DataDir $DataDir `
  -LogDir $LogDir `
  -StartAfterInstall:$StartAfterInstall

if ($LASTEXITCODE -ne 0) {
  throw "Go agent installer exited with code $LASTEXITCODE"
}
