# Linux Go Agent v2

Linux Go Agent 是通用执行节点，只采集原始主机事实并执行经过授权的通用计划。它不识别第三方产品，不解析产品配置，也不提供自由命令入口。

## Linux 平台系列标识

Red Hat、Debian/Ubuntu、麒麟和统信 OS 在控制面使用同一个 Linux Go Agent、同一个 bundle 和同一套安装流程。安装会话可携带 `platformFamily`（`red-hat`、`debian-ubuntu`、`kylin` 或 `uos`），该值只写入 `agent.config.json` 并转换为 `platform-family:*` 注册标签；复制命令末尾的 `os=*` 注释也会显示该系列。它不参与能力判断、任务路由、权限校验或执行分支，因此不会改变 Agent 功能。

## 长期合同

Agent 只注册以下四个动作：

- `agent.fact.collect`
- `agent.plan.validate`
- `agent.plan.execute`
- `agent.execution.receipt`

控制面任务队列使用 `actionType` 和 `actionSchemaVersion` 字段。Agent 运行入口只在队列边界校验这两个字段，并将四个 canonical 动作转换为 Agent v2 wire 的 `action`；转换后会移除队列字段，wire 载荷不得直接携带 `action`、旧动作或产品 Alias。

写计划必须携带 `AgentCapabilityTokenV1`、独立 `PolicyAuthorityDecisionV1`、租户/插件版本绑定、路径/服务/Artifact 摘要、短期过期时间和一次性 nonce。缺少信任根、本地策略、签名或撤销状态时失败关闭；写操作失败或结果不明时返回 `UNKNOWN`，禁止自动重试和旧路径回退。

计划只允许固定通用原语：文件原子替换、带签名检查点的恢复、固定服务控制，以及固定程序和参数模板的 `command.execute_allowlisted`。Agent 不接受 Shell、PowerShell、CMD、裸脚本、自由字符串命令或下载后执行。

## 运行与构建

```bash
go build -trimpath -o gcac-linux-agent .
go test ./...
```

前台运行：

```bash
./gcac-linux-agent run --config=/etc/gcac/linux-agent/agent.config.json
```

自检、健康检查和服务信息仍通过 `self-check`、`health`、`service-info` 提供。服务安装脚本只负责安装通用 Agent 和服务单元，不探测或配置第三方产品。

正式发布使用 `release/build-release.sh`，发布产物必须经过签名与可复现构建校验。

宿主端在线升级使用 `POST /api/v1/control/upgrade` 和 `GET /api/v1/control/upgrade/status?transactionId=...`。Agent 会先校验 `management.upgrade.v1`、产品线/架构、时间窗口、Nonce、SHA-256 和已配置的 Ed25519 信任根，再启动固定的 `linux/upgrade.sh` 适配器；`accepted` 只表示适配器已启动，不表示替换成功，最终结果必须以状态账本中的 `succeeded`、`rolled_back`、`unknown` 或 `manual_required` 为准。

本地文件替换和服务控制需要 root。`linux/install-systemd.sh` 默认以 root 运行 Full Agent，行为与 Windows Service 的 LocalSystem 基线一致；如显式指定非 root `SERVICE_USER`，管理端点会在下载前返回 `AGENT_UPGRADE_PERMISSION_DENIED`，不会消费 Nonce 或写入升级制品。

安装或升级必须显式提供发布公钥、签名文件和 Ed25519 验证器；缺少任一材料时脚本失败关闭，不允许通过 `ALLOW_UNSIGNED_INSTALL` 或 `ALLOW_UNSIGNED_UPGRADE` 绕过：

```bash
PUBLIC_KEY_FILE=/path/to/release-public-key.pem \
SIGNATURE_FILE=/path/to/gcac-linux-agent.sig \
SIGNATURE_VERIFIER=/path/to/gcac-release-sign \
./linux/install.sh
```

`linux/install-systemd.sh` 使用同名环境变量，`release/build-release.sh` 和 `release/verify-reproducible.sh` 还要求 `SIGNING_PRIVATE_KEY_FILE`。
