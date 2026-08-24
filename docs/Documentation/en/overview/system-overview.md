---
title: System overview
description: GCAC module boundaries and core capabilities
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
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

# System overview

GCAC binds certificate material securely to device or application targets, then uses an Agent atomic plan or a workflow for deployment, verification, and rollback.

## Module boundaries

- `001`: platform assembly, APIs, migrations, theme, and internationalization.
- `002`: identity, RBAC, object authorization, Secret, approval, and audit.
- `003`: certificate assets, versions, formats, artifacts, CAs, and trust domains.
- `004`: plugin packages, bindings, assignments, runtime, and vendor-neutrality gates.
- `005`: Agents, agentless targets, Gateways, and execution channels.
- `006`: application assets, certificate bindings, and ManagedTarget context.
- `007`: workflow DSL, template versions, canvas, and protocol executors.
- `008`: deployment input, preflight, snapshot, plan, execution, verification, and rollback.
- `009`: monitoring, notifications, automation, credentials, and reports.

## Current limitations

Cryptographic verification of trusted user-plugin publishers, some real vendor deployment and rollback paths, cross-instance coordination, and production acceptance for Gateway, product version, and execution location still require separate evidence. A code directory alone is not enough to claim completion.
