param(
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler)) {
    throw ".NET Framework C# compiler not found: $compiler"
}

$output = Join-Path $root "bin\$Configuration"
New-Item -ItemType Directory -Force -Path $output | Out-Null
$sources = Get-ChildItem -LiteralPath (Join-Path $root "src") -Filter "*.cs" | ForEach-Object { $_.FullName }
$agentOutput = Join-Path $output "GCAC.WindowsCompatibilityAgent.exe"
& $compiler /nologo /target:exe /platform:anycpu /optimize+ /debug:pdbonly "/out:$agentOutput" /reference:Microsoft.CSharp.dll /reference:System.dll /reference:System.Core.dll /reference:System.Management.dll /reference:System.ServiceProcess.dll /reference:System.Web.Extensions.dll $sources
if ($LASTEXITCODE -ne 0) { throw "Compatibility Agent build failed" }

$testSources = @($sources | Where-Object { $_ -notlike "*\Program.cs" }) + (Join-Path $root "tests\Program.cs")
$testOutput = Join-Path $output "GCAC.WindowsCompatibilityAgent.Tests.exe"
& $compiler /nologo /target:exe /platform:anycpu /optimize+ "/out:$testOutput" /reference:Microsoft.CSharp.dll /reference:System.dll /reference:System.Core.dll /reference:System.Management.dll /reference:System.ServiceProcess.dll /reference:System.Web.Extensions.dll $testSources
if ($LASTEXITCODE -ne 0) { throw "Compatibility Agent test build failed" }
& (Join-Path $output "GCAC.WindowsCompatibilityAgent.Tests.exe")
if ($LASTEXITCODE -ne 0) { throw "Compatibility Agent tests failed" }

Copy-Item -LiteralPath (Join-Path $root "config\agent.config.template.json") -Destination (Join-Path $output "agent.config.template.json") -Force
Write-Output "Compatibility Agent build completed: $output"
