[CmdletBinding()]
param(
  [string]$ServiceName = 'GCACWindowsCompatibilityAgent',
  [string]$DisplayName = 'GCAC Windows Compatibility Agent',
  [string]$InstallRoot = 'C:\Program Files\GCAC\WindowsCompatibilityAgent',
  [string]$ConfigDir = 'C:\ProgramData\GCAC\WindowsCompatibilityAgent\config',
  [string]$DataDir = 'C:\ProgramData\GCAC\WindowsCompatibilityAgent\data',
  [string]$LogDir = 'C:\ProgramData\GCAC\WindowsCompatibilityAgent\logs',
  [Parameter(Mandatory = $true)][string]$PublicKeyFile,
  [Parameter(Mandatory = $true)][string]$SignatureFile,
  [Parameter(Mandatory = $true)][string]$SignatureVerifier,
  [switch]$NoStartAfterInstall
)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator privileges are required.' }

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$binarySource = Join-Path $sourceRoot 'GCAC.WindowsCompatibilityAgent.exe'
$scannerSource = Join-Path $sourceRoot 'plugins\windows-runtime-discovery.exe'
$iisSource = Join-Path $sourceRoot 'web-iis\web-iis-agent-side-plugin.exe'
$configSource = Join-Path $sourceRoot 'config\agent.config.template.json'
$verifyScript = Join-Path $sourceRoot 'release\verify-signature.ps1'
foreach ($path in @($binarySource, $scannerSource, $iisSource, $configSource, $verifyScript)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Compatibility Agent artifact is missing: $path" }
}
& $verifyScript -PublicKeyFile $PublicKeyFile -ArtifactPath $binarySource -SignatureFile $SignatureFile -SignatureVerifier $SignatureVerifier

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($null -ne $service) {
  if ($service.Status -ne 'Stopped') { Stop-Service -Name $ServiceName -Force -ErrorAction Stop }
  & sc.exe delete $ServiceName | Out-Null
  Start-Sleep -Seconds 1
}
New-Item -ItemType Directory -Force -Path $InstallRoot, (Join-Path $InstallRoot 'plugins'), $ConfigDir, $DataDir, $LogDir | Out-Null
$binaryTarget = Join-Path $InstallRoot 'GCAC.WindowsCompatibilityAgent.exe'
$scannerTarget = Join-Path $InstallRoot 'plugins\windows-runtime-discovery.exe'
$iisTarget = Join-Path $InstallRoot 'plugins\web-iis-agent-side-plugin.exe'
$configTarget = Join-Path $ConfigDir 'agent.config.json'
Copy-Item -LiteralPath $binarySource -Destination $binaryTarget -Force
Copy-Item -LiteralPath $scannerSource -Destination $scannerTarget -Force
Copy-Item -LiteralPath $iisSource -Destination $iisTarget -Force
if (-not (Test-Path -LiteralPath $configTarget)) { Copy-Item -LiteralPath $configSource -Destination $configTarget -Force }

& netsh.exe advfirewall firewall delete rule name='GCAC Windows Compatibility Agent Management TCP 18932' 2>$null | Out-Null
& netsh.exe advfirewall firewall add rule name='GCAC Windows Compatibility Agent Management TCP 18932' dir=in action=allow protocol=TCP localport=18932 program=$binaryTarget profile=any | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Compatibility Agent firewall rule creation failed.' }
$serviceCommand = '"' + $binaryTarget + '" service run --config="' + $configTarget + '"'
New-Service -Name $ServiceName -BinaryPathName $serviceCommand -DisplayName $DisplayName -Description 'GCAC Windows Compatibility Agent Go 1.20' -StartupType Automatic | Out-Null
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
& sc.exe failureflag $ServiceName 1 | Out-Null

$metadataPath = Join-Path (Split-Path -Parent $ConfigDir) 'service.install.json'
$esc = { param($v) $v.Replace('\','\\') }
$metadataJson = '{"serviceName":"' + (& $esc $ServiceName) + '","displayName":"' + (& $esc $DisplayName) + '","installRoot":"' + (& $esc $InstallRoot) + '","configPath":"' + (& $esc $configTarget) + '","dataDir":"' + (& $esc $DataDir) + '","logDir":"' + (& $esc $LogDir) + '","binaryPath":"' + (& $esc $binaryTarget) + '","runtime":"go","toolchain":"go1.20","productLine":"windows-compat-full-agent","compatibilityProfile":"windows-server-2008-r2-to-2012-r2"}'
[IO.File]::WriteAllText($metadataPath, $metadataJson, (New-Object Text.UTF8Encoding($false)))
if (-not $NoStartAfterInstall) { Start-Service -Name $ServiceName }
Write-Output "Compatibility Go Agent installed: $ServiceName"
