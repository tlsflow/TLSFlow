---
title: 插件开发
description: TLSFlow v1.0.0 插件包、宿主能力、绑定和完整交付流程
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
  - backend/src/modules/plugins/runner/plugin-runner-host-api.handler.ts
  - backend/src/modules/plugins/runner/protocol/protocol.types.ts
testRefs:
  - backend/src/modules/plugins/unified-plugins.test.ts
  - backend/src/modules/plugins/plugin-workflow-publisher.test.ts
  - backend/src/modules/plugins/plugin-form-and-presentation.test.ts
  - backend/src/modules/plugins/plugins-security.test.ts
lastVerified: 2026-09-04
---

# 插件开发

本页是从“我要交付一个可用插件”出发的操作流程。宿主能力的完整字段、权限和 Schema 见[宿主插件能力清单](./host-plugin-capabilities.md)；工作流步骤和失败恢复见[工作流开发规范](./workflow-development.md)。

插件的职责是描述产品差异并执行目标侧动作，宿主的职责是处理租户、权限、凭据、证书制品、输入快照、并发锁、审计、取消、回滚和生命周期。插件不能把宿主当成任意脚本执行器。

## 0. 可直接交付的包格式

用户插件采用目录包，不需要把源码编译进宿主。目录名可以与 `pluginId` 相同，包根必须有 `manifest.json`，Manifest 中每一个资源索引都必须指向包根下的 UTF-8 文本文件：

```text
data/plugins/device.example/
├── manifest.json
├── logos/logo.svg
├── logos/logo-square.svg
├── workflows/connection-test.json
├── workflows/discover.json
├── workflows/deploy.json
├── workflows/rollback.json
├── forms/device.json
├── presentations/device.json
├── locales/zh-CN.json
└── runtime/index.js                 # 仅声明 plugin.action 时需要
```

资源路径必须使用 `/`、不能是绝对路径、不能包含 `..`，也不能通过符号链接越出包目录。`resources` 是“包内相对路径”的映射，不是 URL；同一路径的内容按 UTF-8 和 LF 计算摘要。开发者可以把目录直接复制到 `data/plugins`，或把相同内容作为 API 的 `resources` 对象提交；API 导入时 `resources` 必填。API 的 `packageContent` 仅用于计算整包摘要，建议提交稳定 JSON 字符串：`{"manifest":<Manifest>,"resources":<资源原文映射>}`；不要提交 Base64 压缩包或本机路径。

## 0.1 API 认证、租户和通用约定

所有控制面请求都必须经过 GCAC 登录获得的访问令牌，并在 HTTPS 下发送：

```http
Authorization: Bearer <access-token>
Content-Type: application/json
X-Request-Id: <client-request-id>       # 可选；用于串联审计
X-Idempotency-Key: <unique-key>          # 创建会话或其他可重试写操作必填
```

令牌中的租户上下文决定可见的插件版本、Binding、资产和能力；插件开发者不能通过请求体伪造 `tenantId`。`X-Idempotency-Key` 必须在同一租户内对同一业务意图保持不变，重放时复用原键；不要把密码、Token、私钥或 Cookie 放入该键、URL 或日志。HTTP 2xx 表示请求已按接口合同接受，不代表目标设备写入已完成，必须继续读取执行记录和目标回执。

错误统一使用 JSON 对象（HTTP 状态码仍是首要判断）：

```json
{
  "errorCode": "VALIDATION_FAILED",
  "message": "插件请求包含未声明字段",
  "details": { "field": "manifest.resources" },
  "requestId": "req_01"
}
```

常见状态为 `400`（字段或 Schema 错误）、`401`（令牌缺失/过期）、`403`（租户或业务权限不足）、`404`（资源不属于当前租户或不存在）、`409`（版本摘要或 `expectedVersion` 冲突）、`422`（能力/兼容性/生命周期不满足）和 `500`（宿主内部错误）。收到 `409` 时必须重新 GET 当前记录再决定是否更新；收到执行超时或 `UNKNOWN` 时禁止盲目重放写操作。

## 0.2 生命周期 API 可复制示例

下面的示例使用 `$BASE_URL`、`$TOKEN`、`$PLUGIN_VERSION_ID` 和 `$BINDING_ID` 占位；真实值由环境和上一步响应提供。响应均为 JSON，时间字段为 ISO 8601，仅用于 API 传输。

