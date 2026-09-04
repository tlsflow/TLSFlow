---
title: 宿主插件能力清单
description: TLSFlow v1.0.0 宿主向插件系统开放的能力、合同、资源和安全边界
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs: []
codeRefs:
  - backend/src/modules/plugins
  - backend/src/modules/plugins/controller/plugins.controller.ts
  - backend/src/modules/plugins/application/unified-plugins.application-service.ts
  - backend/src/modules/plugins/application/plugin-workflow-publisher.service.ts
  - backend/src/modules/plugins/application/plugin-package-resource-schema.service.ts
  - backend/src/modules/plugins/schema/plugin-workflow.schema.ts
  - backend/src/modules/plugins/schema/unified-plugins.schema.ts
  - backend/src/modules/plugins/capabilities/plugin-capability.registry.ts
  - backend/src/modules/plugins/runner/runner-server.ts
  - backend/src/modules/plugins/runner/plugin-runner-supervisor.ts
  - backend/src/modules/plugins/runner/plugin-runner-host-api.handler.ts
  - backend/src/modules/plugins/runner/protocol/host-api.registry.ts
  - backend/src/modules/plugins/runner/protocol/schemas/host-api-v1.schema.json
  - backend/src/modules/plugins/runner/protocol/schemas/ipc-v1.schema.json
  - backend/src/modules/plugins/onboarding/application-onboarding-recipe.dto.ts
  - backend/src/modules/application-onboarding/recipe/application-onboarding-recipe.schema.ts
  - backend/src/modules/application-onboarding/controller/application-onboarding.controller.ts
  - backend/src/modules/application-onboarding/dto/application-onboarding.dto.ts
  - backend/src/modules/browser-runtime/browser-credential-session.controller.ts
  - backend/src/modules/browser-runtime/browser-credential-session.service.ts
  - backend/src/modules/deployment-inputs/dto/deployment-input-contract.dto.ts
  - backend/src/modules/deployment-inputs/dto/resolved-deployment-input.dto.ts
  - backend/src/modules/agents/security/agent-security.contract.ts
  - backend/src/modules/agents/security/schemas/agent-security-v1.schema.json
  - backend/src/modules/agents/security/policy-authority.service.ts
  - backend/src/modules/agents/security/local-agent-authorization.service.ts
testRefs:
  - backend/src/modules/plugins/plugins-openapi.contract.test.ts
  - backend/src/modules/plugins/unified-plugins.test.ts
  - backend/src/modules/plugins/plugin-workflow-publisher.test.ts
  - backend/src/modules/plugins/runner/protocol/protocol.contract.test.ts
  - backend/src/modules/plugins/runner/plugin-runner-host-api.handler.test.ts
  - backend/src/modules/browser-runtime/browser-credential-session.service.test.ts
  - backend/src/modules/application-onboarding/recipe/application-onboarding-recipe.test.ts
  - backend/src/modules/application-onboarding/controller/application-onboarding.controller.test.ts
  - backend/src/modules/agents/security/agent-security.contract.test.ts
lastVerified: 2026-09-04
---

# 宿主插件能力清单

本页是插件开发的能力字典。它把宿主已经实现的能力、输入输出合同、权限、执行位置和限制集中列出。开发者只需要根据本页选择能力并准备资源，不需要通过猜测源码来调用未公开的服务。

## 1. 先理解四个概念

- **插件版本**：Manifest（插件清单）和资源组成的不可变包，唯一由 `pluginId + version` 标识。任何资源变更都必须递增版本。
- **Binding（绑定）**：把一个插件版本与连接、凭据、证书制品和受管上下文关联起来。Binding 保存引用，不保存密码、私钥或明文 Token。
- **Capability Assignment（能力指派）**：把某项能力分配给设备、ManagedTarget（受管目标）、应用资产或 ServiceAsset。新云服务能力使用 `ownerType=SERVICE_ASSET`；旧 CloudAccount API 仍在兼容注册，不能当作只读接口。
- **Grant（授权票据）**：某一次执行、某一个步骤的临时授权。它绑定租户、操作者、插件版本、目标和有效期，插件不能转交或长期保存。

执行链始终是：

```text
Manifest 能力声明
  → 插件版本导入和校验
  → 按插件来源执行适用的权限门禁
  → Plugin Binding
  → Capability Assignment
  → 输入合同解析和快照
  → Workflow 或 Agent Plan 执行
  → 目标回读验证、审计和结果收敛
```

权限门禁不是一个对所有插件都相同的步骤：

| 插件来源/执行形态 | 导入后的权限状态 | 是否调用 `approve-permissions` | 启用/执行条件 |
| --- | --- | --- | --- |
| `source=USER`（包括 USER Agent Plan） | `DISABLED + NOT_REQUIRED` | 否 | 管理员显式 `enable`，资源和合同校验通过 |
| `source=BUILTIN`（包括内置 Workflow/Agent Plan） | 按声明权限和内置策略决定 | 声明权限时调用 | 审批、资源和版本状态允许后才能启用 |
| Agent Plan 执行门禁（不是 Manifest source） | 不改变插件版本权限状态 | 不替代插件权限审批 | `runtime=AGENT_PLAN` 或 `resources.agentPlans` 命中后，还必须同时通过 Token、Policy Decision、Local Policy、Execution Grant 和 Agent 状态校验 |

`trust`、`support` 和签名状态是治理信息，不是执行授权。USER 插件不能因为声明 `OFFICIAL_SIGNED` 或 `COMMUNITY` 而跳过管理员启用；同样，USER 插件不会凭空产生权限审批记录。

## 2. 宿主能力合同

插件只能声明下表中的能力。每项能力的 `contractVersion`、`actionContractId`、风险等级、输入/输出 Schema、锁和执行位置必须与宿主注册表完全一致。

| 能力 | 业务用途 | 风险/幂等 | 权限 | 输入 → 输出 | 锁 | 注册表允许的执行位置 |
| --- | --- | --- | --- | --- | --- | --- |
| `application.discover` | 从主机发现应用资产 | LOW / 只读 | `application.read` | `gcac.application-discovery-input/v1` → `gcac.application-discovery/v1` | 无 | Agent、控制面、Gateway |
| `device.connection.test` | 验证设备地址和凭据是否可连接 | LOW / 只读 | `device.read` | `gcac.connection-test-input/v1` → `gcac.connection-test-result/v1` | 无 | Agent、控制面、Gateway |
| `device.identity.detect` | 确认设备产品族和软件身份 | LOW / 只读 | `device.read` | `gcac.device-identity-input/v1` → `gcac.device-identity-result/v1` | 无 | Agent、控制面、Gateway |
| `device.discover` | 发现框架、站点、目标、证书和绑定 | LOW / 只读 | `device.read` | `gcac.device-discovery-input/v1` → `gcac.device-discovery/v2` | DEVICE | Agent、控制面、Gateway |
| `credential.health-check` | 检测凭据能否认证关联设备并区分认证错误与设备不可达 | LOW / 只读 | `credential.read` | `gcac.credential-health-check-input/v1` → `gcac.credential-health-result/v1` | DEVICE | Agent、控制面、Gateway |
| `device.logs.read` | 查询设备或插件运行日志 | LOW / 只读 | `device.read` | `gcac.device-logs-query/v1` → `gcac.device-logs-page/v1` | 无 | Agent、控制面、Gateway |
| `certificate.discover` | 从设备发现证书及其绑定关系 | LOW / 只读 | `certificate.read` | `gcac.certificate-discovery-input/v1` → `gcac.device-discovery/v2` | DEVICE | Agent、控制面、Gateway |
| `certificate.verify` | 回读目标并确认当前证书 | MEDIUM / 只读 | `certificate.read` | `gcac.certificate-verify-input/v1` → `gcac.certificate-verify-result/v1` | TARGET | Agent、控制面、Gateway |
| `certificate.deploy` | 上传、切换并刷新目标证书 | HIGH / 幂等写 | `certificate.deploy` | `gcac.certificate-deploy-input/v1` → `gcac.certificate-deploy-result/v1` | TARGET | Agent、控制面、Gateway |
| `certificate.rollback` | 恢复部署前证书和目标配置 | HIGH / 幂等写 | `certificate.deploy` | `gcac.certificate-rollback-input/v1` → `gcac.certificate-deploy-result/v1` | TARGET | Agent、控制面、Gateway |
| `cloud.service.connection-test` | 验证云账号连接 | LOW / 只读 | `cloud.service.read` | `gcac.cloud-service-connection-test-input/v1` → `gcac.cloud-service-connection-test-result/v1` | 无 | Agent、控制面、Gateway |
| `cloud.service.discover` | 发现云账号下的资源 | LOW / 只读 | `cloud.service.read` | `gcac.cloud-service-discovery-input/v1` → `gcac.cloud-service-discovery-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.account.manage` | 创建、更新或停用 CA 账号 | HIGH / 幂等写 | `ca.account.manage` | `gcac.ca-account-input/v1` → `gcac.ca-account-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.order.manage` | 管理证书申请订单 | HIGH / 幂等写 | `ca.order.manage` | `gcac.ca-order-input/v1` → `gcac.ca-order-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.challenge.orchestrate` | 编排域名验证挑战 | HIGH / 幂等写 | `ca.challenge.manage` | `gcac.ca-challenge-input/v1` → `gcac.ca-challenge-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.challenge.dns-solver` | 写入和清理 DNS 验证记录 | HIGH / 幂等写 | `ca.challenge.manage` | `gcac.ca-dns-solver-input/v1` → `gcac.ca-dns-solver-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.certificate.issue` | 签发新证书 | HIGH / 幂等写 | `ca.certificate.manage` | `gcac.ca-certificate-issue-input/v1` → `gcac.ca-certificate-issue-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.certificate.renew` | 续期证书 | HIGH / 幂等写 | `ca.certificate.manage` | `gcac.ca-certificate-renew-input/v1` → `gcac.ca-certificate-renew-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.certificate.revoke` | 吊销证书 | HIGH / 幂等写 | `ca.certificate.manage` | `gcac.ca-certificate-revoke-input/v1` → `gcac.ca-certificate-revoke-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.certificate.query` | 查询 CA 证书及其状态 | MEDIUM / 只读 | `ca.operations.read` | `gcac.ca-certificate-query-input/v1` → `gcac.ca-certificate-query-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.revocation.evidence` | 查询证书吊销证据 | MEDIUM / 只读 | `ca.operations.read` | `gcac.ca-revocation-evidence-input/v1` → `gcac.ca-revocation-evidence-result/v1` | 无 | Agent、控制面、Gateway |
| `credential.acquire` | 在浏览器登录页面获取临时凭据 | HIGH / 只读 | `credential.create` | `gcac.credential-acquire-input/v1` → `gcac.credential-output/v1` | 无 | 控制面 |

