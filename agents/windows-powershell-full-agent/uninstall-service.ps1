[CmdletBinding()]
param(
  [string]$ServiceName = "gcac-agent"
)

$ErrorActionPreference = "Stop"

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent (Split-Path -Parent $sourceRoot)
$goAgentRoot = Join-Path $repoRoot "agents\windows-go-full-agent"
$goUninstaller = Join-Path $goAgentRoot "uninstall-service.ps1"

if (-not (Test-Path -LiteralPath $goUninstaller)) {
  throw "Go agent uninstaller not found: $goUninstaller"
}

Write-Host "Legacy PowerShell uninstall entry detected."
Write-Host "This entry now delegates to the Go agent uninstaller."
Write-Host "Target uninstaller: $goUninstaller"

& $goUninstaller -ServiceName $ServiceName

if ($LASTEXITCODE -ne 0) {
  throw "Go agent uninstaller exited with code $LASTEXITCODE"
}
