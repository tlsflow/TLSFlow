---
title: 工作流开发规范
description: TLSFlow v1.0.0 工作流 DSL、模板来源、输入合同和执行边界
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - backend/src/modules/workflow-templates/dto/workflow-templates.dto.ts
  - backend/src/modules/workflow-templates/schema/workflow-templates.schema.ts
  - backend/src/modules/workflow-templates/domain/workflow-templates.domain-service.ts
  - backend/src/modules/executors/ssh
  - backend/src/modules/executors/curl
  - backend/src/modules/executions/application/executors.ts
  - backend/src/modules/workflow-templates/domain/workflow-canvas.compiler.ts
  - backend/src/modules/deployment-inputs/dto/deployment-input-contract.dto.ts
  - backend/src/modules/deployment-inputs/dto/resolved-deployment-input.dto.ts
  - backend/src/modules/deployment-inputs/schema/deployment-input-contract.schema.ts
testRefs:
  - backend/src/modules/workflow-templates/workflow-templates.test.ts
  - backend/src/modules/workflow-templates/workflow-templates.security.test.ts
  - backend/src/modules/workflow-templates/workflow-step-dispatcher.test.ts
  - backend/src/modules/executions/workflow-executor-adapter.test.ts
  - backend/src/modules/executions/execution-grant-artifact.test.ts
lastVerified: 2026-08-24
---

# 工作流开发规范

工作流 DSL（领域专用语言）是 TLSFlow 私有协议，不是任意 Shell 或 JavaScript 脚本。当前正式模板 API 版本为 `gcac.workflow/v1`，模板必须使用 `CurlSshWorkflow` 结构并通过宿主校验。

最小根对象如下，除此之外的根字段会被 Schema 拒绝：

```json
{
  "apiVersion": "gcac.workflow/v1",
  "kind": "CurlSshWorkflow",
  "metadata": { "name": "example-certificate-deploy", "version": "1.0.0" },
  "inputContract": {
    "apiVersion": "gcac.deployment-input/v1",
    "variables": {}, "connections": {}, "credentials": {}, "artifacts": {}
  },
  "steps": []
}
```

`metadata.name` 是稳定标识，`metadata.version` 使用 SemVer（语义化版本号）；数据库编辑历史的整数版本不能替代 DSL 版本。模板不能携带明文密码、Token、私钥或生产凭据。

## 1. 模板来源和版本

- 内置模板只能放在 `backend/src/modules/workflow-templates/builtin-workflows`，随代码发布并受 Git 跟踪。
- 用户导入模板保存到 `data/workflows`，不与内置目录混用。
- 插件包中的工作流资源必须与 Manifest 插件版本一致；更新资源就递增插件版本。
- 数据库 `WorkflowTemplateVersion` 的整数版本是编辑/发布历史，不能代替 DSL `metadata.version`。

## 2. 输入合同

每个模板都要声明 `DeploymentInputContractV1`：

- `variables`：普通值、枚举、对象或数组；
- `connections`：传输方式、主机、端口、TLS 和 SSH Host Key；
- `credentials`：只保存 `credentialId` 和允许的凭据类型；
- `artifacts`：证书、私钥、中间链及输出格式。

字段必须说明类型、是否必填、来源、生命周期和绑定策略。来源可为资产事实、Binding、默认值、派生值、系统值或前置步骤输出。`fixed` 字段不允许用户覆盖；`runtime_injected` 只在运行时注入，不进入应用资产普通表单。

标准投影入口是 `POST /api/v1/deployment-inputs/projection` 和 `POST /api/v1/managed-targets/:managedTargetId/deployment-input-projection`。保存投影与正式预检必须复用同一解析规则。

解析结果必须是 `ResolvedDeploymentInputV1`，包含 `assetContext`、四类输入、`provenance`（来源链）、`sensitivePaths`（敏感路径）、`issues`、`executable` 和 `resolvedSha256`。存在阻断 Issue 或 `executable=false` 时，不得进入 SSH、HTTP、Agent 或 Gateway。输入快照还要固定 Assignment、PluginVersion、PluginBinding、WorkflowVersion、凭据版本和制品摘要；执行与重试不能重新读取“当前最新”配置。

## 3. 可用步骤和执行器

当前工作流使用 SSH（安全远程登录）和 CURL（HTTP 请求执行器）等受控执行器，并可在明确声明时使用 `plugin.action` 调用插件 Runner。步骤只能读取声明的输入和前一步的结构化输出，不能从模板根作用域猜测 Secret。