幂等只代表宿主可以按相同幂等键安全处理重复请求，不代表可以忽略目标回读。非幂等或外部状态未知的写操作必须停止自动重放，交由执行记录和人工确认。

## 3. Runner Host API

代码型 Runner 只接收一个已经冻结的 `plugin.action`。正式协议标识为 `gcac.plugin-runner/v2`；仓库中的 `ipc-v1.schema.*` 和 `host-api-v1.schema.*` 是兼容历史文件名，文件 `$id` 和消息常量仍以 v2 为准。Runner 可以通过 IPC v2 请求以下 8 个 Host API；每次请求都必须携带至少一个 Grant 引用、幂等键、截止时间和当前步骤身份。

| Host API | 能做什么 | 重要限制 |
| --- | --- | --- |
| `cloudService.get` | 读取当前租户可见的 ACTIVE 云服务对象 | 只能读取当前插件获授权的云服务，不能枚举其他租户 |
| `artifact.grant.read` | 读取证书、私钥、证书链或其他制品 | 必须有 Artifact Grant；高风险、始终脱敏，单次输出最多 4 MB |
| `secret.grant.resolve` | 解析 `secret://` 引用 | 必须声明用途；只能在当前步骤和授权范围内使用 |
| `crypto.sign` | 使用授权私钥执行 `RS256` 或 `ES256` 签名 | 只返回签名结果，永远不返回私钥 |
| `crypto.hmac` | 使用授权 HMAC Secret 完成 HMAC 签名 | 密钥只在宿主解密边界内使用；可返回云厂商请求所需的公开标识，不返回 HMAC 密钥 |
| `http.request` | 访问已登记的 HTTPS 服务端点 | 支持 GET、POST、PUT、PATCH、DELETE、HEAD；普通 HTTP 被拒绝 |
| `execution.isCancelled` | 查询当前执行或步骤是否已取消 | 只读；发现取消后应停止后续外部写入 |
| `audit.append` | 追加脱敏审计事件 | 只能追加，不能修改或删除历史记录 |

Host API 的权限分别为 `cloud.service.get`、`artifact.read`、`secret.resolve`、`crypto.sign`、`crypto.hmac`、`network.http`、`execution.cancel.read`、`audit.append`。失败回执必须包含 `code`、`message`、`retryable`、`mayBeUnknown` 和 `secretRedacted: true`。

### Runner 生命周期

Runner 与一个租户和一个插件版本绑定。宿主先完成 `hello` 握手并比对包摘要、Manifest 摘要、资源摘要、能力和权限，再发送 `execute`。Runner 只能返回结构化 `output`、脱敏 `warnings` 和可选外部回执；不能发送 Workflow、rollback、checkpoint 或全局变量。

执行状态只有 `SUCCESS`、`FAILED`、`UNKNOWN`、`CANCELLED`。取消、超时、进程崩溃或晚到结果由宿主收敛，插件不得自行把 UNKNOWN 改写成成功。

### Runner Host API 精确合同

IPC `host_call` 的方法白名单只有以下 8 项。每次调用都要在 IPC 包络中提供 `grantRefs`、`idempotencyKey`、`deadlineAt`、`timeoutMs` 和当前步骤身份；方法输入还必须携带方法所需的 `grantId` 或引用。`timeoutMs` 不得超过方法注册上限，输出不得超过 `maxOutputBytes`。

| 方法 | 必要输入 | 成功数据 | Grant/权限 | 风险和外部状态 |
| --- | --- | --- | --- | --- |
| `cloudService.get` | `cloudServiceRef` | `gcac.cloud-service/v1` 的 ACTIVE 对象 | `cloud.service.get` | 只读，可重试 |
| `artifact.grant.read` | `grantId`、`artifactRef` | 受限 Artifact 内容/摘要 | `artifact.read` | HIGH，不自动重试 |
| `secret.grant.resolve` | `grantId`、`secretRef`、`purpose` | 临时 Secret 结果 | `secret.resolve` | CRITICAL，不自动重试 |
| `crypto.sign` | `grantId`、`secretRef`、`data`、`hashAlgorithm`、`signatureAlgorithm` | 签名结果，不返回私钥 | `crypto.sign` | CRITICAL，不自动重试 |
| `crypto.hmac` | `grantId`、`secretRef`、`publicValueRef`、`publicValuePlaceholder`、`data`、`hashAlgorithm` | `signatureBase64`、`publicValue` | `crypto.hmac` | CRITICAL；密钥只在宿主解密边界使用 |
| `http.request` | HTTPS `url`、`method`、`headers`，可选 `directoryUrl`、`body` | `statusCode`、`headers`、`body`、`bodyText` | `network.http` | HIGH；超时可能 UNKNOWN |
| `execution.isCancelled` | `executionId`、`executionStepId` | 取消状态 | `execution.cancel.read` / `execution.cancel` | 只读 |
| `audit.append` | `eventType`、`action`、`resourceType`、`resourceId`、`result` | `ok` | `audit.append` | 只追加，不可修改历史 |

所有失败结果必须符合以下结构，`secretRedacted` 固定为 `true`：

```json
{
  "ok": false,
  "error": {
    "code": "HOST_API_DENIED",
    "message": "Grant 不包含 network.http",
    "retryable": false,
    "mayBeUnknown": false,
    "details": { "method": "http.request" },
    "secretRedacted": true
  }
}
```

`crypto.hmac` 的 `publicValueRef` 是公开标识的 Secret 引用（例如 AccessKeyId），`secretRef` 是 HMAC 密钥；`publicValuePlaceholder` 必须出现在待签名 `data` 中。宿主返回公开值和签名，不返回密钥：

```json
{
  "grantId": "grant-cloud-1",
  "secretRef": "secret://api_token/access-key-secret#current",
  "publicValueRef": "secret://api_token/access-key-id#current",
  "publicValuePlaceholder": "__PUBLIC__",
  "data": "GET&/__PUBLIC__&Action=Describe&Timestamp=2026-08-24T00%3A00%3A00Z",
  "hashAlgorithm": "SHA-256",
  "keySuffix": "&signatureNonce"
}
```

禁止能力包括 `plugin.invoke`、`database.query`、`repository.call`、`filesystem.read/write`、`process.spawn/execute`、`agent.execute`、`execution.checkpoint.save/load` 和 `resourceLock.acquire/release`。Runner 不能通过未注册方法绕过这些限制。

## 4. Manifest 能力和资源

Manifest 固定根字段：

```json
{
  "apiVersion": "gcac.plugin-manifest/v1",
  "kind": "GcacPlugin"
}
```

必填业务信息包括 `pluginId`、SemVer `version`、显示名称和描述 Locale key、`publisher`、`runtime`、`source`、`scope`、`trust`、`support`、`capabilities`、`permissions`、`compatibility` 和 `resources`。

运行时只有：

- `AGENT_PLAN`：生成 Agent v2 计划，由宿主 Policy Authority、Execution Grant 和 Agent 本地策略共同授权。
- `WORKFLOW_DSL`：发布 `gcac.workflow/v1` 工作流，由宿主执行器控制步骤、锁、快照、回滚和恢复。

资源映射可以包含：

