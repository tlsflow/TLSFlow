# Linux Go Agent v2

Linux Go Agent 是通用执行节点，只采集原始主机事实并执行经过授权的通用计划。它不识别第三方产品，不解析产品配置，也不提供自由命令入口。

## 长期合同

Agent 只注册以下四个动作：

- `agent.fact.collect`
- `agent.plan.validate`
- `agent.plan.execute`
- `agent.execution.receipt`

控制面任务队列使用 `actionType` 和 `actionSchemaVersion` 字段。Agent 运行入口只在队列边界校验这两个字段，并将四个 canonical 动作转换为 Agent v2 wire 的 `action`；转换后会移除队列字段，wire 载荷不得直接携带 `action`、旧动作或产品 Alias。Gateway 转发同样只向队列出口写入 canonical `actionType`，不保留双路径。

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
