# Windows Compatibility Agent Go 构建与验收规则

## 适用范围

本规则适用于 `agents/windows-compat-full-agent`。该产品线固定使用 Go 1.20.x，发布架构为 `windows/amd64`，支持 Windows Server 2008 R2 SP1、Windows Server 2012 和 Windows Server 2012 R2。PowerShell 仅负责安装、升级、卸载和 Windows Service 编排，不是 Agent Runtime。

## 构建入口

Windows 原生构建必须在目标 Windows 构建机执行：

```powershell
Set-Location agents/windows-compat-full-agent
go version
.\build.ps1
```

构建脚本在开始阶段拒绝非 Go 1.20.x 工具链，并以 `CGO_ENABLED=0` 生成以下产物：

- `dist/GCAC.WindowsCompatibilityAgent.exe`
- `dist/gcac-agent-updater.exe`
- `dist/plugins/windows-runtime-discovery.exe`
- `dist/web-iis/web-iis-agent-side-plugin.exe`
- 上述主 Agent、Scanner 和 IIS Plugin 的独立测试程序

macOS/Linux 可以使用 `./build.sh` 做 Go 源码和 `windows/amd64` 交叉编译检查，但本地 Go 1.26 或其他版本的结果只能标记为 `交叉编译通过`，不能标记为 `Go 1.20 正式构建通过`。

## 发布包约束

Release Bundle 只从 `agents/windows-compat-full-agent/dist` 读取 Compatibility 产物，不能读取历史 `bin/Release`。Bundle 中 Compatibility 路径为 `windows/amd64/compatibility/`，不得出现：

- `.cs`、`.csproj`、Reference Assemblies、C# 测试程序；
- `GCAC.WindowsCompatibilityAgent.exe.config` 或其他运行时 `.config`；
- `windows/arm64/compatibility` 目录；
- 未经 Go 1.20 构建机确认的生产二进制。

`docker/verify/verify-release-bundle.mjs` 必须验证 Compatibility manifest 的 `runtime=go`、`toolchain=go1.20`、`productLine=windows-compat-full-agent` 和 `architectures=["windows/amd64"]`，并逐文件校验 SHA-256。

## 安装和升级验收

安装、升级、卸载脚本必须验证主 Agent 签名、复制四个 Go 产物、写入 `agent.config.json`、注册 `GCACWindowsCompatibilityAgent` 服务和管理端口 18932。安装后必须确认：

1. 服务二进制路径指向 `GCAC.WindowsCompatibilityAgent.exe service run`；
2. 安装根目录没有 `.config`、C# 产物或旧 `bin/Release` 文件；
3. `self-check`、`health`、注册、心跳、能力上报和 `web.inventory` 上报成功；
4. 升级失败可以恢复旧二进制并重新启动服务；
5. `web.iis` 写操作仍必须经 Agent v2 授权计划，插件不得执行任意命令。

## 证据等级

| 结果 | 含义 |
| --- | --- |
| `PASS` | 在 Go 1.20 Windows 原生环境或目标旧 Windows 现场完成并保存日志/哈希。 |
| `CROSS_COMPILE_ONLY` | 非 Windows 环境交叉编译或单元测试通过，不能证明旧系统可运行。 |
| `BLOCKED` | 缺少 Go 1.20 构建机、Windows Server 2008 R2/2012/2012 R2 现场、签名材料或控制面，必须写明阻塞事实。 |

没有三类目标 Windows 的真实回放时，Spec 005.8 保持 `IN_REVIEW` 或 `BLOCKED`，不能发布“旧系统已认证”的口径。
