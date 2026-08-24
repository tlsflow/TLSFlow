---
title: 插件开发
description: TLSFlow v1.0.0 插件包、宿主 API、权限和运行边界
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
  - backend/src/modules/plugins/controller/plugins.controller.ts
  - backend/src/modules/plugins/runner/protocol/host-api.registry.ts
  - backend/src/modules/plugins/runner/plugin-runner-host-api.handler.ts
  - backend/src/modules/plugins/application/user-plugin-directory-importer.ts
testRefs: []
lastVerified: 2026-08-22
---

# 插件开发

插件包（Manifest 与资源组成的不可变版本）扩展平台能力；宿主（TLSFlow 控制面）负责租户、权限、凭据、证书制品、审计、快照和执行生命周期。插件只声明能力和调用合同，不能把宿主当作可任意执行的脚本环境。

## 1. 插件类型和生命周期

- 内置插件放在 `backend/src/modules/plugins/builtin-plugins/<pluginId>/`，由 Registry 扫描；当前 Nginx Proxy Manager 就是内置插件。
- 用户插件放在 `data/plugins`（可由 `GCAC_USER_PLUGIN_DATA_DIR` 覆盖），通过 `POST /api/v1/plugin-packages/import` 导入。
- `pluginId + version` 内容不可变。导入、权限审批（用户包）、启用、禁用和退休是独立状态；升级生成新版本，已有绑定不会自动切换。
- `WORKFLOW_DSL` 插件的工作流版本必须与 Manifest 版本一致；`ISOLATED_PROCESS` 只允许由 `plugin.action` 步骤调用独立 Runner。

Manifest 至少要声明 Runtime、Source、Scope、Trust、Support、Capability、Permission、Compatibility 和资源映射。资源只能引用包内相对路径，不能提交宿主磁盘路径。

`gcac.plugin-manifest/v1` 是当前唯一 Manifest 协议。Runtime 只有三种：`declarative`（声明式资源）、`agent_plan`（生成 Agent v2 类型化计划）和 `isolated_process`（在独立 Runner 进程中执行代码型 Action）。Source 区分随版本发布的内置包和通过统一导入链加载的用户包；同一 `pluginId + version` 的内容摘要不可改变，升级必须递增版本并保留旧版本。

能力解析链固定为 `CapabilityAssignment → PluginBinding → PluginVersion`。宿主根据绑定和能力解析结果选择插件，不能按厂商名称、操作系统名称或产品字符串增加分支。插件版本、能力、资源摘要和工作流版本一旦进入部署计划，就由输入快照固定。

## 2. 宿主提供的 Host API

Host API（宿主能力接口）必须先在 Manifest/Action 合同中声明权限和 Grant（一次执行的授权票据），再由 Runner 请求。当前登记的方法如下：

| 方法 | 用途和边界 | 关键权限 |
| --- | --- | --- |
| `cloudService.get` | 读取当前租户且属于当前插件的 ACTIVE 云服务对象 | `cloud.service.get` |
| `artifact.grant.read` | 按制品 Grant 读取证书、私钥或链；结果始终脱敏并受大小限制 | `artifact.read` |
| `secret.grant.resolve` | 按 `secret://` 引用解析 Secret；只能用于当前步骤目的 | `secret.resolve` |
| `crypto.sign` | 使用授权私钥执行 RS256/ES256 签名，不返回私钥 | `crypto.sign` |
| `http.request` | 访问已登记的 HTTPS 云服务端点，限制方法、请求体和响应大小 | `network.http` |
| `execution.isCancelled` | 查询当前执行/步骤是否已取消 | `execution.cancel.read` |
| `audit.append` | 追加脱敏审计事件，不可修改或删除历史记录 | `audit.append` |

调用格式是宿主注册的 JSON 请求和结果合同；失败结果必须包含 `code`、`message`、`retryable`、`mayBeUnknown` 和 `secretRedacted: true`。写请求超时后状态可能为 UNKNOWN，插件不得自动重放。

