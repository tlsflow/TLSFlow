# Windows Service Wrapper 说明

当前 `install-service.ps1` 使用 `New-Service` 直接注册：

- `powershell.exe -File Start-GcacFullAgent.ps1 ...`

这种模型不是真正的 Windows Service Host。
`powershell.exe` 本身不会和 Service Control Manager 建立标准服务生命周期协议，
因此服务可以被创建，但通常无法被 SCM 正常启动。

这不是参数问题，而是服务宿主模型本身不成立。

## 当前状态

- `bootstrap.ps1` 已停止自动 `Start-Service`
- 安装流程仍会完成：
  - 文件落盘
  - 配置写入
  - 自检
  - 首轮 `RunOnce` 注册回传
- 但“常驻服务启动”需要切换到真正的服务包装方案

## 推荐方案

最省事的可用方案是引入 WinSW（Windows Service Wrapper）：

1. 将 `WinSW.exe` 和对应 XML 配置分发到安装目录
2. 由 WinSW 托管 `powershell.exe -File Start-GcacFullAgent.ps1`
3. 用 WinSW 自己完成：
   - install
   - start
   - stop
   - restart
   - log 管理

## 后续落地方向

- `service-wrapper/gcac-full-agent.xml.template`
- `service-wrapper/install-wrapper.ps1`
- `service-wrapper/uninstall-wrapper.ps1`

在引入 wrapper 之前，不应再把 `Start-Service` 视为“可用完成态”。
