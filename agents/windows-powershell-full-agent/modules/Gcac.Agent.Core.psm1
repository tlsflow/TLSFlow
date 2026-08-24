Set-StrictMode -Version Latest

function Invoke-GcacAgentLoop {
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
  Import-Module (Join-Path $moduleRoot "Gcac.ControlPlane.psm1") -Force
  Import-Module (Join-Path $moduleRoot "Gcac.Provider.Runtime.psm1") -Force

  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Config file not found: $ConfigPath"
  }

  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  Assert-GcacAgentConfig -Config $config
  $context = New-GcacExecutionContext -Config $config -LogDir $LogDir

  if ($RunOnce) {
    return (Invoke-GcacAgentIteration -Context $context)
  }

  while ($true) {
    $result = Invoke-GcacAgentIteration -Context $context
    if (-not $result.Success) {
      return $result
    }
    Start-Sleep -Seconds 15
  }
}

function Invoke-GcacAgentIteration {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context
  )

  Write-GcacRuntimeLog -Context $Context -Level "INFO" -Message "Agent iteration started"
  $registration = Register-GcacControlPlaneAgent -Context $Context
  if (-not $registration.Success) {
    return $registration
  }

  $heartbeat = Send-GcacHeartbeat -Context $Context -Registration $registration
  if (-not $heartbeat.Success) {
    return $heartbeat
  }

  $task = Get-GcacPendingTask -Context $Context -Registration $registration
  if (-not $task.Success) {
    return $task
  }

  $state = [pscustomobject]@{
    LastRegistrationAt = (Get-Date).ToString("o")
    LastHeartbeatAt = $heartbeat.Detail.Timestamp
    LastTaskMode = $task.Detail.Mode
    LastTaskId = $task.Detail.TaskId
  }
  Save-GcacLocalState -Context $Context -State $state

  if ($task.Detail.TaskId) {
    $submit = Submit-GcacTaskResult -Context $Context -Registration $registration -Task $task.Detail -Result @{
      success = $true
      mode = "skeleton"
    }
    if (-not $submit.Success) {
      return $submit
    }
  }

  Write-GcacRuntimeLog -Context $Context -Level "INFO" -Message "Agent iteration completed"

  return [pscustomobject]@{
    Success = $true
    ErrorCode = $null
    ErrorMessage = $null
    Detail = [pscustomobject]@{
      ConfigSummary = [pscustomobject]@{
        TenantId = $Context.Config.tenantId
        AgentKey = $Context.Config.agentKey
        ControlPlaneUrl = $Context.Config.controlPlaneUrl
      }
      Registration = $registration
      Heartbeat = $heartbeat
      Task = $task
      LocalStatePath = $Context.StatePath
      Mode = "skeleton"
    }
    Logs = @()
  }
}

function Assert-GcacAgentConfig {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Config
  )

  $required = @("schemaVersion", "tenantId", "agentKey", "controlPlaneUrl")
  foreach ($field in $required) {
    $value = $Config.$field
    if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) {
      throw "Missing required config field: $field"
    }
  }
}

function Save-GcacLocalState {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context,

    [Parameter(Mandatory = $true)]
    [pscustomobject]$State
  )

  $json = $State | ConvertTo-Json -Depth 6
  $utf8Bom = New-Object System.Text.UTF8Encoding($true)
  [System.IO.File]::WriteAllText($Context.StatePath, $json, $utf8Bom)
}

Export-ModuleMember -Function Invoke-GcacAgentLoop, Invoke-GcacAgentIteration, Assert-GcacAgentConfig, Save-GcacLocalState
