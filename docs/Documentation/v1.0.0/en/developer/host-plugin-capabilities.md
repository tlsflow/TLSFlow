---
title: Host Plugin Capability Registry
description: TLSFlow v1.0.0 capabilities, contracts, resources, and security boundaries exposed by the host to the plugin system
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - backend/src/modules/plugins
  - backend/src/modules/plugins/controller/plugins.controller.ts
  - backend/src/modules/plugins/application/unified-plugins.application-service.ts
  - backend/src/modules/plugins/application/plugin-workflow-publisher.service.ts
  - backend/src/modules/plugins/application/plugin-package-resource-schema.service.ts
  - backend/src/modules/plugins/schema/plugin-workflow.schema.ts
  - backend/src/modules/plugins/schema/unified-plugins.schema.ts
  - backend/src/modules/plugins/capabilities/plugin-capability.registry.ts
  - backend/src/modules/plugins/runner/runner-server.ts
  - backend/src/modules/plugins/runner/plugin-runner-supervisor.ts
  - backend/src/modules/plugins/runner/plugin-runner-host-api.handler.ts
  - backend/src/modules/plugins/runner/protocol/host-api.registry.ts
  - backend/src/modules/plugins/runner/protocol/schemas/host-api-v1.schema.json
  - backend/src/modules/plugins/runner/protocol/schemas/ipc-v1.schema.json
  - backend/src/modules/plugins/onboarding/application-onboarding-recipe.dto.ts
  - backend/src/modules/application-onboarding/recipe/application-onboarding-recipe.schema.ts
  - backend/src/modules/application-onboarding/controller/application-onboarding.controller.ts
  - backend/src/modules/application-onboarding/dto/application-onboarding.dto.ts
  - backend/src/modules/browser-runtime/browser-credential-session.controller.ts
  - backend/src/modules/browser-runtime/browser-credential-session.service.ts
  - backend/src/modules/deployment-inputs/dto/deployment-input-contract.dto.ts
  - backend/src/modules/deployment-inputs/dto/resolved-deployment-input.dto.ts
  - backend/src/modules/agents/security/agent-security.contract.ts
  - backend/src/modules/agents/security/schemas/agent-security-v1.schema.json
  - backend/src/modules/agents/security/policy-authority.service.ts
  - backend/src/modules/agents/security/local-agent-authorization.service.ts
testRefs:
  - backend/src/modules/plugins/plugins-openapi.contract.test.ts
  - backend/src/modules/plugins/unified-plugins.test.ts
  - backend/src/modules/plugins/plugin-workflow-publisher.test.ts
  - backend/src/modules/plugins/runner/protocol/protocol.contract.test.ts
  - backend/src/modules/plugins/runner/plugin-runner-host-api.handler.test.ts
  - backend/src/modules/browser-runtime/browser-credential-session.service.test.ts
  - backend/src/modules/application-onboarding/recipe/application-onboarding-recipe.test.ts
  - backend/src/modules/application-onboarding/controller/application-onboarding.controller.test.ts
  - backend/src/modules/agents/security/agent-security.contract.test.ts
lastVerified: 2026-08-26
---

# Host Plugin Capability Registry

This page serves as the capability dictionary for plugin development. It consolidates the capabilities, input/output contracts, permissions, execution locations, and constraints that the host has already implemented. Developers only need to select capabilities and prepare resources according to this page, without having to guess at unpublished services by reading source code.

## 1. Understanding Four Key Concepts

- **Plugin Version**: An immutable package consisting of Manifest and resources, uniquely identified by `pluginId + version`. Any resource change must increment the version.
- **Binding**: Associates a plugin version with connections, credentials, certificate artifacts, and managed context. Bindings store references, not passwords, private keys, or plaintext tokens.
- **Capability Assignment**: Allocates a specific capability to a device, ManagedTarget, application asset, or ServiceAsset. New cloud service capabilities use `ownerType=SERVICE_ASSET`; legacy CloudAccount API still exists for compatibility registration and cannot be treated as read-only interfaces.
- **Grant**: Temporary authorization for a specific execution and step. It binds tenant, operator, plugin version, target, and validity period; plugins cannot transfer or persist grants.

The execution chain is always:

```text
Manifest capability declaration
  → Plugin version import and validation
  → Permission gates applicable by plugin source
  → Plugin Binding
  → Capability Assignment
  → Input contract resolution and snapshot
  → Workflow or Agent Plan execution
  → Target read-back verification, audit, and result convergence
```

Permission gates are not uniform across all plugins:

| Plugin Source/Execution Form | Permission State After Import | Calls `approve-permissions` | Enablement/Execution Conditions |
| --- | --- | --- | --- |
| `source=USER` (including USER Agent Plan) | `DISABLED + NOT_REQUIRED` | No | Admin explicitly `enable`, resources and contracts validated |
| `source=BUILTIN` (including builtin Workflow/Agent Plan) | Determined by declared permissions and builtin policy | Called when permissions declared | Can be enabled only after approval, resources, and version state allow |
| Agent Plan execution gate (not Manifest source) | Does not change plugin version permission state | Does not replace plugin permission approval | After `runtime=AGENT_PLAN` or `resources.agentPlans` matched, must also pass Token, Policy Decision, Local Policy, Execution Grant, and Agent state checks |

`trust`, `support`, and signature status are governance information, not execution authorization. USER plugins cannot skip admin enablement by declaring `OFFICIAL_SIGNED` or `COMMUNITY`; likewise, USER plugins do not spontaneously generate permission approval records.

## 2. Host Capability Contracts

Plugins can only declare capabilities from the table below. Each capability's `contractVersion`, `actionContractId`, risk level, input/output Schema, locks, and execution location must exactly match the host registry.