每个 Action 还必须声明网络、凭据、制品和写入效果，并在运行时使用宿主签发的 Grant（一次执行的授权票据）。Grant 绑定租户、操作者、PluginVersion、目标、步骤和过期时间；插件不能把 Grant 转交给其他插件或保存到持久化字段。宿主同时负责并发锁、熔断、取消、审计和结果脱敏。

## 3. 明确禁止的能力

以下接口不属于 Host API：`database.query`、`repository.call`、`filesystem.read/write`、`process.spawn/execute`、`agent.execute`、检查点保存/加载、资源锁和插件间调用。插件也不得直接读取环境变量、宿主文件、数据库或完整工作流对象。

Plugin Runner 不是操作系统沙箱，也不是 Workflow Runtime。它只接收当前 `plugin.action` 步骤的结构化输入，返回经过 Schema 校验的输出；工作流顺序、`checkpoint`、`rollback`、锁和恢复账本始终由宿主执行器掌握。用户插件发布者密码学验签当前不是 v1.0.0 的完成门禁，不得把包来源字段当作可信签名证明。

## 4. 设备管理实现边界

设备插件通过标准表单保存连接信息，再提供 `device.connection.test`、身份识别和 `discover` 工作流。发现输出 Framework、Site、ManagedTarget 和 Certificate；证书路径等事实必须标记为 `source.kind=asset`，宿主优先使用精确发现结果。

应用资产通过 `CapabilityAssignment → PluginBinding → PluginVersion` 解析能力。插件不能按厂商字符串让宿主增加特判字段；需要新字段时修改 Manifest、表单和输入合同并递增插件版本。

标准发现输出只允许使用宿主定义的 Framework、Site、ManagedTarget 和 Certificate 投影。证书路径、KeyStore、服务名等真实位置必须标记 `source.kind=asset`，精确发现事实优先于插件默认值；默认值不能伪装成发现结果。应用接入表单必须由 Manifest `resources.onboarding.applicationAsset` 声明，不能在宿主增加厂商专属表单分支。

## 5. 证书部署实现边界

部署插件应声明证书 Artifact Slot、连接 Slot、Credential Slot 和回滚所需输入，由宿主统一解析 `ResolvedDeploymentInputV1`、生成计划快照、发放 Grant、执行预检、写审计并验证目标。插件不能把 PEM、私钥、密码放入普通变量、日志或持久化绑定。

证书制品由宿主统一生成和授权：PEM、PFX/P12、JKS、P7B/P7C/SPC 的格式、密码、链顺序和指纹校验不由插件自行实现。插件负责目标产品的上传、切换、刷新和回读验证；非幂等写请求超时必须返回可识别的 UNKNOWN 结果，交由执行记录决定补偿或回滚。

## 6. 开发和验收

1. 先在 `docs/插件开发/<pluginId>/` 创建 `README.md`、`测试文档/` 和 `迭代说明/`。
2. 用脱敏 Fixture 做 Manifest、资源、导入、启用、发现和权限测试。
3. 证书更新流程测试必须执行，记录创建制品、上传/切换、回读验证和失败回滚。
4. 每轮修复都归档现象、原因和解决方案，再进入下一轮。

用户插件的正式发布流程是：将包放入 `data/plugins/<pluginId>/`（或 `GCAC_USER_PLUGIN_DATA_DIR` 指向的目录）→ 在“插件中心”刷新市场 → 通过 `POST /api/v1/plugin-packages/import` 导入 → 审批权限 → 启用版本 → 创建 Binding → 连接测试/发现 → 证书更新流程测试。宿主只验证包契约和运行边界，不执行用户包中的任意测试文件或脚本。

宿主接口索引以代码注册表为准；本页没有列出的接口不可调用，也不因某个插件的测试夹具存在而成为正式承诺。
