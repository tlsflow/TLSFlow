Set-StrictMode -Version Latest

function Convert-GcacCertificateHashToThumbprint {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $false)]
    [object]$CertificateHash
  )

  if ($null -eq $CertificateHash) {
    return $null
  }

  if ($CertificateHash -is [byte[]]) {
    return ([System.BitConverter]::ToString($CertificateHash)).Replace("-", "")
  }

  $value = [string]$CertificateHash
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $null
  }

  return $value.Replace(" ", "").Replace(":", "").ToUpperInvariant()
}

function Get-GcacCertificateSummary {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $false)]
    [string]$StoreName,

    [Parameter(Mandatory = $false)]
    [object]$CertificateHash
  )

  $thumbprint = Convert-GcacCertificateHashToThumbprint -CertificateHash $CertificateHash
  if ([string]::IsNullOrWhiteSpace($thumbprint)) {
    return $null
  }

  $resolvedStoreName = if ([string]::IsNullOrWhiteSpace($StoreName)) { "My" } else { $StoreName }
  $certificate = $null
  $certificatePath = "Cert:\LocalMachine\$resolvedStoreName\$thumbprint"
  if (Test-Path -LiteralPath $certificatePath) {
    try {
      $certificate = Get-Item -LiteralPath $certificatePath -ErrorAction Stop
    } catch {
      $certificate = $null
    }
  }

  return [pscustomobject]@{
    Thumbprint = $thumbprint
    StoreName = $resolvedStoreName
    Subject = if ($null -ne $certificate) { [string]$certificate.Subject } else { $null }
    Issuer = if ($null -ne $certificate) { [string]$certificate.Issuer } else { $null }
    NotBefore = if ($null -ne $certificate) { $certificate.NotBefore.ToString("o") } else { $null }
    NotAfter = if ($null -ne $certificate) { $certificate.NotAfter.ToString("o") } else { $null }
  }
}

function Get-GcacIisBindingSiteRootPath {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [object]$Site
  )

  $directPhysicalPath = $null
  if ($null -ne $Site.PSObject.Properties["PhysicalPath"]) {
    $directPhysicalPath = $Site.PSObject.Properties["PhysicalPath"].Value
  } elseif ($null -ne $Site.PSObject.Properties["physicalPath"]) {
    $directPhysicalPath = $Site.PSObject.Properties["physicalPath"].Value
  }

  if (-not [string]::IsNullOrWhiteSpace([string]$directPhysicalPath)) {
    return [string]$directPhysicalPath
  }

  try {
    $rootApplication = $Site.Applications["/"]
    if ($null -eq $rootApplication) {
      return $null
    }

    $rootVirtualDirectory = $rootApplication.VirtualDirectories["/"]
    if ($null -eq $rootVirtualDirectory) {
      return $null
    }

    return [string]$rootVirtualDirectory.PhysicalPath
  } catch {
    return $null
  }
}

function Convert-GcacIisBindingRecord {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [object]$Binding
  )

  $bindingInformation = [string]$Binding.BindingInformation
  $ipAddress = $null
  $port = $null
  $hostHeader = $null
  if ($bindingInformation -match '^(.*):([0-9]+):(.*)$') {
    $ipAddress = if ([string]::IsNullOrWhiteSpace($Matches[1])) { $null } else { [string]$Matches[1] }
    $port = [int]$Matches[2]
    $hostHeader = if ([string]::IsNullOrWhiteSpace($Matches[3])) { $null } else { [string]$Matches[3] }
  }

  $sslFlags = $null
  try {
    $sslFlags = [int]$Binding.GetAttributeValue("sslFlags")
  } catch {
    $sslFlags = $null
  }

  $certificate = $null
  if ([string]$Binding.Protocol -eq "https") {
    $certificate = Get-GcacCertificateSummary -StoreName ([string]$Binding.CertificateStoreName) -CertificateHash $Binding.CertificateHash
  }

  return [pscustomobject]@{
    Protocol = [string]$Binding.Protocol
    BindingInformation = $bindingInformation
    IPAddress = $ipAddress
    Port = $port
    HostHeader = $hostHeader
    Certificate = $certificate
    CertificateStoreName = if ($null -ne $certificate) { [string]$certificate.StoreName } else { if ($null -ne $Binding.CertificateStoreName) { [string]$Binding.CertificateStoreName } else { $null } }
    CertificateThumbprint = if ($null -ne $certificate) { [string]$certificate.Thumbprint } else { Convert-GcacCertificateHashToThumbprint -CertificateHash $Binding.CertificateHash }
    SslFlags = $sslFlags
  }
}

