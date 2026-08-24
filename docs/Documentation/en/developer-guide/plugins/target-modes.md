---
title: Target modes
description: Selection boundaries for plugins, workflows, and agentless targets
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
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

# Target modes

| Mode | Binding | Meaning |
| --- | --- | --- |
| Agentless `DeviceAsset` | `DeviceAsset` plus standard discovery or an agentless channel | Expresses target facts without inventing an Agent |
| `ManagedTarget + Plugin` | `PluginBinding + CapabilityAssignment` | Default mode for a managed target |
| `ManagedTarget + Workflow Override` | `WorkflowExecutionBinding` | The user explicitly overrides the plugin path |
| `Standalone + Workflow` | `ApplicationAsset + WorkflowExecutionBinding` | A new Standalone target does not create a `PluginBinding` |

Execution location only says where execution occurs; it does not select the plugin. Conflicting sources must fail closed before save or plan creation.