| 资源 | 用途 |
| --- | --- |
| `logos` | 横向和方形 SVG Logo；横向 viewBox 必须为 `0 0 72 48`，方形必须为 `0 0 72 72` |
| `runtimeEntrypoint` | 固定为 `runtime/index.js`，仅用于 Runner 例外入口 |
| `agentPlans` | Agent v2 计划模板 |
| `workflows` | 能力对应的 Workflow DSL |
| `inputContracts` | 变量、连接、凭据和 Artifact 输入合同 |
| `actionContracts` | Action 的输入输出和行为合同 |
| `forms` | 设备或高级配置表单；云账号接入不使用 Provider 专用表单 |
| `presentations` | 设备、应用、证书绑定或云资源展示 |
| `locales` | Locale 文案资源 |
| `discoveryMappings` | 控制面发现映射 |
| `agentDiscoveryMappings` | Agent 发现映射 |
| `onboarding` | 应用资产统一接入配方。当前阿里云 CDN 不声明此资源；它从 `/assets` 的添加资产界面复用 `DeviceOnboardingWizard.vue`，通过插件表单提交并由后端创建 `ServiceAsset(CLOUD_SERVICE)` |

包最多 500 个资源文件、总大小最多 20 MB。资源路径必须是包内相对路径；普通资源禁止 `.js/.mjs/.cjs/.ts/.tsx/.vue/.ps1/.sh/.bat/.cmd/.exe/.dll/.so/.dylib` 等可执行文件，只有固定 `runtime/index.js` 例外。Logo 禁止脚本、动画、外链、`foreignObject` 和外部图片。

### `credential.acquire` Manifest 合同

只有同时声明能力 `credential.acquire` 时才允许提供 `manifest.credentialAcquire`；反之提供该字段会被 Manifest Schema 拒绝。该能力固定在 `CONTROL_PLANE` 执行，输入和输出 Schema 由能力注册表绑定为 `gcac.credential-acquire-input/v1` 与 `gcac.credential-output/v1`。

能力注册表中的固定条目为 `credential.acquire / v1 / credential.acquire.v1 / HIGH / CONTROL_PLANE`；Manifest 中的实际 `credentialAcquire` 对象为：

```json
{
    "inputContractVersion": "gcac.credential-acquire-input/v1",
    "loginUrl": "https://login.example.test/sign-in",
    "allowedOrigins": ["https://login.example.test", "https://sso.example.test"],
    "output": {
      "version": "v1",
      "parameters": {
        "sessionId": {
          "secretType": "session_id",
          "required": true,
          "delivery": { "location": "cookie", "name": "session_id" }
        },
        "csrfToken": {
          "secretType": "api_token",
          "required": false,
          "delivery": { "location": "header", "name": "x-csrf-token" }
        }
      }
    }
  }
```

`loginUrl` 与每个 `allowedOrigins` 必须是 HTTP(S) URL；输出参数名只能使用英文标识符，`secretType` 只能是 `password`、`api_token`、`session_id`、`ssh_key`、`private_key` 或 `certificate_private_key`；投递位置只能是 `header`、`query`、`cookie`、`local_storage`、`session_storage`。至少声明一个输出参数。运行时会把登录 Origin 自动并入白名单，Origin 不匹配、TTL 小于 60 秒或超过 1 小时、未声明输出和多余输出都会失败关闭。

浏览器会话 API 为：

| 接口 | 用途和关键门禁 |
| --- | --- |
| `POST /api/v1/credentials/browser-sessions` | 创建会话；需要 `pluginVersionId`、凭据配置、分享密码，支持 `X-Idempotency-Key`，TTL 60-3600 秒 |
| `GET /api/v1/credentials/browser-sessions/:id` | 查询状态、固定插件版本/Workflow 版本、Origin 和输出参数名；不返回 Secret |
| `GET/POST /api/v1/credentials/browser-sessions/:id/connect` | 一次性临时 URL 和分享密码建立受控 VNC；仅允许合同 Origin |
| `GET /api/v1/credentials/browser-sessions/:id/vnc/:path*` | 代理 VNC 静态/WebSocket 资源，不暴露 Browser Runtime 端口 |
| `POST /api/v1/credentials/browser-sessions/:id/acquire` | 运行同一 BrowserContext 的 `browser` Workflow，严格校验输出合同并保存凭据版本 |
| `POST /api/v1/credentials/browser-sessions/:id/cancel` | 停止会话；已保存或已关闭会话不可恢复 |

## 5. 表单合同

通用表单协议为 `gcac.plugin-form/v1`。字段类型包括文本、多行文本、整数、小数、密码、Secret 引用、凭据引用、单选、多选、开关、日期时间、键值、对象列表、文件引用、证书引用、只读文本、提示和分隔线。

可直接复用的标准字段包括：

`connection.address`、`connection.port`、`connection.basePath`、`connection.timeoutSeconds`、`connection.gatewayId`、`authentication.mode`、`authentication.credentialId`、`authentication.clientCertificateRef`、`tls.enabled`、`tls.verifyPeer`、`tls.ignoreCertificateErrors`、`tls.serverName`、`tls.caSecretRef`、`tls.minimumVersion`、`device.displayName`、`device.description`、`device.tags`、`target.name`、`target.labels`。

表单可以声明分区、必填、默认值、校验、条件显示、条件启用、静态选项和低风险只读 Action 动态选项。凭据字段必须列出允许的凭据种类、Secret 类型、作用域和使用目的。

禁止用普通 `password` 字段保存密码；禁止没有用途的 `credential_ref`；禁止插件把标准敏感字段改成非敏感字段；动态选项不得调用高风险能力；字段条件不能形成循环。

## 6. 展示和标准对象

宿主接受四类展示资源：

- `gcac.device-presentation/v1`：设备概览、Framework、Site、证书绑定、日志和执行记录 Tab。
- `gcac.application-presentation/v1`：应用资产类型、档案、概览字段和动作。
- `gcac.certificate-binding-presentation/v1`：证书绑定详情字段和动作。
- `gcac.plugin-presentation/v1`：云资源列和敏感字段声明。

展示字段只能引用稳定 `valuePath`，类型为文本、数字、状态、时间、链接、徽章或只读文本。动作的 `capabilityKey` 必须是 Manifest 已声明的能力，不能在展示资源里创造新动作。

发现类能力使用 `gcac.device-discovery/v2`，必须返回稳定键以及设备、框架、站点、ManagedTarget、证书、证书绑定和警告之间的真实关系。证书路径、KeyStore、服务名等部署事实必须标记为资产事实；默认值不能伪装成发现结果。返回数组有数量上限，且不得包含密码、Secret、Token、私钥、Authorization 或 Cookie。

## 7. 接入配方和证书制品

接入配方使用版本化的 `gcac.application-onboarding` 合同，用于应用资产接入。设备资源使用 `MANAGED_TARGET`。当前阿里云 CDN 不使用该会话或配方；它由 `/assets` 的添加资产界面提交到兼容设备接入 API，后端创建 `ServiceAsset(CLOUD_SERVICE)`，并按 `serviceAssetId` 绑定 Framework/Site。插件不负责证书选择、部署、验证或回滚，也不得增加厂商专用入口。

证书部署输入合同按变量、连接、凭据和 Artifact Slot 分组。证书 Artifact 的标准输出角色包括 `leafPem`、`privateKeyPem`、`orderedChainPem`、`fingerprintSha256`、`pfxBase64` 和 `pfxPassword`。插件声明所需格式和输出角色，宿主负责制品生成、密码、链顺序、指纹和 Grant；插件只负责目标侧上传、切换、刷新和回读。

Tomcat `KEYSTORE` 插件的 `keystorePassword` 是可选 Credential Slot，只允许 `PASSWORD` 或兼容的
`USERNAME_PASSWORD`。密码优先级固定为“显式 Credential → Agent 从授权的 `configPath` 自动读取 → 失败关闭”；
显式 Credential 解析失败不得回退。Tomcat 运行材料不输出 `pfxPassword`，Agent 在写入前必须用同一密码打开
目标现有 KeyStore 和待写入 Artifact，确保产物密码与 Tomcat 当前配置一致。

## 8. 明确不开放的能力

以下能力不存在于宿主合同中，插件不得通过任何变体调用：

`plugin.invoke`、`database.query`、`repository.call`、`host.service.invoke`、`filesystem.read/write`、`process.spawn/execute`、`agent.execute`、`execution.checkpoint.save/load`、`resourceLock.acquire/release`。

插件不得读取宿主环境变量、数据库、文件、完整工作流对象或其他插件的 Grant，也不得把密钥写入日志、普通变量、Manifest、绑定或资源文件。

## 9. 宿主控制面接口索引

以下是开发和验收时会用到的正式接口，均受租户、角色和对象访问控制保护：