function Get-GcacIisBindingSnapshotFromWebAdministration {
  [CmdletBinding()]
  param()

  try {
    Import-Module WebAdministration -ErrorAction Stop | Out-Null
  } catch {
    return @()
  }

  $sites = @()

  try {
    $websiteItems = @(Get-Website)
  } catch {
    return @()
  }

  foreach ($site in $websiteItems) {
    $bindings = @()
    $bindingItems = @()

    if ($null -ne $site.PSObject.Properties["Bindings"] -and $null -ne $site.Bindings) {
      if ($null -ne $site.Bindings.PSObject.Properties["Collection"] -and $null -ne $site.Bindings.Collection) {
        $bindingItems = @($site.Bindings.Collection)
      } else {
        $bindingItems = @($site.Bindings)
      }
    }

    if ($bindingItems.Count -eq 0) {
      try {
        $bindingItems = @(Get-WebBinding -Name ([string]$site.Name))
      } catch {
        $bindingItems = @()
      }
    }

    foreach ($binding in $bindingItems) {
      $bindings += Convert-GcacIisBindingRecord -Binding $binding
    }

    $serverAutoStart = $true
    if ($null -ne $site.PSObject.Properties["ServerAutoStart"] -and $null -ne $site.ServerAutoStart) {
      $serverAutoStart = [bool]$site.ServerAutoStart
    } elseif ($null -ne $site.PSObject.Properties["serverAutoStart"] -and $null -ne $site.serverAutoStart) {
      $serverAutoStart = [bool]$site.serverAutoStart
    }

    $sites += [pscustomobject]@{
      Id = if ($null -ne $site.PSObject.Properties["Id"] -and $null -ne $site.Id) { [int64]$site.Id } else { 0 }
      Name = [string]$site.Name
      State = [string]$site.State
      ServerAutoStart = $serverAutoStart
      PhysicalPath = Get-GcacIisBindingSiteRootPath -Site $site
      Bindings = @($bindings)
    }
  }

  return @($sites)
}

