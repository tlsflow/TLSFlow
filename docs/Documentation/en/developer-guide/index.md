---
title: Developer guide
description: Extension boundaries and verification rules for GCAC developers
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/001-平台基础与工程治理
  - specs/004-统一插件平台与厂商扩展治理
  - specs/007-工作流DSL与模板运行管理
  - specs/008-证书部署输入与执行编排管理
testRefs: []
codeRefs:
  - backend/src
  - web/src
lastVerified: 2026-08-06
---

# Developer guide

The developer guide describes the current platform boundaries for backend, frontend, database, plugins, workflows, and certificate deployment.

For plugin work, read the plugin package, target-mode, discovery, runtime, and maturity pages in order. For workflow work, read the DSL, input-contract, executor, and certificate-deployment pages in order.

The current code, active Specs, tests, and project standards are the source of truth. Ordinary plugins do not execute code by default, and unknown-code execution requires separate authorization. A page marked `in_review` or `todo` must not be treated as a production guarantee.
