Set-StrictMode -Version Latest

function Get-GcacControlPlaneMode {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context
  )

  $configuredMode = ""
  $hasControlPlane = $null -ne $Context.Config.PSObject.Properties["controlPlane"]
  if ($hasControlPlane -and $null -ne $Context.Config.controlPlane) {
    $hasMode = $null -ne $Context.Config.controlPlane.PSObject.Properties["mode"]
    if ($hasMode -and -not [string]::IsNullOrWhiteSpace([string]$Context.Config.controlPlane.mode)) {
      $configuredMode = [string]$Context.Config.controlPlane.mode
    }
  }

  if (-not [string]::IsNullOrWhiteSpace($configuredMode)) {
    return $configuredMode.ToLowerInvariant()
  }

  $url = [string]$Context.Config.controlPlaneUrl
  if ($url -match 'example\.invalid') {
    return "placeholder"
  }

  return "http"
}

function New-GcacControlPlaneRequestId {
  [CmdletBinding()]
  param()

  return "gcac-ps-" + [guid]::NewGuid().ToString("N")
}

function New-GcacControlPlaneHeaders {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context,

    [Parameter(Mandatory = $false)]
    [string]$RequestId = ""
  )

  $resolvedRequestId = if ([string]::IsNullOrWhiteSpace($RequestId)) {
    New-GcacControlPlaneRequestId
  } else {
    $RequestId
  }

  return @{
    "x-tenant-id" = [string]$Context.Config.tenantId
    "x-request-id" = $resolvedRequestId
  }
}

function Invoke-GcacControlPlaneRequest {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("GET", "POST")]
    [string]$Method,

    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context,

    [Parameter(Mandatory = $true)]
    [string]$Path,

    [Parameter(Mandatory = $false)]
    [hashtable]$Query = @{},

    [Parameter(Mandatory = $false)]
    [object]$Body = $null
  )

  $baseUrl = ([string]$Context.Config.controlPlaneUrl).TrimEnd("/")
  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append($baseUrl)
  [void]$builder.Append($Path)

  if ($Query.Count -gt 0) {
    $pairs = @()
    foreach ($key in $Query.Keys) {
      $pairs += ([System.Uri]::EscapeDataString([string]$key) + "=" + [System.Uri]::EscapeDataString([string]$Query[$key]))
    }
    [void]$builder.Append("?")
    [void]$builder.Append(($pairs -join "&"))
  }

  $requestId = New-GcacControlPlaneRequestId
  $headers = New-GcacControlPlaneHeaders -Context $Context -RequestId $requestId
  $invokeParams = @{
    Method = $Method
    Uri = $builder.ToString()
    Headers = $headers
    ContentType = "application/json; charset=utf-8"
    ErrorAction = "Stop"
  }

  if ($null -ne $Body) {
    $invokeParams.Body = ($Body | ConvertTo-Json -Depth 10)
  }

  try {
    $response = Invoke-RestMethod @invokeParams
    return [pscustomobject]@{
      Success = $true
      RequestId = $requestId
      Response = $response
      ErrorMessage = $null
    }
  } catch {
    return [pscustomobject]@{
      Success = $false
      RequestId = $requestId
      Response = $null
      ErrorMessage = $_.Exception.Message
    }
  }
}

function Get-GcacRegistrationIdentity {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [object]$RegistrationResponse
  )

  $agentId = $RegistrationResponse.id
  if ([string]::IsNullOrWhiteSpace([string]$agentId) -and $RegistrationResponse.agentId) {
    $agentId = $RegistrationResponse.agentId
  }

  return [pscustomobject]@{
    AgentId = [string]$agentId
    AgentKey = [string]$RegistrationResponse.agentKey
    Status = [string]$RegistrationResponse.status
  }
}

