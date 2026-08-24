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

## 网关 TCP 中继（Gateway Relay）

以 gateway 角色运行的 Agent 可启用 TCP 中继：只做私有密钥认证 + 网络层转发，不解析任何应用协议。

- 握手协议 `gcac.gateway-relay/v1`：网关下发随机 `challenge`（hex）→ 客户端对 `challenge + ":" + host + ":" + port` 做 ed25519 签名（hex）→ 网关用 `relayClientPublicKeys` 验证 → 通过后返回 `{"ok":true}` 并双向透传原始字节。
- 认证通过后允许转发到任意网关可达的 host:port（不做目标白名单）。
- 配置项：`relayEnabled`、`relayListenAddress`、`relayPort`（默认 18934）、`relayClientPublicKeys`（hex ed25519 公钥，兼容字符串或数组）、`relayIdleTimeoutSeconds`（默认 300）。
- 安全边界：未启用 gateway 角色或缺少客户端公钥时启动失败关闭；握手限时 10 秒；并发会话上限 128；空闲超时强制断开。

## 构建与运维

Windows Go Full Agent 的唯一安装发布物是 `dist/gcac-agent.windows-amd64.exe`。一键安装接口只会打包该文件，不会读取根目录中可能遗留的 `gcac-agent.exe`。构建时会同步根目录二进制，仅用于兼容尚未重启的旧后端安装器。

macOS、Linux 或 Git Bash：

```bash
./build.sh
```

Windows PowerShell：

```powershell
.\build.ps1
```

Windows 原生构建会先执行测试；macOS、Linux 和 Git Bash 会先交叉编译两种 Windows 测试二进制。随后均生成 `amd64` 和 `arm64` 发布物及其 SHA-256。

Windows 服务安装、卸载和状态检查脚本属于部署运维入口；Agent 进程本身不会启动脚本解释器。配置模板和服务安装路径位于当前目录下的 `config` 与安装脚本中。

服务安装和升级必须显式提供发布签名验证材料，脚本会在注册或替换服务二进制前验证 Ed25519 签名；缺少材料或验证失败时失败关闭：

```powershell
.\install-service.ps1 -PublicKeyFile .\release-public-key.pem -SignatureFile .\gcac-agent.exe.sig -SignatureVerifier .\gcac-release-sign.exe
```
