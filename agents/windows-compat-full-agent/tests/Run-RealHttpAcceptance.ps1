param(
    [string]$AgentPath = "",
    [int]$StartupTimeoutSeconds = 15,
    [string]$ArtifactDirectory = ""
)

$ErrorActionPreference = "Stop"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentDirectory = Split-Path -Parent $scriptDirectory

function Resolve-AgentPath {
    param([string]$RequestedPath)
    $candidates = @()
    if (-not [string]::IsNullOrWhiteSpace($RequestedPath)) {
        $candidates += $RequestedPath
    } else {
        $candidates += (Join-Path $agentDirectory "dist\GCAC.WindowsCompatibilityAgent.exe")
        $candidates += (Join-Path $agentDirectory "..\..\build\agent-release-bundle\windows\amd64\compatibility\GCAC.WindowsCompatibilityAgent.exe")
    }
    foreach ($candidate in $candidates) {
        $resolved = Resolve-Path -LiteralPath $candidate -ErrorAction SilentlyContinue
        if ($resolved) { return $resolved.Path }
    }
    throw "找不到可用的 GCAC.WindowsCompatibilityAgent.exe。"
}

function Find-FreePort {
    $probe = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $probe.Start()
    try { return ([Net.IPEndPoint]$probe.LocalEndpoint).Port } finally { $probe.Stop() }
}

function Quote-ProcessArgument([string]$value) {
    $quote = [string][char]34
    return $quote + $value.Replace($quote, $quote + $quote) + $quote
}

function Invoke-JsonRequest {
    param(
        [string]$Url,
        [string]$Method,
        [object]$Body,
        [int]$TimeoutMilliseconds = 1500
    )
    $startedAt = Get-Date
    $request = [Net.HttpWebRequest][Net.WebRequest]::Create($Url)
    $request.Method = $Method
    $request.Timeout = $TimeoutMilliseconds
    $request.ReadWriteTimeout = $TimeoutMilliseconds
    $request.ContentType = "application/json; charset=utf-8"
    if ($null -ne $Body) {
        $payload = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Compress -Depth 20))
        $request.ContentLength = $payload.Length
        $stream = $request.GetRequestStream()
        try { $stream.Write($payload, 0, $payload.Length) } finally { $stream.Dispose() }
    }
    try {
        $response = [Net.HttpWebResponse]$request.GetResponse()
        try {
            $reader = New-Object IO.StreamReader($response.GetResponseStream(), [Text.Encoding]::UTF8)
            try { $bodyText = $reader.ReadToEnd() } finally { $reader.Dispose() }
            $statusCode = [int]$response.StatusCode
        } finally { $response.Dispose() }
    } catch [Net.WebException] {
        $errorResponse = $_.Exception.Response
        if ($null -eq $errorResponse) { throw }
        try {
            $reader = New-Object IO.StreamReader($errorResponse.GetResponseStream(), [Text.Encoding]::UTF8)
            try { $bodyText = $reader.ReadToEnd() } finally { $reader.Dispose() }
            $statusCode = [int]$errorResponse.StatusCode
        } finally { $errorResponse.Dispose() }
    }
    $json = $null
    if (-not [string]::IsNullOrWhiteSpace($bodyText)) {
        try { $json = $bodyText | ConvertFrom-Json } catch { }
    }
    return [pscustomobject]@{
        StatusCode = $statusCode
        Body = $bodyText
        Json = $json
        DurationMilliseconds = [int]((Get-Date).Subtract($startedAt).TotalMilliseconds)
    }
}

function Add-Check {
    param(
        [System.Collections.Generic.List[object]]$Checks,
        [string]$Name,
        [scriptblock]$CheckBlock
    )
    try {
        & $CheckBlock
        $Checks.Add([pscustomobject]@{ name = $Name; status = "PASS"; detail = "" })
        Write-Output "PASS $Name"
        return $true
    } catch {
        $detail = $_.Exception.Message
        $Checks.Add([pscustomobject]@{ name = $Name; status = "FAIL"; detail = $detail })
        Write-Output "FAIL $Name $detail"
        return $false
    }
}