function Merge-GcacIisSiteSnapshots {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $false)]
    [object[]]$PrimarySites = @(),

    [Parameter(Mandatory = $false)]
    [object[]]$SecondarySites = @()
  )

  $merged = New-Object 'System.Collections.Generic.List[object]'
  $siteMap = @{}

  foreach ($site in @($PrimarySites) + @($SecondarySites)) {
    if ($null -eq $site) {
      continue
    }

    $siteName = if ($null -ne $site.PSObject.Properties['Name'] -and -not [string]::IsNullOrWhiteSpace([string]$site.Name)) {
      [string]$site.Name
    } else {
      ''
    }
    $siteId = if ($null -ne $site.PSObject.Properties['Id']) { [string]$site.Id } else { '' }
    $key = if (-not [string]::IsNullOrWhiteSpace($siteName)) { 'name:' + $siteName.ToLowerInvariant() } else { 'id:' + $siteId }
    if ([string]::IsNullOrWhiteSpace($key)) {
      continue
    }

    if (-not $siteMap.ContainsKey($key)) {
      $bindings = @()
      foreach ($binding in @($site.Bindings)) {
        if ($null -ne $binding) {
          $bindings += $binding
        }
      }

      $clone = [pscustomobject]@{
        Id = if ($null -ne $site.PSObject.Properties['Id']) { $site.Id } else { $null }
        Name = if ($null -ne $site.PSObject.Properties['Name']) { [string]$site.Name } else { $null }
        State = if ($null -ne $site.PSObject.Properties['State']) { [string]$site.State } else { $null }
        ServerAutoStart = if ($null -ne $site.PSObject.Properties['ServerAutoStart']) { [bool]$site.ServerAutoStart } else { $false }
        PhysicalPath = if ($null -ne $site.PSObject.Properties['PhysicalPath']) { [string]$site.PhysicalPath } else { $null }
        Bindings = @($bindings)
      }

      $siteMap[$key] = $clone
      [void]$merged.Add($clone)
      continue
    }

    $target = $siteMap[$key]
    if ([string]::IsNullOrWhiteSpace([string]$target.PhysicalPath) -and $null -ne $site.PSObject.Properties['PhysicalPath'] -and -not [string]::IsNullOrWhiteSpace([string]$site.PhysicalPath)) {
      $target.PhysicalPath = [string]$site.PhysicalPath
    }
    if ([string]::IsNullOrWhiteSpace([string]$target.State) -and $null -ne $site.PSObject.Properties['State'] -and -not [string]::IsNullOrWhiteSpace([string]$site.State)) {
      $target.State = [string]$site.State
    }

    $bindingMap = @{}
    foreach ($binding in @($target.Bindings)) {
      if ($null -eq $binding) {
        continue
      }
      $bindingKey = [string]$binding.Protocol + '|' + [string]$binding.BindingInformation + '|' + [string]$binding.Port + '|' + [string]$binding.HostHeader
      $bindingMap[$bindingKey] = $true
    }

    foreach ($binding in @($site.Bindings)) {
      if ($null -eq $binding) {
        continue
      }
      $bindingKey = [string]$binding.Protocol + '|' + [string]$binding.BindingInformation + '|' + [string]$binding.Port + '|' + [string]$binding.HostHeader
      if (-not $bindingMap.ContainsKey($bindingKey)) {
        $target.Bindings += $binding
        $bindingMap[$bindingKey] = $true
      }
    }
  }

  return @($merged)
}

function Get-GcacIisBindingSnapshot {
  [CmdletBinding()]
  param()

  $inetStpPath = "HKLM:\SOFTWARE\Microsoft\InetStp"
  if (-not (Test-Path -LiteralPath $inetStpPath)) {
    return @()
  }

  $assemblyLoaded = $false
  $assemblyPath = Join-Path $env:WinDir "System32\inetsrv\Microsoft.Web.Administration.dll"
  if (Test-Path -LiteralPath $assemblyPath) {
    try {
      Add-Type -Path $assemblyPath -ErrorAction Stop
      $assemblyLoaded = $true
    } catch {
      $assemblyLoaded = $true
    }
  }

  if (-not $assemblyLoaded) {
    try {
      Add-Type -AssemblyName "Microsoft.Web.Administration" -ErrorAction Stop
    } catch {
      return @()
    }
  }

  $serverManager = $null
  $serverManagerSites = @()
  try {
    $serverManager = New-Object Microsoft.Web.Administration.ServerManager

    foreach ($site in $serverManager.Sites) {
      $bindings = @()
      foreach ($binding in $site.Bindings) {
        $bindings += Convert-GcacIisBindingRecord -Binding $binding
      }

      $serverManagerSites += [pscustomobject]@{
        Id = [int64]$site.Id
        Name = [string]$site.Name
        State = [string]$site.State
        ServerAutoStart = [bool]$site.ServerAutoStart
        PhysicalPath = Get-GcacIisBindingSiteRootPath -Site $site
        Bindings = @($bindings)
      }
    }

  } finally {
    if ($null -ne $serverManager) {
      $serverManager.Dispose()
    }
  }

  $webAdministrationSites = Get-GcacIisBindingSnapshotFromWebAdministration
  $mergedSites = Merge-GcacIisSiteSnapshots -PrimarySites $serverManagerSites -SecondarySites $webAdministrationSites
  if ($mergedSites.Count -gt 0) {
    return @($mergedSites)
  }

  return @()
}

Export-ModuleMember -Function Get-GcacIisBindingSnapshot
