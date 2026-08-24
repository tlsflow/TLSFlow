# GCAC Windows Compatibility Agent

Windows Compatibility Agent 是面向 Windows Server 2008 R2 SP1、Windows Server 2012 和 Windows Server 2012 R2 的 Go 兼容产品线。它与 Windows Go Full Agent 共用 Agent v2 协议、安全校验、恢复账本和结果上报语义，但固定使用 Go 1.20.x，并只发布 `windows/amd64`。

## 产品身份

- 主程序：`GCAC.WindowsCompatibilityAgent.exe`
- 产品线：`windows-compat-full-agent`
- Runtime：`go`
- Toolchain：`go1.20`
- 服务名：`GCACWindowsCompatibilityAgent`
- 管理端口：`18932`
- 兼容档案：`windows-server-2008-r2-to-2012-r2`
- Agent v2 动作：`agent.fact.collect`、`agent.plan.validate`、`agent.plan.execute`、`agent.execution.receipt`

## 功能

主 Agent 负责注册、身份恢复、心跳、能力上报、任务轮询、授权计划、Receipt、恢复账本和健康管理。独立的 `windows-runtime-discovery` Scanner 根据运行进程、Windows 服务注册参数和有效配置扫描并上报 IIS、Apache、nginx、Tomcat；完整快照使用 `FULL_WEB_DISCOVERY` scope 和 `web.inventory` capability。`web.iis` 是独立 Go JSONL Agent-side Plugin，不能绕过 Agent v2 直接执行写操作。

## 构建

构建入口是 `build.ps1` 或 `build.sh`，开始时会严格检查 `go version` 为 Go 1.20.x，并生成主 Agent、升级器、Web 扫描器和 IIS Plugin 的 Windows amd64 产物、测试程序和 SHA-256。构建不调用 C# 编译器，也不需要任何外部框架运行时。

```powershell
.\build.ps1
```

```sh
./build.sh
```

## 安装、升级和卸载

- 安装：`install-service.ps1`
- 升级：`upgrade-service.ps1`
- 卸载：`uninstall-service.ps1`

脚本只负责签名校验、目录准备、Windows Service 编排、配置复制和回滚；任务执行、发现和上报均由 Go 可执行文件完成。安装后配置默认位于 `C:\ProgramData\GCAC\WindowsCompatibilityAgent\config\agent.config.json`，运行数据和恢复账本位于同名 `data` 目录。

## 运行检查

```powershell
.\GCAC.WindowsCompatibilityAgent.exe version
.\GCAC.WindowsCompatibilityAgent.exe self-check --config C:\ProgramData\GCAC\WindowsCompatibilityAgent\config\agent.config.json
.\GCAC.WindowsCompatibilityAgent.exe health --config C:\ProgramData\GCAC\WindowsCompatibilityAgent\config\agent.config.json
```

Windows Server 2008 R2、2012 和 2012 R2 的现场安装、服务恢复、Agent v2、IIS 发现和证书操作结果必须分别记录；现代 Windows 或交叉编译结果不能代替旧系统验收。
