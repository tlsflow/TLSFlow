---
title: 运维指南
description: GCAC 升级、排障、审计和恢复入口
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001-平台基础与工程治理
  - specs/008-证书部署输入与执行编排管理
  - specs/009-运营自动化、监控与系统配置管理
codeRefs:
  - backend/src/database
  - backend/src/modules/deployment-plans
  - backend/src/modules/monitors
testRefs: []
lastVerified: 2026-08-02
---

# 运维指南

运维文档覆盖迁移、配置、凭据、部署恢复、监控、通知和审计。

## 重要原则

1. 历史迁移不能原地修改。
2. 部署计划执行前必须复核固定的目标配置和凭据版本。
3. 非幂等运行步骤不能被无条件自动重试。
4. 监控多实例租约未完成前，不能宣称不会重复探测。
5. 真实生产演练需要单独验收记录。
