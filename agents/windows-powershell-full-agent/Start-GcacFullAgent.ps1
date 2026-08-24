[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$ConfigPath = "",

  [Parameter(Mandatory = $false)]
  [string]$LogDir = "",

  [Parameter(Mandatory = $false)]
  [string]$OutputPath = "",

  [Parameter(Mandatory = $false)]
  [switch]$SelfCheck,

  [Parameter(Mandatory = $false)]
  [switch]$HealthCheck,

  [Parameter(Mandatory = $false)]
  [switch]$RunOnce
)

$ErrorActionPreference = "Stop"

# 旧启动参数没有与 Go Runtime 一一对应的语义。继续静默转发会让调用方误以为
# PowerShell Runtime 仍受支持，因此这里保留路径但明确拒绝执行。
$goAgentRoot = Join-Path (Split-Path -Parent $PSScriptRoot) "windows-go-full-agent"
$goServiceControl = Join-Path $goAgentRoot "service-control.ps1"

throw "LEGACY_RUNTIME_RETIRED: PowerShell Full Agent 已退役。请使用 '$goServiceControl' 管理 Go Agent，或直接运行 '$goAgentRoot\gcac-agent.exe'。"
