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
        $candidates += (Join-Path $agentDirectory "bin\Release\GCAC.WindowsCompatibilityAgent.exe")
        $candidates += (Join-Path $agentDirectory "..\..\build\agent-release-bundle\windows\amd64\compatibility\bin\Release\GCAC.WindowsCompatibilityAgent.exe")
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
    $config.controlPlaneUrl = "http://127.0.0.1:$controlPlanePort"
    $config.directControlListenHost = "127.0.0.1"
    $config.directControlAdvertiseHost = "127.0.0.1"
    $config.directControlListenPort = $agentPort
    $config.heartbeatIntervalSeconds = 1
    $config.taskPollIntervalSeconds = 1
    $config.dataDirectory = Join-Path $artifactRoot "data"
    $config.logDirectory = Join-Path $artifactRoot "logs"
    [IO.Directory]::CreateDirectory($config.dataDirectory) | Out-Null
    [IO.Directory]::CreateDirectory($config.logDirectory) | Out-Null
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
    $processInfo.Arguments = (Quote-ProcessArgument "--config") + " " + (Quote-ProcessArgument $configPath) + " " + (Quote-ProcessArgument "--console")
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

    [void](Add-Check $checks "health 返回可解析 JSON 和可达状态" {
        Assert-Equal $health.StatusCode 200 "health 状态码错误"
        Assert-True ($null -ne $health.Json) "health 响应不是 JSON"
        Assert-True ([bool]$health.Json.success) "health success 不为 true"
        Assert-True ([bool]$health.Json.directControl.reachable) "health 未报告 Direct Control 可达"
        Assert-Equal @($health.Json.directControl.supportedActions).Count 4 "health 动作数量错误"
    })

    $actions = @("agent.fact.collect", "agent.plan.validate", "agent.plan.execute", "agent.execution.receipt")
    $actionResults = @{}
    foreach ($action in $actions) {
        $payload = [ordered]@{
            action = $action
            requestId = "real-http-$($action.Replace('.', '-'))"
            token = @{ keyId = "acceptance"; value = "opaque" }
            policyDecision = @{ allowed = $false }
        }
        if ($action -eq "agent.plan.execute") {
            $payload.plan = @{ operation = "write"; mutating = $true; idempotencyKey = "real-http-write-1" }
        }
        $start = Invoke-JsonRequest "$baseUrl/api/v1/control/actions/start" "POST" $payload
        [void](Add-Check $checks "v2 动作 $action 被 HTTP 接受" {
            Assert-Equal $start.StatusCode 202 "启动状态码错误"
            Assert-True ($null -ne $start.Json) "启动响应不是 JSON"
            Assert-Equal $start.Json.actionType $action "启动响应动作不一致"
            Assert-Equal $start.Json.status "queued" "启动响应不是 queued"
        })
        if ($start.StatusCode -ne 202 -or $null -eq $start.Json) { continue }
        $actionId = [string]$start.Json.actionId
        $status = $null
        $statusDeadline = (Get-Date).AddSeconds(5)
        while ((Get-Date) -lt $statusDeadline) {
            $status = Invoke-JsonRequest "$baseUrl/api/v1/control/actions/status?actionId=$([Uri]::EscapeDataString($actionId))" "GET" $null 1000
            if ($status.Json.status -eq "completed") { break }
            Start-Sleep -Milliseconds 100
        }
        $actionResults[$action] = $status
        [void](Add-Check $checks "v2 动作 $action 可查询完成结果" {
            Assert-Equal $status.StatusCode 200 "状态查询状态码错误"
            Assert-Equal $status.Json.status "completed" "动作未在超时内完成"
            Assert-True ($false -eq [bool]$status.Json.success) "未授权动作不应成功"
            Assert-Equal $status.Json.errorCode "AGENT_V2_POLICY_UNAVAILABLE" "v2 未授权错误码错误"
            $expectedOutcome = if ($action -eq "agent.plan.execute") { "UNKNOWN" } else { "FAILED" }
            Assert-Equal $status.Json.outcome $expectedOutcome "未授权动作终态错误"
            Assert-True ($false -eq [bool]$status.Json.detail.fallback) "检测到旧执行路径 fallback"
        })
    }

    $legacy = Invoke-JsonRequest "$baseUrl/api/v1/control/actions/start" "POST" @{ action = "command.execute"; requestId = "legacy-rejection" }
    [void](Add-Check $checks "旧合同 command.execute 被拒绝" {
        Assert-Equal $legacy.StatusCode 400 "旧合同拒绝状态码错误"
        Assert-Equal $legacy.Json.errorCode "AGENT_V2_ACTION_UNSUPPORTED" "旧合同错误码错误"
    })

    $writeStatus = $actionResults["agent.plan.execute"]
    [void](Add-Check $checks "写操作终态为 UNKNOWN" {
        Assert-Equal $writeStatus.Json.outcome "UNKNOWN" "写操作在授权/执行边界不确定时必须为 UNKNOWN"
    })

    [void](Add-Check $checks "HTTP JSON 不受 Agent stdout/stderr 污染" {
        Assert-True ($null -ne $health.Json -and $health.Body.Trim().StartsWith("{")) "health JSON 被进程输出污染"
        Assert-True ($null -ne $legacy.Json) "旧合同响应无法独立解析 JSON"
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
