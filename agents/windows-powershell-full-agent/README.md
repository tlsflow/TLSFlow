# Windows PowerShell Full Agent 骨架

这是 `012.1` 对应的 Windows PowerShell Full Agent 工程骨架。

当前只包含：

- 目录结构
- Windows Service 安装/卸载入口
- Agent 启动入口
- PowerShell 模块空壳
- 配置模板
- BOM 编码校验脚本

当前明确不包含：

- 控制面真实通信
- IIS / PFX 业务闭环
- 回滚与验证业务实现

当前已具备：

- `example.invalid` 下的本地 placeholder 控制面链路
- 面向 `/api/v1/agents/*` 的 HTTP 控制面客户端骨架
- 控制面不可达时明确失败，不伪装成功

## 目录

- `Start-GcacFullAgent.ps1`
- `install-service.ps1`
- `uninstall-service.ps1`
- `service-control.ps1`
- `modules/`
- `config/`
- `scripts/`

## 编码要求

所有 `.ps1` / `.psm1` / `.psd1` 文件必须使用 **UTF-8 with BOM**。

可使用：

- `scripts/Test-Utf8Bom.ps1`

做本地检查。

## 当前运维入口

- 安装服务：`powershell -ExecutionPolicy Bypass -File .\install-service.ps1`
- 安装并立即启动：`powershell -ExecutionPolicy Bypass -File .\install-service.ps1 -StartAfterInstall`
- 卸载服务：`powershell -ExecutionPolicy Bypass -File .\uninstall-service.ps1`
- 统一运维入口：`powershell -ExecutionPolicy Bypass -File .\service-control.ps1 -Action status`
- 源码目录离线自检：`powershell -ExecutionPolicy Bypass -File .\service-control.ps1 -Action selfcheck -InstallRoot . -ConfigDir .\config -ConfigPath .\config\agent.config.template.json -LogDir .\tmp\logs`
- 源码目录离线健康检查：`powershell -ExecutionPolicy Bypass -File .\service-control.ps1 -Action healthcheck -InstallRoot . -ConfigDir .\config -ConfigPath .\config\agent.config.template.json -LogDir .\tmp\logs`

安装后会在 `C:\ProgramData\GCAC\FullAgent\service.install.json` 写入安装元数据，便于后续排障和运维。

## 控制面模式

- 默认当 `controlPlaneUrl` 仍是 `https://gcac.example.invalid` 时，Agent 使用 placeholder 模式，便于本地骨架验证
- 当 `controlPlaneUrl` 指向真实服务时，Agent 走 `/api/v1/agents/register`、`/heartbeat`、`/tasks/pull`、`/tasks/ack`、`/tasks/result`
- 当前还没有接入 mTLS、日志批量上报、能力快照上报和升级协议
