# GCAC Windows Compatibility Agent

Windows Compatibility Agent（Windows 兼容版 Agent）是面向 Windows Server 2008 R2 SP1 至 Windows Server 2012 R2 的独立正式产品线，不降低 Windows Modern Agent 的 Go 与系统基线。

## 产品身份

- 包名：`GCAC.WindowsCompatibilityAgent`
- 产品线：`windows-compat-full-agent`
- Runtime：`csharp-dotnet-framework`
- 服务名：`GCACWindowsCompatibilityAgent`
- 显示名：`GCAC Windows Compatibility Agent`
- Action Contract：`gcac.action/v1`
- Agent Core 长期动作：`agent.fact.collect`、`agent.plan.validate`、`agent.plan.execute`、`agent.execution.receipt`
- 运行时基线：.NET Framework 3.5.1

Windows Server 2003、2003 R2 和 Windows Server 2008 非 R2 明确不支持。PowerShell 仅用于安装、升级和卸载脚本，不是正式 Agent Runtime；Agent Core 不执行 PowerShell、CMD、Shell 或下载后执行任务。

## 构建

```powershell
.\build.ps1
```

构建脚本使用系统 C# 编译器和 .NET Framework 3.5 Reference Assemblies（引用程序集），并校验 `mscorlib.dll` 必须为 `Version=2.0.0.0`，生成 `bin\Release\GCAC.WindowsCompatibilityAgent.exe` 和独立测试程序。正式产物不依赖 .NET Core、.NET Framework 4.8 或 PowerShell 运行任务循环。

如果开发机没有安装 .NET Framework 3.5 Developer Targeting Pack，可使用 Microsoft.NETFramework.ReferenceAssemblies.net35 包解压后的 `build\.NETFramework\v3.5` 目录：

```powershell
.\build.ps1 -ReferenceAssemblyPath 'C:\path\to\build\.NETFramework\v3.5'
```

## 前置检查

```powershell
.\bin\Release\GCAC.WindowsCompatibilityAgent.exe --config .\agent.config.json --preflight
```

前置检查把系统信息采集为 Fact（环境事实），再用通用约束运算符判断最低内核版本、.NET Framework 3.5.1、控制面连通性和服务权限；使用 HTTPS 控制面时额外检查 TLS 1.2。HTTP 控制面可以连接，但必须部署在受控内网或通过受信 Gateway 隔离，不建议用于生产公网。

## 安装、升级与恢复

- 安装：`install-service.ps1`
- 升级：`upgrade-service.ps1`
- 卸载：`uninstall-service.ps1`
- 安装和升级必须传入 `-PublicKeyFile`、`-SignatureFile`、`-SignatureVerifier`；脚本在注册或替换服务前验证 Ed25519 签名，缺少材料或验证失败时失败关闭。
- 结果恢复：`recovery-ledger.json` 保存尚未上报的 Action Result，进程重启后先补传再继续拉取任务。
- 身份恢复：`agent-id.txt` 保存首次注册返回的 Agent ID，服务或操作系统重启后直接恢复心跳，不重复消耗一次性注册令牌。
- 主动管理：默认监听 `18933` Direct Control 端口并上报控制面，与 Windows Full Agent 的默认 `18930` 端口可同机共存。
- 心跳周期：默认每 10 秒上报一次；平台仍使用独立的心跳超时和管理端口连续失败规则判定离线。
- 审计：`agent-audit.log` 记录注册、任务开始、任务完成和结果补传事件。

升级脚本先停止独立服务并保存 `.rollback` 产物；新产物启动失败时恢复旧文件。Modern Agent 与 Compatibility Agent 使用不同服务名和安装目录，可以在同一主机并存；控制面必须基于 Capability、Compatibility Profile 和 Resolver 只向其中一条产品线分配同一部署动作，禁止两个 Agent 同时修改同一目标。

## 当前认证状态

本工程具备统一注册、心跳、能力上报、任务拉取、确认、结果上报、动作 Registry、前置检查、恢复账本和审计日志。Agent Core 只注册并接受四个 Agent v2 长期动作；缺少独立 Policy Authority 信任根时，四个动作全部失败关闭，不回退到历史执行器。

IIS Inspector、IIS 专用 Handler 和 IIS 站点/Binding 事实不属于本产品的宿主 Core。若未来存在无法由通用原语完成的 IIS API，只能通过独立的 Agent-side Plugin 合同承载；该 Plugin 必须保持独立边界，不能新增 Core 动作或把 IIS 专用执行逻辑回流到宿主。
