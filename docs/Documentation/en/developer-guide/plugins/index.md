---
title: Plugin development
description: Entry point for GCAC unified and Agent plugin development
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/004-统一插件平台与厂商扩展治理
  - specs/005-受管与非受管设备管理
  - specs/006-应用资产、绑定与受管目标管理
codeRefs:
  - backend/src/modules/plugins
testRefs: []
lastVerified: 2026-08-06
---

# Plugin development

Plugin development follows the current `20260802` unified standard, the relevant Specs, and code evidence. The handbook covers package contracts, target modes, discovery, Agent runtime, security gates, and maturity. Capabilities without external-vendor, real-deployment, or cryptographic-signing evidence remain `in_review` or `todo`.

Recommended order:

1. [Plugin package contract](./package-contract.md)
2. [Target modes](./target-modes.md)
3. [Discovery, asset fields, and certificate locations](./discovery-and-assets.md)
4. [Agent runtime](./agent-runtime.md)
5. [Plugin security and maturity](./security-and-maturity.md)

Core boundaries:

- Resolve plugin identity through `CapabilityAssignment -> PluginBinding -> PluginVersion`, not a vendor string.
- Plugin execution locations are `agent_plan`, `declarative`, and `isolated_process`. Code-bearing plugins run in a separate Plugin Runner process inside the same Docker container and must not be dynamically loaded by the host. Agent and code-bearing plugins are not workflow Steps.
- Model agentless `DeviceAsset`, `ManagedTarget + Plugin`, `ManagedTarget + Workflow Override`, and `Standalone + Workflow` separately.
- Discovered certificate locations use `source.kind=asset`; precise discovery takes precedence over plugin defaults.
- The host governs Secrets, Artifacts, permissions, audit, snapshots, verification, and rollback. Code-bearing plugins consume controlled Grants only through an isolated Plugin Runner and after explicit code-execution authorization.