| Capability | Business Purpose | Risk/Idempotency | Permission | Input → Output | Lock | Registry-Allowed Execution Location |
| --- | --- | --- | --- | --- | --- | --- |
| `application.discover` | Discover application assets from host | LOW / read-only | `application.read` | `gcac.application-discovery-input/v1` → `gcac.application-discovery/v1` | None | Agent, control plane, Gateway |
| `device.connection.test` | Verify device address and credential connectivity | LOW / read-only | `device.read` | `gcac.connection-test-input/v1` → `gcac.connection-test-result/v1` | None | Agent, control plane, Gateway |
| `device.identity.detect` | Confirm device product family and software identity | LOW / read-only | `device.read` | `gcac.device-identity-input/v1` → `gcac.device-identity-result/v1` | None | Agent, control plane, Gateway |
| `device.discover` | Discover frameworks, sites, targets, certificates, and bindings | LOW / read-only | `device.read` | `gcac.device-discovery-input/v1` → `gcac.device-discovery/v2` | DEVICE | Agent, control plane, Gateway |
| `credential.health-check` | Test credential authentication against associated device, distinguishing auth errors from device unreachability | LOW / read-only | `credential.read` | `gcac.credential-health-check-input/v1` → `gcac.credential-health-result/v1` | DEVICE | Agent, control plane, Gateway |
| `device.logs.read` | Query device or plugin runtime logs | LOW / read-only | `device.read` | `gcac.device-logs-query/v1` → `gcac.device-logs-page/v1` | None | Agent, control plane, Gateway |
| `certificate.discover` | Discover certificates and their bindings from device | LOW / read-only | `certificate.read` | `gcac.certificate-discovery-input/v1` → `gcac.device-discovery/v2` | DEVICE | Agent, control plane, Gateway |
| `certificate.verify` | Read back target and confirm current certificate | MEDIUM / read-only | `certificate.read` | `gcac.certificate-verify-input/v1` → `gcac.certificate-verify-result/v1` | TARGET | Agent, control plane, Gateway |
| `certificate.deploy` | Upload, switch, and refresh target certificate | HIGH / idempotent write | `certificate.deploy` | `gcac.certificate-deploy-input/v1` → `gcac.certificate-deploy-result/v1` | TARGET | Agent, control plane, Gateway |
| `certificate.rollback` | Restore pre-deployment certificate and target configuration | HIGH / idempotent write | `certificate.deploy` | `gcac.certificate-rollback-input/v1` → `gcac.certificate-deploy-result/v1` | TARGET | Agent, control plane, Gateway |
| `cloud.service.connection-test` | Verify cloud account connection | LOW / read-only | `cloud.service.read` | `gcac.cloud-service-connection-test-input/v1` → `gcac.cloud-service-connection-test-result/v1` | None | Agent, control plane, Gateway |
| `cloud.service.discover` | Discover resources under cloud account | LOW / read-only | `cloud.service.read` | `gcac.cloud-service-discovery-input/v1` → `gcac.cloud-service-discovery-result/v1` | None | Agent, control plane, Gateway |
| `ca.account.manage` | Create, update, or deactivate CA account | HIGH / idempotent write | `ca.account.manage` | `gcac.ca-account-input/v1` → `gcac.ca-account-result/v1` | None | Agent, control plane, Gateway |
| `ca.order.manage` | Manage certificate order requests | HIGH / idempotent write | `ca.order.manage` | `gcac.ca-order-input/v1` → `gcac.ca-order-result/v1` | None | Agent, control plane, Gateway |
| `ca.challenge.orchestrate` | Orchestrate domain validation challenges | HIGH / idempotent write | `ca.challenge.manage` | `gcac.ca-challenge-input/v1` → `gcac.ca-challenge-result/v1` | None | Agent, control plane, Gateway |
| `ca.challenge.dns-solver` | Write and clean up DNS validation records | HIGH / idempotent write | `ca.challenge.manage` | `gcac.ca-dns-solver-input/v1` → `gcac.ca-dns-solver-result/v1` | None | Agent, control plane, Gateway |
| `ca.certificate.issue` | Issue new certificate | HIGH / idempotent write | `ca.certificate.manage` | `gcac.ca-certificate-issue-input/v1` → `gcac.ca-certificate-issue-result/v1` | None | Agent, control plane, Gateway |
| `ca.certificate.renew` | Renew certificate | HIGH / idempotent write | `ca.certificate.manage` | `gcac.ca-certificate-renew-input/v1` → `gcac.ca-certificate-renew-result/v1` | None | Agent, control plane, Gateway |
| `ca.certificate.revoke` | Revoke certificate | HIGH / idempotent write | `ca.certificate.manage` | `gcac.ca-certificate-revoke-input/v1` → `gcac.ca-certificate-revoke-result/v1` | None | Agent, control plane, Gateway |
| `credential.acquire` | Acquire temporary credential on browser login page | HIGH / read-only | `credential.create` | `gcac.credential-acquire-input/v1` → `gcac.credential-output/v1` | None | Control plane |

Idempotency only means the host can safely handle duplicate requests with the same idempotency key; it does not mean target read-back can be skipped. Non-idempotent writes or writes with unknown external state must stop automatic replay and defer to execution records and manual confirmation.

## 3. Runner Host API

Code-based runners receive only a frozen `plugin.action`. The formal protocol identifier is `gcac.plugin-runner/v2`; `ipc-v1.schema.*` and `host-api-v1.schema.*` in the repository are compatibility historical filenames—the file `$id` and message constants still use v2. Runners can request the following 8 Host APIs via IPC v2; each request must carry at least one Grant reference, idempotency key, deadline, and current step identity.

| Host API | What It Does | Important Constraints |
| --- | --- | --- |
| `cloudService.get` | Read ACTIVE cloud service objects visible to current tenant | Can only read cloud services authorized to current plugin, cannot enumerate other tenants |
| `artifact.grant.read` | Read certificate, private key, certificate chain, or other artifacts | Must have Artifact Grant; high risk, always redacted, single output max 4 MB |
| `secret.grant.resolve` | Resolve `secret://` references | Must declare purpose; can only use within current step and authorized scope |
| `crypto.sign` | Execute `RS256` or `ES256` signature using authorized private key | Only returns signature result, never returns private key |
| `crypto.hmac` | Complete HMAC signature using authorized HMAC Secret | Key only used within host decryption boundary; can return public identifier needed for cloud vendor requests, does not return HMAC key |
| `http.request` | Access registered HTTPS service endpoints | Supports GET, POST, PUT, PATCH, DELETE, HEAD; plain HTTP rejected |
| `execution.isCancelled` | Query if current execution or step is cancelled | Read-only; should stop subsequent external writes after discovering cancellation |
| `audit.append` | Append redacted audit events | Can only append, cannot modify or delete historical records |

Host API permissions are respectively `cloud.service.get`, `artifact.read`, `secret.resolve`, `crypto.sign`, `crypto.hmac`, `network.http`, `execution.cancel.read`, `audit.append`. Failure responses must include `code`, `message`, `retryable`, `mayBeUnknown`, and `secretRedacted: true`.

### Runner Lifecycle

Runners bind to one tenant and one plugin version. The host first completes `hello` handshake and compares package digest, Manifest digest, resource digest, capabilities, and permissions, then sends `execute`. Runners can only return structured `output`, redacted `warnings`, and optional external receipts; cannot send Workflow, rollback, checkpoint, or global variables.

Execution status is only `SUCCESS`, `FAILED`, `UNKNOWN`, `CANCELLED`. Cancellation, timeout, process crash, or late results are converged by the host; plugins must not rewrite UNKNOWN to success.

### Runner Host API Precise Contract

