Set-StrictMode -Version Latest

function New-GcacExecutionContext {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Config,

    [Parameter(Mandatory = $true)]
    [string]$LogDir
  )

  $dataDir = if ($Config.paths -and $Config.paths.windows -and $Config.paths.windows.dataDir) {
    [string]$Config.paths.windows.dataDir
  } else {
    Join-Path $env:ProgramData "GCAC\FullAgent\data"
  }

  $workDir = Join-Path $dataDir "work"
  $statePath = Join-Path $dataDir "agent-state.json"

  New-Item -ItemType Directory -Force -Path $dataDir, $LogDir, $workDir | Out-Null

  return [pscustomobject]@{
    Config = $Config
    LogDir = $LogDir
    DataDir = $dataDir
    WorkDir = $workDir
    StatePath = $statePath
    Mode = "skeleton"
  }
}

function Invoke-GcacProvider {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProviderName,

    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context,

    [Parameter(Mandatory = $false)]
    [object]$Payload
  )

  return [pscustomobject]@{
    Success = $false
    ErrorCode = "PROVIDER_NOT_IMPLEMENTED"
    ErrorMessage = "Provider is not implemented in the current skeleton: $ProviderName"
    Detail = [pscustomobject]@{
      ProviderName = $ProviderName
      Payload = $Payload
      Mode = "skeleton"
    }
    Logs = @()
  }
}

function Write-GcacRuntimeLog {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context,

    [Parameter(Mandatory = $true)]
    [string]$Level,

    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  $timestamp = (Get-Date).ToString("s")
  $line = "[{0}] [{1}] {2}" -f $timestamp, $Level, $Message
  $logPath = Join-Path $Context.LogDir "runtime.log"
  $utf8Bom = New-Object System.Text.UTF8Encoding($true)
  if (Test-Path -LiteralPath $logPath) {
    $existing = Get-Content -LiteralPath $logPath -Raw
    [System.IO.File]::WriteAllText($logPath, ($existing + [Environment]::NewLine + $line), $utf8Bom)
  } else {
    [System.IO.File]::WriteAllText($logPath, $line, $utf8Bom)
  }
}

Export-ModuleMember -Function New-GcacExecutionContext, Invoke-GcacProvider, Write-GcacRuntimeLog
