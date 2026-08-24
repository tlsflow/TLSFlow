# Windows Go Agent v2

Windows Go Agent 是通用执行节点，只采集原始 Windows 主机事实并执行经过授权的通用计划。第三方产品识别、配置解析和部署语义属于插件，不进入 Agent Core。

## 长期合同

Agent 只注册以下四个动作：

- `agent.fact.collect`
- `agent.plan.validate`
- `agent.plan.execute`
- `agent.execution.receipt`

写计划必须携带 `AgentCapabilityTokenV1`、独立 `PolicyAuthorityDecisionV1`、租户/插件版本绑定、路径/服务/Artifact 摘要、短期过期时间和一次性 nonce。缺少信任根、本地策略、签名或撤销状态时失败关闭；写操作失败或结果不明时返回 `UNKNOWN`，禁止自动重试和旧路径回退。

计划只允许固定通用原语：文件原子替换、带签名检查点的恢复、固定 Windows Service 控制，以及固定程序和参数模板的 `command.execute_allowlisted`。Agent 不接受 Shell、PowerShell、CMD、裸脚本、自由字符串命令或下载后执行。

## 构建与运维

```powershell
go build -trimpath -o gcac-agent.exe .
go test ./...
```

Windows 服务安装、卸载和状态检查脚本属于部署运维入口；Agent 进程本身不会启动脚本解释器。配置模板和服务安装路径位于当前目录下的 `config` 与安装脚本中。

服务安装和升级必须显式提供发布签名验证材料，脚本会在注册或替换服务二进制前验证 Ed25519 签名；缺少材料或验证失败时失败关闭：

```powershell
.\install-service.ps1 -PublicKeyFile .\release-public-key.pem -SignatureFile .\gcac-agent.exe.sig -SignatureVerifier .\gcac-release-sign.exe
```
