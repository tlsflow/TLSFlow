---
title: 设备与目标模式
description: 插件、工作流和无 Agent 目标的选择边界
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
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

| 模式 | 绑定方式 | 说明 |
| --- | --- | --- |
| 无 Agent DeviceAsset | DeviceAsset + 标准发现/无代理通道 | 只表达目标事实，不虚构 Agent |
| ManagedTarget + Plugin | PluginBinding + CapabilityAssignment | 受管目标默认模式 |
| ManagedTarget + Workflow Override | WorkflowExecutionBinding | 用户明确覆盖插件 |
| Standalone + Workflow | ApplicationAsset + WorkflowExecutionBinding | 新 Standalone 目标不创建 PluginBinding |

执行位置只说明在哪里执行，不能决定选择哪个插件。来源冲突必须在保存或计划前失败关闭。
