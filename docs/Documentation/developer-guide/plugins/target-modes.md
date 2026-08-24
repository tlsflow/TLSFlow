---
title: 设备与目标模式
description: 插件、工作流和无 Agent 目标的选择边界
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/004.5-插件进程隔离与宿主能力边界重构治理
  - specs/005-受管与非受管设备管理
  - specs/006.2-受管目标上下文与应用执行配置管理
codeRefs:
  - backend/src/modules/plugins/promotion/plugin-promotion.service.ts
  - backend/src/modules/assets/application
  - backend/src/modules/workflow-templates/application
testRefs: []
lastVerified: 2026-08-02
---

# 设备与目标模式

| 目标上下文 | 绑定方式 | 说明 |
| --- | --- | --- |
| 无 Agent DeviceAsset | DeviceAsset + 标准发现/无代理通道 + WorkflowExecutionBinding | 只表达目标事实，不虚构 Agent；Action 由 DSL 步骤按需绑定 |
| ManagedTarget | ManagedTarget 上下文 + WorkflowExecutionBinding | DSL 是唯一执行来源，不建立包级 Runner Workflow |
| Standalone | ApplicationAsset + WorkflowExecutionBinding | 新目标不创建独立 PluginBinding；Action 只作为 DSL 步骤存在 |

执行位置只说明在哪里执行，不能决定选择哪个插件。WorkflowVersion 固定后，只有 DSL 明确包含 `plugin.action` 才固定 PluginVersion、Capability 和 Action Binding。来源冲突必须在保存或计划前失败关闭。