开发前先读取宿主能力注册表和标准字段目录，不能凭能力名称猜合同：

```bash
curl "$BASE_URL/api/v1/plugin-capabilities" -H "Authorization: Bearer $TOKEN"
curl "$BASE_URL/api/v1/plugin-form/standard-fields" -H "Authorization: Bearer $TOKEN"
```

能力响应为 `{ "items": [{ "key", "contractVersion", "actionContractId", "riskLevel", "idempotency", "permission", "inputSchemaId", "outputSchemaId", "resourceLock", "executionLocations" }] }`；Manifest 必须逐项复制 `contractVersion`、`actionContractId`、风险、权限和执行位置。

导入一个用户插件（`manifest` 与 `resources` 必须与包目录内容一致）：

```bash
curl -X POST "$BASE_URL/api/v1/plugin-packages/import" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "X-Request-Id: req_import_01" \
  -d '{"manifest":{...},"resources":{"workflows/connection-test.json":"{...}"},"packageContent":"{...}"}'
```

成功响应为 `201`，关键字段如下：

```json
{
  "id": "uplgv_01", "pluginVersionId": "uplgv_01",
  "pluginId": "device.example", "version": "1.0.0",
  "source": "USER", "status": "DISABLED",
  "permissionApprovalStatus": "NOT_REQUIRED",
  "packageSha256": "sha256:<64位小写十六进制>",
  "manifestSha256": "sha256:<64位小写十六进制>",
  "resourceSha256": {"workflows/connection-test.json":"sha256:<64位小写十六进制>"},
  "validationReport": {"valid": true, "errors": [], "warnings": []}
}
```

内置包才提交权限审批；审批和启用都使用响应中的 `pluginVersionId`：

```bash
curl -X POST "$BASE_URL/api/v1/plugin-versions/approve-permissions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pluginVersionId":"'$PLUGIN_VERSION_ID'","approvedPermissions":["network.http","artifact.read"]}'
curl -X POST "$BASE_URL/api/v1/plugin-versions/enable" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pluginVersionId":"'$PLUGIN_VERSION_ID'"}'
```

两次成功响应均返回完整 `UnifiedPluginVersionRecord`，其中 `status` 应为 `ENABLED`，审批后 `permissionApprovalStatus` 为 `APPROVED`。USER 包跳过第一条审批请求，但仍必须显式调用启用。

创建 Binding 和能力指派：

```bash
curl -X POST "$BASE_URL/api/v1/plugin-bindings" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pluginVersionId":"'$PLUGIN_VERSION_ID'","mode":"MANAGED","inputBindings":{"apiVersion":"gcac.input-bindings/v1","variables":{"allowInsecureTls":false},"connections":{"management":{"host":"npm.example.test","port":443}},"credentials":{"credential":{"credentialId":"cred_01"}},"artifacts":{ }},"managedContext":{"hostId":"host_01","managedTargetId":"target_01"}}'
```

成功响应包含 `id`、`version: 1`、`status: "ACTIVE"` 和原样保存的 `inputBindings`；记录其 `id` 作为 `$BINDING_ID`。随后指派能力：

```bash
curl -X POST "$BASE_URL/api/v1/capability-assignments" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"ownerType":"MANAGED_TARGET","ownerId":"target_01","capabilityKey":"certificate.deploy","pluginVersionId":"'$PLUGIN_VERSION_ID'","pluginBindingId":"'$BINDING_ID'","precedence":"TARGET_OVERRIDE"}'
```

成功响应包含 `status: "ACTIVE"`、`ownerType/ownerId`、`capabilityKey`、`pluginVersionId` 和 `pluginBindingId`。用 `POST /api/v1/capability-assignments/resolve` 检查最终来源时，只发送一个资产定位字段，例如 `{"capabilityKey":"certificate.deploy","managedTargetId":"target_01"}`；返回 `null` 或完整的 `CapabilityAssignment` 记录。再读取该记录引用的插件版本、Binding 和受管目标兼容插件接口，确认版本为 `ENABLED`、Binding 为 `ACTIVE` 且兼容。

Binding 更新必须携带乐观锁版本：

```bash
curl -X PATCH "$BASE_URL/api/v1/plugin-bindings" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"bindingId":"'$BINDING_ID'","expectedVersion":1,"inputBindings":{"apiVersion":"gcac.input-bindings/v1","variables":{},"connections":{},"credentials":{},"artifacts":{}},"status":"ACTIVE"}'
```

