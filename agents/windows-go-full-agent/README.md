# Windows Go Full Agent

## 应用证书本地密钥

- `certificate.key.create_csr` 使用 Microsoft Software Key Storage Provider 创建机器级 CNG 密钥，设置 `Exportable=FALSE`，只返回 CSR、公钥指纹和不透明 `localKeyRef`。
- `certificate.install_issued` 在调用 `certreq -accept` 前验证签发证书公钥与 CSR 公钥指纹一致。
- `certificate.key.retire` 按 CNG KeyContainer 删除退役密钥。
- `certificate.trust.install` 将 CA 证书加入本机 Root 存储，`certificate.trust.rollback` 按拇指纹删除本次信任锚。

这是 `012.1` 对应的 **Windows Go Full Agent** 最小真实闭环落地产物。

当前已包含：

- Go 主入口 `gcac-agent.exe`
- Windows Service 正式宿主骨架
- 控制面注册、心跳、拉任务、ack、日志和结果回传
- 本地任务幂等账本与 Recovery Ledger
- Windows Adapter 基础能力采集
- IIS Provider 最小真实闭环：`PFX -> 私钥 ACL -> Binding -> TLS 验证 -> 失败回滚`
- Windows 配置模板
- 安装、卸载、运维辅助脚本
- 最小前台运行、自检、健康检查和服务信息输出
- 直连控制面启用后自动维护 Windows 防火墙入站例外规则

当前明确不包含：

- 多 Provider 并发调度与更通用的 Provider 插件化框架
- SecretRef 正式解析链路
- 更完整的实机验收记录与环境矩阵文档沉淀

## 关键边界

- 正式宿主是 `gcac-agent.exe`
- Windows Service 不再启动 `powershell.exe -File ...`
- PowerShell 脚本只保留为安装器和运维辅助资产

## 目录

- `main.go`
- `go.mod`
- `config/agent.config.template.json`
- `install-service.ps1`
- `uninstall-service.ps1`
- `service-control.ps1`

## 构建

```powershell
go build -o gcac-agent.exe .
```

## 运维入口

- 安装服务：`powershell -ExecutionPolicy Bypass -File .\install-service.ps1`
- 卸载服务：`powershell -ExecutionPolicy Bypass -File .\uninstall-service.ps1`
- 查看状态：`powershell -ExecutionPolicy Bypass -File .\service-control.ps1 -Action status`
- 自检：`powershell -ExecutionPolicy Bypass -File .\service-control.ps1 -Action selfcheck`
- 健康检查：`powershell -ExecutionPolicy Bypass -File .\service-control.ps1 -Action healthcheck`
- 服务信息：`powershell -ExecutionPolicy Bypass -File .\service-control.ps1 -Action service-info`

## 直连监听默认值

- Windows Go Agent 默认直连监听端口：`18930`
- 默认监听地址：`0.0.0.0`
- 默认 `directControlAdvertiseHost` 留空，Agent 启动时会优先按 `controlPlaneUrl` 的实际出站源地址选择主 IP 对外声明；如果探测失败，再回退到“默认网关优先、非虚拟网卡优先、IPv4 优先”的评分逻辑；最后才回退到监听地址
- 只要 `directControlEnabled=true` 且监听地址不是回环地址，Agent 就会自动创建并维护 Windows 防火墙入站例外规则
- 如果后续把监听改回 `127.0.0.1` / `localhost`，Agent 启动时会自动清理自己管理的这条防火墙规则

## 安装迁移行为

- 如果目标宿主之前安装过旧版 PowerShell Windows agent，`install-service.ps1` 会先探测并卸载旧服务，再安装新的 Go agent。
- 旧宿主识别范围包括：`gcac-full-agent-ps*` 服务名、`GCAC PowerShell Full Agent` 显示名，以及旧安装根目录 `C:\Program Files\GCAC\FullAgentPS` / 旧元数据 `C:\ProgramData\GCAC\FullAgent\service.install.json`。
- 这一步是强制迁移，不允许 Go agent 与旧 PowerShell 正式宿主并存。

## 当前结论

这一版已经不再是“Go 外壳包 PowerShell Runtime”的假迁移，而是 Go 正式承担宿主、控制面、账本和 Provider 调度，PowerShell 只保留为安装器、排障脚本和受控平台动作边界。

## Agent 原子操作插件

- 注册动作：`agent.atomic_plan.execute@1.0`。
- 执行计划必须包含目标 Agent、租户、插件包哈希、过期时间、幂等键和 HMAC-SHA256 签名。
- 签名密钥读取 `GCAC_AGENT_PLAN_SIGNING_KEY`；开发环境未配置时才使用仓库约定的开发密钥。
- 支持文件备份、原子替换、恢复、权限设置、受控程序执行、Windows Service 控制和 TLS 校验。
- 支持结构化 IIS 原子操作：PFX 检查与幂等导入、私钥 ACL、Binding 捕获、证书更新和账本恢复；插件不能传入 PowerShell 脚本。
- 内置 `builtin.windows.iis.pfx` 插件通过 `agent.atomic_plan.execute` 执行，旧 `windows.iis.deploy_certificate` 继续作为 `NATIVE_HANDLER` 兼容回退。
- `command.execute` 只接受 `program + args`，Shell 模式默认并强制禁用。
- 每个计划写入恢复账本；重复计划返回缓存结果，失败时逆序执行回滚；`whenOperationCompleted` 防止预检失败时执行无意义回滚，真正回滚失败才进入 `MANUAL_INTERVENTION`。