| 接口 | 用途 |
| --- | --- |
| `GET /api/v1/plugin-catalog` | 查询可见插件目录 |
| `POST /api/v1/plugin-catalog/refresh-builtins` | 刷新插件目录（内置包并导入当前租户用户插件） |
| `GET /api/v1/plugin-versions`、`GET /api/v1/plugin-version-groups` | 查询版本和版本分组 |
| `GET /api/v1/plugin-version-management/:pluginVersionId` | 查看导入、权限和状态详情 |
| `POST /api/v1/plugin-packages/import` | 导入 Manifest 和资源 |
| `POST /api/v1/plugin-versions/approve-permissions` | 审批权限 |
| `POST /api/v1/plugin-versions/enable`、`disable`、`retire` | 启用、禁用或退休版本 |
| `GET /api/v1/plugin-versions/upgrade-diff` | 比较两个版本的能力、权限和资源变化 |
| `GET /api/v1/plugin-form/standard-fields` | 查询标准表单字段 |
| `GET /api/v1/plugin-capabilities` | 查询宿主能力合同 |
| `GET /api/v1/plugin-versions/ui-resources` | 读取表单、展示和 Locale 资源 |
| `GET /api/v1/plugin-versions/:pluginVersionId/resources/logos/:variant` | 读取 Logo |
| `POST/GET/PATCH /api/v1/plugin-bindings` | 创建、查询和更新 Binding |
| `POST /api/v1/capability-assignments` | 设置能力指派 |
| `POST /api/v1/capability-assignments/resolve` | 查看某个目标最终采用的能力来源 |
| `/api/v1/cloud-account-assets/*` | 历史 CloudAccountAsset 兼容接口；当前仍注册读写、连接测试和发现，不得作为新云服务接入路径 |
| `GET /api/v1/managed-targets/:id/deployment-capabilities/:capabilityKey` | 查看受管目标生效能力 |
| `GET /api/v1/managed-targets/:id/compatible-plugins` | 查询兼容插件 |
| `POST /api/v1/managed-targets/:id/deployment-input-projection` | 生成应用资产部署输入投影 |
| `PUT /api/v1/application-assets/:applicationAssetId/managed-target` | 保存应用资产受管目标和插件覆盖 |
| `POST /api/v1/plugin-promotions/preview`、`confirm`、`revoke`；`GET /api/v1/plugin-promotions` | 预览、确认、撤销 Standalone 目标归集 |
| `GET /api/v1/plugin-runtime/metrics` | 查看 Runner 运行指标 |

### 9.1 环境、认证和通用请求约定

将 `https://<gcac-host>` 替换为实际控制面地址。控制面 API 使用 JSON；除 Logo 下载外，请求必须带 `Content-Type: application/json`。先用本地用户登录取得短期 Bearer Token：

```bash
curl -sS -X POST "$GCAC_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -H 'X-Request-Id: req-plugin-login' \
  -d '{"username":"<operator>","password":"<password>"}'
```

响应为 `{ "token": "…", "user": { … }, "permissions": [ … ] }`。后续请求使用 `Authorization: Bearer <token>`；多租户用户还必须把当前租户放在 `X-Tenant-Id`（只能选择 `/api/v1/tenants/accessible` 返回的租户），不能用伪造的租户头越权。`X-Actor-Id` 仅用于兼容测试夹具，生产调用以 Token 身份为准。

推荐请求头：

| 请求头 | 何时必填 | 规则 |
| --- | --- | --- |
| `Authorization` | 除登录和公开接口外 | `Bearer <token>`；Token 过期返回 `401 AUTH_UNAUTHENTICATED` |
| `X-Tenant-Id` | 当前 Token 可访问多个租户时 | 必须是可访问租户；缺失或过期返回 `403 TENANT_CONTEXT_INVALID`/`409 TENANT_CONTEXT_STALE` |
| `X-Request-Id` | 推荐 | 1-128 个字母、数字、`.`, `_`, `:`, `-`；响应会原样返回，便于审计关联 |
| `X-Trace-Id` | 可选 | 调用链追踪标识；响应会原样返回或由宿主生成 |
| `X-Idempotency-Key` | 创建会话、异步/外部写操作 | 同一租户和接口内必须稳定且不复用不同请求；重复相同请求返回原结果，内容不同返回 `409 IDEMPOTENCY_CONFLICT` |

所有时间字段在接口中使用 ISO 8601；前端展示时转换为浏览器本地时间。分页响应统一为 `{ items, page, pageSize, total }`。不要把 Token、Secret、Cookie、私钥或 Artifact 内容放进 URL、日志或普通变量。

### 9.2 插件版本生命周期：请求和响应字段

1. 查询能力合同，确认 `key`、`contractVersion`、权限、输入/输出 Schema 和执行位置：

```bash
curl -sS "$GCAC_URL/api/v1/plugin-capabilities" \
  -H "Authorization: Bearer $TOKEN" -H "X-Tenant-Id: $TENANT_ID"
```

2. 导入版本。`manifest` 是 JSON 对象，`resources` 必须提供（键为包内相对路径、值为文本/JSON），`packageContent` 是可选的整包摘要稳定 JSON 字符串。`packageContent` 不是 Base64 压缩包，也不能包含本机路径；资源映射始终以 `resources` 为准。下面只突出接口字段，`manifest` 的完整必填字段和 Workflow 资源必须替换为通过 Schema 校验的真实内容，不能直接提交占位字符串：

```bash
curl -sS -X POST "$GCAC_URL/api/v1/plugin-packages/import" \
  -H "Authorization: Bearer $TOKEN" -H "X-Tenant-Id: $TENANT_ID" \
  -H 'Content-Type: application/json' -H 'X-Request-Id: req-plugin-import' \
  -d '{
    "manifest": {
      "apiVersion": "gcac.plugin-manifest/v1", "kind": "GcacPlugin",
      "pluginId": "example.edge", "version": "1.0.0", "runtime": "WORKFLOW_DSL",
      "source": "USER", "scope": "MANAGED", "publisher": "Example",
      "capabilities": [{"key":"device.connection.test","contractVersion":"v1","actionContractId":"device.connection.test.v1","riskLevel":"LOW","executionLocations":["CONTROL_PLANE"]}],
      "permissions": ["device.read"], "resources": {"workflows":{"device.connection.test":"workflows/test.json"}}
    },
    "resources": {"workflows/test.json":"{\"apiVersion\":\"gcac.workflow/v1\"}"}
  }'
```

成功响应为 HTTP `201`，正文是 PluginVersion（至少包含 `id`、`pluginId`、`version`、`status`、`packageSha256`、`manifestSha256`、`resourceSha256`、`capabilities`）。保存返回的 `id`，后续只使用该 `pluginVersionId`。USER 插件导入后为 `DISABLED + NOT_REQUIRED`，不调用权限审批；BUILTIN 或需要审批的版本先审批声明权限：

```bash
curl -sS -X POST "$GCAC_URL/api/v1/plugin-versions/approve-permissions" \
  -H "Authorization: Bearer $TOKEN" -H "X-Tenant-Id: $TENANT_ID" -H 'Content-Type: application/json' \
  -d '{"pluginVersionId":"<pluginVersionId>","approvedPermissions":["device.read"]}'
```

启用、禁用、退休使用相同的请求体 `{ "pluginVersionId": "…" }`，分别调用 `/api/v1/plugin-versions/enable`、`disable`、`retire`。成功响应返回更新后的 PluginVersion；`enable` 只允许状态转换到 `ENABLED`，`retire` 是终态，不能重新启用。导入、审批或启用失败时先读取 `GET /api/v1/plugin-version-management/:pluginVersionId` 的 `validationReport`，不要重复提交相同版本。

### 9.3 Binding 和 Capability Assignment

Binding 保存输入引用和受管上下文，不保存明文 Secret。创建时 `inputBindings` 必须包含四个对象（没有值也传 `{}`）：

```bash
curl -sS -X POST "$GCAC_URL/api/v1/plugin-bindings" \
  -H "Authorization: Bearer $TOKEN" -H "X-Tenant-Id: $TENANT_ID" -H 'Content-Type: application/json' \
  -d '{
    "pluginVersionId":"<pluginVersionId>", "mode":"MANAGED",
    "inputBindings": {"apiVersion":"gcac.input-bindings/v1","variables":{},"connections":{},"credentials":{},"artifacts":{}},
    "managedContext": {"hostId":"<hostId>","managedTargetId":"<managedTargetId>"}
  }'
```

HTTP `200` 响应包含 `{ id, tenantId, pluginVersionId, mode, inputBindings, managedContext, status, version, createdAt, updatedAt }`。查询使用 `GET /api/v1/plugin-bindings?bindingId=<id>`。更新必须携带乐观锁版本：

```json
{
  "bindingId": "<bindingId>", "expectedVersion": 1,
  "inputBindings": {"apiVersion":"gcac.input-bindings/v1","variables":{},"connections":{},"credentials":{},"artifacts":{}},
  "status": "ACTIVE"
}
```

通过 `PATCH /api/v1/plugin-bindings` 提交；版本不匹配返回 `409 RESOURCE_VERSION_CONFLICT`，客户端必须重新读取后合并，禁止覆盖写。

将能力分配给目标时，`ownerType` 与 `ownerId` 必须指向当前租户可见对象，且 Binding 和 PluginVersion 必须属于同一租户/版本：

