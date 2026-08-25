# GCAC Windows AD CS Agent

这是独立的 Windows AD CS Agent，使用 `windows_adcs_service` 平台和 `adcs_agent` 注册角色。它不调用任何其它 Agent 可执行文件，服务名为 `GCACWindowsAdcsAgent`，管理端口固定为 `18933`。

当前版本：`0.1.1`。bootstrap 安装会显示该版本，并在覆盖可执行文件前停止现有服务，完成替换后重新创建并启动服务。

安装隔离矩阵：

| 项目 | AD CS Agent |
| --- | --- |
| 可执行文件 | `gcac-adcs-agent.exe` |
| 安装目录 | `C:\Program Files\GCAC\WindowsAdcsAgent` |
| 配置目录 | `C:\ProgramData\GCAC\WindowsAdcsAgent\config` |
| 数据目录 | `C:\ProgramData\GCAC\WindowsAdcsAgent\data` |
| 日志目录 | `C:\ProgramData\GCAC\WindowsAdcsAgent\logs` |
| 服务名 | `GCACWindowsAdcsAgent` |
| 管理端口 | `18933` |

进程启动后向控制面注册 `adcs_agent` 角色和 Microsoft AD CS 能力，持续发送心跳并拉取 Agent v2 任务。AD CS 操作在本机直接调用 `certreq.exe`/`certutil.exe`，支持状态检查、CSR 提交、证书查询、签发结果读取、吊销、CRL 发布和 CRL 状态读取。任务结果包含 `AgentReceipt` 摘要，控制面仍负责授权、队列、审计和最终状态确认。

构建与测试：

```bash
go test ./...
./build.sh
sha256sum dist/gcac-adcs-agent.windows-amd64.exe
```

Windows 原生安装由控制面生成的一次性 bootstrap 完成，也可以使用 `install-service.ps1` 手动安装。当前仓库完成代码、Go 测试和 `windows/amd64`、`CGO_ENABLED=0` 交叉编译验证；没有 Windows Server/真实 AD CS 主机，因此未声称现场安装或签发成功。
