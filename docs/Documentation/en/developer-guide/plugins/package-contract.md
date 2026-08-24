---
title: Plugin package contract
description: The package, manifest, resource, and version contract for GCAC plugins
docStatus: in_review
productVersion: current
sourceLocale: zh-CN
locale: en-US
specRefs:
  - specs/004-统一插件平台与厂商扩展治理
  - specs/004.1-插件包契约、权限与生命周期治理
codeRefs:
  - backend/src/modules/plugins/schema
  - backend/src/modules/plugins/application
testRefs:
  - backend/src/modules/plugins/builtin-unified-plugin-loader.test.ts
  - backend/src/modules/plugins/plugin-workflow-publisher.test.ts
lastVerified: 2026-08-06
---

# Plugin package contract

A plugin package is an immutable capability declaration. Its manifest, resources, content hash, version, permissions, and runtime kind must be validated before publication.

## Required boundaries

- Use the current manifest Schema and stable plugin identity.
- Declare resources, capabilities, input slots, permissions, network access, and compatibility explicitly.
- Keep `AGENT_ATOMIC`, `WORKFLOW_DSL`, and `TRUSTED_JS` as distinct runtime kinds. Ordinary plugins do not execute code by default. Trusted `TRUSTED_JS` packages may carry a controlled JavaScript entrypoint and vendor SDK dependencies, but runtime entry still requires separate unknown-code execution authorization.
- Do not encode vendor selection as a host-side Driver, Executor, Projector, or page branch.
- Treat package and workflow hashes as content identity, not as a display label.

The host owns publication state, approval, credential and artifact Grants, audit, execution locks, and status transitions. A package existing in storage does not mean that its tenant has enabled or approved it.

User-plugin publisher cryptographic verification is still `todo`; do not use a user-provided signature state as a trusted-publisher guarantee.