```bash
curl -sS -X POST "$GCAC_URL/api/v1/capability-assignments" \
  -H "Authorization: Bearer $TOKEN" -H "X-Tenant-Id: $TENANT_ID" -H 'Content-Type: application/json' \
  -d '{"ownerType":"MANAGED_TARGET","ownerId":"<managedTargetId>","capabilityKey":"certificate.deploy","pluginVersionId":"<pluginVersionId>","pluginBindingId":"<bindingId>","precedence":"TARGET_OVERRIDE"}'
```

成功响应包含 `id`、`status`、时间戳及上述输入字段。优先级只允许 `DEVICE_DEFAULT`、`TARGET_OVERRIDE`、`ASSET_OVERRIDE`；云服务必须使用 `SERVICE_ASSET`。解析最终来源时：

```bash
curl -sS -X POST "$GCAC_URL/api/v1/capability-assignments/resolve" \
  -H "Authorization: Bearer $TOKEN" -H "X-Tenant-Id: $TENANT_ID" -H 'Content-Type: application/json' \
  -d '{"capabilityKey":"certificate.deploy","managedTargetId":"<managedTargetId>"}'
```

返回 `null` 表示没有生效能力；非空结果是 `CapabilityAssignment` 记录，包含 `id`、所有者、`capabilityKey`、`pluginVersionId`、`pluginBindingId`、优先级、状态和时间戳。客户端应继续读取对应 PluginVersion 管理详情、Binding 和受管目标兼容插件接口，确认 PluginVersion 为 `ENABLED`、Binding 为 `ACTIVE`、执行位置和兼容性满足要求。

### 9.4 统一错误、状态码和重试

HTTP 错误正文统一为：

```json
{
  "errorCode":"RESOURCE_VERSION_CONFLICT",
  "message":"资源版本冲突",
  "details":{"expectedVersion":1,"actualVersion":2},
  "requestId":"req-plugin-1", "traceId":"trace-1", "timestamp":"2026-08-26T08:00:00Z"
}
```

常见状态码：`400 VALIDATION_FAILED`（字段不合法）、`401 AUTH_UNAUTHENTICATED`（缺 Token/过期）、`403 AUTH_FORBIDDEN` 或 `SEC_PERMISSION_DENIED`（无权限/对象越权）、`404 RESOURCE_NOT_FOUND`、`409 RESOURCE_ALREADY_EXISTS`/`RESOURCE_VERSION_CONFLICT`/`IDEMPOTENCY_CONFLICT`（冲突）、`422 PLUGIN_CONTRACT_INVALID`（合同或资源不合法）、`429`（限流，由部署网关产生）、`500 SYSTEM_INTERNAL_ERROR`、`502 PLUGIN_OPERATION_FAILED`、`503`（目标或 Runner 不可用）、`504 EXECUTION_TIMEOUT`。错误中的 `details` 已脱敏，不能依赖其中的 Secret。

只对网络断开前未产生外部写入、且错误明确标记可重试的只读请求自动重试；幂等写请求使用同一 `X-Idempotency-Key`。`UNKNOWN`、`202` 或 `mayBeUnknown=true` 表示外部状态可能已改变，必须先查询执行记录/目标回读，禁止换新幂等键盲目重放。

### 9.5 Runner IPC v2 最小实现

Runner 是宿主以固定绝对路径启动的子进程；stdin/stdout 使用 UTF-8 JSON Lines（每行一个 JSON 对象，禁止日志写 stdout；调试日志写 stderr）。每个对象都必须有 `protocolVersion: "gcac.plugin-runner/v2"`、`messageType`、唯一 `requestId`、`sentAt`。除 `hello` 外的消息必须复用宿主固定的 `pluginVersionId`、租户、Action 摘要和三份资源哈希。

最小握手和执行序列：

```json
{"protocolVersion":"gcac.plugin-runner/v2","messageType":"hello","requestId":"hello-1","sentAt":"2026-08-26T08:00:00Z","tenantId":"tenant-1","pluginVersionId":"pv-1","pluginId":"example.edge","pluginVersion":"1.0.0","runner":{"pid":1234,"sdkVersion":"1","runnerVersion":"1"},"capabilities":["device.connection.test"],"permissions":["device.read"],"packageHash":"sha256:<64hex>","manifestHash":"sha256:<64hex>","resourceHash":"sha256:<64hex>"}
{"protocolVersion":"gcac.plugin-runner/v2","messageType":"hello_result","requestId":"hello-1","sentAt":"2026-08-26T08:00:00Z","pluginVersionId":"pv-1","accepted":true,"pluginId":"example.edge","pluginVersion":"1.0.0","runnerVersion":"1","sdkVersion":"1","capabilities":["device.connection.test"],"permissions":["device.read"],"packageHash":"sha256:<64hex>","manifestHash":"sha256:<64hex>","resourceHash":"sha256:<64hex>"}
{"protocolVersion":"gcac.plugin-runner/v2","messageType":"execute","requestId":"exec-1","sentAt":"2026-08-26T08:00:01Z","pluginVersionId":"pv-1","tenantId":"tenant-1","executionId":"ex-1","executionStepId":"step-1","workflowVersionId":"wf-1","pluginId":"example.edge","capability":"device.connection.test","actionId":"device.connection.test","actionContractVersion":"v1","inputSchemaSha256":"sha256:<64hex>","outputSchemaSha256":"sha256:<64hex>","packageHash":"sha256:<64hex>","manifestHash":"sha256:<64hex>","resourceHash":"sha256:<64hex>","planDigest":"<64hex>","writeEffect":false,"grantRefs":["grant-1"],"idempotencyKey":"idem-1","deadlineAt":"2026-08-26T08:01:00Z","input":{"connectionRef":"conn-1"}}
{"protocolVersion":"gcac.plugin-runner/v2","messageType":"execute_result","requestId":"exec-1","sentAt":"2026-08-26T08:00:02Z","pluginVersionId":"pv-1","tenantId":"tenant-1","executionId":"ex-1","executionStepId":"step-1","workflowVersionId":"wf-1","pluginId":"example.edge","capability":"device.connection.test","actionId":"device.connection.test","actionContractVersion":"v1","inputSchemaSha256":"sha256:<64hex>","outputSchemaSha256":"sha256:<64hex>","packageHash":"sha256:<64hex>","manifestHash":"sha256:<64hex>","resourceHash":"sha256:<64hex>","planDigest":"<64hex>","writeEffect":false,"success":true,"status":"SUCCESS","output":{"reachable":true},"warnings":[]}
```

Runner 发起 Host API 时发送 `host_call`，字段除上述 Action 绑定外还必须有 `method`、`input`、至少一个 `grantRefs`、`idempotencyKey`、`deadlineAt`、`timeoutMs`（1-120000）；宿主以相同 `requestId` 返回 `host_result`，成功为 `{ "ok": true, "output": { … } }`，失败为 `{ "ok": false, "error": { "code", "message", "retryable", "mayBeUnknown", "secretRedacted": true } }`。Runner 只能调用 8 个已注册方法，不能扩展方法名。取消使用 `cancel.targetRequestId`，宿主回复 `cancel_result`；健康检查使用 `ping/pong`，排空使用 `shutdown/shutdown_result`。

以下字段必须原样比对，任一不一致宿主拒绝握手或执行：`pluginVersionId`、`pluginId`、`pluginVersion`、`capabilities`、`permissions`、`packageHash`、`manifestHash`、`resourceHash`、Action Contract 版本和输入/输出 Schema 摘要。Runner 不得并行执行两个 Action；超时、崩溃、取消或晚到结果由宿主收敛为 `FAILED`、`UNKNOWN` 或 `CANCELLED`。

