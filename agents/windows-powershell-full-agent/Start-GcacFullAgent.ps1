[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$ConfigPath = "",

  [Parameter(Mandatory = $false)]
  [string]$LogDir = "",

  [Parameter(Mandatory = $false)]
  [string]$OutputPath = "",

  [Parameter(Mandatory = $false)]
  [switch]$SelfCheck,

  [Parameter(Mandatory = $false)]
  [switch]$HealthCheck,

  [Parameter(Mandatory = $false)]
  [switch]$RunOnce
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$moduleRoot = Join-Path $scriptRoot "modules"

Import-Module (Join-Path $moduleRoot "Gcac.Agent.Service.psm1") -Force

$resolvedConfigPath = if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  Join-Path $scriptRoot "config\agent.config.template.json"
} else {
  $ConfigPath
}

$resolvedLogDir = if ([string]::IsNullOrWhiteSpace($LogDir)) {
  Join-Path $env:ProgramData "GCAC\FullAgent\logs"
} else {
  $LogDir
}

if ($SelfCheck) {
  $result = Test-GcacAgentSelfCheck -ConfigPath $resolvedConfigPath -LogDir $resolvedLogDir
} elseif ($HealthCheck) {
  $result = Test-GcacAgentHealth -ConfigPath $resolvedConfigPath -LogDir $resolvedLogDir
} else {
  $result = Start-GcacAgentService -ConfigPath $resolvedConfigPath -LogDir $resolvedLogDir -RunOnce:$RunOnce
}

if ($RunOnce -or $SelfCheck -or $HealthCheck) {
  $json = $result | ConvertTo-Json -Depth 8
  if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    Write-Output $json
  } else {
    $utf8Bom = New-Object System.Text.UTF8Encoding($true)
    [System.IO.File]::WriteAllText($OutputPath, $json, $utf8Bom)
  }
}
