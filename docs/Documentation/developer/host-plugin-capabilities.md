---
title: 宿主插件能力清单
description: TLSFlow v1.0.0 宿主向插件系统开放的能力、合同、资源和安全边界
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - docs/项目规范/20260819-插件开发流程规范.md
  - docs/项目规范/20260815-插件Manifest、Registry与Policy边界规范.md
  - docs/项目规范/20260723-工作流模板管理及编写规范.md
codeRefs:
  - backend/src/modules/plugins
testRefs: []
lastVerified: 2026-08-23
---

# 宿主插件能力清单

本页是插件开发的能力字典。它把宿主已经实现的能力、输入输出合同、权限、执行位置和限制集中列出。开发者只需要根据本页选择能力并准备资源，不需要通过猜测源码来调用未公开的服务。

## 1. 先理解四个概念

- **插件版本**：Manifest（插件清单）和资源组成的不可变包，唯一由 `pluginId + version` 标识。任何资源变更都必须递增版本。
- **Binding（绑定）**：把一个插件版本与连接、凭据、证书制品和受管上下文关联起来。Binding 保存引用，不保存密码、私钥或明文 Token。
- **Capability Assignment（能力指派）**：把某项能力分配给设备、ManagedTarget（受管目标）、应用资产或云账号。宿主按“应用资产 → 云账号 → 受管目标 → 设备”的顺序解析。
- **Grant（授权票据）**：某一次执行、某一个步骤的临时授权。它绑定租户、操作者、插件版本、目标和有效期，插件不能转交或长期保存。

执行链始终是：

```text
Manifest 能力声明
  → 插件版本导入和校验
  → 权限审批与启用
  → Plugin Binding
  → Capability Assignment
  → 输入合同解析和快照
  → Workflow 或 Agent Plan 执行
  → 目标回读验证、审计和结果收敛
```

## 2. 宿主能力合同

插件只能声明下表中的能力。每项能力的 `contractVersion`、`actionContractId`、风险等级、输入/输出 Schema、锁和执行位置必须与宿主注册表完全一致。

