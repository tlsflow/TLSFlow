Set-StrictMode -Version Latest

function Start-GcacAgentService {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [Parameter(Mandatory = $true)]
    [string]$LogDir,

    [Parameter(Mandatory = $false)]
    [switch]$RunOnce
  )

  $moduleRoot = Split-Path -Parent $PSCommandPath
  Import-Module (Join-Path $moduleRoot "Gcac.Agent.Core.psm1") -Force

  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

  Write-GcacAgentLog -LogDir $LogDir -Level "INFO" -Message "Agent service skeleton start"
  $result = Invoke-GcacAgentLoop -ConfigPath $ConfigPath -LogDir $LogDir -RunOnce:$RunOnce

  if ($result.Success) {
    Write-GcacAgentLog -LogDir $LogDir -Level "INFO" -Message "Agent service skeleton completed iteration"
  } else {
    $message = if ([string]::IsNullOrWhiteSpace($result.ErrorMessage)) { "Agent service skeleton failed" } else { $result.ErrorMessage }
    Write-GcacAgentLog -LogDir $LogDir -Level "ERROR" -Message $message
  }

  return $result
}

function Test-GcacAgentSelfCheck {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [Parameter(Mandatory = $true)]
    [string]$LogDir
  )

  $moduleRoot = Split-Path -Parent $PSCommandPath
  Import-Module (Join-Path $moduleRoot "Gcac.Agent.Core.psm1") -Force
  Import-Module (Join-Path $moduleRoot "Gcac.Provider.Runtime.psm1") -Force

  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    return New-GcacAgentResult -Success $false -ErrorCode "CONFIG_NOT_FOUND" -ErrorMessage "Config file not found." -Detail @{
      ConfigPath = $ConfigPath
      Mode = "self_check"
    }
  }

  try {
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    Assert-GcacAgentConfig -Config $config
    $context = New-GcacExecutionContext -Config $config -ConfigPath $ConfigPath -LogDir $LogDir

    return New-GcacAgentResult -Success $true -Detail @{
      ConfigPath = $ConfigPath
      LogDir = $LogDir
      DataDir = $context.DataDir
      WorkDir = $context.WorkDir
      StatePath = $context.StatePath
      Mode = "self_check"
    }
  } catch {
    return New-GcacAgentResult -Success $false -ErrorCode "SELF_CHECK_FAILED" -ErrorMessage $_.Exception.Message -Detail @{
      ConfigPath = $ConfigPath
      LogDir = $LogDir
      Mode = "self_check"
    }
  }
}

function Test-GcacAgentHealth {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [Parameter(Mandatory = $true)]
    [string]$LogDir
  )

  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    return New-GcacAgentResult -Success $false -ErrorCode "HEALTH_CONFIG_NOT_FOUND" -ErrorMessage "Config file not found." -Detail @{
      ConfigPath = $ConfigPath
      Mode = "health_check"
    }
  }

  return New-GcacAgentResult -Success $true -Detail @{
    ConfigPath = $ConfigPath
    LogDir = $LogDir
    Timestamp = (Get-Date).ToString("o")
    Mode = "health_check"
    Status = "healthy_skeleton"
  }
}

function Write-GcacAgentLog {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$LogDir,

    [Parameter(Mandatory = $true)]
    [string]$Level,

    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  $timestamp = (Get-Date).ToString("s")
  $line = "[{0}] [{1}] {2}" -f $timestamp, $Level, $Message
  $logPath = Join-Path $LogDir "agent.log"
  $utf8Bom = New-Object System.Text.UTF8Encoding($true)
  if (Test-Path -LiteralPath $logPath) {
    $existing = Get-Content -LiteralPath $logPath -Raw
    [System.IO.File]::WriteAllText($logPath, ($existing + [Environment]::NewLine + $line), $utf8Bom)
  } else {
    [System.IO.File]::WriteAllText($logPath, $line, $utf8Bom)
  }
}

function New-GcacAgentResult {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [bool]$Success,

    [Parameter(Mandatory = $false)]
    [string]$ErrorCode = $null,

    [Parameter(Mandatory = $false)]
    [string]$ErrorMessage = $null,

    [Parameter(Mandatory = $false)]
    [hashtable]$Detail = @{},

    [Parameter(Mandatory = $false)]
    [array]$Logs = @()
  )

  return [pscustomobject]@{
    Success = $Success
    ErrorCode = $ErrorCode
    ErrorMessage = $ErrorMessage
    Detail = [pscustomobject]$Detail
    Logs = $Logs
  }
}

Export-ModuleMember -Function Start-GcacAgentService, Test-GcacAgentSelfCheck, Test-GcacAgentHealth