function Register-GcacControlPlaneAgent {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context
  )

  $mode = Get-GcacControlPlaneMode -Context $Context
  if ($mode -eq "placeholder") {
    return [pscustomobject]@{
      Success = $true
      ErrorCode = $null
      ErrorMessage = $null
      Detail = [pscustomobject]@{
        AgentId = "skeleton-agent"
        AgentKey = [string]$Context.Config.agentKey
        Status = "ONLINE"
        Mode = "placeholder"
        ControlPlaneUrl = $Context.Config.controlPlaneUrl
      }
      Logs = @()
    }
  }

  $hostname = [System.Net.Dns]::GetHostName()
  $body = @{
    agentKey = [string]$Context.Config.agentKey
    hostname = $hostname
    version = if ($null -ne $Context.Config.PSObject.Properties["agentVersion"] -and -not [string]::IsNullOrWhiteSpace([string]$Context.Config.agentVersion)) { [string]$Context.Config.agentVersion } else { "0.1.0" }
    osType = "windows"
    arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    labels = @("full-agent", "powershell", "windows")
    role = "full_agent"
    zone = if ($null -ne $Context.Config.PSObject.Properties["zone"] -and -not [string]::IsNullOrWhiteSpace([string]$Context.Config.zone)) { [string]$Context.Config.zone } else { "local" }
  }

  $response = Invoke-GcacControlPlaneRequest -Method "POST" -Context $Context -Path "/api/v1/agents/register" -Body $body
  if (-not $response.Success) {
    return [pscustomobject]@{
      Success = $false
      ErrorCode = "CONTROL_PLANE_REGISTER_FAILED"
      ErrorMessage = $response.ErrorMessage
      Detail = [pscustomobject]@{
        Mode = "http"
        ControlPlaneUrl = $Context.Config.controlPlaneUrl
        RequestId = $response.RequestId
      }
      Logs = @()
    }
  }

  $identity = Get-GcacRegistrationIdentity -RegistrationResponse $response.Response
  return [pscustomobject]@{
    Success = $true
    ErrorCode = $null
    ErrorMessage = $null
    Detail = [pscustomobject]@{
      AgentId = $identity.AgentId
      AgentKey = $identity.AgentKey
      Status = $identity.Status
      Mode = "http"
      ControlPlaneUrl = $Context.Config.controlPlaneUrl
      RequestId = $response.RequestId
    }
    Logs = @()
  }
}

function Send-GcacHeartbeat {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context,

    [Parameter(Mandatory = $true)]
    [pscustomobject]$Registration
  )

  $mode = Get-GcacControlPlaneMode -Context $Context
  if ($mode -eq "placeholder") {
    return [pscustomobject]@{
      Success = $true
      ErrorCode = $null
      ErrorMessage = $null
      Detail = [pscustomobject]@{
        AgentId = $Registration.Detail.AgentId
        Timestamp = (Get-Date).ToString("o")
        Mode = "placeholder"
      }
      Logs = @()
    }
  }

  $body = @{
    agentId = [string]$Registration.Detail.AgentId
    status = "ONLINE"
    version = if ($null -ne $Context.Config.PSObject.Properties["agentVersion"] -and -not [string]::IsNullOrWhiteSpace([string]$Context.Config.agentVersion)) { [string]$Context.Config.agentVersion } else { "0.1.0" }
    taskSummary = @{
      running = 0
      queued = 0
    }
  }

  $response = Invoke-GcacControlPlaneRequest -Method "POST" -Context $Context -Path "/api/v1/agents/heartbeat" -Body $body
  if (-not $response.Success) {
    return [pscustomobject]@{
      Success = $false
      ErrorCode = "CONTROL_PLANE_HEARTBEAT_FAILED"
      ErrorMessage = $response.ErrorMessage
      Detail = [pscustomobject]@{
        AgentId = $Registration.Detail.AgentId
        Mode = "http"
        RequestId = $response.RequestId
      }
      Logs = @()
    }
  }

  return [pscustomobject]@{
    Success = $true
    ErrorCode = $null
    ErrorMessage = $null
    Detail = [pscustomobject]@{
      AgentId = $Registration.Detail.AgentId
      Timestamp = (Get-Date).ToString("o")
      Mode = "http"
      RequestId = $response.RequestId
      Response = $response.Response
    }
    Logs = @()
  }
}