| 能力 | 业务用途 | 风险/幂等 | 权限 | 输入 → 输出 | 锁 | 默认执行位置 |
| --- | --- | --- | --- | --- | --- | --- |
| `application.discover` | 从主机发现应用资产 | LOW / 只读 | `application.read` | `gcac.application-discovery-input/v1` → `gcac.application-discovery/v1` | 无 | Agent、控制面 |
| `device.connection.test` | 验证设备地址和凭据是否可连接 | LOW / 只读 | `device.read` | `gcac.connection-test-input/v1` → `gcac.connection-test-result/v1` | 无 | Agent、控制面、Gateway |
| `device.identity.detect` | 确认设备产品族和软件身份 | LOW / 只读 | `device.read` | `gcac.device-identity-input/v1` → `gcac.device-identity-result/v1` | 无 | Agent、控制面、Gateway |
| `device.discover` | 发现框架、站点、目标、证书和绑定 | LOW / 只读 | `device.read` | `gcac.device-discovery-input/v1` → `gcac.device-discovery/v2` | DEVICE | Agent、控制面、Gateway |
| `device.logs.read` | 查询设备或插件运行日志 | LOW / 只读 | `device.read` | `gcac.device-logs-query/v1` → `gcac.device-logs-page/v1` | 无 | Agent、控制面、Gateway |
| `certificate.discover` | 从设备发现证书及其绑定关系 | LOW / 只读 | `certificate.read` | `gcac.certificate-discovery-input/v1` → `gcac.device-discovery/v2` | DEVICE | Agent、控制面、Gateway |
| `certificate.verify` | 回读目标并确认当前证书 | MEDIUM / 只读 | `certificate.read` | `gcac.certificate-verify-input/v1` → `gcac.certificate-verify-result/v1` | TARGET | Agent、控制面、Gateway |
| `certificate.deploy` | 上传、切换并刷新目标证书 | HIGH / 幂等写 | `certificate.deploy` | `gcac.certificate-deploy-input/v1` → `gcac.certificate-deploy-result/v1` | TARGET | Agent、控制面、Gateway |
| `certificate.rollback` | 恢复部署前证书和目标配置 | HIGH / 幂等写 | `certificate.deploy` | `gcac.certificate-rollback-input/v1` → `gcac.certificate-deploy-result/v1` | TARGET | Agent、控制面、Gateway |
| `cloud.service.connection-test` | 验证云账号连接 | LOW / 只读 | `cloud.service.read` | `gcac.cloud-service-connection-test-input/v1` → `gcac.cloud-service-connection-test-result/v1` | 无 | 控制面 |
| `cloud.service.discover` | 发现云账号下的资源 | LOW / 只读 | `cloud.service.read` | `gcac.cloud-service-discovery-input/v1` → `gcac.cloud-service-discovery-result/v1` | 无 | 控制面 |
| `ca.account.manage` | 创建、更新或停用 CA 账号 | HIGH / 幂等写 | `ca.account.manage` | `gcac.ca-account-input/v1` → `gcac.ca-account-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.order.manage` | 管理证书申请订单 | HIGH / 幂等写 | `ca.order.manage` | `gcac.ca-order-input/v1` → `gcac.ca-order-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.challenge.orchestrate` | 编排域名验证挑战 | HIGH / 幂等写 | `ca.challenge.manage` | `gcac.ca-challenge-input/v1` → `gcac.ca-challenge-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.challenge.dns-solver` | 写入和清理 DNS 验证记录 | HIGH / 幂等写 | `ca.challenge.manage` | `gcac.ca-dns-solver-input/v1` → `gcac.ca-dns-solver-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.certificate.issue` | 签发新证书 | HIGH / 幂等写 | `ca.certificate.manage` | `gcac.ca-certificate-issue-input/v1` → `gcac.ca-certificate-issue-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.certificate.renew` | 续期证书 | HIGH / 幂等写 | `ca.certificate.manage` | `gcac.ca-certificate-renew-input/v1` → `gcac.ca-certificate-renew-result/v1` | 无 | Agent、控制面、Gateway |
| `ca.certificate.revoke` | 吊销证书 | HIGH / 幂等写 | `ca.certificate.manage` | `gcac.ca-certificate-revoke-input/v1` → `gcac.ca-certificate-revoke-result/v1` | 无 | Agent、控制面、Gateway |
| `credential.acquire` | 在浏览器登录页面获取临时凭据 | HIGH / 只读 | `credential.create` | `gcac.credential-acquire-input/v1` → `gcac.credential-output/v1` | 无 | 控制面 |

幂等只代表宿主可以按相同幂等键安全处理重复请求，不代表可以忽略目标回读。非幂等或外部状态未知的写操作必须停止自动重放，交由执行记录和人工确认。

## 3. Runner Host API

代码型 Runner 只接收一个已经冻结的 `plugin.action`。它可以通过 IPC v2 请求以下 7 个 Host API；每次请求都必须携带至少一个 Grant 引用、幂等键、截止时间和当前步骤身份。

| Host API | 能做什么 | 重要限制 |
| --- | --- | --- |
| `cloudService.get` | 读取当前租户可见的 ACTIVE 云服务对象 | 只能读取当前插件获授权的云服务，不能枚举其他租户 |
| `artifact.grant.read` | 读取证书、私钥、证书链或其他制品 | 必须有 Artifact Grant；高风险、始终脱敏，单次输出最多 4 MB |
| `secret.grant.resolve` | 解析 `secret://` 引用 | 必须声明用途；只能在当前步骤和授权范围内使用 |
| `crypto.sign` | 使用授权私钥执行 `RS256` 或 `ES256` 签名 | 只返回签名结果，永远不返回私钥 |
| `http.request` | 访问已登记的 HTTPS 服务端点 | 支持 GET、POST、PUT、PATCH、DELETE、HEAD；普通 HTTP 被拒绝 |
| `execution.isCancelled` | 查询当前执行或步骤是否已取消 | 只读；发现取消后应停止后续外部写入 |
| `audit.append` | 追加脱敏审计事件 | 只能追加，不能修改或删除历史记录 |

