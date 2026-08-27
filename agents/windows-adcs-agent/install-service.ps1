[CmdletBinding()]
param(
  [string]$InstallRoot = 'C:\Program Files\GCAC\WindowsAdcsAgent',
  [string]$ConfigDir = 'C:\ProgramData\GCAC\WindowsAdcsAgent\config',
  [string]$DataDir = 'C:\ProgramData\GCAC\WindowsAdcsAgent\data',
  [string]$LogDir = 'C:\ProgramData\GCAC\WindowsAdcsAgent\logs',
  [Parameter(Mandatory=$true)][string]$ControlPlaneUrl,
  [Parameter(Mandatory=$true)][string]$TenantId,
  [Parameter(Mandatory=$true)][string]$AgentKey,
  [Parameter(Mandatory=$true)][string]$EnrollmentToken,
  [string]$Zone = 'default',
  [string]$AgentVersion = '0.1.14',
  [switch]$StartAfterInstall
)
$ErrorActionPreference = 'Stop'
if ($InstallRoot -ne 'C:\Program Files\GCAC\WindowsAdcsAgent' -or $ConfigDir -ne 'C:\ProgramData\GCAC\WindowsAdcsAgent\config' -or $DataDir -ne 'C:\ProgramData\GCAC\WindowsAdcsAgent\data' -or $LogDir -ne 'C:\ProgramData\GCAC\WindowsAdcsAgent\logs') { throw 'AD CS Agent installation paths are fixed and isolated.' }
$serviceName = 'GCACWindowsAdcsAgent'; $displayName = 'GCAC Windows AD CS Agent'; $managementPort = 18933
$binaryPath = Join-Path $InstallRoot 'gcac-adcs-agent.exe'; $configPath = Join-Path $ConfigDir 'agent.config.json'
New-Item -ItemType Directory -Force -Path $InstallRoot,$ConfigDir,$DataDir,$LogDir | Out-Null
if (-not (Test-Path -LiteralPath $binaryPath)) { throw "AD CS Agent binary is missing: $binaryPath" }
$config = [ordered]@{ schemaVersion='gcac.adcs-agent.windows.v1'; version=$AgentVersion; tenantId=$TenantId; agentKey=$AgentKey; enrollmentToken=$EnrollmentToken; zone=$Zone; controlPlaneUrl=$ControlPlaneUrl; heartbeatIntervalSeconds=10; taskPollIntervalSeconds=5; observationIntervalSeconds=5; managementListenAddress='0.0.0.0'; managementPort=$managementPort; paths=[ordered]@{ windows=[ordered]@{ configPath=$configPath; dataDir=$DataDir; logDir=$LogDir } }; service=[ordered]@{ name=$serviceName; displayName=$displayName } }
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($null -ne $existing) { if ($existing.Status -ne 'Stopped') { Stop-Service -Name $serviceName -Force }; & sc.exe delete $serviceName | Out-Null; Start-Sleep -Seconds 1 }
& netsh.exe advfirewall firewall delete rule name='GCAC Windows AD CS Agent Management TCP 18933' 2>$null | Out-Null
& netsh.exe advfirewall firewall add rule name='GCAC Windows AD CS Agent Management TCP 18933' dir=in action=allow protocol=TCP localport=18933 program=$binaryPath profile=any | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'AD CS Agent firewall rule creation failed' }
$serviceCommand = '"{0}" service run --config="{1}"' -f $binaryPath,$configPath
New-Service -Name $serviceName -BinaryPathName $serviceCommand -DisplayName $displayName -StartupType Automatic | Out-Null
& sc.exe failure $serviceName reset= 86400 actions= restart/5000/restart/15000 | Out-Null
$metadataPath = Join-Path (Split-Path -Parent $ConfigDir) 'service.install.json'
[IO.File]::WriteAllText($metadataPath, (([ordered]@{ serviceName=$serviceName; displayName=$displayName; version=$AgentVersion; installRoot=$InstallRoot; configPath=$configPath; dataDir=$DataDir; logDir=$LogDir; binaryPath=$binaryPath; managementPort=$managementPort; productLine='windows-adcs-agent'; installedAt=(Get-Date).ToUniversalTime().ToString('o') }) | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
if ($StartAfterInstall) { Start-Service -Name $serviceName }
Write-Host ("GCAC Windows AD CS Agent v{0} service installed." -f $AgentVersion)