证书材料通过 Artifact Slot，密码和令牌通过 Credential/`secret://` 引用获取；PEM、私钥和 Secret 不得进入普通变量、命令文本、日志或计划 JSON。

当前 Step 类型为：`http`、`ssh`、`browser`、`sftp`、`scp`、`condition`、`transform`、`foreach`、`checkpoint`、`checkpoint_verify`、`wait`、`manual` 和 `plugin.action`。证书部署阶段固定为 `prepare → backup → install → refresh → verify`；`rollback` 是同一 WorkflowVersion 的独立数组，不是把命令追加到主流程末尾。`plugin.execute` 仅属于旧插件 Workflow Schema，当前 DSL 不接受。

### HTTP/CURL

HTTP Step 必须引用 Contract 中的 `connectionRef`。Basic、Bearer、API Key、Cookie、自定义 Header 和 mTLS（双向 TLS）均通过 Credential/SecretRef 注入；URL 只允许 HTTP(S)，默认拒绝明文远程 HTTP。`tls.verify=false` 只有在 DSL 显式声明 `allowInsecure=true`、解析后的执行授权包含 `allowInsecureTls=true`，并且宿主为当前租户、run、step 和 WorkflowVersion 签发有效短期 `ExecutionGrant` 时才会执行；Grant 在步骤结束后撤销。`approvalId` 不是 TLS 连接前置字段，执行事件仍必须按宿主审计规则记录，不能把该例外当成生产目标已验证。`extract` 可读取 JSON 路径、响应 Header、正则或状态码，`assert` 可检查状态码、JSON 路径、Header、文本、正则和证书指纹。

需要连续登录的设备 API 在 HTTP request 上声明 `cookieSessionRef`。该名称只在当前 `tenantId`、运行 ID 和 WorkflowVersion 内有效，宿主以内存 CookieJar 保存所有原始多值 `Set-Cookie`，按 Domain/Path/Secure/Host-only/Expires/Max-Age 计算后续请求；普通 DSL 在 Workflow finally 清理会话，Plugin Runner 在 Action finally 清理会话。Cookie 不进入日志、审计、step 输出、SSE、数据库或前端响应，显式 Cookie Header 与 CookieSession 不得同时声明。证书 multipart 只能使用 `artifact://` Artifact 或受控 PEM 输出，带文件名、Content-Type、大小限制和可选 SHA-256，严禁本地路径或 UNC 路径。厂商 nLIB/DNA 动态编码必须放在专用 Runner/适配器，不能向通用 DSL 增加任意脚本执行。

### Browser Step

Browser Step 由宿主 Browser Runtime 执行，只允许 `navigate`、`extract`、`verify` 三种动作，不开放任意脚本、选择器点击或文件系统访问。`url` 默认来自当前能力合同；用户或已有凭据可以显式提供 HTTPS 登录地址，宿主会把该地址的规范化 Origin 临时加入当前会话白名单，后续导航仍只能访问会话允许的 Origin；同一个受控 BrowserContext 内完成导航、提取和验证。

```json
{
  "name": "extract-session",
  "type": "browser",
  "stage": "prepare",
  "browser": {
    "action": "extract",
    "extractions": [
      { "name": "sessionId", "source": "cookie", "key": "session_id", "sensitive": true },
      { "name": "csrf", "source": "header", "key": "x-csrf-token", "optional": true, "sensitive": true }
    ]
  },
  "extract": [{ "name": "browserSession", "type": "outputPath", "path": "sessionId", "sensitive": true }]
}
```

`cookie`、`header`、`local_storage`、`session_storage` 必须提供 `key`；`url` 和 `text` 不需要 `key`。敏感提取只能进入声明过的 `BROWSER_SESSION` 或其他凭据输出合同，未声明字段必须丢弃；不得写入普通变量、日志或 Workflow 持久化快照。

### Plugin Action Step

`plugin.action` 只能调用当前插件版本 Manifest 中已经声明且已发布的单个 Action。宿主在执行前比对 Action Contract、输入/输出 Schema 摘要、能力、Grant、超时和幂等键；Runner 不接收 Workflow、rollback、checkpoint 或全局变量。

```json
{
  "name": "cloud-sign-request",
  "type": "plugin.action",
  "pluginId": "cloud.aliyun",
  "capability": "cloud.service.connection-test",
  "actionId": "cloud.service.connection-test",
  "actionContractVersion": "v1",
  "input": { "serviceRef": "{{ asset.cloudServiceRef }}" },
  "inputSchemaSha256": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "outputSchemaSha256": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "timeoutSeconds": 30,
  "writeEffect": false,
  "idempotencyKeyRef": "{{ variables.requestId }}"
}
```