Host API 的权限分别为 `cloud.service.get`、`artifact.read`、`secret.resolve`、`crypto.sign`、`network.http`、`execution.cancel.read`、`audit.append`。失败回执必须包含 `code`、`message`、`retryable`、`mayBeUnknown` 和 `secretRedacted: true`。

### Runner 生命周期

Runner 与一个租户和一个插件版本绑定。宿主先完成 `hello` 握手并比对包摘要、Manifest 摘要、资源摘要、能力和权限，再发送 `execute`。Runner 只能返回结构化 `output`、脱敏 `warnings` 和可选外部回执；不能发送 Workflow、rollback、checkpoint 或全局变量。

执行状态只有 `SUCCESS`、`FAILED`、`UNKNOWN`、`CANCELLED`。取消、超时、进程崩溃或晚到结果由宿主收敛，插件不得自行把 UNKNOWN 改写成成功。

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
| `forms` | 设备、云账号或高级配置表单 |
| `presentations` | 设备、应用、证书绑定或云资源展示 |
| `locales` | Locale 文案资源 |
| `discoveryMappings` | 控制面发现映射 |
| `agentDiscoveryMappings` | Agent 发现映射 |
| `onboarding` | 应用资产接入配方 |

包最多 500 个资源文件、总大小最多 20 MB。资源路径必须是包内相对路径；普通资源禁止 `.js/.mjs/.cjs/.ts/.tsx/.vue/.ps1/.sh/.bat/.cmd/.exe/.dll/.so/.dylib` 等可执行文件，只有固定 `runtime/index.js` 例外。Logo 禁止脚本、动画、外链、`foreignObject` 和外部图片。

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

应用资产接入配方使用 `gcac.application-onboarding/v1`，由插件声明平台名称、支持状态、设备选择方式、新建设备入口、连接测试、身份识别、发现、目标投影、接受的证书格式、所需制品和提交来源。宿主只执行统一向导，不按厂商名称写分支。

证书部署输入合同按变量、连接、凭据和 Artifact Slot 分组。证书 Artifact 的标准输出角色包括 `leafPem`、`privateKeyPem`、`orderedChainPem`、`fingerprintSha256`、`pfxBase64` 和 `pfxPassword`。插件声明所需格式和输出角色，宿主负责制品生成、密码、链顺序、指纹和 Grant；插件只负责目标侧上传、切换、刷新和回读。

## 8. 明确不开放的能力

以下能力不存在于宿主合同中，插件不得通过任何变体调用：

`plugin.invoke`、`database.query`、`repository.call`、`host.service.invoke`、`filesystem.read/write`、`process.spawn/execute`、`agent.execute`、`execution.checkpoint.save/load`、`resourceLock.acquire/release`。

插件不得读取宿主环境变量、数据库、文件、完整工作流对象或其他插件的 Grant，也不得把密钥写入日志、普通变量、Manifest、绑定或资源文件。

## 9. 宿主控制面接口索引

以下是开发和验收时会用到的正式接口，均受租户、角色和对象访问控制保护：

