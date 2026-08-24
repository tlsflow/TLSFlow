---
title: 平台扩展基础
description: GCAC 后端、前端、迁移和安全开发边界
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001-平台基础与工程治理
  - specs/002-统一安全管理与访问控制
codeRefs:
  - backend/src/app.module.ts
  - backend/src/database
  - web/src/design-system
  - web/src/i18n
testRefs: []
lastVerified: 2026-08-02
---

# 平台扩展基础

## 必须遵守的边界

- 后端模块通过应用装配入口注册，API 使用稳定错误合同和请求上下文。
- 已执行迁移不可修改，修历史数据必须新增递增迁移。
- 前端用户文案和 ARIA 必须通过 `vue-i18n`。
- 前端时间展示使用浏览器本地时间。
- 可复用组件放在设计系统目录，样式消费 `--gc-*` 语义变量。
- Secret、Token、私钥和凭据不得进入日志、普通快照或文档示例。

新增业务能力前，先查对应父 Spec 和最小子 Spec，避免把同一任务分配给多个领域。
