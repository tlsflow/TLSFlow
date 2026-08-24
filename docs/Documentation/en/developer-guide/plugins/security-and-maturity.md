---
title: Plugin security and maturity
description: Plugin publication, permissions, external acceptance, and gap status
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/004-统一插件平台与厂商扩展治理
  - specs/006.2-受管目标上下文与应用执行配置管理
  - specs/008-证书部署输入与执行编排管理
codeRefs:
  - backend/src/modules/plugins/promotion/plugin-promotion.service.ts
  - backend/src/modules/plugins/application/plugin-workflow-publisher.service.ts
testRefs: []
lastVerified: 2026-08-06
---

# Plugin security and maturity

## Publication gates

- Manifest, resources, package hash, and version are immutable.
- Permissions, network access, Secrets, Artifacts, and device writes require approval.
- Logs, audit records, snapshots, and errors must be redacted.
- The host must not add Driver, Executor, Projector, or page branches based on a vendor string.
- Ordinary plugins do not execute code by default; code-bearing `TRUSTED_JS` plugins require separate unknown-code execution authorization before runtime entry.
- `TRUSTED_JS` plugins may access credentials, artifacts, locks, audit, and checkpoints only through explicit Host API gates; they must not access the database or arbitrary host filesystems directly.

## Maturity status

| Capability | Current status |
| --- | --- |
| Manifest Schema and resource validation | `implemented` |
| Normalized content hash for workflow publication | `implemented` |
| Unknown-code execution authorization gate | `in_review` |
| Cryptographic verification of trusted user-plugin publishers | `todo` |
| Explicit dual-mode Promotion aggregation | `todo` |
| Execution-time `configFingerprint` comparison | `todo` |
| Real vendor deployment and rollback | `in_review` |
| External acceptance for Gateway, product version, and execution location | `in_review` |
| Approval and audit gates for Citrix `allowInsecure: true` | `in_review` |
