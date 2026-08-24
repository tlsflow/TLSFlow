---
title: Discovery, asset fields, and certificate locations
description: Standard plugin discovery, asset sources, and certificate-location rules
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/005-受管与非受管设备管理
  - specs/006.2-受管目标上下文与应用执行配置管理
codeRefs:
  - backend/src/modules/plugins/discovery
  - backend/src/modules/deployment-inputs
testRefs: []
lastVerified: 2026-08-02
---

# Discovery, asset fields, and certificate locations

Plugins use standard discovery to output Framework, Site, ManagedTarget, and Certificate objects. The plugin declares stable keys; the host handles projection, conflicts, and stale data.

Certificate paths, KeyStores, service names, and program paths discovered from the target use `source.kind=asset` and take precedence over plugin defaults. Defaults are only compatibility fallbacks for targets where discovery did not provide a value.

Discovery may continue for an individual child object and expose a Warning. Deployment, change, and rollback must fail closed. `configFingerprint` is already included in the input snapshot, but execution-time comparison is still a pending gate.
