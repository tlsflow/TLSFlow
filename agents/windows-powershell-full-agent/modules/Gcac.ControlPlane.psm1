Set-StrictMode -Version Latest

$gcacRuntimeModulePath = Join-Path $PSScriptRoot "Gcac.Provider.Runtime.psm1"
if (Test-Path -LiteralPath $gcacRuntimeModulePath) {
  Import-Module $gcacRuntimeModulePath -Force -DisableNameChecking
}

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
    $errorMessage = $_.Exception.Message
    if ($null -ne $_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace([string]$_.ErrorDetails.Message)) {
      $errorMessage = $errorMessage + "`n" + [string]$_.ErrorDetails.Message
    }

    return [pscustomobject]@{
      Success = $false
      RequestId = $requestId
      Response = $null
      ErrorMessage = $errorMessage
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

function Get-GcacCapabilitySnapshot {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context,

    [Parameter(Mandatory = $true)]
    [pscustomobject]$Registration
  )

  $inspection = Get-GcacRuntimeInspection
  $plainOsDetail = @{
    Caption = if ($null -ne $inspection.OperatingSystem.Caption) { [string]$inspection.OperatingSystem.Caption } else { $null }
    ProductName = if ($null -ne $inspection.OperatingSystem.ProductName) { [string]$inspection.OperatingSystem.ProductName } else { $null }
    Version = if ($null -ne $inspection.OperatingSystem.Version) { [string]$inspection.OperatingSystem.Version } else { $null }
    BuildNumber = if ($null -ne $inspection.OperatingSystem.BuildNumber) { [string]$inspection.OperatingSystem.BuildNumber } else { $null }
    BuildRevision = if ($null -ne $inspection.OperatingSystem.BuildRevision) { [string]$inspection.OperatingSystem.BuildRevision } else { $null }
    CurrentBuild = if ($null -ne $inspection.OperatingSystem.CurrentBuild) { [string]$inspection.OperatingSystem.CurrentBuild } else { $null }
    CurrentBuildNumber = if ($null -ne $inspection.OperatingSystem.CurrentBuildNumber) { [string]$inspection.OperatingSystem.CurrentBuildNumber } else { $null }
    UBR = $inspection.OperatingSystem.UBR
    DisplayVersion = if ($null -ne $inspection.OperatingSystem.DisplayVersion) { [string]$inspection.OperatingSystem.DisplayVersion } else { $null }
    ReleaseId = if ($null -ne $inspection.OperatingSystem.ReleaseId) { [string]$inspection.OperatingSystem.ReleaseId } else { $null }
    EditionId = if ($null -ne $inspection.OperatingSystem.EditionId) { [string]$inspection.OperatingSystem.EditionId } else { $null }
    InstallationType = if ($null -ne $inspection.OperatingSystem.InstallationType) { [string]$inspection.OperatingSystem.InstallationType } else { $null }
    BuildLabEx = if ($null -ne $inspection.OperatingSystem.BuildLabEx) { [string]$inspection.OperatingSystem.BuildLabEx } else { $null }
    OsArchitecture = if ($null -ne $inspection.OperatingSystem.OsArchitecture) { [string]$inspection.OperatingSystem.OsArchitecture } else { $null }
    ProductType = $inspection.OperatingSystem.ProductType
    LastBootUpTime = if ($null -ne $inspection.OperatingSystem.LastBootUpTime) { [string]$inspection.OperatingSystem.LastBootUpTime } else { $null }
  }

  $plainIisSites = @()
  foreach ($site in @($inspection.IIS.Sites)) {
    if ($null -eq $site) {
      continue
    }

    $plainBindings = @()
    foreach ($binding in @($site.Bindings)) {
      if ($null -eq $binding) {
        continue
      }

      $plainCertificate = $null
      if ($null -ne $binding.Certificate) {
        $plainCertificate = @{
          Thumbprint = if ($null -ne $binding.Certificate.Thumbprint) { [string]$binding.Certificate.Thumbprint } else { $null }
          StoreName = if ($null -ne $binding.Certificate.StoreName) { [string]$binding.Certificate.StoreName } else { $null }
          Subject = if ($null -ne $binding.Certificate.Subject) { [string]$binding.Certificate.Subject } else { $null }
          Issuer = if ($null -ne $binding.Certificate.Issuer) { [string]$binding.Certificate.Issuer } else { $null }
          NotBefore = if ($null -ne $binding.Certificate.NotBefore) { [string]$binding.Certificate.NotBefore } else { $null }
          NotAfter = if ($null -ne $binding.Certificate.NotAfter) { [string]$binding.Certificate.NotAfter } else { $null }
        }
      }

      $plainBindings += @{
        Protocol = if ($null -ne $binding.Protocol) { [string]$binding.Protocol } else { $null }
        BindingInformation = if ($null -ne $binding.BindingInformation) { [string]$binding.BindingInformation } else { $null }
        IPAddress = if ($null -ne $binding.IPAddress) { [string]$binding.IPAddress } else { $null }
        Port = $binding.Port
        HostHeader = if ($null -ne $binding.HostHeader) { [string]$binding.HostHeader } else { $null }
        Certificate = $plainCertificate
        CertificateStoreName = if ($null -ne $binding.CertificateStoreName) { [string]$binding.CertificateStoreName } else { $null }
        CertificateThumbprint = if ($null -ne $binding.CertificateThumbprint) { [string]$binding.CertificateThumbprint } else { $null }
        SslFlags = $binding.SslFlags
      }
    }

    $plainIisSites += @{
      Id = $site.Id
      Name = if ($null -ne $site.Name) { [string]$site.Name } else { $null }
      State = if ($null -ne $site.State) { [string]$site.State } else { $null }
      ServerAutoStart = [bool]$site.ServerAutoStart
      PhysicalPath = if ($null -ne $site.PhysicalPath) { [string]$site.PhysicalPath } else { $null }
      Bindings = @($plainBindings)
    }
  }

  $plainIisDetail = @{
    Installed = [bool]$inspection.IIS.Installed
    VersionString = if ($null -ne $inspection.IIS.VersionString) { [string]$inspection.IIS.VersionString } else { $null }
    MajorVersion = $inspection.IIS.MajorVersion
    MinorVersion = $inspection.IIS.MinorVersion
    BuildNumber = $inspection.IIS.BuildNumber
    SetupString = if ($null -ne $inspection.IIS.SetupString) { [string]$inspection.IIS.SetupString } else { $null }
    Sites = @($plainIisSites)
  }

  $plainNetworkAdapters = @()
  foreach ($adapter in @($inspection.NetworkAdapters)) {
    if ($null -eq $adapter) {
      continue
    }

    $plainNetworkAdapters += @{
      Index = $adapter.Index
      Guid = if ($null -ne $adapter.Guid) { [string]$adapter.Guid } else { $null }
      Name = if ($null -ne $adapter.Name) { [string]$adapter.Name } else { $null }
      NetConnectionId = if ($null -ne $adapter.NetConnectionId) { [string]$adapter.NetConnectionId } else { $null }
      Description = if ($null -ne $adapter.Description) { [string]$adapter.Description } else { $null }
      Manufacturer = if ($null -ne $adapter.Manufacturer) { [string]$adapter.Manufacturer } else { $null }
      ServiceName = if ($null -ne $adapter.ServiceName) { [string]$adapter.ServiceName } else { $null }
      MACAddress = if ($null -ne $adapter.MACAddress) { [string]$adapter.MACAddress } else { $null }
      PhysicalAdapter = $adapter.PhysicalAdapter
      AdapterType = if ($null -ne $adapter.AdapterType) { [string]$adapter.AdapterType } else { $null }
      NetEnabled = $adapter.NetEnabled
      NetConnectionStatus = $adapter.NetConnectionStatus
      Speed = if ($null -ne $adapter.Speed) { [string]$adapter.Speed } else { $null }
      DHCPEnabled = $adapter.DHCPEnabled
      IPEnabled = $adapter.IPEnabled
      DefaultGateways = @($adapter.DefaultGateways)
      HasDefaultGateway = $adapter.HasDefaultGateway
      LikelyVirtual = $adapter.LikelyVirtual
      VirtualReason = if ($null -ne $adapter.VirtualReason) { [string]$adapter.VirtualReason } else { $null }
      IPv4 = @($adapter.IPv4)
      IPv6 = @($adapter.IPv6)
    }
  }

  $capabilities = @(
    @{
      capabilityKey = "full_agent"
      value = $true
      confidence = 1.0
      evidence = @{ source = "powershell-agent" }
    },
    @{
      capabilityKey = "windows.powershell"
      value = $true
      confidence = 1.0
      evidence = @{ source = "powershell-agent" }
    },
    @{
      capabilityKey = "windows.service"
      value = $true
      confidence = 0.9
      evidence = @{ source = "service-skeleton" }
    },
    @{
      capabilityKey = "windows.os.detail"
      value = $plainOsDetail
      confidence = 1.0
      evidence = @{ source = "runtime-inspection" }
    },
    @{
      capabilityKey = "windows.iis.detail"
      value = $plainIisDetail
      confidence = if ($inspection.IIS.Installed) { 1.0 } else { 0.95 }
      evidence = @{ source = "runtime-inspection" }
    },
    @{
      capabilityKey = "windows.iis.sites"
      value = @($plainIisSites)
      confidence = if ($inspection.IIS.Installed) { 1.0 } else { 0.95 }
      evidence = @{ source = "runtime-inspection" }
    },
    @{
      capabilityKey = "windows.network.adapters"
      value = @($plainNetworkAdapters)
      confidence = 1.0
      evidence = @{ source = "runtime-inspection" }
    }
  )

  return @{
    agentId = [string]$Registration.Detail.AgentId
    compatibilityLevel = "L1"
    capabilities = $capabilities
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
  $inspection = Get-GcacRuntimeInspection
  $effectiveAgentKey = if (-not [string]::IsNullOrWhiteSpace([string]$inspection.StableAgentKey)) {
    [string]$inspection.StableAgentKey
  } else {
    [string]$Context.Config.agentKey
  }

  $body = @{
    agentKey = $effectiveAgentKey
    machineId = if (-not [string]::IsNullOrWhiteSpace([string]$inspection.MachineId)) { [string]$inspection.MachineId } else { $null }
    hostname = $hostname
    version = if ($null -ne $Context.Config.PSObject.Properties["agentVersion"] -and -not [string]::IsNullOrWhiteSpace([string]$Context.Config.agentVersion)) { [string]$Context.Config.agentVersion } else { "0.1.0" }
    osType = "windows"
    arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    ipAddress = if (-not [string]::IsNullOrWhiteSpace([string]$inspection.PrimaryIPAddress)) { [string]$inspection.PrimaryIPAddress } else { $null }
    osVersion = if (-not [string]::IsNullOrWhiteSpace([string]$inspection.OperatingSystem.ProductName)) {
      [string]$inspection.OperatingSystem.ProductName
    } elseif (-not [string]::IsNullOrWhiteSpace([string]$inspection.OperatingSystem.Caption)) {
      [string]$inspection.OperatingSystem.Caption
    } else {
      [string]$inspection.OperatingSystem.Version
    }
    labels = @(
      "full-agent",
      "powershell",
      "windows",
      ("os-version:" + [string]$inspection.OperatingSystem.Version),
      ("iis-installed:" + ([string][bool]$inspection.IIS.Installed).ToLowerInvariant())
    )
    role = "full_agent"
    zone = if ($null -ne $Context.Config.PSObject.Properties["zone"] -and -not [string]::IsNullOrWhiteSpace([string]$Context.Config.zone)) { [string]$Context.Config.zone } else { "local" }
  }

  if ($null -ne $Context.Config.PSObject.Properties["enrollmentToken"] -and -not [string]::IsNullOrWhiteSpace([string]$Context.Config.enrollmentToken)) {
    $body.enrollmentToken = [string]$Context.Config.enrollmentToken
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

function Report-GcacCapabilities {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context,

    [Parameter(Mandatory = $true)]
    [pscustomobject]$Registration
  )

  $mode = Get-GcacControlPlaneMode -Context $Context
  if ($mode -eq "placeholder") {
    $capabilityCount = (Get-GcacCapabilitySnapshot -Context $Context -Registration $Registration).capabilities.Count
    return [pscustomobject]@{
      Success = $true
      ErrorCode = $null
      ErrorMessage = $null
      Detail = [pscustomobject]@{
        AgentId = $Registration.Detail.AgentId
        Mode = "placeholder"
        CapabilityCount = $capabilityCount
      }
      Logs = @()
    }
  }

  $body = Get-GcacCapabilitySnapshot -Context $Context -Registration $Registration
  $response = Invoke-GcacControlPlaneRequest -Method "POST" -Context $Context -Path "/api/v1/agents/capabilities" -Body $body
  if (-not $response.Success) {
    return [pscustomobject]@{
      Success = $false
      ErrorCode = "CONTROL_PLANE_REPORT_CAPABILITIES_FAILED"
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
        Mode = "http"
        CapabilityCount = $body.capabilities.Count
        RequestId = $response.RequestId
        Response = $response.Response
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

function Submit-GcacTaskLogs {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context,

    [Parameter(Mandatory = $true)]
    [pscustomobject]$Registration,

    [Parameter(Mandatory = $true)]
    [object]$Task,

    [Parameter(Mandatory = $true)]
    [array]$Logs
  )

  $mode = Get-GcacControlPlaneMode -Context $Context
  if ($mode -eq "placeholder") {
    return [pscustomobject]@{
      Success = $true
      ErrorCode = $null
      ErrorMessage = $null
      Detail = [pscustomobject]@{
        AgentId = $Registration.Detail.AgentId
        TaskId = [string]$Task.TaskId
        Mode = "placeholder"
        LogCount = $Logs.Count
        LastAckedSequence = if ($Logs.Count -gt 0) { $Logs[-1].sequence } else { 0 }
      }
      Logs = @()
    }
  }

  $response = Invoke-GcacControlPlaneRequest -Method "POST" -Context $Context -Path "/api/v1/agents/tasks/log-batches" -Body @{
    agentId = [string]$Registration.Detail.AgentId
    taskId = [string]$Task.TaskId
    logs = $Logs
  }

  if (-not $response.Success) {
    return [pscustomobject]@{
      Success = $false
      ErrorCode = "CONTROL_PLANE_SUBMIT_LOGS_FAILED"
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
      Mode = "http"
      LogCount = $Logs.Count
      RequestId = $response.RequestId
      Response = $response.Response
      LastAckedSequence = $response.Response.lastAckedSequence
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

Export-ModuleMember -Function Register-GcacControlPlaneAgent, Report-GcacCapabilities, Send-GcacHeartbeat, Submit-GcacTaskLogs, Get-GcacPendingTask, Submit-GcacTaskResult