浏览器凭据会话接口见 [`credential.acquire` 合同](#credentialacquire-manifest-合同)；它们使用 `credential.create` / `credential.read` RBAC，不属于插件 Runner Host API。

云服务至少绑定 `cloud.service.connection-test` 和 `cloud.service.discover`，且 `ownerType=SERVICE_ASSET`；证书签发、续期、吊销等能力必须按 CA 能力合同或 V1 DSL Workflow 使用，不能把证书生命周期偷偷挂到云服务识别绑定上。阿里云 CDN 从资产中心的“添加资产”动作复用 `DeviceOnboardingWizard.vue` 和 `/api/v1/devices/onboarding`，服务端保存 `ServiceAsset(assetKind=CLOUD_SERVICE)`，发现结果投影为 Framework/Site。当前插件不声明可执行管理端点，不能据此生成证书 ManagedTarget。`/providers` 不再作为二级菜单，但旧 CloudAccount 接口仍存在。

## 10. 应用资产统一接入会话

声明 `resources.onboarding` 后，插件可以接入应用资产统一会话。该会话用于应用资产和设备目标；当前阿里云 CDN 云服务不使用这套会话，不能把下面步骤套用到云服务资产：

1. `GET /api/v1/application-onboarding/platforms`：列出当前租户可用的平台和插件版本。
2. `POST /api/v1/application-onboarding/sessions`：以 `platformKey` 创建会话，必须带 `X-Idempotency-Key`。
3. `GET /api/v1/application-onboarding/sessions/:id/resources`：读取可用设备资源。
4. `POST /api/v1/application-onboarding/sessions/:id/resource-selection`：提交 `ResourceRef(kind,id)` 和通用资源字段，并带 `expectedStateVersion`；新设备进入标准设备接入。
5. `POST /api/v1/application-onboarding/sessions/:id/test`：执行连接测试。
6. `POST /api/v1/application-onboarding/sessions/:id/discover`：执行身份识别和发现，得到可选目标。
7. `POST /api/v1/application-onboarding/sessions/:id/target-selection`：提交 `TargetRef(kind,id,fingerprint)` 以及可选访问域名和验证地址。
8. `GET /api/v1/application-onboarding/sessions/:id/certificate-options`：读取符合配方格式的证书选项。
9. `POST /api/v1/application-onboarding/sessions/:id/certificate-selection`：精确提交 `certificateId` 和 `certificateVersionId`，或使用配方允许的最新有效版本。
10. `POST /api/v1/application-onboarding/sessions/:id/complete`：提交接入，按配方能力生成配置结果或 V1 DSL 部署计划。

所有写步骤都必须携带 `expectedStateVersion`，旧版本会被拒绝，防止用户在发现结果过期后误选目标。会话默认 30 分钟过期；提交中和已生成计划的会话不能取消。`DIRECT_WORKFLOW` 配方还必须同时存在同一插件版本的连接、发现和执行 Workflow，且目标必须是 ACTIVE 并提供真实端点；云资源若没有执行能力只能保存“已配置”，宿主不会接受绕过发现的地址、账号或密码。

### 应用接入配方 Schema

配方正文的完整字段如下；Manifest 只保存资源路径（`resources.onboarding.applicationAsset` 或 `applicationAssets`），Loader 会计算 `recipeHash` 并把 `pluginVersionId + recipeHash` 固定进会话：

```json
{
  "protocol": "gcac.application-onboarding/v1",
  "platformKey": "device.example",
  "displayNameKey": "plugin.example.name",
  "platformMetadata": {
    "capabilityVersion": "v1",
    "compatibilityKeys": ["plugin.example.compatibility"],
    "requiredInformationKeys": ["plugin.example.address", "plugin.example.credential"]
  },
  "supportStatus": "SUPPORTED",
  "deploymentMode": "MANAGED_TARGET",
  "deviceResourceType": "device.example",
  "deviceSelection": "EXISTING_OR_NEW",
  "newDeviceOnboarding": { "kind": "PLUGIN_MANAGED", "pluginId": "device.example" },
  "forms": { "device": "forms/device.json", "advanced": "forms/advanced.json" },
  "capabilities": {
    "connectionTest": "device.connection.test",
    "identity": "device.identity.detect",
    "discovery": "device.discover"
  },
  "targetProjection": {
    "targetType": "tls.binding",
    "frameworkTypes": ["web.example"],
    "displayFields": ["displayName", "endpoint.port", "frameworkType"],
    "identityFields": ["managedTargetId", "configFingerprint"],
    "selectableWhen": "selectable === true"
  },
  "deploymentDefaults": {
    "capabilityKey": "certificate.deploy",
    "variables": { "allowInsecureTls": false },
    "connections": { "management": { "port": 443 } },
    "credentials": { "management": { "credentialId": "credential-1" } },
    "certificateFormat": { "format": "PEM", "configName": "宿主默认 PEM Bundle" }
  },
  "certificate": {
    "acceptedFormats": ["PEM"],
    "requiredArtifacts": ["leaf", "privateKey"],
    "defaultVersion": "LATEST_VALID"
  },
  "commit": { "executionSource": "PLUGIN", "inputContract": "certificate.deploy.v1" }
}
```

字段约束：

| 字段 | 合同 |
| --- | --- |
| `deploymentMode=MANAGED_TARGET` | 必须有 `deviceResourceType`；`deviceSelection` 不能为 `NONE`；不能声明 `workflowExecution`；`commit.executionSource` 必须为 `PLUGIN` |
| `deploymentMode=DIRECT_WORKFLOW` | 不得有 `deviceResourceType` 或设备表单；必须声明 `workflowExecution`；`commit.executionSource` 必须为 `WORKFLOW`；宿主必须找到同版本连接、发现、执行三个已发布 Workflow |
| `deviceSelection=EXISTING_OR_NEW` | 必须有 `newDeviceOnboarding` 或设备表单；`AGENT_INSTALL` 只能打开统一 Agent/设备向导，插件不能自行注册 Agent |
| `targetProjection` | `targetType`、`displayFields`、`identityFields`、`selectableWhen` 必填；稳定身份至少包含 `managedTargetId` 和 `configFingerprint` |
| `certificate` | `acceptedFormats` 和 `requiredArtifacts` 非空；证书版本选择仍需提交精确 `certificateId + certificateVersionId` |
| `deploymentDefaults` | 仅适用于 `MANAGED_TARGET`，其 `capabilityKey` 必须由 Manifest 声明；默认值不能覆盖 `fixed` 输入 |

### 接入会话响应 Schema

`GET /sessions/:id` 返回以下字段；服务器可能根据阶段填充可选字段，不会返回密码、私钥或 Secret 明文：

```json
{
  "id": "onboard-1",
  "tenantId": "tenant-1",
  "actorId": "user-1",
  "platformKey": "device.example",
  "pluginVersionId": "plugin-version-1",
  "recipeHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "state": "TARGET_SELECTION_REQUIRED",
  "stateVersion": 4,
  "deploymentMode": "MANAGED_TARGET",
  "deviceId": "device-1",
  "assetId": "asset-1",
  "discoverySnapshotId": "snapshot-1",
  "targets": [{
    "managedTargetId": "target-1",
    "targetType": "tls.binding",
    "displayName": "example.test:443",
    "endpoint": { "host": "example.test", "port": 443, "protocol": "HTTPS" },
    "certificateStatus": "PRESENT",
    "configFingerprint": "fingerprint-1",
    "selectable": true
  }],
  "inputSnapshot": {},
  "idempotencyKey": "onboarding-unique-1",
  "createdAt": "2026-08-24T00:00:00.000Z",
  "updatedAt": "2026-08-24T00:05:00.000Z",
  "expiresAt": "2026-08-24T00:30:00.000Z"
}
```

合法状态包括 `CREATED`、`PLATFORM_SELECTED`、`RESOURCE_SELECTION_REQUIRED`、`DEVICE_INPUT_REQUIRED`、`DEVICE_ONBOARDING`、`WAITING_AGENT`、`CONNECTION_TESTING`、`DISCOVERING`、`TARGET_SELECTION_REQUIRED`、`CERTIFICATE_SELECTION_REQUIRED`、`READY_TO_COMMIT`、`COMMITTING`、`PLAN_CREATED`、`FAILED`、`CANCELLED`。`COMMITTING` 和 `PLAN_CREATED` 不可取消；过期会话收敛为 `FAILED`。

### 应用接入 API 索引

| 方法 | 请求关键字段 | 成功结果/阶段 |
| --- | --- | --- |
| `GET /api/v1/application-onboarding/platforms` | `locale` 可选 | 平台卡片、插件版本、Logo、业务元数据和证书格式；仅返回最高 ENABLED 版本 |
| `POST /api/v1/application-onboarding/sessions` | `{ platformKey }`，必须 `X-Idempotency-Key` | 201 + 固定 `pluginVersionId`、`recipeHash` 的会话 |
| `GET /api/v1/application-onboarding/sessions/:id` | 无 | 完整会话 Schema |
| `GET /api/v1/application-onboarding/sessions/:id/devices` | 无 | `{ items: OnboardingDeviceOptionDto[] }`；只列当前租户且通过能力健康检查的设备 |
| `POST /api/v1/application-onboarding/sessions/:id/resource-selection` | `expectedStateVersion`、`mode`；已有设备需 `deviceId`，新增设备需表单 `values` | 进入 `CONNECTION_TESTING` 或 `DEVICE_ONBOARDING`；新增设备调用 `credential.create` |
| `POST /api/v1/application-onboarding/sessions/:id/test` | `expectedStateVersion` | 连接成功进入 `DISCOVERING` |
| `POST /api/v1/application-onboarding/sessions/:id/discover` | `expectedStateVersion` | 发现真实目标并进入 `TARGET_SELECTION_REQUIRED` |
| `GET /api/v1/application-onboarding/sessions/:id/targets` | 无 | `{ items: OnboardingTargetOptionDto[] }` |
| `POST /api/v1/application-onboarding/sessions/:id/target-selection` | `expectedStateVersion`、`managedTargetId`、`configFingerprint`；可选 `accessDomain`、`verifyUrl`、`inputBindings` | 目标指纹复核后进入 `CERTIFICATE_SELECTION_REQUIRED` |
| `GET /api/v1/application-onboarding/sessions/:id/certificate-options` | `certificateAssetId` 可选 | 按配方 `acceptedFormats` 过滤的资产和版本 |
| `POST /api/v1/application-onboarding/sessions/:id/certificate-selection` | `expectedStateVersion`、`certificateId`、`certificateVersionId`、可选 `selectionMode=EXPLICIT/LATEST_AUTO` | 精确版本复核后进入 `READY_TO_COMMIT` |
| `POST /api/v1/application-onboarding/sessions/:id/complete` | `expectedStateVersion` | 生成应用资产、部署计划或执行记录，进入 `PLAN_CREATED` |
| `POST /api/v1/application-onboarding/sessions/:id/cancel` | `expectedStateVersion` | 进入 `CANCELLED`；提交中/完成后拒绝 |

所有写请求必须通过 `service_asset.manage`，读请求通过 `service_asset.read`；新建设备额外需要 `credential.create`。状态版本冲突必须重新读取会话，不能盲目重放。

## 11. Full Agent 事实边界

Full Agent 是 Web 服务器和主机运行事实的唯一采集入口。控制面通过 `agent.fact.collect` 向 Windows/Linux Full Agent 请求事实，Agent 返回带 TTL、摘要和警告的 `AgentFactEnvelopeV1`；插件只能消费宿主投影的 `gcac.device-discovery/v2` 和 `ManagedTarget`，不能直接读取 Agent 文件、进程或数据库。

事实允许的原子类型只有：

| 事实 | 允许字段 | 用途 |
| --- | --- | --- |
| `process` | PID、父 PID、绝对可执行路径、可选 SHA-256、脱敏命令行、启动时间 | 证明实际运行框架和版本入口 |
| `service` | 服务名、状态、可执行路径、启动类型 | 证明 Windows Service/systemd 运行状态 |
| `listening_port` | 地址、端口、协议、可选 PID | 证明监听端点 |
| `file_stat` / `file_content` | 绝对路径、存在性/大小/摘要；内容最多 64 KiB Base64 | 读取有效配置树和文件摘要；内容必须受限 |
| `certificate_file` / `certificate_store` | 路径/库、主题、指纹、有效期、是否有私钥 | 只上报证书公开摘要，不上报私钥 |
| `privilege` | Principal、是否提升、组 | 判断写入前权限边界 |

Full Agent 事实不得携带 `product`、`framework`、`provider`、`detected` 或 `deploymentSemantic` 等产品判断字段；产品映射由宿主投影器根据事实完成。Nginx、Apache、Tomcat、IIS 的框架、站点、TLS 绑定、证书路径、KeyStore、服务名和刷新方式必须来自真实进程、服务、监听端口、运行参数和有效配置树。插件不得：

- 自己扫描同一主机并建立第二条 Web Discovery 链；
- 以默认路径、默认站点、端口或厂商版本猜测缺失事实；
- 要求用户重新填写 Full Agent 已确认的部署路径、证书绑定或服务名；
- 把 Fixture、候选兼容性或静态 Manifest 当作现场发现成功。

Gateway Agent 与 Full Agent 是独立产品边界。Gateway 只提供中继连接，不产生 Full Agent 的 Web 事实；没有 `FULL_WEB_DISCOVERY` 事实和 `discoverySource=AGENT` 的目标，插件只能报告“未发现/待现场验证”，不能继续证书写入。

事实包示例（摘要字段必须由 Agent 实际计算，以下摘要仅为占位）：

```json
{
  "contractVersion": "gcac.agent-security/v1",
  "factId": "fact-1",
  "agentId": "agent-1",
  "tenantId": "tenant-1",
  "collectedAt": "2026-08-24T00:00:00.000Z",
  "ttlSeconds": 3600,
  "source": "windows",
  "facts": [
    { "kind": "process", "pid": 4321, "executablePath": "C:\\Program Files\\IIS\\iisexpress.exe" },
    { "kind": "service", "name": "W3SVC", "status": "running", "startType": "automatic" },
    { "kind": "listening_port", "address": "0.0.0.0", "port": 443, "protocol": "tcp", "pid": 4321 },
    { "kind": "certificate_store", "store": "My", "storeLocation": "LocalMachine", "subject": "CN=example.test", "thumbprint": "AA11", "hasPrivateKey": true }
  ],
  "digest": "3333333333333333333333333333333333333333333333333333333333333333",
  "warnings": []
}
```

## 12. Agent Plan、Token、Receipt、Artifact 和 Policy 合同

Agent v2 的动作集合固定为 `agent.fact.collect`、`agent.plan.validate`、`agent.plan.execute`、`agent.execution.receipt`。计划执行必须同时绑定同一 `planDigest` 的 Token、Policy Authority Decision、Agent Local Policy、KeySet、短期 Nonce 和 Artifact 摘要；插件不能签发其中任何授权材料。

### 12.1 Agent Plan 与操作

```json
{
  "planVersion": "gcac.agent-security/v1",
  "planId": "plan-1",
  "agentId": "agent-1",
  "tenantId": "tenant-1",
  "pluginId": "web.example",
  "pluginVersionId": "plugin-version-1",
  "capability": "certificate.deploy",
  "operations": [{
    "operationId": "op-install-1",
    "operationType": "certificate.store.install",
    "stage": "execute",
    "input": { "path": "/etc/example/cert.pem", "artifactDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "dependsOn": [],
    "idempotencyKey": "deploy-asset-version-1-target-1",
    "timeoutSeconds": 120
  }],
  "planDigest": "1111111111111111111111111111111111111111111111111111111111111111",
  "tokenId": "token-1",
  "policyDecisionId": "decision-1",
  "nonce": "nonce-1",
  "expiresAt": "2026-08-24T00:10:00.000Z",
  "writeEffect": true,
  "approvalRef": "approval-1"
}
```

每个操作必须有唯一 `operationId`、白名单 `operationType`、`stage`、对象 `input`、依赖数组、幂等键和 1-3600 秒超时；依赖图必须无环。计划摘要排除授权阶段生成的 Token/Decision/Nonce/过期时间，但包含审批引用和全部操作。`agent.plan.validate` 必须 `writeEffect=false`，`agent.plan.execute` 必须 `writeEffect=true`。

上例中的摘要和签名是文档占位值；真实计划必须按 `agent-security.contract.ts` 的 Canonical JSON 规则重新计算并由宿主/Agent 签发，不能直接复制。

### 12.2 Token 与 Policy Authority Decision

```json
{
  "tokenVersion": "gcac.agent-security/v1",
  "tokenId": "token-1",
  "agentId": "agent-1",
  "tenantId": "tenant-1",
  "pluginId": "web.example",
  "pluginVersionId": "plugin-version-1",
  "capability": "certificate.deploy",
  "actions": ["certificate.store.install"],
  "allowedPaths": ["/etc/example"],
  "allowedServices": ["example-service"],
  "artifactDigests": ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  "policyRef": "policy-1",
  "policyVersion": "2026-08-24.1",
  "issuedAt": "2026-08-24T00:00:00.000Z",
  "expiresAt": "2026-08-24T00:10:00.000Z",
  "nonce": "nonce-1",
  "planDigest": "1111111111111111111111111111111111111111111111111111111111111111",
  "authorityKeyId": "authority-key-1",
  "signature": "base64url-signature"
}
```

```json
{
  "decisionVersion": "gcac.agent-security/v1",
  "decisionId": "decision-1",
  "allowed": true,
  "agentId": "agent-1",
  "tenantId": "tenant-1",
  "pluginId": "web.example",
  "pluginVersionId": "plugin-version-1",
  "capability": "certificate.deploy",
  "actions": ["certificate.store.install"],
  "allowedPaths": ["/etc/example"],
  "allowedServices": ["example-service"],
  "artifactDigests": ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  "policyRef": "policy-1",
  "policyVersion": "2026-08-24.1",
  "planDigest": "1111111111111111111111111111111111111111111111111111111111111111",
  "tokenId": "token-1",
  "nonce": "nonce-1",
  "issuedAt": "2026-08-24T00:00:00.000Z",
  "validUntil": "2026-08-24T00:10:00.000Z",
  "authorityKeyId": "authority-key-1",
  "revocationRef": "revocation-1",
  "reason": "租户策略允许本次证书部署",
  "signature": "base64url-signature"
}
```

Token 和 Decision 的动作、路径、服务、Artifact 摘要必须分别与计划相交；任一集合超出范围、本地策略禁用、Key 被撤销或时间窗过期，Agent 必须拒绝执行。

### 12.3 Agent Receipt、Local Policy、KeySet、撤销和 Nonce

```json
{
  "receiptVersion": "gcac.agent-security/v1",
  "operationId": "op-install-1",
  "planId": "plan-1",
  "planDigest": "1111111111111111111111111111111111111111111111111111111111111111",
  "agentId": "agent-1",
  "tenantId": "tenant-1",
  "tokenId": "token-1",
  "status": "SUCCESS",
  "startedAt": "2026-08-24T00:00:01.000Z",
  "completedAt": "2026-08-24T00:00:04.000Z",
  "operationResults": [{ "operationId": "op-install-1", "status": "installed", "artifactDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
  "nonceConsumed": true,
  "digest": "2222222222222222222222222222222222222222222222222222222222222222",
  "agentKeyId": "agent-key-1",
  "signature": "base64url-agent-signature"
}
```

```json
{
  "policyVersion": "gcac.agent-security/v1",
  "agentId": "agent-1",
  "authorityKeyIds": ["authority-key-1"],
  "allowedActions": ["certificate.store.install"],
  "pathRules": [{ "prefix": "/etc/example", "operations": ["certificate.store.install"] }],
  "serviceRules": ["example-service"],
  "commandRules": [],
  "disabled": false,
  "updatedAt": "2026-08-24T00:00:00.000Z"
}
```

```json
{
  "keySetVersion": "gcac.agent-security/v1",
  "authorityId": "policy-authority-1",
  "activeKeyId": "authority-key-1",
  "keys": [{
    "keyId": "authority-key-1",
    "algorithm": "Ed25519",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\nBASE64\n-----END PUBLIC KEY-----",
    "status": "ACTIVE",
    "notBefore": "2026-08-23T00:00:00.000Z",
    "notAfter": "2026-09-23T00:00:00.000Z"
  }],
  "issuedAt": "2026-08-24T00:00:00.000Z"
}
```

撤销和一次性消费记录分别使用 `TokenRevocationRecordV1`、`DecisionRevocationRecordV1`、`NonceConsumptionRecordV1`，字段为版本、被撤销的 Token/Decision、Authority Key、原因、时间，Nonce 记录还必须含 `resultDigest`。同一 Nonce 不能成功消费两次。

### 12.4 Artifact Contract 与快照

Artifact 是宿主生成并授权的不可变制品，不是插件自己拼接的文件。输入合同中的 Artifact Slot 完整形态为：

```json
{
  "kind": "certificate",
  "required": true,
  "configurationMode": "required",
  "lifecycle": "runtime_injected",
  "artifactContract": {
    "outputs": {
      "leafPem": { "role": "leaf", "required": true, "format": "PEM", "encoding": "utf8", "sensitive": true },
      "privateKeyPem": { "role": "privateKey", "required": true, "format": "PEM", "encoding": "utf8", "sensitive": true },
      "orderedChainPem": { "role": "chain", "required": false, "format": "PEM", "encoding": "utf8", "sensitive": false },
      "fingerprintSha256": { "role": "fingerprint", "required": true, "format": "SHA-256", "encoding": "hex", "sensitive": false }
    }
  },
  "descriptionKey": "plugin.example.certificateArtifact"
}
```

执行阶段解析后的 Artifact 仅以引用和摘要进入快照：

```json
{
  "artifactId": "artifact-1",
  "outputs": {
    "leafPem": "artifact://artifact-1/leafPem",
    "privateKeyPem": "artifact://artifact-1/privateKeyPem",
    "orderedChainPem": "artifact://artifact-1/orderedChainPem",
    "fingerprintSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "artifactDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "certificateVersionId": "certificate-version-1",
  "certificateFormatId": "PEM"
}
```

私钥、PFX 密码、Secret 和 Token 不能写入 Plan、Receipt、普通变量、Manifest、Binding 或日志；Tomcat 的
`keystorePassword` 只在执行期短暂注入，不进入发现事实或普通快照。Runner 读取 Artifact 必须拥有
`artifact.read` Grant，读取 Secret 必须拥有用途明确的 `secret.resolve` Grant。

### 12.5 Agent 授权接口顺序

插件不直接签发 Token、Policy Decision 或本地策略。控制面在获得用户的 `deployment.plan.execute` 权限后，按以下顺序调用 Agent 接口；插件只提供 Manifest 中的计划和已计算的 `planDigest`：

1. **生成授权材料**：`POST /api/v1/agents/:agentId/policy-provisioning`。请求体必须包含 `pluginId`、`pluginVersionId`、`capability`、`planDigest`、`policyRef`、`policyVersion`、`actions`、`allowedPaths`、`allowedServices`、`commandRules`、`artifactDigests`、`lifetimeSeconds` 和完整 `compiledPlan`，可选 `approvalRef`。`lifetimeSeconds` 应尽可能短，且不能超过计划截止时间。成功返回 HTTP `201`，正文包含 Policy Authority 签发的 Token、Decision、Agent Local Policy、KeySet 和一次性 Nonce；这些对象只用于本次执行，不得持久化到插件。
2. **投递执行任务**：`POST /api/v1/agents/tasks`。请求体为 `agentId`、`executionRunId`、`executionStepId`、稳定 `idempotencyKey` 和 `payload`。`payload.actionType` 必须为 `agent.plan.validate` 或 `agent.plan.execute`，并携带同一 `planDigest` 的 `agentPlan`、`token`、`policyDecision`、`localPolicy`、`keySet`、`nonce` 和 Artifact 摘要。验证阶段 `writeEffect=false`，正式执行阶段 `writeEffect=true`。成功返回 HTTP `201` 的任务对象；不要自行修改任务状态。
3. **读取和回收**：通过 `GET /api/v1/agents/tasks?agentId=<id>` 或执行记录查询任务状态；Agent 通过 `POST /api/v1/agents/tasks/result` 回传签名 Receipt。Receipt 的 `planDigest`、`tokenId`、`nonce`、`agentId` 和每个 `operationId` 必须与原计划一致。`nonceConsumed=true` 后不得再次提交同一计划；失败、过期、撤销或签名不一致应收敛为 `FAILED`/`UNKNOWN`。

最小任务投递示例（授权对象使用上一步响应，以下值均为占位）：

```json
{
  "agentId":"agent-1",
  "executionRunId":"run-1",
  "executionStepId":"step-1",
  "idempotencyKey":"agent.plan.execute:run-1:step-1",
  "payload": {
    "actionType":"agent.plan.execute",
    "planDigest":"1111111111111111111111111111111111111111111111111111111111111111",
    "agentPlan": {"planId":"plan-1","planDigest":"1111111111111111111111111111111111111111111111111111111111111111"},
    "token": {"tokenId":"token-1","planDigest":"1111111111111111111111111111111111111111111111111111111111111111"},
    "policyDecision": {"decisionId":"decision-1","allowed":true,"planDigest":"1111111111111111111111111111111111111111111111111111111111111111"},
    "nonce":"nonce-1"
  }
}
```

Agent 接口的认证、租户和 `X-Request-Id` 约定与本节 9.1 相同；Agent mTLS 会话和注册令牌是 Agent 安装/心跳协议，插件不得复用或代管。

## 13. 完整 JSON Schema 与权威源码索引

以下机器 Schema 才是发布和验收入口；Markdown 示例只用于理解字段关系，不能替代它们：

| 范围 | Schema/源码 |
| --- | --- |
| Manifest、资源、`credentialAcquire` | `backend/src/modules/plugins/schema/unified-plugins.schema.ts`、`backend/src/modules/plugins/dto/unified-plugins.dto.ts` |
| 能力注册表（能力、权限、输入/输出 Schema ID、锁、执行位置） | `backend/src/modules/plugins/capabilities/plugin-capability.registry.ts` |
| Workflow DSL / Browser / `plugin.action` | `backend/src/modules/workflow-templates/schema/workflow-templates.schema.ts`、`backend/src/modules/workflow-templates/dto/workflow-templates.dto.ts` |
| Onboarding Recipe | `backend/src/modules/application-onboarding/recipe/application-onboarding-recipe.schema.ts`、`backend/src/modules/plugins/onboarding/application-onboarding-recipe.dto.ts` |
| Onboarding API 与 Session DTO | `backend/src/modules/application-onboarding/controller/application-onboarding.controller.ts`、`backend/src/modules/application-onboarding/dto/application-onboarding.dto.ts` |
| Browser Session API | `backend/src/modules/browser-runtime/browser-credential-session.controller.ts`、`backend/src/modules/browser-runtime/browser-credential-session.service.ts` |
| DeploymentInput / Artifact / Resolved Snapshot | `backend/src/modules/deployment-inputs/dto/deployment-input-contract.dto.ts`、`backend/src/modules/deployment-inputs/dto/resolved-deployment-input.dto.ts`、`backend/src/modules/deployment-inputs/schema/deployment-input-contract.schema.ts` |
| Agent Fact/Plan/Token/Decision/Receipt/Policy/KeySet | `backend/src/modules/agents/security/agent-security.contract.ts`、`backend/src/modules/agents/security/schemas/agent-security-v1.schema.json` |
| Policy Authority IPC/Provisioning/Service | `backend/src/modules/agents/security/schemas/policy-authority-ipc-v1.schema.json`、`policy-authority-provisioning-v1.schema.json`、`policy-authority-service-v1.schema.json` |
| Runner Host API 与 IPC | `backend/src/modules/plugins/runner/protocol/host-api.registry.ts`、`backend/src/modules/plugins/runner/protocol/schemas/host-api-v1.schema.json`、`backend/src/modules/plugins/runner/protocol/schemas/ipc-v1.schema.json` |

每次修改这些合同都要同步更新本页 `lastVerified`、对应项目规范和插件迭代说明；单元测试、Fixture 和 Schema 通过只证明静态合同，不证明 Agent、浏览器、外部 CA 或真实厂商现场成功。
