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
lastVerified: 2026-08-02
---

# 插件包契约

Manifest 使用 `gcac.plugin-manifest/v1`。必须声明 Runtime、Source、Scope、Trust、Support、Capability、Permission、Compatibility 和资源映射。

同一 `pluginId + version` 内容不可变。资源路径不能越界，插件包不得携带可执行代码。`WORKFLOW_DSL` 必须有 Workflow 资源，`AGENT_ATOMIC` 必须有 Agent Recipe。

插件导入、审批、启用、绑定和执行是独立阶段。未通过任何一个阶段都必须失败关闭。