成功后 `version` 递增；并发更新返回 `409`，必须重新读取 `GET /api/v1/plugin-bindings?bindingId=<id>`。查询 UI 资源使用 `GET /api/v1/plugin-versions/ui-resources?pluginVersionId=<id>&locale=zh-CN`，返回 `{ pluginVersionId, forms, presentations, locale }`。

## 1. 开始前的交付目录

先建立插件开发记录，并分别保存说明、测试证据和迭代记录。说明应写清支持的平台、能力组合、凭据要求和已验证版本；测试记录按插件实际声明的能力保存导入、连接、发现或证书部署/验证/回滚证据，云服务插件不要求也不得伪造证书部署证据。迭代记录一旦不再符合当前实现，必须删除或由现行文档替代，不能保留为“已废止”但可被误用的事实来源。

## 2. 选择插件形态

`runtime` 是 Manifest 的包级资源路由，不是“在哪台机器执行”的字段。执行位置由能力声明、目标兼容性、Workflow 中的步骤以及宿主生成的执行绑定共同决定。

| 场景 | Manifest `runtime` | 必需资源和执行路径 |
| --- | --- | --- |
| 只需固定的 HTTP/SSH/SFTP/SCP 步骤 | `WORKFLOW_DSL` | `resources.workflows`；由宿主 DSL Runtime 执行 |
| Workflow DSL 需要在 Agent 上执行类型化计划 | `WORKFLOW_DSL` | 同时提供 `resources.workflows` 和 `resources.agentPlans`；只有明确的 `agent.plan.*` 动作、Agent 执行位置和计划资源匹配时才走 Agent v2 |
| 包只提供显式 Agent Plan 路由 | `AGENT_PLAN` | `resources.agentPlans`；由宿主 Policy Authority、Execution Grant 和 Agent 本地策略共同授权 |
| 需要少量代码封装外部 API | `WORKFLOW_DSL` | DSL 中使用 `plugin.action`；`runtime/index.js` 只执行单个固定 Action，不能接管 Workflow 顺序 |

当前 Manifest 只接受 `AGENT_PLAN` 和 `WORKFLOW_DSL`。不要为了“灵活”携带任意脚本；普通资源不得包含可执行代码，Runner 入口只能是 `runtime/index.js`。`WORKFLOW_DSL` 与 `agentPlans` 可以共存，不能根据 `runtime` 字符串单独判断最终执行器。

## 3. 设计能力合同

1. 从宿主能力清单选择已有能力，确认风险等级、幂等性、锁、输入输出 Schema 和执行位置。
2. 为每项能力指定唯一 `actionContractId`，并在 Manifest 中原样填写宿主注册值。
3. 明确兼容性：`productFamilies`、`frameworkTypes`、`targetTypes`、`managementMethods`、`executionLocations` 和 `artifactContracts`。
4. 只申请完成业务所需的最小权限。`certificate.deploy` 能力合同本身要求注册表中的 `certificate.deploy` 权限；Workflow 还应按实际 Host API 调用声明 `secret.resolve`、`artifact.read`、`network.http` 和 `audit.append`。不要把 `device.write` 当作 `certificate.deploy` 的替代名称；Agent 计划则需要对应的 `agent.plan.*` 权限。
5. 为写操作设计目标回读和失败回滚。上传成功不能作为部署成功条件。

宿主通过能力指派解析插件，不按厂商字符串添加分支。一个应用资产最终可以覆盖设备、受管目标或默认能力，但解析顺序和租户边界由宿主固定。

## 4. 编写 Manifest

下面是一个“最小可校验包”的 Manifest 片段。它不是完整可运行插件：必须同时提供 `workflows/connection-test.json`，且该文件必须通过 Workflow Schema；资源路径必须与包内文件一一对应。

```json
{
  "apiVersion": "gcac.plugin-manifest/v1",
  "kind": "GcacPlugin",
  "pluginId": "device.example",
  "version": "1.0.0",
  "displayNameKey": "plugins.deviceExample.name",
  "descriptionKey": "plugins.deviceExample.description",
  "publisher": "Example",
  "runtime": "WORKFLOW_DSL",
  "source": "USER",
  "scope": "BOTH",
  "trust": "USER_SIGNED",
  "support": "COMMUNITY",
  "capabilities": [
    {
      "key": "device.connection.test",
      "contractVersion": "v1",
      "actionContractId": "device.connection.test.v1",
      "riskLevel": "LOW",
      "executionLocations": ["CONTROL_PLANE"]
    }
  ],
  "permissions": [],
  "compatibility": {},
  "resources": {
    "logos": { "horizontal": "logos/logo.svg", "square": "logos/logo-square.svg" },
    "workflows": {
      "device.connection.test": "workflows/connection-test.json"
    },
    "actionContracts": {},
    "forms": {},
    "presentations": {},
    "locales": {}
  }
}
```

