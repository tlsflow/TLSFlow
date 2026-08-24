---
title: 插件开发
description: TLSFlow v1.0.0 插件包、宿主能力、绑定和完整交付流程
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - docs/项目规范/20260819-插件开发流程规范.md
  - docs/项目规范/20260815-插件Manifest、Registry与Policy边界规范.md
  - specs/004-统一插件平台与厂商扩展治理
  - specs/004.5-插件进程隔离与宿主能力边界重构治理
codeRefs:
  - backend/src/modules/plugins
testRefs: []
lastVerified: 2026-08-23
---

# 插件开发

本页是从“我要交付一个可用插件”出发的操作流程。宿主能力的完整字段、权限和 Schema 见[宿主插件能力清单](./host-plugin-capabilities.md)；工作流步骤和失败恢复见[工作流开发规范](./workflow-development.md)。

插件的职责是描述产品差异并执行目标侧动作，宿主的职责是处理租户、权限、凭据、证书制品、输入快照、并发锁、审计、取消、回滚和生命周期。插件不能把宿主当成任意脚本执行器。

## 1. 开始前的交付目录

先建立插件开发记录目录：

```text
docs/插件开发/<pluginId>/
├── README.md
├── 测试文档/
└── 迭代说明/
```

`README.md` 写清支持的平台、能力组合、凭据要求和已验证版本；`测试文档/` 保存导入、连接、发现、部署、验证和回滚证据；每一轮修复必须在 `迭代说明/` 记录现象、原因、修改和验证结果后才能开始下一轮。

## 2. 选择插件形态

| 场景 | 建议运行时 | 适合的宿主能力 |
| --- | --- | --- |
| 只需固定的 HTTP/SSH/SFTP/SCP 步骤 | `WORKFLOW_DSL` | 连接测试、发现、证书部署、验证、回滚、云服务操作 |
| 需要 Agent v2 类型化计划 | `AGENT_PLAN` | Linux/Windows Agent 上的证书部署、验证和回滚 |
| 需要少量代码封装外部 API | `WORKFLOW_DSL` + 固定 Runner Action | 只把单个结构化 Action 交给 Runner，顺序和回滚仍由宿主掌控 |

当前 Manifest 不接受其他运行时名称。不要为了“灵活”携带任意脚本；普通资源不得包含可执行代码，Runner 入口只能是 `runtime/index.js`。

## 3. 设计能力合同

1. 从宿主能力清单选择已有能力，确认风险等级、幂等性、锁、输入输出 Schema 和执行位置。
2. 为每项能力指定唯一 `actionContractId`，并在 Manifest 中原样填写宿主注册值。
3. 明确兼容性：`productFamilies`、`frameworkTypes`、`targetTypes`、`managementMethods`、`executionLocations` 和 `artifactContracts`。
4. 只申请完成业务所需的最小权限。设备证书更新通常需要 `secret.resolve`、`artifact.read`、`network.http`、`device.write`、`audit.append`；Agent 计划则需要对应的 `agent.plan.*` 权限。
5. 为写操作设计目标回读和失败回滚。上传成功不能作为部署成功条件。

宿主通过能力指派解析插件，不按厂商字符串添加分支。一个应用资产最终可以覆盖设备、受管目标或默认能力，但解析顺序和租户边界由宿主固定。

## 4. 编写 Manifest

