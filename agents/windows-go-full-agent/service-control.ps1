[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("start", "stop", "restart", "status", "selfcheck", "healthcheck", "service-info")]
  [string]$Action,

  [string]$ServiceName = "gcac-agent",
  [string]$BinaryPath = "C:\Program Files\GCAC\FullAgentGo\gcac-agent.exe",
  [string]$ConfigPath = "C:\ProgramData\GCAC\FullAgentGo\config\agent.config.json",
  [string]$MetadataPath = "C:\ProgramData\GCAC\FullAgentGo\service.install.json"
)

$ErrorActionPreference = "Stop"

switch ($Action) {
  "start" {
    Start-Service -Name $ServiceName
    Get-Service -Name $ServiceName
  }
  "stop" {
    Stop-Service -Name $ServiceName -Force
    Get-Service -Name $ServiceName
  }
  "restart" {
    Restart-Service -Name $ServiceName -Force
    Get-Service -Name $ServiceName
  }
  "status" {
    Get-Service -Name $ServiceName
  }
  "selfcheck" {
    & $BinaryPath self-check --config=$ConfigPath
  }
  "healthcheck" {
    & $BinaryPath health --config=$ConfigPath
  }
  "service-info" {
    & $BinaryPath service-info --config=$ConfigPath --metadata=$MetadataPath
  }
}
