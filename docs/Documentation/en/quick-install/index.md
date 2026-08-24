---
title: Quick start
description: The shortest path from tenant setup to the first usable target
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/001-平台基础与工程治理
  - specs/002-统一安全管理与访问控制
  - specs/005-受管与非受管设备管理
codeRefs:
  - backend/src/app.module.ts
  - backend/src/modules/security
  - backend/src/modules/devices
testRefs: []
lastVerified: 2026-08-02
---

# Quick start

Use this order for a first setup:

1. Create or select a tenant and administrator.
2. Decide whether the target is Agent-managed or agentless.
3. Store credentials in the controlled Secret/Credential system.
4. Register the Agent or create the agentless target.
5. Run read-only discovery and review the target context.
6. Configure the application asset and certificate binding.
7. Run preflight before creating a deployment plan.

The exact installation topology and external-system acceptance still require environment-specific evidence.