关键规则：

- `version` 使用合法 SemVer；改能力、合同、工作流、表单或 Logo 都要递增版本。
- `source=BUILTIN` 只用于随代码发布的内置插件；用户包使用 `source=USER`。
- `scope` 为 `MANAGED`、`STANDALONE` 或 `BOTH`；Managed Binding 必须有 `hostId`、`serviceAssetId` 或历史兼容的 `cloudAccountAssetId`，Standalone Binding 不得保存 managedContext。旧 CloudAccount API 仍可能存在，不能因此描述为只读或已退役。
- `trust` 和 `support` 是包的治理声明，不是执行授权。`source=BUILTIN` 的内置包按内置策略处理权限；Agent Plan 形态使用 `runtime=AGENT_PLAN`，或在 `runtime=WORKFLOW_DSL` 下通过 `resources.agentPlans` 路由到 Agent 策略，不能把它写成额外的 Manifest `source`。USER 插件导入后保持 `DISABLED + NOT_REQUIRED`，不创建权限审批记录，只允许管理员显式启用。
- Manifest 至少声明一项能力，并为该能力提供对应 Workflow 或 Agent Plan 资源。
- `WORKFLOW_DSL` 至少声明一个非空 `resources.workflows`；`AGENT_PLAN` 至少声明一个非空 `resources.agentPlans`。两类资源可以同时存在。

## 5. 准备资源

### 5.1 Locale 和 Logo

表单、展示和 Manifest 文案全部使用 Locale key。只要包含表单或展示，就必须提供 Locale。Logo 必须是两个 SVG：横向 `viewBox="0 0 72 48"`，方形 `viewBox="0 0 72 72"`；不能使用脚本、外链图片、动画或 `foreignObject`。

Tomcat KeyStore 插件的密码字段必须声明为可选 Credential：优先使用 `PASSWORD`，兼容旧的
`USERNAME_PASSWORD`；未绑定时由 Agent 从目标配置自动读取，显式值错误或无法读取时都必须失败关闭。
密码不能写入发现事实、普通快照、Receipt、审计或日志；部署前还必须确认生成产物与目标现有 KeyStore
使用同一密码。

### 5.2 设备表单与凭据

设备优先复用标准字段。云服务资源从 `/assets` 的添加资产界面创建，Provider 可以在插件 Manifest 中声明 `resources.forms.cloud` 以提供凭据字段和校验规则；该表单由当前资产添加界面承载，不得新增独立云服务入口或 Provider CRUD。敏感信息使用 `credential_ref` 或 `secret_ref`，并声明允许的凭据种类、Secret 类型、作用域和目的。不要把密码设计成普通文本字段，也不要把 Token 放进默认值或占位符。

表单的动态选项只能调用低风险只读能力；条件显示和条件启用必须形成无环依赖。标准字段目录可以通过 `GET /api/v1/plugin-form/standard-fields` 查询。

### 5.3 展示

为设备、应用、证书绑定或云资源分别选择对应展示协议。字段使用稳定 `valuePath`，动作只引用已声明的能力。不要在展示资源里写产品特判或敏感字段值。

### 5.4 发现映射和接入配方

独立设备发现能力必须输出 `gcac.device-discovery/v2`，包含稳定键、真实父子关系、可用能力、ManagedTarget、证书和证书绑定。Nginx、Apache、Tomcat、IIS 的框架、站点、TLS 绑定和证书位置由 Windows/Linux Full Agent 从实际进程、服务、运行参数和有效配置树产生；证书更新插件只消费宿主投影结果，不得建立第二条发现链、猜测默认路径或要求用户填写 Agent 已确认的事实。具体边界见[宿主插件能力清单](./host-plugin-capabilities.md)。

