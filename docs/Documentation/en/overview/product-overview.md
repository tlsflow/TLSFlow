---
title: Product overview
description: What GCAC solves and where it stops
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/001-平台基础与工程治理
  - specs/003-证书资产与CA生命周期管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/app.module.ts
  - backend/src/modules/certificates
  - backend/src/modules/deployment-plans
testRefs: []
lastVerified: 2026-08-06
---

# Product overview

GCAC addresses scattered certificate assets, unclear device targets, unauditable deployment, and poor recovery after failures.

## Typical use cases

- Manage multiple CAs, certificate versions, and certificate artifacts.
- Use Agent, Gateway, or agentless channels across different network zones.
- Relate application assets, certificate bindings, and managed targets.
- Use Agent atomic plans or workflows for deployment, verification, and rollback.
- Operate the certificate lifecycle through monitoring, notifications, automation, and reports.

## What GCAC is not

GCAC is not an arbitrary remote Shell platform or a sandbox for plugins to carry unrestricted scripts and binaries. Declarative and Agent Plan plugins do not execute arbitrary code; code-bearing plugins run only as signed `isolated_process` packages in a separate Plugin Runner process and require explicit code-execution authorization. The host governs permissions, credentials, artifacts, execution locks, and audit records through the approved Host API.
