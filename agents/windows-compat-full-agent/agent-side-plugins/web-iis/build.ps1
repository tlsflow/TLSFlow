param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    [string]$ReferenceAssemblyPath = "",
    [string]$CompilerPath = "",
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if ([string]::IsNullOrEmpty($CompilerPath)) {
    $compilerCandidates = @(
        (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"),
        (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe")
    )
    $CompilerPath = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if ([string]::IsNullOrEmpty($CompilerPath) -or -not (Test-Path -LiteralPath $CompilerPath)) {
    throw ".NET Framework C# compiler not found"
}

if ([string]::IsNullOrEmpty($ReferenceAssemblyPath)) {
    $referenceCandidates = @(
        (Join-Path ${env:ProgramFiles(x86)} "Reference Assemblies\Microsoft\Framework\.NETFramework\v4.0"),
        (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319"),
        (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319")
    )
    $ReferenceAssemblyPath = $referenceCandidates | Where-Object {
        (Test-Path -LiteralPath (Join-Path $_ "mscorlib.dll")) -and
        (Test-Path -LiteralPath (Join-Path $_ "System.Web.Extensions.dll"))
    } | Select-Object -First 1
}
if ([string]::IsNullOrEmpty($ReferenceAssemblyPath)) {
    throw ".NET Framework reference assemblies not found"
}

$references = @(
    "mscorlib.dll",
    "System.dll",
    "System.Core.dll",
    "System.Web.Extensions.dll",
    "System.Xml.dll"
) | ForEach-Object { "/reference:$([IO.Path]::Combine($ReferenceAssemblyPath, $_))" }

$output = Join-Path $root "bin\$Configuration"
New-Item -ItemType Directory -Force -Path $output | Out-Null
$sources = @(
    (Join-Path $root "runtime\Program.cs"),
    (Join-Path $root "src\IisAgentSidePlugin.cs")
)
$runtimeOutput = Join-Path $output "web-iis-agent-side-plugin.exe"
& $CompilerPath /noconfig /nologo /nostdlib+ /langversion:3 /target:exe /platform:anycpu /optimize+ /debug:pdbonly "/out:$runtimeOutput" $references $sources
if ($LASTEXITCODE -ne 0) { throw "IIS Agent-side Plugin build failed" }

if (-not $SkipTests) {
    $testOutput = Join-Path $output "web-iis-agent-side-plugin.tests.exe"
    & $CompilerPath /noconfig /nologo /nostdlib+ /langversion:3 /target:exe /platform:anycpu /optimize+ "/out:$testOutput" $references (Join-Path $root "tests\Program.cs")
    if ($LASTEXITCODE -ne 0) { throw "IIS Agent-side Plugin test build failed" }
    & $testOutput
    if ($LASTEXITCODE -ne 0) { throw "IIS Agent-side Plugin targeted test failed" }
}

Write-Output "IIS Agent-side Plugin build completed: $runtimeOutput"