IPC `host_call` method whitelist includes only the following 8 items. Each call must provide `grantRefs`, `idempotencyKey`, `deadlineAt`, `timeoutMs`, and current step identity in the IPC envelope; method input must also carry the method-required `grantId` or reference. `timeoutMs` must not exceed method registration limit, output must not exceed `maxOutputBytes`.

| Method | Required Input | Success Data | Grant/Permission | Risk and External State |
| --- | --- | --- | --- | --- |
| `cloudService.get` | `cloudServiceRef` | ACTIVE object of `gcac.cloud-service/v1` | `cloud.service.get` | Read-only, retryable |
| `artifact.grant.read` | `grantId`, `artifactRef` | Restricted Artifact content/digest | `artifact.read` | HIGH, no auto-retry |
| `secret.grant.resolve` | `grantId`, `secretRef`, `purpose` | Temporary Secret result | `secret.resolve` | CRITICAL, no auto-retry |
| `crypto.sign` | `grantId`, `secretRef`, `data`, `hashAlgorithm`, `signatureAlgorithm` | Signature result, never returns private key | `crypto.sign` | CRITICAL, no auto-retry |
| `crypto.hmac` | `grantId`, `secretRef`, `publicValueRef`, `publicValuePlaceholder`, `data`, `hashAlgorithm` | `signatureBase64`, `publicValue` | `crypto.hmac` | CRITICAL; key used only within host decryption boundary |
| `http.request` | HTTPS `url`, `method`, `headers`, optional `directoryUrl`, `body` | `statusCode`, `headers`, `body`, `bodyText` | `network.http` | HIGH; timeout may result in UNKNOWN |
| `execution.isCancelled` | `executionId`, `executionStepId` | Cancellation status | `execution.cancel.read` / `execution.cancel` | Read-only |
| `audit.append` | `eventType`, `action`, `resourceType`, `resourceId`, `result` | `ok` | `audit.append` | Append-only, cannot modify history |

All failure results must conform to the following structure, with `secretRedacted` fixed to `true`:

```json
{
  "ok": false,
  "error": {
    "code": "HOST_API_DENIED",
    "message": "Grant does not include network.http",
    "retryable": false,
    "mayBeUnknown": false,
    "details": { "method": "http.request" },
    "secretRedacted": true
  }
}
```

For `crypto.hmac`, `publicValueRef` is the Secret reference for the public identifier (e.g., AccessKeyId), `secretRef` is the HMAC key; `publicValuePlaceholder` must appear in the data to be signed. The host returns the public value and signature, never the key:

```json
{
  "grantId": "grant-cloud-1",
  "secretRef": "secret://api_token/access-key-secret#current",
  "publicValueRef": "secret://api_token/access-key-id#current",
  "publicValuePlaceholder": "__PUBLIC__",
  "data": "GET&/__PUBLIC__&Action=Describe&Timestamp=2026-08-24T00%3A00%3A00Z",
  "hashAlgorithm": "SHA-256",
  "keySuffix": "&signatureNonce"
}
```

Prohibited capabilities include `plugin.invoke`, `database.query`, `repository.call`, `filesystem.read/write`, `process.spawn/execute`, `agent.execute`, `execution.checkpoint.save/load`, and `resourceLock.acquire/release`. Runners cannot bypass these restrictions through unregistered methods.

## 4. Manifest Capabilities and Resources

Manifest fixed root fields:

```json
{
  "apiVersion": "gcac.plugin-manifest/v1",
  "kind": "GcacPlugin"
}
```

Required business information includes `pluginId`, SemVer `version`, display name and description Locale keys, `publisher`, `runtime`, `source`, `scope`, `trust`, `support`, `capabilities`, `permissions`, `compatibility`, and `resources`.

Runtime options are limited to:

- `AGENT_PLAN`: Generate Agent v2 plans, jointly authorized by host Policy Authority, Execution Grant, and Agent local policy.
- `WORKFLOW_DSL`: Publish `gcac.workflow/v1` workflows, with host executor controlling steps, locks, snapshots, rollback, and recovery.

Resource mapping can include:

| Resource | Purpose |
| --- | --- |
| `logos` | Horizontal and square SVG logos; horizontal viewBox must be `0 0 72 48`, square must be `0 0 72 72` |
| `runtimeEntrypoint` | Fixed to `runtime/index.js`, only for Runner exception entry |
| `agentPlans` | Agent v2 plan templates |
| `workflows` | Workflow DSL for capabilities |
| `inputContracts` | Variable, connection, credential, and Artifact input contracts |
| `actionContracts` | Action input/output and behavior contracts |
| `forms` | Device or advanced configuration forms; cloud account onboarding does not use Provider-specific forms |
| `presentations` | Device, application, certificate binding, or cloud resource presentations |
| `locales` | Locale text resources |
| `discoveryMappings` | Control plane discovery mappings |
| `agentDiscoveryMappings` | Agent discovery mappings |
| `onboarding` | Application asset unified onboarding recipe. Currently Alibaba Cloud CDN does not declare this resource; it reuses `DeviceOnboardingWizard.vue` from the `/assets` add asset interface, submits via plugin form, and backend creates `ServiceAsset(CLOUD_SERVICE)` |

Package can have at most 500 resource files with total size up to 20 MB. Resource paths must be relative to package root; ordinary resources prohibit `.js/.mjs/.cjs/.ts/.tsx/.vue/.ps1/.sh/.bat/.cmd/.exe/.dll/.so/.dylib` and other executable files, except for fixed `runtime/index.js`. Logos prohibit scripts, animations, external links, `foreignObject`, and external images.

### `credential.acquire` Manifest Contract

Only when capability `credential.acquire` is declared can `manifest.credentialAcquire` be provided; conversely, providing this field will be rejected by Manifest Schema. This capability is fixed to execute in `CONTROL_PLANE`, with input and output Schema bound by capability registry to `gcac.credential-acquire-input/v1` and `gcac.credential-output/v1`.

The fixed entry in capability registry is `credential.acquire / v1 / credential.acquire.v1 / HIGH / CONTROL_PLANE`; the actual `credentialAcquire` object in Manifest is:

```json
{
    "inputContractVersion": "gcac.credential-acquire-input/v1",
    "loginUrl": "https://login.example.test/sign-in",
    "allowedOrigins": ["https://login.example.test", "https://sso.example.test"],
    "output": {
      "version": "v1",
      "parameters": {
        "sessionId": {
          "secretType": "session_id",
          "required": true,
          "delivery": { "location": "cookie", "name": "session_id" }
        },
        "csrfToken": {
          "secretType": "api_token",
          "required": false,
          "delivery": { "location": "header", "name": "x-csrf-token" }
        }
      }
    }
  }
```

