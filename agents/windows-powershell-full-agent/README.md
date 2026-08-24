# Windows PowerShell Agent 兼容入口

这个目录不再代表正式的 PowerShell Agent Runtime。

当前作用只有一个：

- 保留旧的 Windows 安装/卸载/运维命令入口路径
- 把这些旧入口统一代理到 `agents/windows-go-full-agent/` 下的 Go Agent 脚本

## 当前结论

- 正式 Agent Runtime 只有 Go
- 正式 Windows Service 宿主只有 `gcac-agent.exe`
- 这里的 `install-service.ps1` / `uninstall-service.ps1` / `service-control.ps1` 只是兼容壳
- `Start-GcacFullAgent.ps1` 只保留旧路径，并以 `LEGACY_RUNTIME_RETIRED` 明确拒绝启动
- 旧入口继续可执行，但最终安装和运维的对象都是 Go Agent

## 旧入口现在会做什么

### install-service.ps1

- 不再安装 PowerShell Agent
- 直接代理到 `agents/windows-go-full-agent/install-service.ps1`

### uninstall-service.ps1

- 不再卸载 PowerShell Runtime
- 直接代理到 `agents/windows-go-full-agent/uninstall-service.ps1`

### service-control.ps1

- 不再调用 `Start-GcacFullAgent.ps1`
- 直接代理到 `agents/windows-go-full-agent/service-control.ps1`

### Start-GcacFullAgent.ps1

- 不再加载任何 PowerShell Agent 模块
- 不猜测性转换旧的 `RunOnce`、`OutputPath` 等参数语义
- 始终返回 `LEGACY_RUNTIME_RETIRED`，并指向 Go Agent 的服务控制脚本和可执行文件

## 为什么还保留这个目录

因为现场可能还在使用旧命令路径。

保留兼容入口可以做到：

- 不破坏既有操作习惯
- 不再继续安装 PowerShell Runtime
- 让旧入口自然过渡到 Go Agent

## 明确不再支持的内容

- PowerShell 作为正式 Agent 宿主
- `powershell.exe -File Start-GcacFullAgent.ps1` 作为正式 Windows Service 目标
- 旧 PowerShell 安装逻辑继续注册 NSSM + PowerShell Runtime

## 契约检查

运行以下命令可检查兼容入口语法、转发目标及旧 Runtime 文件是否已清零：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\agents\windows-powershell-full-agent\tests\Test-CompatibilityEntrypoints.ps1
```
