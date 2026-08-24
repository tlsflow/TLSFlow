---
title: 系统概览
description: GCAC 的模块边界和核心能力
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001-平台基础与工程治理
  - specs/004-统一插件平台与厂商扩展治理
  - specs/005-受管与非受管设备管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/app.module.ts
  - backend/src/modules/plugins
  - backend/src/modules/deployment-plans
testRefs: []
lastVerified: 2026-08-02
---

# 系统概览

GCAC 的核心工作是把证书材料安全地绑定到设备或应用目标，并通过 Agent 原子计划或工作流完成部署、验证和回滚。

## 模块边界

- `001`：平台装配、API、迁移、主题和国际化。
- `002`：身份、RBAC、对象授权、Secret、审批和审计。
- `003`：证书资产、版本、格式、制品、CA 和信任域。
- `004`：插件包、Binding、Assignment、运行时和厂商中立门禁。
- `005`：Agent、非 Agent 目标、Gateway 和执行通道。
- `006`：应用资产、证书绑定和 ManagedTarget 上下文。
- `007`：工作流 DSL、模板版本、画布和协议执行器。
- `008`：部署输入、预检、快照、计划、执行、验证和回滚。
- `009`：监控、通知、自动化、凭据和报表。

## 当前限制

用户插件可信发布者密码学验签、部分真实厂商部署/回滚、跨实例协调和生产环境验收仍需单独证据，不能仅根据代码目录存在就宣称完成。