| 接口 | 用途 |
| --- | --- |
| `GET /api/v1/plugin-catalog` | 查询可见插件目录 |
| `POST /api/v1/plugin-catalog/refresh-builtins` | 刷新内置插件目录 |
| `GET /api/v1/plugin-versions`、`GET /api/v1/plugin-version-groups` | 查询版本和版本分组 |
| `GET /api/v1/plugin-version-management/:pluginVersionId` | 查看导入、权限和状态详情 |
| `POST /api/v1/plugin-packages/import` | 导入 Manifest 和资源 |
| `POST /api/v1/plugin-versions/approve-permissions` | 审批权限 |
| `POST /api/v1/plugin-versions/enable`、`disable`、`retire` | 启用、禁用或退休版本 |
| `GET /api/v1/plugin-versions/upgrade-diff` | 比较两个版本的能力、权限和资源变化 |
| `GET /api/v1/plugin-form/standard-fields` | 查询标准表单字段 |
| `GET /api/v1/plugin-capabilities` | 查询宿主能力合同 |
| `GET /api/v1/plugin-versions/ui-resources` | 读取表单、展示和 Locale 资源 |
| `GET /api/v1/plugin-versions/:id/resources/logos/:variant` | 读取 Logo |
| `POST/GET/PATCH /api/v1/plugin-bindings` | 创建、查询和更新 Binding |
| `POST /api/v1/capability-assignments` | 设置能力指派 |
| `POST /api/v1/capability-assignments/resolve` | 查看某个目标最终采用的能力来源 |
| `POST /api/v1/cloud-account-assets/:id/capability-binding` | 为云账号固定连接测试或资源发现能力 |
| `GET /api/v1/managed-targets/:id/deployment-capabilities/:capabilityKey` | 查看受管目标生效能力 |
| `GET /api/v1/managed-targets/:id/compatible-plugins` | 查询兼容插件 |
| `POST /api/v1/managed-targets/:id/deployment-input-projection` | 生成应用资产部署输入投影 |
| `GET /api/v1/plugin-runtime/metrics` | 查看 Runner 运行指标 |

云账号只能绑定 `cloud.service.connection-test` 和 `cloud.service.discover`；证书签发、续期、吊销等能力必须按 CA 能力合同或 Workflow 使用，不能把证书生命周期偷偷挂到云账号识别绑定上。

## 10. 应用资产接入会话

声明 `resources.onboarding` 后，插件可以接入统一应用资产向导。宿主提供以下业务步骤：

1. `GET /api/v1/application-onboarding/platforms`：列出当前租户可用的平台和插件版本。
2. `POST /api/v1/application-onboarding/sessions`：以 `platformKey` 创建会话，必须带 `X-Idempotency-Key`。
3. `GET /api/v1/application-onboarding/sessions/:id/devices`：读取可用设备；已有设备直接选择，新设备必须跳转统一设备向导或使用配方声明的 `PLUGIN_MANAGED` 入口。
4. `POST /api/v1/application-onboarding/sessions/:id/resource-selection`：提交设备选择和表单值，并带 `expectedStateVersion`。
5. `POST /api/v1/application-onboarding/sessions/:id/test`：执行连接测试。
6. `POST /api/v1/application-onboarding/sessions/:id/discover`：执行身份识别和发现，得到可选 ManagedTarget。
7. `POST /api/v1/application-onboarding/sessions/:id/target-selection`：提交 `managedTargetId`、`configFingerprint` 以及可选访问域名和验证地址。
8. `GET /api/v1/application-onboarding/sessions/:id/certificate-options`：读取符合配方格式的证书选项。
9. `POST /api/v1/application-onboarding/sessions/:id/certificate-selection`：精确提交 `certificateId` 和 `certificateVersionId`，或使用配方允许的最新有效版本。
10. `POST /api/v1/application-onboarding/sessions/:id/complete`：提交接入，生成部署计划或执行记录。

所有写步骤都必须携带 `expectedStateVersion`，旧版本会被拒绝，防止用户在发现结果过期后误选目标。会话默认 30 分钟过期；提交中和已生成计划的会话不能取消。DIRECT_WORKFLOW 配方还必须同时存在同一插件版本的连接、发现和执行 Workflow，且目标必须是 ACTIVE 并提供真实端点，宿主不会接受绕过发现的地址、账号或密码。