`loginUrl` and each `allowedOrigins` must be HTTP(S) URLs; output parameter names can only use English identifiers, `secretType` can only be `password`, `api_token`, `session_id`, `ssh_key`, `private_key`, or `certificate_private_key`; delivery location can only be `header`, `query`, `cookie`, `local_storage`, `session_storage`. At least one output parameter must be declared. Runtime automatically merges login Origin into whitelist; mismatched Origin, TTL less than 60 seconds or exceeding 1 hour, undeclared output, and excess output will all fail and close.

Browser session APIs are:

| Interface | Purpose and Key Gates |
| --- | --- |
| `POST /api/v1/credentials/browser-sessions` | Create session; requires `pluginVersionId`, credential configuration, share password, supports `X-Idempotency-Key`, TTL 60-3600 seconds |
| `GET /api/v1/credentials/browser-sessions/:id` | Query status, fixed plugin version/Workflow version, Origin, and output parameter names; does not return Secret |
| `GET/POST /api/v1/credentials/browser-sessions/:id/connect` | One-time temporary URL and share password to establish controlled VNC; only allows contract Origin |
| `GET /api/v1/credentials/browser-sessions/:id/vnc/:path*` | Proxy VNC static/WebSocket resources, does not expose Browser Runtime port |
| `POST /api/v1/credentials/browser-sessions/:id/acquire` | Run `browser` Workflow in same BrowserContext, strictly validate output contract and save credential version |
| `POST /api/v1/credentials/browser-sessions/:id/cancel` | Stop session; saved or closed sessions cannot be recovered |

## 5. Form Contract

The universal form protocol is `gcac.plugin-form/v1`. Field types include text, multiline text, integer, decimal, password, Secret reference, credential reference, single select, multi select, switch, datetime, key-value, object list, file reference, certificate reference, read-only text, hint, and divider.

Directly reusable standard fields include:

`connection.address`, `connection.port`, `connection.basePath`, `connection.timeoutSeconds`, `connection.gatewayId`, `authentication.mode`, `authentication.credentialId`, `authentication.clientCertificateRef`, `tls.enabled`, `tls.verifyPeer`, `tls.ignoreCertificateErrors`, `tls.serverName`, `tls.caSecretRef`, `tls.minimumVersion`, `device.displayName`, `device.description`, `device.tags`, `target.name`, `target.labels`.

Forms can declare sections, required fields, default values, validation, conditional visibility, conditional enablement, static options, and low-risk read-only Action dynamic options. Credential fields must list allowed credential types, Secret types, scopes, and usage purposes.

Prohibitions: Do not use ordinary `password` fields to store passwords; do not use `credential_ref` without purpose; do not change standard sensitive fields to non-sensitive fields; dynamic options must not invoke high-risk capabilities; field conditions must not form cycles.

## 6. Presentations and Standard Objects

The host accepts four types of presentation resources:

- `gcac.device-presentation/v1`: Device overview, Framework, Site, certificate binding, logs, and execution record tabs.
- `gcac.application-presentation/v1`: Application asset types, profiles, overview fields, and actions.
- `gcac.certificate-binding-presentation/v1`: Certificate binding detail fields and actions.
- `gcac.plugin-presentation/v1`: Cloud resource columns and sensitive field declarations.

Presentation fields can only reference stable `valuePath`, with types of text, number, status, time, link, badge, or read-only text. Action `capabilityKey` must be a capability already declared in Manifest; new actions cannot be created in presentation resources.

Discovery capabilities use `gcac.device-discovery/v2`, must return stable keys and actual relationships among devices, frameworks, sites, ManagedTargets, certificates, certificate bindings, and warnings. Certificate paths, KeyStores, service names, and other deployment facts must be marked as asset facts; default values cannot masquerade as discovery results. Return arrays have quantity limits and must not contain passwords, Secrets, Tokens, private keys, Authorization, or Cookies.

## 7. Onboarding Recipes and Certificate Artifacts

Onboarding recipes use versioned `gcac.application-onboarding` contract for application asset onboarding. Device resources use `MANAGED_TARGET`. Currently Alibaba Cloud CDN does not use this session or recipe; it is submitted from the `/assets` add asset interface to compatible device onboarding API, backend creates `ServiceAsset(CLOUD_SERVICE)`, and binds Framework/Site by `serviceAssetId`. Plugins are not responsible for certificate selection, deployment, verification, or rollback, nor should they add vendor-specific entry points.

Certificate deployment input contracts are grouped by variables, connections, credentials, and Artifact Slots. Standard output roles for certificate Artifacts include `leafPem`, `privateKeyPem`, `orderedChainPem`, `fingerprintSha256`, `pfxBase64`, and `pfxPassword`. Plugins declare required formats and output roles; host is responsible for artifact generation, passwords, chain order, fingerprints, and Grants; plugins are only responsible for target-side upload, switch, refresh, and read-back.

Tomcat `KEYSTORE` plugin's `keystorePassword` is an optional Credential Slot, only allowing `PASSWORD` or compatible `USERNAME_PASSWORD`. Password priority is fixed to "explicit Credential → Agent auto-reads from authorized `configPath` → fail-close"; explicit Credential resolution failure must not fall back. Tomcat runtime material does not output `pfxPassword`; Agent must open both target's existing KeyStore and the Artifact to be written with the same password before writing, ensuring artifact password matches Tomcat's current configuration.

## 8. Explicitly Unexposed Capabilities

The following capabilities do not exist in host contracts; plugins must not invoke them through any variants:

`plugin.invoke`, `database.query`, `repository.call`, `host.service.invoke`, `filesystem.read/write`, `process.spawn/execute`, `agent.execute`, `execution.checkpoint.save/load`, `resourceLock.acquire/release`.

Plugins must not read host environment variables, databases, files, complete workflow objects, or other plugins' Grants, nor write keys to logs, ordinary variables, Manifests, bindings, or resource files.

## 9. Host Control Plane Interface Index

The following are official interfaces used during development and acceptance, all protected by tenant, role, and object access control:

