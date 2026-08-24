param(
    [Parameter(Mandatory = $true)]
    [int]$Port,
    [Parameter(Mandatory = $true)]
    [string]$LogPath,
    [Parameter(Mandatory = $true)]
    [string]$StopFile
)

$ErrorActionPreference = "Stop"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")

function Write-Log([object]$record) {
    $line = $record | ConvertTo-Json -Compress -Depth 20
    [IO.File]::AppendAllText($LogPath, $line + [Environment]::NewLine, (New-Object Text.UTF8Encoding($false)))
}

function Write-Json([System.Net.HttpListenerContext]$context, [int]$statusCode, [object]$body) {
    if ($body -is [Array] -and $body.Count -eq 0) {
        $json = "[]"
    } else {
        $json = $body | ConvertTo-Json -Compress -Depth 20
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $context.Response.StatusCode = $statusCode
    $context.Response.ContentType = "application/json; charset=utf-8"
    $context.Response.ContentLength64 = $bytes.Length
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $context.Response.Close()
}

try {
    $listener.Start()
    Write-Log @{ event = "started"; port = $Port }
    while ($true) {
        $async = $listener.BeginGetContext($null, $null)
        while (-not $async.AsyncWaitHandle.WaitOne(250)) {
            if (Test-Path -LiteralPath $StopFile) { break }
        }
        if (Test-Path -LiteralPath $StopFile) { break }

        $context = $listener.EndGetContext($async)
        try {
            $request = $context.Request
            $body = ""
            if ($request.HasEntityBody) {
                $reader = New-Object IO.StreamReader($request.InputStream, [Text.Encoding]::UTF8)
                try { $body = $reader.ReadToEnd() } finally { $reader.Dispose() }
            }
            Write-Log @{
                event = "request"
                method = $request.HttpMethod
                path = $request.Url.AbsolutePath
                query = $request.Url.Query
                body = $body
            }

            $path = $request.Url.AbsolutePath
            if ($request.HttpMethod -eq "HEAD") {
                $context.Response.StatusCode = 200
                $context.Response.ContentLength64 = 0
                $context.Response.Close()
            } elseif ($request.HttpMethod -eq "GET" -and $path -eq "/ready") {
                Write-Json $context 200 @{ ready = $true }
            } elseif ($request.HttpMethod -eq "POST" -and $path -eq "/api/v1/agents/register") {
                Write-Json $context 200 @{ id = "acceptance-agent-1" }
            } elseif ($request.HttpMethod -eq "GET" -and $path -eq "/api/v1/agents/tasks/pull") {
                Write-Json $context 200 @()
            } elseif ($request.HttpMethod -eq "POST" -and $path -in @(
                    "/api/v1/agents/capabilities",
                    "/api/v1/agents/heartbeat",
                    "/api/v1/agents/tasks/ack",
                    "/api/v1/agents/tasks/result")) {
                Write-Json $context 200 @{}
            } else {
                Write-Json $context 404 @{ errorCode = "STUB_NOT_FOUND"; message = "测试控制面未实现该路径" }
            }
        } catch {
            try { Write-Json $context 500 @{ errorCode = "STUB_INTERNAL_ERROR"; message = $_.Exception.Message } } catch { }
            Write-Log @{ event = "error"; message = $_.Exception.ToString() }
        }
    }
} catch {
    Write-Log @{ event = "fatal"; message = $_.Exception.ToString() }
    exit 2
} finally {
    if ($listener) {
        try { $listener.Stop() } catch { }
        try { $listener.Close() } catch { }
    }
    Write-Log @{ event = "stopped"; port = $Port }
}
