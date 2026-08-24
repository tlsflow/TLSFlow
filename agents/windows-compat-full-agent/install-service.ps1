param(
    [Parameter(Mandatory = $true)][string]$InstallRoot,
    [Parameter(Mandatory = $true)][string]$ConfigPath
)

$ErrorActionPreference = "Stop"
$serviceName = "GCACWindowsCompatibilityAgent"
$binaryPath = Join-Path $InstallRoot "GCAC.WindowsCompatibilityAgent.exe"
if (-not (Test-Path -LiteralPath $binaryPath)) { throw "Agent executable not found: $binaryPath" }
if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Agent config not found: $ConfigPath" }

$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($null -ne $existing) { throw "Service already exists; use the dedicated upgrade flow: $serviceName" }

$quotedBinary = '"' + $binaryPath + '" --config "' + $ConfigPath + '"'
& sc.exe create $serviceName binPath= $quotedBinary start= auto DisplayName= "GCAC Windows Compatibility Agent"
if ($LASTEXITCODE -ne 0) { throw "Service creation failed" }
& sc.exe description $serviceName "GCAC compatibility product line for Windows Server 2008 R2 SP1 through 2012 R2"
& sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000/none/0
Start-Service -Name $serviceName