应用接入配方使用 `gcac.application-onboarding/v1`，完整字段和校验规则见[宿主插件能力清单](./host-plugin-capabilities.md#应用接入配方-schema)。

当前阿里云 CDN 不使用 `gcac.application-onboarding/v2` 接入配方。它从 `/assets` 复用 `DeviceOnboardingWizard.vue`，经 `POST /api/v1/devices/onboarding` 提交插件表单；后端创建 `ServiceAsset(assetKind=CLOUD_SERVICE)`，以 `SERVICE_ASSET` 执行连接测试和资源发现。发现结果为 Framework 与 Site；插件不创建 Device/Host，不负责证书部署、验证或回滚，也不得实现独立模态框或 Provider CRUD 旁路。

## 6. 编写 Workflow 或 Agent Plan

### Workflow DSL

`WORKFLOW_DSL` 插件的每个能力都要在 Manifest `resources.workflows` 中映射到一个资源。资源根对象使用 `gcac.workflow/v1` 和 `CurlSshWorkflow`。当前标准 Step 类型为 `http`、`ssh`、`browser`、`sftp`、`scp`、`condition`、`transform`、`foreach`、`checkpoint`、`checkpoint_verify`、`wait`、`manual` 和 `plugin.action`。`plugin.execute` 仅属于旧的插件 Workflow Schema，不得用于当前标准 DSL。

`plugin.execute` 的旧 `PluginWorkflow` Schema 仍会被 `PluginWorkflowSchemaRegistry` 识别和校验，用于兼容历史资源的诊断；它不是当前可发布格式。发布阶段 `PluginWorkflowPublisherService` 会以 `PLUGIN_WORKFLOW_LEGACY_EXECUTOR_FORBIDDEN` 拒绝包级 `PluginWorkflow`，运行阶段 Dispatcher 也会再次失败关闭。迁移时把整个编排改为普通 `CurlSshWorkflow`，需要代码能力的单个步骤改为 `plugin.action`；Runner 只执行这个 Action，不接管 Workflow 顺序、rollback、checkpoint 或全局变量。

`browser` 只允许 `navigate`、`extract`、`verify` 三种动作；提取来源为 `cookie`、`header`、`local_storage`、`session_storage`、`url` 或 `text`，敏感结果只能按能力合同进入临时凭据。会话默认使用 `credentialAcquire.loginUrl`，用户或已有凭据可以显式提供 HTTPS 登录地址，宿主会将规范化后的登录 Origin 临时加入当前会话白名单；后续导航仍受该会话白名单限制。`plugin.action` 只能调用一个已固定版本的 Action，输入/输出 Schema 摘要、超时、写入效果和幂等键引用必须在步骤中声明；Runner 不接收 Workflow、rollback、checkpoint 或全局变量。禁止 Shell、PowerShell、任意命令执行和下载执行。

证书部署建议固定为：

```text
prepare → backup → install → refresh → verify
```

部署前保存旧证书 ID、配置路径或其他稳定标识；写入后回读目标实际证书指纹；失败时使用原始 WorkflowVersion 和输入快照回滚。超时或连接中断可能是 UNKNOWN，不能直接重放写请求。

### Agent Plan

`AGENT_PLAN` 或带 Agent Plan 的 `WORKFLOW_DSL` 插件必须提供能力对应的 `agentPlans`、`inputContracts` 和必要的 Workflow 入口。Agent v2 计划执行前由宿主校验计划摘要、PluginVersion 身份、Execution Grant、Agent Capability Token、Policy Authority Decision、Agent Local Policy、Artifact 摘要和 Nonce；插件不能自行签发 Token、Decision 或 Receipt。

证书更新计划必须绑定统一部署输入快照和 Artifact 摘要。`agent.plan.validate` 只能预演且 `writeEffect=false`；`agent.plan.execute` 必须 `writeEffect=true`。计划操作必须包含唯一 `operationId`、允许的 `operationType`、阶段、依赖、幂等键和超时，并形成无环依赖图。宿主只把已授权的计划交给 Agent，插件不能把私钥、密码或 Secret 明文写入计划 JSON。

## 7. 导入和启用

用户插件包放入 `data/plugins/<pluginId>/`（也可由 `GCAC_USER_PLUGIN_DATA_DIR` 指定），然后按以下顺序操作：

1. 使用 `POST /api/v1/plugin-packages/import` 提交 Manifest 和资源。
2. 检查返回的版本详情、资源缺失、能力合同和兼容性结果。
3. `source=BUILTIN` 按声明权限调用 `POST /api/v1/plugin-versions/approve-permissions`；`source=USER`（包括 USER Agent Plan）跳过该步骤，导入结果应为 `NOT_REQUIRED`。
4. 调用 `POST /api/v1/plugin-versions/enable` 启用明确版本；USER 插件也必须由管理员显式启用。
5. 通过 `GET /api/v1/plugin-versions/ui-resources` 检查表单、展示和 Locale。

导入时宿主会检查根字段、SemVer、能力注册、资源路径、资源数量和大小、Logo 安全性、表单/展示 Schema、Locale 引用以及输入合同。任何一项失败都应修包后递增版本重新导入，不要直接改已导入版本。

## 8. 创建 Binding 和能力指派

创建 Binding 时至少提供 `pluginVersionId`、`mode` 和 `inputBindings`。输入绑定分为变量、连接、凭据和 Artifact；凭据只写 `credentialId`，证书制品只写格式和输出映射。

```text
POST /api/v1/plugin-bindings
POST /api/v1/capability-assignments
```

Managed Binding 还要提供 `managedContext.hostId`、`managedContext.serviceAssetId` 或历史兼容的 `managedContext.cloudAccountAssetId`；可选 `managedTargetId` 用于限定目标。Standalone Binding 不能携带 managedContext。更新 Binding 时必须带 `expectedVersion`，遇到版本冲突应重新读取后再编辑。

能力指派的 `pluginBindingId` 和 `pluginVersionId` 必须相互匹配。云服务资产只能使用 `cloud.service.connection-test` 或 `cloud.service.discover`，并且插件 ID 必须等于云服务资产的 `providerKey`；能力所有者为 `SERVICE_ASSET`。

接入设备或应用资产后，用 `POST /api/v1/capability-assignments/resolve` 验证最终来源；部署前再用受管目标能力接口确认插件版本已启用、执行位置支持且兼容性通过。

### 设备/应用资产向导的完整顺序

如果插件声明了 `resources.onboarding`，开发者应按以下顺序验收真实接入：

1. `GET /api/v1/application-onboarding/platforms` 查看平台；宿主只展示最高的 ENABLED 版本。
2. `POST /api/v1/application-onboarding/sessions` 创建会话，并携带 `X-Idempotency-Key`。
3. `GET /api/v1/application-onboarding/sessions/:id` 读取会话状态和固定的 `pluginVersionId + recipeHash`。
4. `GET /api/v1/application-onboarding/sessions/:id/devices`，选择已有设备，或按配方跳转统一设备向导；新增设备还需要 `credential.create`。
5. `POST /resource-selection`，再调用 `/test` 完成连接测试。
6. 调用 `/discover`，再用 `GET /targets` 从真实发现结果选择目标。
7. 提交 `/target-selection` 时必须同时带 `managedTargetId` 和 `configFingerprint`，防止使用过期的发现结果。
8. 读取 `/certificate-options`，在 `/certificate-selection` 中提交精确的 `certificateId` 和 `certificateVersionId`。
9. 调用 `/complete` 生成计划或执行记录；用户主动退出时调用 `/cancel`，不能把已提交或已完成会话伪装成可取消。

每个写步骤都要带 `expectedStateVersion`；会话默认 30 分钟过期，过期或版本冲突必须重新读取状态后再操作。DIRECT_WORKFLOW 只有在连接、发现和执行三个 Workflow 都已发布且目标 ACTIVE 时才可进入接入流程。

### 云服务资产接入顺序

当前阿里云 CDN 的顺序为：`/assets → 添加资产 → DeviceOnboardingWizard.vue → 插件表单 → /api/v1/devices/onboarding → ServiceAsset → 连接测试 → 资源发现`。

云服务根对象是 `ServiceAsset(assetKind=CLOUD_SERVICE)`，发现结果按 `ServiceAsset → FrameworkInstance → SiteAsset` 投影；当前阿里云 CDN 不生成 Device、Host、证书绑定、部署计划或证书工作流。

## 9. 按能力类型验收

所有插件都必须完成包级合同、导入生命周期、Binding/Assignment、租户隔离、版本不可变、脱敏和幂等测试；能力级测试按实际声明选择，不得强行执行不适用的证书流程，并保存对应的测试证据。

| 能力族 | 必测内容 |
| --- | --- |
| `device.connection.test`、`device.identity.detect` | 真实端点/凭据边界、产品身份、失败脱敏和取消 |
| `device.discover`、`certificate.discover`、`application.discover` | 稳定键、真实父子关系、事实来源、数量上限、警告和重复发现幂等；Web 服务器必须验证 Full Agent 事实链 |
| `certificate.verify` | 目标回读、证书指纹、版本/配置漂移和 UNKNOWN 收敛 |
| `certificate.deploy`、`certificate.rollback` | Artifact Contract、次新证书版本、预演/正式执行、写后回读、失败补偿、回滚和 Receipt；只覆盖插件实际使用的 CONTROL_PLANE/GATEWAY/AGENT 通道 |
| `cloud.service.connection-test`、`cloud.service.discover` | 云账号租户隔离、`crypto.hmac`、公开标识与密钥分离、资源层级幂等；不要求证书部署 |
| `ca.*` | CA 账号/订单/挑战/签发/续期/吊销对应的真实协议、幂等、外部状态 UNKNOWN 和 Secret 脱敏 |
| `credential.acquire` | 独立 Browser Workflow、Origin 限制、同一 BrowserContext、输出合同、临时 `BROWSER_SESSION` 和未声明敏感输出丢弃 |
| `plugin.action` | Runner hello/execute、Action Binding 摘要、Host API Grant、取消、崩溃、UNKNOWN、迟到结果和资源限制 |

通用测试仍需覆盖：Manifest/资源路径/Logo/表单/展示/Locale/输入合同，导入、启用、禁用、退休，Binding 更新冲突，重复幂等键以及版本升级差异。单元测试和 Fixture 只能证明合同；真实厂商、Gateway、Agent、浏览器、外部 CA 和生产网络必须单独记录证据。没有现场证据，不要在插件说明中写成“所有版本兼容”。

## 10. 升级、禁用和退休

升级前用 `GET /api/v1/plugin-versions/upgrade-diff` 比较能力、权限、输入合同、资源摘要和兼容性。升级必须导入新 `pluginId + version`，旧版本保持不可变；现有 Binding 不会自动切换。

```bash
curl "$BASE_URL/api/v1/plugin-versions/upgrade-diff?fromVersionId=$OLD_ID&toVersionId=$PLUGIN_VERSION_ID" \
  -H "Authorization: Bearer $TOKEN"
curl -X POST "$BASE_URL/api/v1/plugin-versions/disable" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"pluginVersionId":"'$OLD_ID'"}'
curl -X POST "$BASE_URL/api/v1/plugin-versions/retire" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"pluginVersionId":"'$OLD_ID'"}'
```

升级差异响应包含 `addedCapabilities`、`removedCapabilities`、`addedPermissions`、`runtimeChanged`、`scopeChanged`、`compatibilityChanged`、`bindingRecheckRequired` 和 `requiresApproval`。`disable` 阻止新执行但保留记录；`retire` 表示不再允许继续使用，均返回更新后的版本记录。

确认新版本完成适用的能力测试后，再创建或更新 Binding 并重新指派能力。禁用版本会阻止新的执行；退休版本用于停止继续使用，旧执行记录仍保留。Runner 切换版本时由宿主先 Drain（排空）旧进程，再启动新版本，晚到结果不得覆盖新版本结果。

## 11. 常见失败判断

| 现象 | 正确处理 |
| --- | --- |
| 能力声明被拒绝 | 对照 `GET /api/v1/plugin-capabilities` 修正版本、合同、风险和执行位置 |
| 导入成功但无法启用 | 非 USER 包检查适用权限审批；USER 插件应为 `NOT_REQUIRED`；同时检查资源完整和 Workflow 是否已发布 |
| 找不到能力 | 检查版本是否 ENABLED、Binding 是否 ACTIVE、Assignment 是否属于当前租户和目标 |
| 连接成功但发现为空 | 检查发现输出是否符合 v2 和真实父子关系，不要添加默认目标 |
| 上传成功但部署失败 | 以目标回读验证为准，检查证书指纹和服务刷新结果 |
| 请求超时 | 查看执行记录；状态可能 UNKNOWN，禁止盲目重放写请求 |
| Runner 被拒绝 | 检查 hello 中的 PluginVersion、Manifest/资源摘要、能力和权限是否与宿主一致 |

完成以上步骤后，开发者应能只依赖 Manifest、资源合同和宿主控制面完成插件开发、导入、启用、绑定、测试、升级和发布；源码路径只作为实现者的追溯信息，不是插件使用前提。
