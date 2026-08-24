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

同一 `pluginId + version` 内容不可变。资源路径不能越界。插件执行位置只有 `declarative`、`agent_plan` 和 `isolated_process`：声明式插件必须提供受校验的 Workflow/Manifest 资源，Agent 插件必须生成 Agent v2 类型化计划，代码型插件必须声明独立 Plugin Runner 入口、IPC 版本和资源摘要。任何代码都不得通过宿主进程动态加载，插件不得直接访问数据库、Repository、宿主文件或环境变量。

插件导入、审批、启用、绑定和执行是独立阶段。未通过任何一个阶段都必须失败关闭。
