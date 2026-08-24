---
title: 核心对象与主链
description: GCAC 核心对象的关系和执行主链
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/004-统一插件平台与厂商扩展治理
  - specs/005-受管与非受管设备管理
  - specs/006-应用资产、绑定与受管目标管理
  - specs/007-工作流DSL与模板运行管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/modules/plugins
  - backend/src/modules/assets
  - backend/src/modules/workflow-templates
  - backend/src/modules/deployment-plans
testRefs: []
lastVerified: 2026-08-02
---

# 核心对象与主链

GCAC 不把每个厂商做成宿主代码中的独立产品分支。插件声明能力，宿主解析目标、权限、凭据、证书制品和执行位置。

```mermaid
flowchart LR
  A[PluginVersion] --> B[PluginBinding]
  B --> C[CapabilityAssignment]
  C --> D[ApplicationAsset]
  D --> E[ManagedTargetContext]
  E --> F[WorkflowVersion或Agent Atomic Plan]
  F --> G[DeploymentPlan]
  G --> H[ExecutionRun]
```

## 关键原则

1. 插件身份由 `CapabilityAssignment -> PluginBinding -> PluginVersion` 解析。
2. 执行位置描述在哪里执行，不决定使用哪个插件。
3. 计划固定部署输入快照，执行时不能偷偷回查当前配置。
4. 证书材料通过统一 Artifact，不在普通日志或快照中保存明文私钥。
