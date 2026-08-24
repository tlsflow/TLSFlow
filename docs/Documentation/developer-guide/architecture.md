---
title: 架构与模块边界
description: GCAC 后端、前端和跨模块主链
docStatus: implemented
productVersion: current
sourceLocale: zh-CN
locale: zh-CN
specRefs:
  - specs/001-平台基础与工程治理
  - specs/004-统一插件平台与厂商扩展治理
  - specs/007-工作流DSL与模板运行管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/app.module.ts
  - backend/src/modules
  - web/src
testRefs: []
lastVerified: 2026-08-02
---

# 架构与模块边界

## 请求链

```text
Browser
  -> web API module
  -> Router / Controller
  -> Application Service
  -> Domain Service
  -> Repository
  -> Postgres/PGlite
```

请求上下文携带租户、操作者和请求 ID。领域读写必须经过租户边界和对象授权。

## 业务主链所有者

- 插件解析和运行时：`004`。
- Agent、Gateway、无代理通道：`005`。
- ApplicationAsset 和 ManagedTarget：`006`。
- DSL、模板和执行器：`007`。
- 部署计划、执行、验证和回滚：`008`。
- 监控、通知、自动化、凭据和报表：`009`。

新增实现必须归属一个最小子 Spec，不能在父域和子域重复定义同一状态机。