| Interface | Purpose |
| --- | --- |
| `GET /api/v1/plugin-catalog` | Query visible plugin catalog |
| `POST /api/v1/plugin-catalog/refresh-builtins` | Refresh plugin catalog (bundle builtins and import current tenant user plugins) |
| `GET /api/v1/plugin-versions`, `GET /api/v1/plugin-version-groups` | Query versions and version groups |
| `GET /api/v1/plugin-version-management/:pluginVersionId` | View import, permissions, and state details |
| `POST /api/v1/plugin-packages/import` | Import Manifest and resources |
| `POST /api/v1/plugin-versions/approve-permissions` | Approve permissions |
| `POST /api/v1/plugin-versions/enable`, `disable`, `retire` | Enable, disable, or retire version |
| `GET /api/v1/plugin-versions/upgrade-diff` | Compare capability, permission, and resource changes between two versions |
| `GET /api/v1/plugin-form/standard-fields` | Query standard form fields |
| `GET /api/v1/plugin-capabilities` | Query host capability contracts |
| `GET /api/v1/plugin-versions/ui-resources` | Read form, presentation, and Locale resources |
| `GET /api/v1/plugin-versions/:pluginVersionId/resources/logos/:variant` | Read Logo |
| `POST/GET/PATCH /api/v1/plugin-bindings` | Create, query, and update Binding |
| `POST /api/v1/capability-assignments` | Set capability assignment |
| `POST /api/v1/capability-assignments/resolve` | View final capability source adopted by a target |
| `/api/v1/cloud-account-assets/*` | Legacy CloudAccountAsset compatibility interface; currently still registers read/write, connection test, and discovery; must not be used as new cloud service onboarding path |
| `GET /api/v1/managed-targets/:id/deployment-capabilities/:capabilityKey` | View effective capability for managed target |
| `GET /api/v1/managed-targets/:id/compatible-plugins` | Query compatible plugins |
| `POST /api/v1/managed-targets/:id/deployment-input-projection` | Generate application asset deployment input projection |
| `PUT /api/v1/application-assets/:applicationAssetId/managed-target` | Save application asset managed target and plugin override |
| `POST /api/v1/plugin-promotions/preview`, `confirm`, `revoke`; `GET /api/v1/plugin-promotions` | Preview, confirm, revoke Standalone target aggregation |
| `GET /api/v1/plugin-runtime/metrics` | View Runner runtime metrics |

