---
title: 插件开发
description: GCAC 统一插件和 Agent 插件开发入口
docStatus: todo
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/004-统一插件平台与厂商扩展治理
  - specs/005-受管与非受管设备管理
  - specs/006-应用资产、绑定与受管目标管理
codeRefs:
  - backend/src/modules/plugins
testRefs: []
lastVerified: 2026-08-02
---

# 插件开发

插件开发正文将在阶段 3.4 编写。当前入口先固定导航和事实边界，避免开发者直接从旧规范复制已迁移的 Standalone 或厂商分派模型。

重点主题：

- 统一 Manifest、版本不可变和权限审批。
- Agent Atomic Runtime 与 Workflow DSL Runtime。
- 无 Agent、ManagedTarget 和 Standalone 的执行模式。
- 标准发现、证书位置、Secret/Artifact Grant 和回滚。
