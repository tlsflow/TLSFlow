---
title: Developer Documentation
description: Entry point for TLSFlow v1.0.0 plugin and workflow extension development
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - backend/src/modules/plugins
  - backend/src/modules/workflow-templates
  - backend/src/modules/agents/security
  - backend/src/modules/application-onboarding
  - backend/src/modules/browser-runtime
testRefs:
  - backend/src/modules/plugins/plugins-openapi.contract.test.ts
  - backend/src/modules/plugins/plugin-workflow-publisher.test.ts
  - backend/src/modules/application-onboarding/controller/application-onboarding.controller.test.ts
  - backend/src/modules/browser-runtime/browser-credential-session.service.test.ts
  - backend/src/modules/agents/security/agent-security.contract.test.ts
  - backend/src/modules/executions/workflow-executor-adapter.test.ts
lastVerified: 2026-09-04
---

# Developer Documentation

This documentation describes the host boundaries implemented in TLSFlow v1.0.0. It is not an internal Spec, a test fixture, or a list of unfinished capabilities. Start with [Host Plugin Capabilities](./host-plugin-capabilities.md) for the complete capability and contract list. Then follow [Plugin Development](./plugin-development.md) for delivery, [Plugin Example](./plugin-example-nginx-proxy-manager.md) for a complete device and certificate-deployment example, or [Workflow Development](./workflow-development.md) for workflow-template development.

Development testing must use redacted data and an isolated tenant. Acceptance testing against real targets, external CA behavior, and production release must be completed separately in the relevant environment.

## Three Development Boundaries

- Plugins use host capabilities only through the Manifest, Host API, and Grant. The host owns tenants, permissions, Secrets, Artifacts, audit, locks, snapshots, and rollback.
- [Host Plugin Capabilities](./host-plugin-capabilities.md) is the only development entry point for host capabilities. Interfaces, permissions, and steps not listed there are not plugin contracts.
- Workflows use only `gcac.workflow/v1` and `CurlSshWorkflow`. Templates come only from the built-in directory or `data/workflows`; each release fixes a concrete version and input snapshot.
- Target read-back verification is the final success condition for certificate deployment, not a successful local upload. Capabilities without external-vendor or field evidence are not documented as compatibility commitments.

## Contract Navigation

- [Host Plugin Capabilities](./host-plugin-capabilities.md): Manifest, capability registry, USER/BUILTIN/Agent Plan permission gates, Runner Host API, `credential.acquire`, onboarding, full-Agent facts, and Agent security contracts.
- [Plugin Development](./plugin-development.md): Plugin-package layout, Manifest, Workflow/Agent Plan selection, capability-specific test matrix, and version upgrades.
- [Workflow Development](./workflow-development.md): Complete Step types, Browser/Plugin Actions, TLS ExecutionGrant, DeploymentInput/Artifact, and machine-readable Schema indexes.
- [Plugin Example](./plugin-example-nginx-proxy-manager.md): Real code boundaries and verification status for Nginx Proxy Manager.

Backend requests must follow the “Controller → Application Service → Domain Service → Repository” chain and carry the tenant, actor, and request ID. User-facing text, ARIA labels, and time display must follow the project's existing internationalization, semantic theme-token, and browser-local-time rules. These are host-engineering boundaries that plugins must not bypass.