function Get-GcacPendingTask {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context,

    [Parameter(Mandatory = $true)]
    [pscustomobject]$Registration
  )

  $mode = Get-GcacControlPlaneMode -Context $Context
  if ($mode -eq "placeholder") {
    return [pscustomobject]@{
      Success = $true
      ErrorCode = $null
      ErrorMessage = $null
      Detail = [pscustomobject]@{
        TaskId = $null
        Mode = "no_task_placeholder"
        AgentId = $Registration.Detail.AgentId
      }
      Logs = @()
    }
  }

  $response = Invoke-GcacControlPlaneRequest -Method "GET" -Context $Context -Path "/api/v1/agents/tasks/pull" -Query @{
    agentId = [string]$Registration.Detail.AgentId
    limit = "1"
  }

  if (-not $response.Success) {
    return [pscustomobject]@{
      Success = $false
      ErrorCode = "CONTROL_PLANE_PULL_TASK_FAILED"
      ErrorMessage = $response.ErrorMessage
      Detail = [pscustomobject]@{
        AgentId = $Registration.Detail.AgentId
        Mode = "http"
        RequestId = $response.RequestId
      }
      Logs = @()
    }
  }

  $firstTask = $null
  if ($response.Response -is [System.Array]) {
    if ($response.Response.Count -gt 0) {
      $firstTask = $response.Response[0]
    }
  } elseif ($null -ne $response.Response) {
    $firstTask = $response.Response
  }

  if ($null -eq $firstTask) {
    return [pscustomobject]@{
      Success = $true
      ErrorCode = $null
      ErrorMessage = $null
      Detail = [pscustomobject]@{
        TaskId = $null
        Mode = "no_task_http"
        AgentId = $Registration.Detail.AgentId
        RequestId = $response.RequestId
      }
      Logs = @()
    }
  }

  $leaseId = "lease-" + [guid]::NewGuid().ToString("N")
  $ackResponse = Invoke-GcacControlPlaneRequest -Method "POST" -Context $Context -Path "/api/v1/agents/tasks/ack" -Body @{
    agentId = [string]$Registration.Detail.AgentId
    taskId = [string]$firstTask.id
    leaseId = $leaseId
  }

  if (-not $ackResponse.Success) {
    return [pscustomobject]@{
      Success = $false
      ErrorCode = "CONTROL_PLANE_ACK_TASK_FAILED"
      ErrorMessage = $ackResponse.ErrorMessage
      Detail = [pscustomobject]@{
        AgentId = $Registration.Detail.AgentId
        TaskId = [string]$firstTask.id
        Mode = "http"
        RequestId = $ackResponse.RequestId
      }
      Logs = @()
    }
  }

  return [pscustomobject]@{
    Success = $true
    ErrorCode = $null
    ErrorMessage = $null
    Detail = [pscustomobject]@{
      TaskId = [string]$firstTask.id
      LeaseId = $leaseId
      AgentId = $Registration.Detail.AgentId
      ExecutionRunId = [string]$firstTask.executionRunId
      ExecutionStepId = [string]$firstTask.executionStepId
      Payload = $firstTask.payload
      Mode = "http"
      RequestId = $response.RequestId
    }
    Logs = @()
  }
}

function Submit-GcacTaskResult {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context,

    [Parameter(Mandatory = $true)]
    [pscustomobject]$Registration,

    [Parameter(Mandatory = $true)]
    [object]$Task,

    [Parameter(Mandatory = $true)]
    [object]$Result
  )

  $mode = Get-GcacControlPlaneMode -Context $Context
  if ($mode -eq "placeholder") {
    return [pscustomobject]@{
      Success = $true
      ErrorCode = $null
      ErrorMessage = $null
      Detail = [pscustomobject]@{
        AgentId = $Registration.Detail.AgentId
        Task = $Task
        Result = $Result
        Mode = "submit_placeholder"
      }
      Logs = @()
    }
  }

  $successValue = $true
  if ($null -ne $Result.PSObject.Properties["success"]) {
    $successValue = [bool]$Result.success
  }

  $errorCode = $null
  if ($null -ne $Result.PSObject.Properties["errorCode"]) {
    $errorCode = [string]$Result.errorCode
  }

  $errorMessage = $null
  if ($null -ne $Result.PSObject.Properties["errorMessage"]) {
    $errorMessage = [string]$Result.errorMessage
  }

  $response = Invoke-GcacControlPlaneRequest -Method "POST" -Context $Context -Path "/api/v1/agents/tasks/result" -Body @{
    agentId = [string]$Registration.Detail.AgentId
    taskId = [string]$Task.TaskId
    leaseId = [string]$Task.LeaseId
    success = $successValue
    errorCode = $errorCode
    errorMessage = $errorMessage
    detail = $Result
  }

  if (-not $response.Success) {
    return [pscustomobject]@{
      Success = $false
      ErrorCode = "CONTROL_PLANE_SUBMIT_RESULT_FAILED"
      ErrorMessage = $response.ErrorMessage
      Detail = [pscustomobject]@{
        AgentId = $Registration.Detail.AgentId
        TaskId = [string]$Task.TaskId
        Mode = "http"
        RequestId = $response.RequestId
      }
      Logs = @()
    }
  }

  return [pscustomobject]@{
    Success = $true
    ErrorCode = $null
    ErrorMessage = $null
    Detail = [pscustomobject]@{
      AgentId = $Registration.Detail.AgentId
      TaskId = [string]$Task.TaskId
      LeaseId = [string]$Task.LeaseId
      Result = $response.Response
      Mode = "http"
      RequestId = $response.RequestId
    }
    Logs = @()
  }
}

Export-ModuleMember -Function Register-GcacControlPlaneAgent, Send-GcacHeartbeat, Get-GcacPendingTask, Submit-GcacTaskResult
