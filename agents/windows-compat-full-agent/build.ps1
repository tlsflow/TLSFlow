param(
    [string]$Configuration = "Release",
    [string]$ReferenceAssemblyPath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$compiler = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler)) {
    throw ".NET Framework C# compiler not found: $compiler"
}

if ([string]::IsNullOrEmpty($ReferenceAssemblyPath)) {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} "Reference Assemblies\Microsoft\Framework\.NETFramework\v3.5"),
        (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v3.5"),
        (Join-Path $env:WINDIR "Microsoft.NET\Framework\v3.5")
    )
    $ReferenceAssemblyPath = $candidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ "mscorlib.dll") } | Select-Object -First 1
}
if ([string]::IsNullOrEmpty($ReferenceAssemblyPath) -or -not (Test-Path -LiteralPath (Join-Path $ReferenceAssemblyPath "mscorlib.dll"))) {
    throw ".NET Framework 3.5 reference assemblies not found. Install the developer targeting pack or pass -ReferenceAssemblyPath."
}

$references = @(
    "mscorlib.dll",
    "System.dll",
    "System.Core.dll",
    "System.Management.dll",
    "System.ServiceProcess.dll",
    "System.Web.Extensions.dll"
) | ForEach-Object { "/reference:$([IO.Path]::Combine($ReferenceAssemblyPath, $_))" }

$output = Join-Path $root "bin\$Configuration"
New-Item -ItemType Directory -Force -Path $output | Out-Null
$sources = Get-ChildItem -LiteralPath (Join-Path $root "src") -Filter "*.cs" | ForEach-Object { $_.FullName }
$agentOutput = Join-Path $output "GCAC.WindowsCompatibilityAgent.exe"
& $compiler /noconfig /nologo /nostdlib+ /langversion:3 /target:exe /platform:anycpu /optimize+ /debug:pdbonly "/out:$agentOutput" $references $sources
if ($LASTEXITCODE -ne 0) { throw "Compatibility Agent build failed" }
Copy-Item -LiteralPath (Join-Path $root "config\runtime.config") -Destination ($agentOutput + ".config") -Force

$testSources = @($sources | Where-Object { $_ -notlike "*\Program.cs" }) + (Join-Path $root "tests\Program.cs")
$testOutput = Join-Path $output "GCAC.WindowsCompatibilityAgent.Tests.exe"
& $compiler /noconfig /nologo /nostdlib+ /langversion:3 /target:exe /platform:anycpu /optimize+ "/out:$testOutput" $references $testSources
if ($LASTEXITCODE -ne 0) { throw "Compatibility Agent test build failed" }
Copy-Item -LiteralPath (Join-Path $root "config\runtime.config") -Destination ($testOutput + ".config") -Force
& (Join-Path $output "GCAC.WindowsCompatibilityAgent.Tests.exe")
if ($LASTEXITCODE -ne 0) { throw "Compatibility Agent tests failed" }

Copy-Item -LiteralPath (Join-Path $root "config\agent.config.template.json") -Destination (Join-Path $output "agent.config.template.json") -Force
Write-Output "Compatibility Agent build completed: $output"