`inputSchemaSha256` 和 `outputSchemaSha256` 必须是资源内容的 `sha256:<64 位小写十六进制>` 摘要；`timeoutSeconds` 为 1-3600；`idempotencyKeyRef` 必须是变量引用。Runner 只能通过[宿主 Host API](./host-plugin-capabilities.md#runner-host-api-精确合同)读取云服务、Artifact、Secret、签名、HTTPS、取消状态和追加审计。

### SSH/SFTP/SCP

SSH、SFTP（安全文件传输）和 SCP（安全复制）使用 `connectionRef` 和 Credential Slot。Host Key（主机密钥）策略必须明确为严格校验、首次信任或人工审批；文件上传优先写临时路径，校验大小或哈希后再原子替换。远程路径、权限、Owner/Group、期望哈希和超时都必须进入计划和审计。

`foreach` 必须声明 `itemsPath`、元素变量和子步骤，最大 1000 项、嵌套最多三层；只有只读发现可以使用 `continueOnError`，部署和回滚禁止用它掩盖失败。`plugin.action` 只能调用单个已固定版本的 Runner Action，不能接管工作流顺序。

## 4. 失败、取消和回滚

部署、变更和回滚默认失败关闭；只有只读发现可以按合同允许部分继续。提交和执行使用当前租户部署任务设置，不能由插件自行跳过 Dry Run 或审批。

工作流应在写操作前保存恢复所需的稳定标识和旧值，在写入后执行目标回读。超时或连接中断可能导致外部状态未知，不能自动重放非幂等写操作；必须把状态收敛为失败或 UNKNOWN，并让用户先确认目标实际状态。

`checkpoint` 必须声明名称、捕获路径和是否为回滚必需；`checkpoint_verify` 用实际值和期望哈希检查漂移。宿主为正式执行创建恢复账本和资源锁，每个成功步骤写入账本，步骤结束后回收 Grant。只有幂等步骤允许自动恢复；非幂等步骤必须转人工处理或执行显式补偿。回滚始终使用原始 WorkflowVersion 和输入快照，并同时保留原始失败、回滚结果和最终验证结果。

Windows Remote 当前只有规划或 Mock（模拟）边界，不能在规范中写成已经具备生产执行能力。真实厂商、Gateway、多实例和外部目标验收必须单独记录，单元测试不能替代现场验证。

## 5. 校验清单

1. Schema 校验、资源路径和版本一致性通过。
2. 输入投影只出现合同声明的字段，敏感字段为引用而非明文。
3. 连接测试、发现、部署、回读和失败回滚均有脱敏测试记录。
4. 权限、租户隔离、审批、取消、重试和审计事件通过。
5. 新增 step、stage、变量或执行器后同步更新项目规范，并重新运行文档和相关测试。

证书部署工作流还必须固定 `certificateVersionId` 和 `certificateFormatId`，由宿主生成叶子证书、私钥、中间链、PFX/P12、JKS 或 P7B/P7C 制品。`verify` 阶段必须读取目标服务实际返回的证书指纹；上传成功不等于部署成功。结果同步只有在正式验证成功或回滚成功后才更新当前绑定状态。

## 6. 权威 Schema 与执行合同索引

以下文件是机器可校验合同的唯一来源；本文只解释使用方式，不复制一份可能漂移的简化 Schema：

| 合同 | 权威源码 |
| --- | --- |
| Workflow DSL 与 Step 校验 | `backend/src/modules/workflow-templates/schema/workflow-templates.schema.ts`、`backend/src/modules/workflow-templates/dto/workflow-templates.dto.ts` |
| DeploymentInput Contract | `backend/src/modules/deployment-inputs/dto/deployment-input-contract.dto.ts`、`backend/src/modules/deployment-inputs/schema/deployment-input-contract.schema.ts` |
| ResolvedDeploymentInput / Artifact 快照 | `backend/src/modules/deployment-inputs/dto/resolved-deployment-input.dto.ts` |
| Runner `plugin.action` Host API | `backend/src/modules/plugins/runner/protocol/host-api.registry.ts`、`backend/src/modules/plugins/runner/protocol/schemas/host-api-v1.schema.json` |
| Runner IPC v2 | `backend/src/modules/plugins/runner/protocol/protocol.types.ts`、`backend/src/modules/plugins/runner/protocol/schemas/ipc-v1.schema.json` |

新增或修改 Step、stage、变量、SecretRef、extract/assert、SSH/CURL 或 Runner 适配后，必须同步更新 `docs/项目规范/20260723-工作流模板管理及编写规范.md`，并在插件迭代说明中记录合同摘要变化。
