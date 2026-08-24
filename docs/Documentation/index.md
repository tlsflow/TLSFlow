---
title: GCAC 官方文档
description: GCAC 证书生命周期管理平台官方文档入口
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001-平台基础与工程治理
  - specs/002-统一安全管理与访问控制
  - specs/003-证书资产与CA生命周期管理
  - specs/004-统一插件平台与厂商扩展治理
  - specs/005-受管与非受管设备管理
  - specs/006-应用资产、绑定与受管目标管理
  - specs/007-工作流DSL与模板运行管理
  - specs/008-证书部署输入与执行编排管理
  - specs/009-运营自动化、监控与系统配置管理
codeRefs:
  - backend/src/app.module.ts
  - backend/src/modules/plugins
  - backend/src/modules/workflow-templates
testRefs: []
lastVerified: 2026-08-02
---

# GCAC 官方文档

GCAC 是证书生命周期管理平台，负责证书资产、CA、设备、应用资产、工作流、部署执行和运营监控。

## 从哪里开始

- 新接入系统：阅读[快速开始](/quick-install/)。
- 日常管理证书和设备：阅读[用户指南](/user-guide/)。
- 开发插件或工作流：阅读[开发者手册](/developer-guide/)。
- 处理升级、排障和恢复：阅读[运维指南](/operations/)。
- 查询事实来源和当前实现状态：阅读[参考资料](/reference/)。

## 当前文档状态

当前文档库正在建设中。页面会明确标注 `implemented`、`in_review` 或 `todo`，未完成能力不会因为页面已经存在就被当作已发布能力。

## 核心主链

```mermaid
flowchart LR
  A[身份与权限] --> B[插件与能力]
  B --> C[Agent或无代理目标]
  C --> D[应用资产与受管目标]
  D --> E[工作流或原子计划]
  E --> F[证书部署计划]
  F --> G[验证与回滚]
  G --> H[监控与运营]
```
