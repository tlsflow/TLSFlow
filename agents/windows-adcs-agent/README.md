# GCAC Windows AD CS Agent

这是独立的 Windows AD CS Agent，使用 `windows_adcs_service` 平台和 `adcs_agent` 注册角色。它不调用任何其它 Agent 可执行文件，服务名为 `GCACWindowsAdcsAgent`，管理端口固定为 `18933`。

当前版本：`0.1.27`。bootstrap 安装会显示该版本，并在覆盖可执行文件前停止现有服务，完成替换后重新创建并启动服务。

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

进程启动后向控制面注册 `adcs_agent` 角色和 Microsoft AD CS 能力，持续发送心跳。服务每 5 秒分别通过 Windows `CertificateAuthority.View` 读取 `Log`（历史签发/吊销记录）和 `Queue`（待处理请求），COM 查询失败时才回退 `certutil.exe -view ... csv`；按请求号和状态摘要去重，只把新增或变化的请求、签发和吊销记录推送到 `/api/v1/agents/ca-observations`。控制面从 Agent 身份解析租户、Provider 和 Authority，并复用 `pg_ca_external_observations` 的唯一键幂等入库；CA 运维页面直接读取该表，不再依赖创建历史同步任务。推送失败批次保存在数据目录的 `ca-observations.json`，采用临时文件原子替换和指数退避自动重试。状态文件绑定 Agent/CA 来源身份，旧状态文件或重新注册后的新 Agent 会自动触发一次历史全量回填。证书签发、查询、吊销和 CRL 等写操作仍通过兼容的 Agent 任务队列执行。

排障时读取 `C:\ProgramData\GCAC\WindowsAdcsAgent\logs\agent.log` 中的 `AD CS Agent 观测链路摘要`，或访问管理端点 `/api/v1/control/observations`。摘要按 `scannedRecords → statusCounts → changedRecords/queuedRecords → submittedRecords/failedBatches → accepted/inserted/updated/duplicates/rejected` 记录完整链路；`scannedRecords=0` 表示本机两个 AD CS 视图均未返回记录，`submittedRecords=0` 表示本轮没有发起 POST，`failedBatches>0` 表示控制面不可达或返回非 2xx，`rejected>0` 表示控制面已解析请求但拒绝了部分记录，`warnings` 会列出单个视图失败原因。管理端点 `/api/v1/control/observations/scan` 接受 POST，可由控制面触发一次真实扫描并立即返回本轮摘要。`0.1.23` 注册与首次心跳不再调用 CA 探测命令；它使用已安装的 `caConfig`，或由控制面保留同一 Agent 已验证的 CA 身份，避免 CA 命令阻断心跳。`0.1.24` 会在前台 `run --debug` 时将脱敏后的任务阶段和外部命令诊断同时写入控制台与日志。它优先直接调用 Windows `certutil.exe` 读取 Log/Queue，并按 Windows ACP/OEMCP 转换原生命令输出；直连失败时才回退 `CertificateAuthority.View` COM 和 PowerShell UTF-8 包装。PowerShell 成功输出使用 UTF-8 Base64，失败输出也会按 Windows ACP/OEMCP 解码后写入日志；Agent 日志自动写入 UTF-8 BOM，Windows PowerShell 5.1 可直接正确读取。处置状态只接受 AD CS Disposition 的稳定数字代码或明确文本，缺失/错位时保持 `unknown`，不再通过 RevokedWhen 推断吊销；`statusCounts` 按 request/issuance/revocation 投影报告本轮归类结果，可区分“采集正确但未发送”与“采集阶段错误分类”。

现场执行任务需要脱离 Windows Service 宿主时，先停止服务，再以前台诊断模式运行：`gcac-adcs-agent.exe run --config="C:\ProgramData\GCAC\WindowsAdcsAgent\config\agent.config.json" --debug`。该模式把任务阶段和 `certutil.exe`/`certreq.exe` 的启动、PID、结束、耗时、退出错误及最多 4096 字符的输出同步到控制台，并继续写入 `agent.log`；令牌、Receipt 正文和私钥材料不会输出。按 `Ctrl+C` 停止前台进程后，再用 `Start-Service GCACWindowsAdcsAgent` 恢复服务。

构建与测试：

```bash
go test ./...
./build.sh
sha256sum dist/gcac-adcs-agent.windows-amd64.exe
```

Windows 原生安装由控制面生成的一次性 bootstrap 完成，也可以使用 `install-service.ps1` 手动安装。当前仓库完成代码、Go 测试和 `windows/amd64`、`CGO_ENABLED=0` 交叉编译验证；没有 Windows Server/真实 AD CS 主机，因此未声称现场安装或签发成功。