Manifest 的最小骨架如下，资源路径必须与包内文件一一对应：

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
  "capabilities": [],
  "permissions": [],
  "compatibility": {},
  "resources": {
    "logos": { "horizontal": "logos/logo.svg", "square": "logos/logo-square.svg" },
    "workflows": {},
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
- `scope` 为 `MANAGED`、`STANDALONE` 或 `BOTH`；Managed Binding 必须有 `hostId` 或 `cloudAccountAssetId`，Standalone Binding 不得保存 managedContext。
- `trust` 和 `support` 是包的治理声明，不是绕过权限审批的证明。用户包仍需权限审批和启用。
- Manifest 至少声明一项能力，并为该能力提供对应 Workflow 或 Agent Plan 资源。

## 5. 准备资源

### 5.1 Locale 和 Logo

表单、展示和 Manifest 文案全部使用 Locale key。只要包含表单或展示，就必须提供 Locale。Logo 必须是两个 SVG：横向 `viewBox="0 0 72 48"`，方形 `viewBox="0 0 72 72"`；不能使用脚本、外链图片、动画或 `foreignObject`。

### 5.2 表单

设备和云账号优先复用标准字段。敏感信息使用 `credential_ref` 或 `secret_ref`，并声明允许的凭据种类、Secret 类型、作用域和目的。不要把密码设计成普通文本字段，也不要把 Token 放进默认值或占位符。

表单的动态选项只能调用低风险只读能力；条件显示和条件启用必须形成无环依赖。标准字段目录可以通过 `GET /api/v1/plugin-form/standard-fields` 查询。

### 5.3 展示

为设备、应用、证书绑定或云资源分别选择对应展示协议。字段使用稳定 `valuePath`，动作只引用已声明的能力。不要在展示资源里写产品特判或敏感字段值。

### 5.4 发现映射和接入配方

设备发现必须输出 `gcac.device-discovery/v2`，包含稳定键、真实父子关系、可用能力、ManagedTarget、证书和证书绑定。应用接入配方使用 `gcac.application-onboarding/v1`，声明统一向导所需的设备选择、发现、目标投影、证书格式和提交来源。

## 6. 编写 Workflow 或 Agent Plan

### Workflow DSL

`WORKFLOW_DSL` 插件的每个能力都要在 Manifest `resources.workflows` 中映射到一个资源。资源根对象使用 `gcac.workflow/v1` 和 `CurlSshWorkflow`，每个插件 Action 只能通过 `plugin.execute` 步骤引用已声明的能力。可用步骤为 HTTP、SSH、SFTP、SCP、条件、转换、循环、检查点、检查点验证、等待和人工确认；禁止 Shell、PowerShell、任意命令执行和下载执行。

证书部署建议固定为：

```text
prepare → backup → install → refresh → verify
```

部署前保存旧证书 ID、配置路径或其他稳定标识；写入后回读目标实际证书指纹；失败时使用原始 WorkflowVersion 和输入快照回滚。超时或连接中断可能是 UNKNOWN，不能直接重放写请求。

### Agent Plan

`AGENT_PLAN` 插件必须同时提供能力对应的 `agentPlans`、`inputContracts` 和必要的 Workflow 入口。Agent v2 计划执行前由宿主校验计划摘要、PluginVersion 身份、Execution Grant、Agent 本地策略和 Policy Authority 决策；插件不能自行签发 Token 或 Decision。

证书更新计划必须绑定统一部署输入快照和 Artifact 摘要。`agent.plan.validate` 只能预演且 `writeEffect=false`；`agent.plan.execute` 必须 `writeEffect=true`。宿主只把已授权的计划交给 Agent，插件不能把私钥或密码写入计划 JSON。

## 7. 导入和启用

用户插件包放入 `data/plugins/<pluginId>/`（也可由 `GCAC_USER_PLUGIN_DATA_DIR` 指定），然后按以下顺序操作：

1. 使用 `POST /api/v1/plugin-packages/import` 提交 Manifest 和资源。
2. 检查返回的版本详情、资源缺失、能力合同和兼容性结果。
3. 审核权限说明，调用 `POST /api/v1/plugin-versions/approve-permissions`。
4. 调用 `POST /api/v1/plugin-versions/enable` 启用明确版本。
5. 通过 `GET /api/v1/plugin-versions/ui-resources` 检查表单、展示和 Locale。

导入时宿主会检查根字段、SemVer、能力注册、资源路径、资源数量和大小、Logo 安全性、表单/展示 Schema、Locale 引用以及输入合同。任何一项失败都应修包后递增版本重新导入，不要直接改已导入版本。

## 8. 创建 Binding 和能力指派

创建 Binding 时至少提供 `pluginVersionId`、`mode` 和 `inputBindings`。输入绑定分为变量、连接、凭据和 Artifact；凭据只写 `credentialId`，证书制品只写格式和输出映射。

```text
POST /api/v1/plugin-bindings
POST /api/v1/capability-assignments
```

Managed Binding 还要提供 `managedContext.hostId` 或 `managedContext.cloudAccountAssetId`；可选 `managedTargetId` 用于限定目标。Standalone Binding 不能携带 managedContext。更新 Binding 时必须带 `expectedVersion`，遇到版本冲突应重新读取后再编辑。

能力指派的 `pluginBindingId` 和 `pluginVersionId` 必须相互匹配。云账号只能使用 `cloud.service.connection-test` 或 `cloud.service.discover`，并且插件 ID 必须等于云账号资产的 `providerKey`。

接入设备或应用资产后，用 `POST /api/v1/capability-assignments/resolve` 验证最终来源；部署前再用受管目标能力接口确认插件版本已启用、执行位置支持且兼容性通过。

### 应用资产向导的完整顺序

如果插件声明了 `resources.onboarding`，开发者应按以下顺序验收真实接入：

1. `GET /api/v1/application-onboarding/platforms` 查看平台；宿主只展示最高的 ENABLED 版本。
2. `POST /api/v1/application-onboarding/sessions` 创建会话，并携带 `X-Idempotency-Key`。
3. 读取 `/sessions/:id/devices`，选择已有设备，或按配方跳转统一设备向导；新增设备还需要 `credential.create`。
4. 提交 `/resource-selection`，再调用 `/test` 完成连接测试。
5. 调用 `/discover`，从真实发现结果选择目标。
6. 提交 `/target-selection` 时必须同时带 `managedTargetId` 和 `configFingerprint`，防止使用过期的发现结果。
7. 读取 `/certificate-options`，在 `/certificate-selection` 中提交精确的 `certificateId` 和 `certificateVersionId`。
8. 调用 `/complete` 生成计划或执行记录。

每个写步骤都要带 `expectedStateVersion`；会话默认 30 分钟过期，过期或版本冲突必须重新读取状态后再操作。DIRECT_WORKFLOW 只有在连接、发现和执行三个 Workflow 都已发布且目标 ACTIVE 时才可进入接入流程。

## 9. 端到端测试顺序

每个插件至少完成以下测试，并把结果写入 `docs/插件开发/<pluginId>/测试文档/`：

1. Manifest、资源路径、Logo、表单、展示、Locale 和输入合同校验。
2. 导入、权限审批、启用、禁用和退休。
3. Binding 创建、更新、租户隔离和能力解析。
4. 设备或云账号连接测试。
5. 身份识别和发现，确认稳定键、目标关系、证书和警告。
6. 证书制品解析，确认格式、链顺序、指纹和敏感字段仅以引用出现。
7. 预演、正式部署、目标回读验证。
8. 在上传失败、切换失败、回读失败、取消、超时和进程崩溃时验证回滚或 UNKNOWN 收敛。
9. 重复相同幂等键，确认宿主重放已有结果而不是重复外部写入。

单元测试和 Fixture 只能证明合同；真实厂商版本、网络策略、Gateway、Agent 和外部 CA 必须在目标环境单独验收。没有现场证据，不要在插件说明中写成“所有版本兼容”。

## 10. 升级、禁用和退休

升级前用 `GET /api/v1/plugin-versions/upgrade-diff` 比较能力、权限、输入合同、资源摘要和兼容性。升级必须导入新 `pluginId + version`，旧版本保持不可变；现有 Binding 不会自动切换。

确认新版本完成连接、发现和证书流程测试后，再创建或更新 Binding 并重新指派能力。禁用版本会阻止新的执行；退休版本用于停止继续使用，旧执行记录仍保留。Runner 切换版本时由宿主先 Drain（排空）旧进程，再启动新版本，晚到结果不得覆盖新版本结果。

## 11. 常见失败判断

| 现象 | 正确处理 |
| --- | --- |
| 能力声明被拒绝 | 对照 `GET /api/v1/plugin-capabilities` 修正版本、合同、风险和执行位置 |
| 导入成功但无法启用 | 检查权限是否已审批、资源是否完整、Workflow 是否已发布 |
| 找不到能力 | 检查版本是否 ENABLED、Binding 是否 ACTIVE、Assignment 是否属于当前租户和目标 |
| 连接成功但发现为空 | 检查发现输出是否符合 v2 和真实父子关系，不要添加默认目标 |
| 上传成功但部署失败 | 以目标回读验证为准，检查证书指纹和服务刷新结果 |
| 请求超时 | 查看执行记录；状态可能 UNKNOWN，禁止盲目重放写请求 |
| Runner 被拒绝 | 检查 hello 中的 PluginVersion、Manifest/资源摘要、能力和权限是否与宿主一致 |

完成以上步骤后，开发者应能只依赖 Manifest、资源合同和宿主控制面完成插件开发、导入、启用、绑定、测试、升级和发布；源码路径只作为实现者的追溯信息，不是插件使用前提。
