---
title: 插件包契约
description: GCAC 统一插件 Manifest、资源和版本约束
docStatus: implemented
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/004-统一插件平台与厂商扩展治理
codeRefs:
  - backend/src/modules/plugins/schema/unified-plugins.schema.ts
  - backend/src/modules/plugins/repository
testRefs: []
lastVerified: 2026-08-06
---

# 插件包契约

Manifest 使用 `gcac.plugin-manifest/v1`。必须声明 Runtime、Source、Scope、Trust、Support、Capability、Permission、Compatibility 和资源映射。

同一 `pluginId + version` 内容不可变。资源路径不能越界。普通插件默认不允许执行代码；受信任的官方 `TRUSTED_JS` 插件包可以携带受控 JavaScript 入口和厂商 SDK 依赖，但代码执行还必须单独通过“未知代码执行”授权，且仍受签名、白名单和 Host API 门禁约束。`WORKFLOW_DSL` 必须有 Workflow 资源，`AGENT_ATOMIC` 必须有 Agent Recipe，`TRUSTED_JS` 必须有受信任入口资源和对应能力声明。

插件导入、审批、启用、绑定和执行是独立阶段。未通过任何一个阶段都必须失败关闭。
