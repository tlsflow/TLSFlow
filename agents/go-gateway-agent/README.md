# Gateway Agent（gcac-gateway-agent）

独立于 Full Agent 的网关代理：**独立二进制、独立配置 schema、独立端口与独立安装路径**。
只承载网关职责，不包含 Full Agent 的本地计划执行、事实采集、Web 库存与证书操作。

## 职责

- **TCP 中继（Gateway Relay）**：只做私有密钥认证 + 网络层转发，不解析任何应用协议。
  - 握手协议 `gcac.gateway-relay/v1`：网关下发随机 `challenge`（hex）→ 客户端对 `challenge + ":" + host + ":" + port` 做 Ed25519 签名 → 网关用 `relayClientPublicKeys` 验证 → 通过后返回 `{"ok":true}` 并双向透传原始字节。
  - 目标租户、Zone、端口、出站 ACL 和 SSRF 防护必须由控制面策略与 Gateway 网络策略共同完成；签名通过不代表可以任意访问内网地址。
- **网关探测**：如启用，仅用于控制面可达性观测，不承载业务执行和业务结果。

`gateway.forward.agent_task`、Agent Task 队列、结果轮询和 Receipt 属于旧业务转发路径，不是当前 Gateway Relay 职责。现有源码中的兼容路径在清退或显式禁用前不得用于生产。

## 独立配置（schema `gcac.gateway-agent.v1`）

| 项 | 值 |
| --- | --- |
| 管理端口 | `managementPort` 默认 **18935**（Full Agent 为 18930/18931/18932） |
| 中继端口 | `relayPort` 默认 **18934** |
| Linux 安装路径 | `/opt/gcac/gateway`、`/etc/gcac/gateway`、`/var/lib/gcac/gateway`、`/var/log/gcac/gateway` |
| Windows 安装路径 | `C:\Program Files\GCAC\Gateway`、`C:\ProgramData\GCAC\Gateway\{config,data,logs}` |
| 服务名 | `gcac-gateway-agent` |

关键配置项：`controlPlaneUrl`、`tenantId`、`agentKey`、`enrollmentToken`、`zone`、
`relayEnabled`、`relayListenAddress`、`relayPort`、`relayClientPublicKeys`（hex ed25519 公钥，兼容字符串或数组）、`relayIdleTimeoutSeconds`。

安全边界：缺少客户端公钥时中继启动失败关闭；握手限时 10 秒；并发会话上限 128；空闲超时强制断开。

## 构建

单一源码同时构建 Linux 与 Windows：

```bash
./build.sh
```

产物位于 `dist/`：`gcac-gateway-agent.linux-{amd64,arm64}`、`gcac-gateway-agent.windows-{amd64,arm64}.exe`；根目录 `gcac-gateway-agent` 为 Linux amd64 副本。

## 运行

```bash
./gcac-gateway-agent run --config=/etc/gcac/gateway/agent.config.json
./gcac-gateway-agent self-check --config=/etc/gcac/gateway/agent.config.json
./gcac-gateway-agent version
```

Linux systemd 安装：

```bash
GCAC_SKIP_RELEASE_SIGNATURE_VERIFY=bootstrap-fixed-bundle \
SERVICE_NAME=gcac-gateway-agent DISPLAY_NAME="GCAC Gateway Agent" \
INSTALL_ROOT=/opt/gcac/gateway CONFIG_DIR=/etc/gcac/gateway \
DATA_DIR=/var/lib/gcac/gateway LOG_DIR=/var/log/gcac/gateway \
bash linux/install-systemd.sh
```

Windows 由控制面 bootstrap 脚本安装（服务名 `gcac-gateway-agent`，自动放行 18934/18935 防火墙规则）。

## 测试

```bash
go test ./...
```