Browser credential session interfaces are covered in [`credential.acquire` contract](#credentialacquire-manifest-contract); they use `credential.create` / `credential.read` RBAC and are not part of plugin Runner Host API.

Cloud services must bind at least `cloud.service.connection-test` and `cloud.service.discover`, with `ownerType=SERVICE_ASSET`; certificate issuance, renewal, revocation, and other capabilities must use CA capability contracts or V1 DSL Workflow; certificate lifecycle cannot be secretly attached to cloud service identity binding. Alibaba Cloud CDN reuses `DeviceOnboardingWizard.vue` and `/api/v1/devices/onboarding` from asset center's "Add Asset" action; server saves `ServiceAsset(assetKind=CLOUD_SERVICE)`, discovery results are projected to Framework/Site. Currently plugins do not declare executable management endpoints and cannot generate certificate ManagedTargets based on this. `/providers` is no longer a secondary menu, but old CloudAccount interfaces still exist.

## 10. Application Asset Unified Onboarding Session

After declaring `resources.onboarding`, plugins can access application asset unified session. This session is for application assets and device targets; currently Alibaba Cloud CDN cloud service does not use this session suite and the following steps should not be applied to cloud service assets:

1. `GET /api/v1/application-onboarding/platforms`: List available platforms and plugin versions for current tenant.
2. `POST /api/v1/application-onboarding/sessions`: Create session with `platformKey`, must include `X-Idempotency-Key`.
3. `GET /api/v1/application-onboarding/sessions/:id/resources`: Read available device resources.
4. `POST /api/v1/application-onboarding/sessions/:id/resource-selection`: Submit `ResourceRef(kind,id)` and common resource fields, with `expectedStateVersion`; new devices enter standard device onboarding.
5. `POST /api/v1/application-onboarding/sessions/:id/test`: Execute connection test.
6. `POST /api/v1/application-onboarding/sessions/:id/discover`: Execute identity detection and discovery, obtain selectable targets.
7. `POST /api/v1/application-onboarding/sessions/:id/target-selection`: Submit `TargetRef(kind,id,fingerprint)` and optional access domain and verification address.
8. `GET /api/v1/application-onboarding/sessions/:id/certificate-options`: Read certificate options conforming to recipe format.
9. `POST /api/v1/application-onboarding/sessions/:id/certificate-selection`: Submit precise `certificateId` and `certificateVersionId`, or use recipe-allowed latest valid version.
10. `POST /api/v1/application-onboarding/sessions/:id/complete`: Submit onboarding, generate configuration result or V1 DSL deployment plan according to recipe capability.

All write steps must carry `expectedStateVersion`; old versions will be rejected to prevent users from selecting targets after discovery results expire. Session expires by default after 30 minutes; sessions in progress and with generated plans cannot be cancelled. `DIRECT_WORKFLOW` recipe must also have connection, discovery, and execution Workflows of the same plugin version, and target must be ACTIVE and provide real endpoint; cloud resources without execution capability can only save "configured"; host will not accept addresses, accounts, or passwords that bypass discovery.

### Application Onboarding Recipe Schema

Complete fields in recipe body are as follows; Manifest only stores resource path (`resources.onboarding.applicationAsset` or `applicationAssets`), Loader will calculate `recipeHash` and fix `pluginVersionId + recipeHash` into session:

```json
{
  "protocol": "gcac.application-onboarding/v1",
  "platformKey": "device.example",
  "displayNameKey": "plugin.example.name",
  "platformMetadata": {
    "capabilityVersion": "v1",
    "compatibilityKeys": ["plugin.example.compatibility"],
    "requiredInformationKeys": ["plugin.example.address", "plugin.example.credential"]
  },
  "supportStatus": "SUPPORTED",
  "deploymentMode": "MANAGED_TARGET",
  "deviceResourceType": "device.example",
  "deviceSelection": "EXISTING_OR_NEW",
  "newDeviceOnboarding": { "kind": "PLUGIN_MANAGED", "pluginId": "device.example" },
  "forms": { "device": "forms/device.json", "advanced": "forms/advanced.json" },
  "capabilities": {
    "connectionTest": "device.connection.test",
    "identity": "device.identity.detect",
    "discovery": "device.discover"
  },
  "targetProjection": {
    "targetType": "tls.binding",
    "frameworkTypes": ["web.example"],
    "displayFields": ["displayName", "endpoint.port", "frameworkType"],
    "identityFields": ["managedTargetId", "configFingerprint"],
    "selectableWhen": "selectable === true"
  },
  "deploymentDefaults": {
    "capabilityKey": "certificate.deploy",
    "variables": { "allowInsecureTls": false },
    "connections": { "management": { "port": 443 } },
    "credentials": { "management": { "credentialId": "credential-1" } },
    "certificateFormat": { "format": "PEM", "configName": "Host default PEM Bundle" }
  },
  "certificate": {
    "acceptedFormats": ["PEM"],
    "requiredArtifacts": ["leaf", "privateKey"],
    "defaultVersion": "LATEST_VALID"
  },
  "commit": { "executionSource": "PLUGIN", "inputContract": "certificate.deploy.v1" }
}
```

Field constraints:

| Field | Contract |
| --- | --- |
| `deploymentMode=MANAGED_TARGET` | Must have `deviceResourceType`; `deviceSelection` cannot be `NONE`; cannot declare `workflowExecution`; `commit.executionSource` must be `PLUGIN` |
| `deploymentMode=DIRECT_WORKFLOW` | Must not have `deviceResourceType` or device forms; must declare `workflowExecution`; `commit.executionSource` must be `WORKFLOW`; host must find same version connection, discovery, execution three published Workflows |
| `deviceSelection=EXISTING_OR_NEW` | Must have `newDeviceOnboarding` or device forms; `AGENT_INSTALL` can only open unified Agent/device wizard; plugins cannot register Agent themselves |
| `targetProjection` | `targetType`, `displayFields`, `identityFields`, `selectableWhen` required; stable identity must include at least `managedTargetId` and `configFingerprint` |
| `certificate` | `acceptedFormats` and `requiredArtifacts` non-empty; certificate version selection still requires submitting precise `certificateId + certificateVersionId` |
| `deploymentDefaults` | Only applicable to `MANAGED_TARGET`; its `capabilityKey` must be declared by Manifest; defaults cannot override `fixed` inputs |

### Onboarding Session Response Schema

`GET /sessions/:id` returns the following fields; server may populate optional fields based on stage; will not return passwords, private keys, or Secret plaintext:

```json
{
  "id": "onboard-1",
  "tenantId": "tenant-1",
  "actorId": "user-1",
  "platformKey": "device.example",
  "pluginVersionId": "plugin-version-1",
  "recipeHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "state": "TARGET_SELECTION_REQUIRED",
  "stateVersion": 4,
  "deploymentMode": "MANAGED_TARGET",
  "deviceId": "device-1",
  "assetId": "asset-1",
  "discoverySnapshotId": "snapshot-1",
  "targets": [{
    "managedTargetId": "target-1",
    "targetType": "tls.binding",
    "displayName": "example.test:443",
    "endpoint": { "host": "example.test", "port": 443, "protocol": "HTTPS" },
    "certificateStatus": "PRESENT",
    "configFingerprint": "fingerprint-1",
    "selectable": true
  }],
  "inputSnapshot": {},
  "idempotencyKey": "onboarding-unique-1",
  "createdAt": "2026-08-24T00:00:00.000Z",
  "updatedAt": "2026-08-24T00:05:00.000Z",
  "expiresAt": "2026-08-24T00:30:00.000Z"
}
```

Valid states include `CREATED`, `PLATFORM_SELECTED`, `RESOURCE_SELECTION_REQUIRED`, `DEVICE_INPUT_REQUIRED`, `DEVICE_ONBOARDING`, `WAITING_AGENT`, `CONNECTION_TESTING`, `DISCOVERING`, `TARGET_SELECTION_REQUIRED`, `CERTIFICATE_SELECTION_REQUIRED`, `READY_TO_COMMIT`, `COMMITTING`, `PLAN_CREATED`, `FAILED`, `CANCELLED`. `COMMITTING` and `PLAN_CREATED` cannot be cancelled; expired sessions converge to `FAILED`.

### Application Onboarding API Index

| Method | Request Key Fields | Success Result/Stage |
| --- | --- | --- |
| `GET /api/v1/application-onboarding/platforms` | `locale` optional | Platform cards, plugin versions, Logos, business metadata, and certificate formats; returns only highest ENABLED version |
| `POST /api/v1/application-onboarding/sessions` | `{ platformKey }`, must have `X-Idempotency-Key` | 201 + session with fixed `pluginVersionId`, `recipeHash` |
| `GET /api/v1/application-onboarding/sessions/:id` | None | Complete session Schema |
| `GET /api/v1/application-onboarding/sessions/:id/devices` | None | `{ items: OnboardingDeviceOptionDto[] }`; lists only current tenant devices passing capability health check |
| `POST /api/v1/application-onboarding/sessions/:id/resource-selection` | `expectedStateVersion`, `mode`; existing device requires `deviceId`, new device requires form `values` | Enter `CONNECTION_TESTING` or `DEVICE_ONBOARDING`; new device calls `credential.create` |
| `POST /api/v1/application-onboarding/sessions/:id/test` | `expectedStateVersion` | Connection success enters `DISCOVERING` |
| `POST /api/v1/application-onboarding/sessions/:id/discover` | `expectedStateVersion` | Discover real targets and enter `TARGET_SELECTION_REQUIRED` |
| `GET /api/v1/application-onboarding/sessions/:id/targets` | None | `{ items: OnboardingTargetOptionDto[] }` |
| `POST /api/v1/application-onboarding/sessions/:id/target-selection` | `expectedStateVersion`, `managedTargetId`, `configFingerprint`; optional `accessDomain`, `verifyUrl`, `inputBindings` | After target fingerprint verification enters `CERTIFICATE_SELECTION_REQUIRED` |
| `GET /api/v1/application-onboarding/sessions/:id/certificate-options` | `certificateAssetId` optional | Assets and versions filtered by recipe `acceptedFormats` |
| `POST /api/v1/application-onboarding/sessions/:id/certificate-selection` | `expectedStateVersion`, `certificateId`, `certificateVersionId`, optional `selectionMode=EXPLICIT/LATEST_AUTO` | After precise version verification enters `READY_TO_COMMIT` |
| `POST /api/v1/application-onboarding/sessions/:id/complete` | `expectedStateVersion` | Generate application asset, deployment plan or execution record, enter `PLAN_CREATED` |
| `POST /api/v1/application-onboarding/sessions/:id/cancel` | `expectedStateVersion` | Enter `CANCELLED`; rejected after committing/completed |

All write requests must pass `service_asset.manage`, read requests pass `service_asset.read`; new devices additionally require `credential.create`. State version conflicts must re-read session; cannot blindly replay.

## 11. Full Agent Fact Boundary

Full Agent is the only collection entry point for web server and host runtime facts. Control plane requests facts from Windows/Linux Full Agent via `agent.fact.collect`; Agent returns `AgentFactEnvelopeV1` with TTL, digest, and warnings; plugins can only consume host-projected `gcac.device-discovery/v2` and `ManagedTarget`, cannot directly read Agent files, processes, or databases.

Allowed atomic fact types are:

| Fact | Allowed Fields | Purpose |
| --- | --- | --- |
| `process` | PID, parent PID, absolute executable path, optional SHA-256, redacted command line, start time | Prove actual running framework and version entry |
| `service` | Service name, status, executable path, startup type | Prove Windows Service/systemd runtime state |
| `listening_port` | Address, port, protocol, optional PID | Prove listening endpoint |
| `file_stat` / `file_content` | Absolute path, existence/size/digest; content max 64 KiB Base64 | Read effective config tree and file digest; content must be restricted |
| `certificate_file` / `certificate_store` | Path/store, subject, fingerprint, validity period, has private key | Report only certificate public digest, not private key |
| `privilege` | Principal, is elevated, groups | Determine permission boundary before write |

Full Agent facts must not carry `product`, `framework`, `provider`, `detected`, or `deploymentSemantic` and other product judgment fields; product mapping is completed by host projector based on facts. Framework, site, TLS binding, certificate path, KeyStore, service name, and refresh method for Nginx, Apache, Tomcat, IIS must come from real processes, services, listening ports, runtime arguments, and effective config tree. Plugins must not:

- Scan the same host themselves and establish a second Web Discovery chain;
- Guess missing facts with default paths, default sites, ports, or vendor versions;
- Require users to re-enter deployment paths, certificate bindings, or service names already confirmed by Full Agent;
- Treat Fixtures, candidate compatibility, or static Manifest as on-site discovery success.

Gateway Agent and Full Agent are independent product boundaries. Gateway only provides relay connections, does not produce Full Agent's Web facts; without `FULL_WEB_DISCOVERY` facts and `discoverySource=AGENT` targets, plugins can only report "undiscovered/pending on-site verification", cannot proceed to certificate write.

Fact package example (digest fields must be actually calculated by Agent; digests below are placeholders only):

```json
{
  "contractVersion": "gcac.agent-security/v1",
  "factId": "fact-1",
  "agentId": "agent-1",
  "tenantId": "tenant-1",
  "collectedAt": "2026-08-24T00:00:00.000Z",
  "ttlSeconds": 3600,
  "source": "windows",
  "facts": [
    { "kind": "process", "pid": 4321, "executablePath": "C:\\Program Files\\IIS\\iisexpress.exe" },
    { "kind": "service", "name": "W3SVC", "status": "running", "startType": "automatic" },
    { "kind": "listening_port", "address": "0.0.0.0", "port": 443, "protocol": "tcp", "pid": 4321 },
    { "kind": "certificate_store", "store": "My", "storeLocation": "LocalMachine", "subject": "CN=example.test", "thumbprint": "AA11", "hasPrivateKey": true }
  ],
  "digest": "3333333333333333333333333333333333333333333333333333333333333333",
  "warnings": []
}
```

## 12. Agent Plan, Token, Receipt, Artifact, and Policy Contract

Agent v2 action set is fixed to `agent.fact.collect`, `agent.plan.validate`, `agent.plan.execute`, `agent.execution.receipt`. Plan execution must simultaneously bind Token, Policy Authority Decision, Agent Local Policy, KeySet, short-term Nonce, and Artifact digest all with the same `planDigest`; plugins cannot issue any of these authorization materials.

### 12.1 Agent Plan and Operations

```json
{
  "planVersion": "gcac.agent-security/v1",
  "planId": "plan-1",
  "agentId": "agent-1",
  "tenantId": "tenant-1",
  "pluginId": "web.example",
  "pluginVersionId": "plugin-version-1",
  "capability": "certificate.deploy",
  "operations": [{
    "operationId": "op-install-1",
    "operationType": "certificate.store.install",
    "stage": "execute",
    "input": { "path": "/etc/example/cert.pem", "artifactDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    "dependsOn": [],
    "idempotencyKey": "deploy-asset-version-1-target-1",
    "timeoutSeconds": 120
  }],
  "planDigest": "1111111111111111111111111111111111111111111111111111111111111111",
  "tokenId": "token-1",
  "policyDecisionId": "decision-1",
  "nonce": "nonce-1",
  "expiresAt": "2026-08-24T00:10:00.000Z",
  "writeEffect": true,
  "approvalRef": "approval-1"
}
```

Each operation must have unique `operationId`, whitelisted `operationType`, `stage`, object `input`, dependency array, idempotency key, and 1-3600 second timeout; dependency graph must be acyclic. Plan digest excludes Token/Decision/Nonce/expiry time generated during authorization stage, but includes approval reference and all operations. `agent.plan.validate` must have `writeEffect=false`, `agent.plan.execute` must have `writeEffect=true`.

Digests and signatures in above example are document placeholders; real plans must be recalculated according to Canonical JSON rules in `agent-security.contract.ts` and issued by host/Agent, cannot be directly copied.

### 12.2 Token and Policy Authority Decision

```json
{
  "tokenVersion": "gcac.agent-security/v1",
  "tokenId": "token-1",
  "agentId": "agent-1",
  "tenantId": "tenant-1",
  "pluginId": "web.example",
  "pluginVersionId": "plugin-version-1",
  "capability": "certificate.deploy",
  "actions": ["certificate.store.install"],
  "allowedPaths": ["/etc/example"],
  "allowedServices": ["example-service"],
  "artifactDigests": ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  "policyRef": "policy-1",
  "policyVersion": "2026-08-24.1",
  "issuedAt": "2026-08-24T00:00:00.000Z",
  "expiresAt": "2026-08-24T00:10:00.000Z",
  "nonce": "nonce-1",
  "planDigest": "1111111111111111111111111111111111111111111111111111111111111111",
  "authorityKeyId": "authority-key-1",
  "signature": "base64url-signature"
}
```

```json
{
  "decisionVersion": "gcac.agent-security/v1",
  "decisionId": "decision-1",
  "allowed": true,
  "agentId": "agent-1",
  "tenantId": "tenant-1",
  "pluginId": "web.example",
  "pluginVersionId": "plugin-version-1",
  "capability": "certificate.deploy",
  "actions": ["certificate.store.install"],
  "allowedPaths": ["/etc/example"],
  "allowedServices": ["example-service"],
  "artifactDigests": ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  "policyRef": "policy-1",
  "policyVersion": "2026-08-24.1",
  "planDigest": "1111111111111111111111111111111111111111111111111111111111111111",
  "tokenId": "token-1",
  "nonce": "nonce-1",
  "issuedAt": "2026-08-24T00:00:00.000Z",
  "validUntil": "2026-08-24T00:10:00.000Z",
  "authorityKeyId": "authority-key-1",
  "revocationRef": "revocation-1",
  "reason": "Tenant policy allows this certificate deployment",
  "signature": "base64url-signature"
}
```

Token and Decision actions, paths, services, and Artifact digests must each intersect with the plan; any set exceeding scope, local policy disabled, Key revoked, or time window expired, Agent must refuse execution.

### 12.3 Agent Receipt, Local Policy, KeySet, Revocation, and Nonce

```json
{
  "receiptVersion": "gcac.agent-security/v1",
  "operationId": "op-install-1",
  "planId": "plan-1",
  "planDigest": "1111111111111111111111111111111111111111111111111111111111111111",
  "agentId": "agent-1",
  "tenantId": "tenant-1",
  "tokenId": "token-1",
  "status": "SUCCESS",
  "startedAt": "2026-08-24T00:00:01.000Z",
  "completedAt": "2026-08-24T00:00:04.000Z",
  "operationResults": [{ "operationId": "op-install-1", "status": "installed", "artifactDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
  "nonceConsumed": true,
  "digest": "2222222222222222222222222222222222222222222222222222222222222222",
  "agentKeyId": "agent-key-1",
  "signature": "base64url-agent-signature"
}
```

```json
{
  "policyVersion": "gcac.agent-security/v1",
  "agentId": "agent-1",
  "authorityKeyIds": ["authority-key-1"],
  "allowedActions": ["certificate.store.install"],
  "pathRules": [{ "prefix": "/etc/example", "operations": ["certificate.store.install"] }],
  "serviceRules": ["example-service"],
  "commandRules": [],
  "disabled": false,
  "updatedAt": "2026-08-24T00:00:00.000Z"
}
```

```json
{
  "keySetVersion": "gcac.agent-security/v1",
  "authorityId": "policy-authority-1",
  "activeKeyId": "authority-key-1",
  "keys": [{
    "keyId": "authority-key-1",
    "algorithm": "Ed25519",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\nBASE64\n-----END PUBLIC KEY-----",
    "status": "ACTIVE",
    "notBefore": "2026-08-23T00:00:00.000Z",
    "notAfter": "2026-09-23T00:00:00.000Z"
  }],
  "issuedAt": "2026-08-24T00:00:00.000Z"
}
```

Revocation and one-time consumption records use `TokenRevocationRecordV1`, `DecisionRevocationRecordV1`, `NonceConsumptionRecordV1` respectively, with fields for version, revoked Token/Decision, Authority Key, reason, time; Nonce record must also contain `resultDigest`. Same Nonce cannot be successfully consumed twice.

### 12.4 Artifact Contract and Snapshot

Artifact is immutable artifact generated and authorized by host, not files assembled by plugins themselves. Complete form of Artifact Slot in input contract is:

```json
{
  "kind": "certificate",
  "required": true,
  "configurationMode": "required",
  "lifecycle": "runtime_injected",
  "artifactContract": {
    "outputs": {
      "leafPem": { "role": "leaf", "required": true, "format": "PEM", "encoding": "utf8", "sensitive": true },
      "privateKeyPem": { "role": "privateKey", "required": true, "format": "PEM", "encoding": "utf8", "sensitive": true },
      "orderedChainPem": { "role": "chain", "required": false, "format": "PEM", "encoding": "utf8", "sensitive": false },
      "fingerprintSha256": { "role": "fingerprint", "required": true, "format": "SHA-256", "encoding": "hex", "sensitive": false }
    }
  },
  "descriptionKey": "plugin.example.certificateArtifact"
}
```

Artifact after execution stage resolution enters snapshot only as reference and digest:

```json
{
  "artifactId": "artifact-1",
  "outputs": {
    "leafPem": "artifact://artifact-1/leafPem",
    "privateKeyPem": "artifact://artifact-1/privateKeyPem",
    "orderedChainPem": "artifact://artifact-1/orderedChainPem",
    "fingerprintSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "artifactDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "certificateVersionId": "certificate-version-1",
  "certificateFormatId": "PEM"
}
```

Private keys, PFX passwords, Secrets, and Tokens cannot be written to Plan, Receipt, ordinary variables, Manifest, Binding, or logs; Tomcat's `keystorePassword` is only briefly injected during execution, does not enter discovery facts or ordinary snapshots. Runner reading Artifact must have `artifact.read` Grant, reading Secret must have purpose-explicit `secret.resolve` Grant.

## 13. Complete JSON Schema and Authoritative Source Code Index

The following machine Schemas are the release and acceptance entry points; Markdown examples are only for understanding field relationships, cannot replace them:

| Scope | Schema/Source Code |
| --- | --- |
| Manifest, resources, `credentialAcquire` | `backend/src/modules/plugins/schema/unified-plugins.schema.ts`, `backend/src/modules/plugins/dto/unified-plugins.dto.ts` |
| Capability registry (capabilities, permissions, input/output Schema ID, locks, execution locations) | `backend/src/modules/plugins/capabilities/plugin-capability.registry.ts` |
| Workflow DSL / Browser / `plugin.action` | `backend/src/modules/workflow-templates/schema/workflow-templates.schema.ts`, `backend/src/modules/workflow-templates/dto/workflow-templates.dto.ts` |
| Onboarding Recipe | `backend/src/modules/application-onboarding/recipe/application-onboarding-recipe.schema.ts`, `backend/src/modules/plugins/onboarding/application-onboarding-recipe.dto.ts` |
| Onboarding API and Session DTO | `backend/src/modules/application-onboarding/controller/application-onboarding.controller.ts`, `backend/src/modules/application-onboarding/dto/application-onboarding.dto.ts` |
| Browser Session API | `backend/src/modules/browser-runtime/browser-credential-session.controller.ts`, `backend/src/modules/browser-runtime/browser-credential-session.service.ts` |
| DeploymentInput / Artifact / Resolved Snapshot | `backend/src/modules/deployment-inputs/dto/deployment-input-contract.dto.ts`, `backend/src/modules/deployment-inputs/dto/resolved-deployment-input.dto.ts`, `backend/src/modules/deployment-inputs/schema/deployment-input-contract.schema.ts` |
| Agent Fact/Plan/Token/Decision/Receipt/Policy/KeySet | `backend/src/modules/agents/security/agent-security.contract.ts`, `backend/src/modules/agents/security/schemas/agent-security-v1.schema.json` |
| Policy Authority IPC/Provisioning/Service | `backend/src/modules/agents/security/schemas/policy-authority-ipc-v1.schema.json`, `policy-authority-provisioning-v1.schema.json`, `policy-authority-service-v1.schema.json` |
| Runner Host API and IPC | `backend/src/modules/plugins/runner/protocol/host-api.registry.ts`, `backend/src/modules/plugins/runner/protocol/schemas/host-api-v1.schema.json`, `backend/src/modules/plugins/runner/protocol/schemas/ipc-v1.schema.json` |

Each modification to these contracts must synchronously update this page's `lastVerified`, corresponding project specifications, and plugin iteration notes; unit tests, Fixtures, and Schema passing only prove static contracts, do not prove Agent, browser, external CA, or real vendor on-site success.
