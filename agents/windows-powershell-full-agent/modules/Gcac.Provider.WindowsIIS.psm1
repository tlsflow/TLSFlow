Set-StrictMode -Version Latest

function Invoke-WindowsIisDeployment {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [pscustomobject]$Context,

    [Parameter(Mandatory = $false)]
    [object]$DeploymentInput
  )

  return [pscustomobject]@{
    Success = $false
    ErrorCode = "WINDOWS_IIS_PROVIDER_NOT_IMPLEMENTED"
    ErrorMessage = "Windows IIS Provider 涓氬姟闂幆灏氭湭瀹炵幇銆?
    Detail = [pscustomobject]@{
      Mode = "skeleton"
      DeploymentInput = $DeploymentInput
    }
    Logs = @()
  }
}

Export-ModuleMember -Function Invoke-WindowsIisDeployment