function Assert-Equal($actual, $expected, [string]$message) {
    if ($actual -ne $expected) { throw "$message；实际值：$actual；预期值：$expected" }
}

function Assert-True($condition, [string]$message) {
    if (-not $condition) { throw $message }
}

$checks = New-Object 'System.Collections.Generic.List[object]'
$agent = $null
$stub = $null
$stdoutTask = $null
$stderrTask = $null
$artifactRoot = $null
$configPath = $null
$stopFile = $null
$agentPort = $null
$controlPlanePort = $null
$agentPathResolved = $null
$exitCode = $null
$startedAt = Get-Date

try {
    $agentPathResolved = Resolve-AgentPath $AgentPath
    if ([string]::IsNullOrWhiteSpace($ArtifactDirectory)) {
        $ArtifactDirectory = Join-Path $scriptDirectory ("artifacts\real-http-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    }
    $artifactRoot = [IO.Path]::GetFullPath($ArtifactDirectory)
    [IO.Directory]::CreateDirectory($artifactRoot) | Out-Null
    $configPath = Join-Path $artifactRoot "agent.config.json"
    $stubLogPath = Join-Path $artifactRoot "control-plane.requests.jsonl"
    $stdoutPath = Join-Path $artifactRoot "agent.stdout.log"
    $stderrPath = Join-Path $artifactRoot "agent.stderr.log"
    $summaryPath = Join-Path $artifactRoot "result.json"
    $stopFile = Join-Path $artifactRoot "stop-stub.signal"
    $controlPlanePort = Find-FreePort
    $agentPort = Find-FreePort

    $templatePath = Join-Path $agentDirectory "config\agent.config.template.json"
    $config = ([IO.File]::ReadAllText($templatePath, [Text.Encoding]::UTF8) | ConvertFrom-Json)
    $config.agentKey = "real-http-test-agent-key"
    $config.controlPlaneUrl = "http://127.0.0.1:$controlPlanePort"
    $config.managementListenAddress = "127.0.0.1"
    $config.managementPort = $agentPort
    $config.heartbeatIntervalSeconds = 1
    $config.taskPollIntervalSeconds = 1
    $config.paths.windows.configPath = $configPath
    $config.paths.windows.dataDir = Join-Path $artifactRoot "data"
    $config.paths.windows.logDir = Join-Path $artifactRoot "logs"
    $config.authorizationMaterialPath = Join-Path $config.paths.windows.dataDir "policy\agent-trust-material.json"
    $config.receiptSigningKeyPath = Join-Path $config.paths.windows.dataDir "policy\agent-receipt-signing-key.bin"
    $config.receiptKeySetPath = Join-Path $config.paths.windows.dataDir "policy\agent-receipt-keyset.json"
    [IO.Directory]::CreateDirectory($config.paths.windows.dataDir) | Out-Null
    [IO.Directory]::CreateDirectory($config.paths.windows.logDir) | Out-Null
    [IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))

    $powershellCommand = Get-Command powershell.exe -ErrorAction SilentlyContinue
    if ($null -eq $powershellCommand) { throw "找不到 Windows PowerShell，无法启动本地控制面测试桩。" }
    $stubPath = Join-Path $scriptDirectory "RealHttpControlPlaneStub.ps1"
    $stubArguments = @(
        "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $stubPath,
        "-Port", $controlPlanePort.ToString(), "-LogPath", $stubLogPath, "-StopFile", $stopFile
    ) | ForEach-Object { Quote-ProcessArgument $_ }
    $stub = Start-Process -FilePath $powershellCommand.Source -ArgumentList ($stubArguments -join " ") -WindowStyle Hidden -PassThru

    $stubReady = $false
    $stubDeadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $stubDeadline) {
        if ($stub.HasExited) { throw "控制面测试桩启动失败，退出码：$($stub.ExitCode)" }
        try {
            $readyResponse = Invoke-JsonRequest "http://127.0.0.1:$controlPlanePort/ready" "GET" $null 500
            if ($readyResponse.StatusCode -eq 200) { $stubReady = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 100
    }
    if (-not $stubReady) { throw "在 5 秒内未等到控制面测试桩就绪。" }

    $processInfo = New-Object Diagnostics.ProcessStartInfo
    $processInfo.FileName = $agentPathResolved
    $processInfo.Arguments = (Quote-ProcessArgument "run") + " " + (Quote-ProcessArgument "--config=$configPath")
    $processInfo.WorkingDirectory = Split-Path -Parent $agentPathResolved
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $agent = New-Object Diagnostics.Process
    $agent.StartInfo = $processInfo
    if (-not $agent.Start()) { throw "Agent 进程启动失败。" }
    $stdoutTask = $agent.StandardOutput.ReadToEndAsync()
    $stderrTask = $agent.StandardError.ReadToEndAsync()

    $baseUrl = "http://127.0.0.1:$agentPort"
    $health = $null
    $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ($agent.HasExited) { throw "Agent 在健康接口就绪前退出，退出码：$($agent.ExitCode)" }
        try {
            $candidate = Invoke-JsonRequest "$baseUrl/api/v1/control/health" "GET" $null 1000
            if ($candidate.StatusCode -eq 200) { $health = $candidate; break }
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    if ($null -eq $health) { throw "在 ${StartupTimeoutSeconds} 秒内未等到健康接口。" }
    [void](Add-Check $checks "健康接口在启动超时边界内就绪" {
        Assert-True ((Get-Date) -lt $deadline) "健康接口超过启动超时边界"
    })

    [void](Add-Check $checks "health 返回 Go Agent 健康 JSON" {
        Assert-Equal $health.StatusCode 200 "health 状态码错误"
        Assert-True ($null -ne $health.Json) "health 响应不是 JSON"
        Assert-True ([bool]$health.Json.success) "health success 不为 true"
        Assert-Equal $health.Json.status "healthy" "health 状态错误"
        Assert-Equal $health.Json.agentVersion "0.2.1" "health Agent 版本错误"
    })

    $controlPlaneDeadline = (Get-Date).AddSeconds(15)
    $controlPlaneLog = ""
    while ((Get-Date) -lt $controlPlaneDeadline) {
        if (Test-Path -LiteralPath $stubLogPath) {
            $controlPlaneLog = [IO.File]::ReadAllText($stubLogPath, [Text.Encoding]::UTF8)
            if ($controlPlaneLog -match "/api/v1/agents/register" -and $controlPlaneLog -match "/api/v1/agents/capabilities" -and $controlPlaneLog -match "/api/v1/agents/heartbeat") { break }
        }
        Start-Sleep -Milliseconds 200
    }
    [void](Add-Check $checks "控制面收到注册、能力上报和心跳" {
        Assert-True ($controlPlaneLog -match "/api/v1/agents/register") "未收到 Agent 注册请求"
        Assert-True ($controlPlaneLog -match "/api/v1/agents/capabilities") "未收到能力上报请求"
        Assert-True ($controlPlaneLog -match "/api/v1/agents/heartbeat") "未收到心跳请求"
    })

    $discovery = $null
    $discoveryDeadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $discoveryDeadline) {
        $candidateDiscovery = Invoke-JsonRequest "$baseUrl/api/v1/control/discovery" "POST" @{ actionType = "agent.fact.collect"; refreshWebInventory = $true; requestedBy = "real-http-acceptance" }
        if ($candidateDiscovery.StatusCode -ne 409) { $discovery = $candidateDiscovery; break }
        Start-Sleep -Milliseconds 200
    }
    if ($null -eq $discovery) { throw "直接 Web 发现在扫描锁超时边界内未返回最终结果。" }
    [void](Add-Check $checks "直接 Web 发现经过 Agent v2 授权边界" {
        Assert-Equal $discovery.StatusCode 400 "未授权直接发现状态码错误"
        Assert-True ($null -ne $discovery.Json) "直接发现响应不是 JSON"
        Assert-Equal $discovery.Json.errorCode "AGENT_V2_AUTHORIZATION_DENIED" "直接发现未返回 Agent v2 拒绝码"
    })

    $upgradeStatus = Invoke-JsonRequest "$baseUrl/api/v1/control/upgrade/status" "GET" $null
    [void](Add-Check $checks "升级状态接口返回 Go 升级合同" {
        Assert-Equal $upgradeStatus.StatusCode 200 "升级状态状态码错误"
        Assert-True ($null -ne $upgradeStatus.Json) "升级状态响应不是 JSON"
        Assert-Equal $upgradeStatus.Json.schemaVersion "management.upgrade.v1" "升级状态 schema 错误"
        Assert-Equal $upgradeStatus.Json.status "idle" "初始升级状态错误"
    })

    $legacy = Invoke-JsonRequest "$baseUrl/api/v1/control/actions/start" "POST" @{ action = "command.execute"; requestId = "legacy-rejection" }
    [void](Add-Check $checks "旧动作队列接口已移除" {
        Assert-Equal $legacy.StatusCode 404 "旧动作队列接口未被移除"
        Assert-True ($legacy.Body -match "management endpoint only supports") "旧接口拒绝响应不符合 Go 管理端合同"
    })

    [void](Add-Check $checks "HTTP JSON 不受 Agent stdout/stderr 污染" {
        Assert-True ($null -ne $health.Json -and $health.Body.Trim().StartsWith("{")) "health JSON 被进程输出污染"
        Assert-True ($null -ne $discovery.Json -and $null -ne $upgradeStatus.Json) "管理端 JSON 响应无法独立解析"
    })
} catch {
    $checks.Add([pscustomobject]@{ name = "运行前置或真实 HTTP 流程"; status = "FAIL"; detail = $_.Exception.Message })
    Write-Output "FAIL 运行前置或真实 HTTP 流程 $($_.Exception.Message)"
} finally {
    if ($agent) {
        if (-not $agent.HasExited) {
            $agent.Kill()
            [void]$agent.WaitForExit(5000)
        }
        $exitCode = $agent.ExitCode
        try { $stdout = $stdoutTask.Result } catch { $stdout = "读取 stdout 失败：$($_.Exception.Message)" }
        try { $stderr = $stderrTask.Result } catch { $stderr = "读取 stderr 失败：$($_.Exception.Message)" }
        if ($null -ne $artifactRoot) {
            [IO.File]::WriteAllText($stdoutPath, $stdout, (New-Object Text.UTF8Encoding($false)))
            [IO.File]::WriteAllText($stderrPath, $stderr, (New-Object Text.UTF8Encoding($false)))
        }
        [void](Add-Check $checks "Agent 进程可被有界终止" {
            Assert-True $agent.HasExited "Agent 进程在 Kill/WaitForExit 后仍存活"
        })
        if ($agentPort -and $baseUrl) {
            $portReleased = $false
            for ($attempt = 0; $attempt -lt 10; $attempt++) {
                try {
                    $probe = Invoke-JsonRequest "$baseUrl/api/v1/control/health" "GET" $null 300
                    if ($null -eq $probe) { $portReleased = $true; break }
                } catch {
                    $portReleased = $true
                    break
                }
                Start-Sleep -Milliseconds 100
            }
            [void](Add-Check $checks "Agent 终止后 Direct Control 端口释放" {
                Assert-True $portReleased "Agent 终止后 Direct Control 端口仍可响应"
            })
        }
    }
    if ($stopFile) { [IO.File]::WriteAllText($stopFile, "stop", (New-Object Text.UTF8Encoding($false))) }
    if ($stub) {
        [void]$stub.WaitForExit(3000)
        if (-not $stub.HasExited) { $stub.Kill(); [void]$stub.WaitForExit(3000) }
    }
}

$failed = @($checks | Where-Object { $_.status -eq "FAIL" }).Count
$result = [ordered]@{
    acceptance = "windows-compatibility-agent-real-http-subprocess-v2"
    startedAt = $startedAt.ToString("o")
    completedAt = (Get-Date).ToString("o")
    agentPath = $agentPathResolved
    agentPort = $agentPort
    controlPlanePort = $controlPlanePort
    agentExitCode = $exitCode
    checks = $checks
    passed = ($failed -eq 0)
    failureCount = $failed
}
if ($summaryPath) {
    [IO.File]::WriteAllText($summaryPath, ($result | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
}
Write-Output ("tests=" + $checks.Count + " failures=" + $failed)
Write-Output ("artifacts=" + $artifactRoot)
if ($failed -gt 0) { exit 1 }
exit 0
