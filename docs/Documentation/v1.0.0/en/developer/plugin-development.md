---
title: Plugin Development
description: TLSFlow v1.0.0 plugin packages, host capabilities, bindings, and complete delivery workflow
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
  - backend/src/modules/plugins/runner/plugin-runner-host-api.handler.ts
  - backend/src/modules/plugins/runner/protocol/protocol.types.ts
testRefs:
  - backend/src/modules/plugins/unified-plugins.test.ts
  - backend/src/modules/plugins/plugin-workflow-publisher.test.ts
  - backend/src/modules/plugins/plugin-form-and-presentation.test.ts
  - backend/src/modules/plugins/plugins-security.test.ts
lastVerified: 2026-09-04
---

# Plugin Development

This page covers the operational workflow from "I want to deliver a working plugin." For complete fields, permissions, and schemas of host capabilities, see [Host Plugin Capabilities Inventory](./host-plugin-capabilities.md); for workflow steps and failure recovery, see [Workflow Development Specification](./workflow-development.md).

The plugin's responsibility is to describe product differences and execute target-side actions. The host's responsibility is to handle tenants, permissions, credentials, certificate artifacts, input snapshots, concurrency locks, auditing, cancellation, rollback, and lifecycle management. Plugins must not treat the host as an arbitrary script executor.

## 0. Deliverable Package Format

User plugins are directory packages; the host does not compile plugin source code into its process. The package root must contain `manifest.json`, and every resource index in the Manifest must point to a UTF-8 text file under that root:

```text
data/plugins/device.example/
├── manifest.json
├── logos/logo.svg
├── logos/logo-square.svg
├── workflows/connection-test.json
├── workflows/discover.json
├── workflows/deploy.json
├── workflows/rollback.json
├── forms/device.json
├── presentations/device.json
├── locales/zh-CN.json
└── runtime/index.js                 # required only when plugin.action is declared
```

Resource paths must use `/`, must not be absolute, must not contain `..`, and must not escape the package through a symlink. `resources` is a map of package-relative paths, not URLs. Hashes are calculated from UTF-8 content normalized to LF. Developers may copy the directory into `data/plugins`, or submit the same content as the API `resources` object; API imports require `resources`. `packageContent` is only used for the package digest; use a stable JSON string such as `{"manifest":<Manifest>,"resources":<raw resource map>}`. Do not submit a Base64 archive or a local filesystem path.

## 0.1 API Authentication, Tenant Context, and Common Rules

Every control-plane request requires an access token obtained from GCAC login and must use HTTPS:

```http
Authorization: Bearer <access-token>
Content-Type: application/json
X-Request-Id: <client-request-id>       # optional; joins audit records
X-Idempotency-Key: <unique-key>          # required for onboarding and retryable writes
```

The tenant context in the token controls visible plugin versions, Bindings, assets, and capabilities; callers must not forge `tenantId` in a request body. Keep the same `X-Idempotency-Key` for the same business intent within one tenant when retrying. Never place passwords, Tokens, private keys, or Cookies in the key, URL, or logs. A 2xx response means that the host accepted the request under the endpoint contract; it does not prove that a target write completed. Continue with execution records and target read-back.

Errors use one JSON object (the HTTP status remains authoritative):

```json
{
  "errorCode": "VALIDATION_FAILED",
  "message": "Plugin request contains undeclared fields",
  "details": { "field": "manifest.resources" },
  "requestId": "req_01"
}
```

Common statuses are `400` (field or Schema error), `401` (missing/expired token), `403` (tenant or business permission), `404` (not found or outside the tenant), `409` (digest or `expectedVersion` conflict), `422` (capability/compatibility/lifecycle rejection), and `500` (host failure). On `409`, GET the current record before editing. On timeout or `UNKNOWN`, never blindly replay a write.

## 0.2 Copyable Lifecycle API Examples

The examples use `$BASE_URL`, `$TOKEN`, `$PLUGIN_VERSION_ID`, and `$BINDING_ID` placeholders supplied by the environment or a previous response. Responses are JSON; timestamp fields are ISO 8601 for API transport only.

Before development, read the host capability registry and standard-field catalog; do not guess contracts from capability names:

```bash
curl "$BASE_URL/api/v1/plugin-capabilities" -H "Authorization: Bearer $TOKEN"
curl "$BASE_URL/api/v1/plugin-form/standard-fields" -H "Authorization: Bearer $TOKEN"
```

The capability response is `{ "items": [{ "key", "contractVersion", "actionContractId", "riskLevel", "idempotency", "permission", "inputSchemaId", "outputSchemaId", "resourceLock", "executionLocations" }] }`. Copy `contractVersion`, `actionContractId`, risk, permission, and execution locations exactly into the Manifest.

Import a user package (the `manifest` and `resources` must match the package directory):

```bash
curl -X POST "$BASE_URL/api/v1/plugin-packages/import" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "X-Request-Id: req_import_01" \
  -d '{"manifest":{...},"resources":{"workflows/connection-test.json":"{...}"},"packageContent":"{...}"}'
```

The successful `201` response contains:

```json
{
  "id": "uplgv_01", "pluginVersionId": "uplgv_01",
  "pluginId": "device.example", "version": "1.0.0",
  "source": "USER", "status": "DISABLED",
  "permissionApprovalStatus": "NOT_REQUIRED",
  "packageSha256": "sha256:<64 lowercase hexadecimal characters>",
  "manifestSha256": "sha256:<64 lowercase hexadecimal characters>",
  "resourceSha256": {"workflows/connection-test.json":"sha256:<64 lowercase hexadecimal characters>"},
  "validationReport": {"valid": true, "errors": [], "warnings": []}
}
```

Only built-in packages submit permission approval; both approval and enable use the returned `pluginVersionId`:

```bash
curl -X POST "$BASE_URL/api/v1/plugin-versions/approve-permissions" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pluginVersionId":"'$PLUGIN_VERSION_ID'","approvedPermissions":["network.http","artifact.read"]}'
curl -X POST "$BASE_URL/api/v1/plugin-versions/enable" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pluginVersionId":"'$PLUGIN_VERSION_ID'"}'
```

Both successful responses return a full `UnifiedPluginVersionRecord`; `status` must be `ENABLED`, and after approval `permissionApprovalStatus` is `APPROVED`. User packages skip approval but still require explicit enable.

Create a Binding and assign a capability:

```bash
curl -X POST "$BASE_URL/api/v1/plugin-bindings" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"pluginVersionId":"'$PLUGIN_VERSION_ID'","mode":"MANAGED","inputBindings":{"apiVersion":"gcac.input-bindings/v1","variables":{"allowInsecureTls":false},"connections":{"management":{"host":"npm.example.test","port":443}},"credentials":{"credential":{"credentialId":"cred_01"}},"artifacts":{ }},"managedContext":{"hostId":"host_01","managedTargetId":"target_01"}}'
```

The response contains `id`, `version: 1`, `status: "ACTIVE"`, and the saved `inputBindings`; store its `id` as `$BINDING_ID`. Then assign the capability:

```bash
curl -X POST "$BASE_URL/api/v1/capability-assignments" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"ownerType":"MANAGED_TARGET","ownerId":"target_01","capabilityKey":"certificate.deploy","pluginVersionId":"'$PLUGIN_VERSION_ID'","pluginBindingId":"'$BINDING_ID'","precedence":"TARGET_OVERRIDE"}'
```

The assignment response contains `status: "ACTIVE"`, owner fields, capability key, plugin version, and Binding IDs. To resolve the effective source, call `POST /api/v1/capability-assignments/resolve` with one locator, for example `{"capabilityKey":"certificate.deploy","managedTargetId":"target_01"}`; the response is either `null` or a complete `CapabilityAssignment` record. Read the referenced PluginVersion, Binding, and compatible-plugin endpoint next to confirm the version is `ENABLED`, the Binding is `ACTIVE`, and compatibility passes.

Binding updates use optimistic locking:

```bash
curl -X PATCH "$BASE_URL/api/v1/plugin-bindings" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"bindingId":"'$BINDING_ID'","expectedVersion":1,"inputBindings":{"apiVersion":"gcac.input-bindings/v1","variables":{},"connections":{},"credentials":{},"artifacts":{}},"status":"ACTIVE"}'
```

On success `version` increments. A concurrent update returns `409`; re-read with `GET /api/v1/plugin-bindings?bindingId=<id>`. UI resources are read with `GET /api/v1/plugin-versions/ui-resources?pluginVersionId=<id>&locale=en-US`, returning `{ pluginVersionId, forms, presentations, locale }`.

## 1. Pre-delivery Directory Structure

First, establish plugin development records, keeping the overview, test evidence, and iteration history separate. The overview should document supported platforms, capability combinations, credential requirements, and verified versions. Preserve import, connection, discovery, or certificate deployment/verification/rollback evidence according to the plugin's actual capability declarations. Cloud service plugins are not required to provide, and must not fake, certificate deployment evidence. Iteration records that no longer match the current implementation must be deleted or replaced by current documentation; they cannot be retained as "deprecated but potentially misused" sources of truth.

## 2. Choose Plugin Form Factor

`runtime` is the package-level resource routing in the Manifest, not a "which machine executes" field. Execution location is determined jointly by capability declarations, target compatibility, steps in the Workflow, and execution bindings generated by the host.

| Scenario | Manifest `runtime` | Required Resources and Execution Path |
| --- | --- | --- |
| Only fixed HTTP/SSH/SFTP/SCP steps needed | `WORKFLOW_DSL` | `resources.workflows`; executed by host DSL Runtime |
| Workflow DSL needs to execute typed plans on Agent | `WORKFLOW_DSL` | Provide both `resources.workflows` and `resources.agentPlans`; only explicit `agent.plan.*` actions with matching Agent execution location and plan resources use Agent v2 |
| Package only provides explicit Agent Plan routing | `AGENT_PLAN` | `resources.agentPlans`; authorized jointly by host Policy Authority, Execution Grant, and Agent local policy |
| Needs minimal code to wrap external APIs | `WORKFLOW_DSL` | Use `plugin.action` in DSL; `runtime/index.js` only executes a single fixed Action, cannot take over Workflow sequencing |

Currently, Manifest only accepts `AGENT_PLAN` and `WORKFLOW_DSL`. Do not carry arbitrary scripts for "flexibility"; ordinary resources must not contain executable code, and the Runner entry point can only be `runtime/index.js`. `WORKFLOW_DSL` and `agentPlans` can coexist; the final executor cannot be determined solely from the `runtime` string.

## 3. Design Capability Contracts

1. Select existing capabilities from the host capabilities inventory, confirming risk level, idempotency, locks, input/output Schema, and execution location.
2. Assign a unique `actionContractId` for each capability, filling in the host-registered value exactly as-is in the Manifest.
3. Clarify compatibility: `productFamilies`, `frameworkTypes`, `targetTypes`, `managementMethods`, `executionLocations`, and `artifactContracts`.
4. Only request the minimum permissions needed to complete the business function. The `certificate.deploy` capability contract requires the registry permission `certificate.deploy`; a Workflow should additionally declare `secret.resolve`, `artifact.read`, `network.http`, and `audit.append` according to the Host APIs it actually calls. Do not treat `device.write` as an alias for `certificate.deploy`; Agent plans require the corresponding `agent.plan.*` permissions.
5. Design target read-back and failure rollback for write operations. Upload success cannot serve as deployment success criteria.

The host resolves plugins through capability assignments, not by adding branches for vendor strings. An application asset can ultimately override device, managed target, or default capabilities, but the resolution order and tenant boundaries are fixed by the host.

## 4. Write the Manifest

Below is a "minimal validatable package" Manifest excerpt. It is not a complete runnable plugin: you must also provide `workflows/connection-test.json`, and that file must pass Workflow Schema validation; resource paths must correspond one-to-one with files in the package.

```json
{
  "apiVersion": "gcac.plugin-manifest/v1",
  "kind": "GcacPlugin",
  "pluginId": "device.example",
  "version": "1.0.0",
  "displayNameKey": "plugins.deviceExample.name",
  "descriptionKey": "plugins.deviceExample.description",
  "publisher": "Example",
  "runtime": "WORKFLOW_DSL",
  "source": "USER",
  "scope": "BOTH",
  "trust": "USER_SIGNED",
  "support": "COMMUNITY",
  "capabilities": [
    {
      "key": "device.connection.test",
      "contractVersion": "v1",
      "actionContractId": "device.connection.test.v1",
      "riskLevel": "LOW",
      "executionLocations": ["CONTROL_PLANE"]
    }
  ],
  "permissions": [],
  "compatibility": {},
  "resources": {
    "logos": { "horizontal": "logos/logo.svg", "square": "logos/logo-square.svg" },
    "workflows": {
      "device.connection.test": "workflows/connection-test.json"
    },
    "actionContracts": {},
    "forms": {},
    "presentations": {},
    "locales": {}
  }
}
```

Key rules:

- `version` uses valid SemVer; increment version when changing capabilities, contracts, workflows, forms, or logos.
- `source=BUILTIN` is only for built-in plugins released with code; user packages use `source=USER`.
- `scope` is `MANAGED`, `STANDALONE`, or `BOTH`; Managed Bindings must have `hostId`, `serviceAssetId`, or historically compatible `cloudAccountAssetId`; Standalone Bindings must not save managedContext. The legacy CloudAccount API may still exist and cannot be described as read-only or retired based on that.
- `trust` and `support` are governance declarations for the package, not execution authorization. Built-in packages with `source=BUILTIN` handle permissions according to built-in policy; Agent Plan form factors use `runtime=AGENT_PLAN`, or route to Agent policy via `resources.agentPlans` under `runtime=WORKFLOW_DSL`; this cannot be written as an additional Manifest `source`. USER plugins remain `DISABLED + NOT_REQUIRED` after import, do not create permission approval records, and only allow administrators to explicitly enable them.
- The Manifest must declare at least one capability and provide corresponding Workflow or Agent Plan resources for that capability.
- `WORKFLOW_DSL` must declare at least one non-empty `resources.workflows`; `AGENT_PLAN` must declare at least one non-empty `resources.agentPlans`. Both resource types can exist simultaneously.

## 5. Prepare Resources

### 5.1 Locales and Logos

Forms, presentations, and Manifest copy all use locale keys. If the package includes forms or presentations, it must provide locales. Logos must be two SVGs: horizontal `viewBox="0 0 72 48"`, square `viewBox="0 0 72 72"`; scripts, external images, animations, or `foreignObject` are prohibited.

The Tomcat KeyStore plugin's password field must be declared as an optional Credential: prioritize `PASSWORD`, support legacy `USERNAME_PASSWORD`; when unbound, the Agent automatically reads from target configuration, and must fail-close when explicit value is incorrect or unreadable. Passwords must not be written to discovery facts, ordinary snapshots, Receipts, audits, or logs; before deployment, must also confirm the generated artifact uses the same password as the target's existing KeyStore.

### 5.2 Device Forms and Credentials

Devices should prioritize reusing standard fields. Cloud service resources are created from the `/assets` add asset interface, and Providers can declare `resources.forms.cloud` in the plugin Manifest to provide credential fields and validation rules; this form is hosted by the current asset addition interface and must not add independent cloud service entry points or Provider CRUD. Sensitive information uses `credential_ref` or `secret_ref`, declaring allowed credential types, Secret types, scopes, and purposes. Do not design passwords as plain text fields, and do not put tokens in default values or placeholders.

Dynamic options in forms can only invoke low-risk read-only capabilities; conditional display and conditional enable must form acyclic dependencies. The standard fields catalog can be queried via `GET /api/v1/plugin-form/standard-fields`.

### 5.3 Presentations

Choose the corresponding presentation protocol for devices, applications, certificate bindings, or cloud resources respectively. Fields use stable `valuePath`, and actions only reference declared capabilities. Do not write product-specific conditionals or sensitive field values in presentation resources.

### 5.4 Discovery Mapping and Onboarding Recipes

Standalone device discovery capabilities must output `gcac.device-discovery/v2`, containing stable keys, true parent-child relationships, available capabilities, ManagedTargets, certificates, and certificate bindings. For Nginx, Apache, Tomcat, IIS frameworks, sites, TLS bindings, and certificate locations, Windows/Linux Full Agents produce these from actual processes, services, runtime parameters, and effective configuration trees; certificate update plugins only consume host projection results and must not establish a second discovery chain, guess default paths, or require users to fill in facts already confirmed by the Agent. For specific boundaries, see [Host Plugin Capabilities Inventory](./host-plugin-capabilities.md).

Application onboarding recipes use `gcac.application-onboarding/v1`. For complete fields and validation rules, see [Host Plugin Capabilities Inventory](./host-plugin-capabilities.md#application-onboarding-recipe-schema).

Currently, Alibaba Cloud CDN does not use `gcac.application-onboarding/v2` onboarding recipes. It reuses `DeviceOnboardingWizard.vue` from `/assets`, submits plugin forms via `POST /api/v1/devices/onboarding`; the backend creates `ServiceAsset(assetKind=CLOUD_SERVICE)`, executing connection tests and resource discovery as `SERVICE_ASSET`. Discovery results are Frameworks and Sites; the plugin does not create Device/Host, is not responsible for certificate deployment, verification, or rollback, and must not implement independent modal dialogs or Provider CRUD bypasses.

## 6. Write Workflow or Agent Plan

### Workflow DSL

Each capability in a `WORKFLOW_DSL` plugin must be mapped to a resource in Manifest `resources.workflows`. The resource root object uses `gcac.workflow/v1` and `CurlSshWorkflow`. Current standard Step types are `http`, `ssh`, `browser`, `sftp`, `scp`, `condition`, `transform`, `foreach`, `checkpoint`, `checkpoint_verify`, `wait`, `manual`, and `plugin.action`. `plugin.execute` only belongs to the legacy plugin Workflow Schema and must not be used in the current standard DSL.

The legacy `PluginWorkflow` Schema of `plugin.execute` is still recognized and validated by `PluginWorkflowSchemaRegistry` for compatibility diagnostics of historical resources; it is not the current publishable format. During the publishing phase, `PluginWorkflowPublisherService` will reject package-level `PluginWorkflow` with `PLUGIN_WORKFLOW_LEGACY_EXECUTOR_FORBIDDEN`, and the runtime Dispatcher will also fail-close again. When migrating, change the entire orchestration to regular `CurlSshWorkflow`, and change individual steps requiring code capability to `plugin.action`; the Runner only executes this Action and does not take over Workflow sequencing, rollback, checkpoint, or global variables.

`browser` only allows three actions: `navigate`, `extract`, `verify`; extraction sources are `cookie`, `header`, `local_storage`, `session_storage`, `url`, or `text`; sensitive results can only enter temporary credentials according to capability contracts. Sessions default to using `credentialAcquire.loginUrl`; users or existing credentials can explicitly provide an HTTPS login address, and the host will temporarily add the normalized login Origin to the current session whitelist; subsequent navigation is still restricted by that session whitelist. `plugin.action` can only invoke a single fixed-version Action; input/output Schema digests, timeout, write effects, and idempotency key references must be declared in the step; the Runner does not accept Workflow, rollback, checkpoint, or global variables. Shell, PowerShell, arbitrary command execution, and download-execute are prohibited.

Certificate deployment is recommended to follow this fixed sequence:

```text
prepare → backup → install → refresh → verify
```

Save the old certificate ID, configuration path, or other stable identifiers before deployment; read back the actual certificate fingerprint from the target after writing; on failure, use the original WorkflowVersion and input snapshot for rollback. Timeout or connection interruption may result in UNKNOWN status; blind replay of write requests is prohibited.

### Agent Plan

`AGENT_PLAN` plugins or `WORKFLOW_DSL` plugins with Agent Plans must provide corresponding `agentPlans`, `inputContracts`, and necessary Workflow entry points for capabilities. Before Agent v2 plan execution, the host validates the plan digest, PluginVersion identity, Execution Grant, Agent Capability Token, Policy Authority Decision, Agent Local Policy, Artifact digest, and Nonce; plugins cannot self-issue Tokens, Decisions, or Receipts.

Certificate update plans must bind unified deployment input snapshots and Artifact digests. `agent.plan.validate` can only preview with `writeEffect=false`; `agent.plan.execute` must have `writeEffect=true`. Plan operations must include unique `operationId`, allowed `operationType`, phase, dependencies, idempotency keys, and timeout, forming an acyclic dependency graph. The host only delivers authorized plans to Agents; plugins must not write private keys, passwords, or Secret plaintext into plan JSON.

## 7. Import and Enable

Place user plugin packages in `data/plugins/<pluginId>/` (can also be specified via `GCAC_USER_PLUGIN_DATA_DIR`), then follow this sequence:

1. Submit Manifest and resources using `POST /api/v1/plugin-packages/import`.
2. Check returned version details, missing resources, capability contracts, and compatibility results.
3. For `source=BUILTIN`, call `POST /api/v1/plugin-versions/approve-permissions` with declared permissions; for `source=USER` (including USER Agent Plans), skip this step; import result should be `NOT_REQUIRED`.
4. Call `POST /api/v1/plugin-versions/enable` to enable the specific version; USER plugins must also be explicitly enabled by administrators.
5. Check forms, presentations, and locales via `GET /api/v1/plugin-versions/ui-resources`.

During import, the host checks root fields, SemVer, capability registration, resource paths, resource count and size, logo security, form/presentation schemas, locale references, and input contracts. Any failure should result in repackaging with incremented version for reimport; do not directly modify already-imported versions.

## 8. Create Bindings and Capability Assignments

When creating a Binding, provide at least `pluginVersionId`, `mode`, and `inputBindings`. Input bindings are divided into variables, connections, credentials, and Artifacts; credentials only write `credentialId`, certificate artifacts only write format and output mapping.

```text
POST /api/v1/plugin-bindings
POST /api/v1/capability-assignments
```

Managed Bindings must also provide `managedContext.hostId`, `managedContext.serviceAssetId`, or historically compatible `managedContext.cloudAccountAssetId`; optional `managedTargetId` restricts to a specific target. Standalone Bindings must not carry managedContext. When updating Bindings, must include `expectedVersion`; on version conflict, read again before editing.

The `pluginBindingId` and `pluginVersionId` in capability assignments must match each other. Cloud service assets can only use `cloud.service.connection-test` or `cloud.service.discover`, and the plugin ID must equal the cloud service asset's `providerKey`; capability owner is `SERVICE_ASSET`.

After onboarding devices or application assets, use `POST /api/v1/capability-assignments/resolve` to verify the final source; before deployment, use the managed target capability interface to confirm the plugin version is enabled, execution location is supported, and compatibility passes.

### Complete Sequence for Device/Application Asset Wizards

If the plugin declares `resources.onboarding`, developers should verify real onboarding in this sequence:

1. `GET /api/v1/application-onboarding/platforms` to view platforms; the host only displays the highest ENABLED version.
2. `POST /api/v1/application-onboarding/sessions` to create a session, with `X-Idempotency-Key`.
3. `GET /api/v1/application-onboarding/sessions/:id` to read session state and fixed `pluginVersionId + recipeHash`.
4. `GET /api/v1/application-onboarding/sessions/:id/devices`, select existing device or jump to unified device wizard according to recipe; adding new devices also requires `credential.create`.
5. `POST /resource-selection`, then call `/test` to complete connection test.
6. Call `/discover`, then use `GET /targets` to select targets from real discovery results.
7. When submitting `/target-selection`, must include both `managedTargetId` and `configFingerprint` to prevent using stale discovery results.
8. Read `/certificate-options`, submit precise `certificateId` and `certificateVersionId` in `/certificate-selection`.
9. Call `/complete` to generate plan or execution record; when user actively exits, call `/cancel`; cannot disguise submitted or completed sessions as cancellable.

Each write step must include `expectedStateVersion`; sessions expire by default after 30 minutes; on expiration or version conflict, must read state again before operating. DIRECT_WORKFLOW can only enter onboarding flow when connection, discovery, and execution Workflows are all published and target is ACTIVE.

### Cloud Service Asset Onboarding Sequence

Current Alibaba Cloud CDN sequence: `/assets → Add Asset → DeviceOnboardingWizard.vue → Plugin Form → /api/v1/devices/onboarding → ServiceAsset → Connection Test → Resource Discovery`.

The cloud service root object is `ServiceAsset(assetKind=CLOUD_SERVICE)`, discovery results project as `ServiceAsset → FrameworkInstance → SiteAsset`; currently Alibaba Cloud CDN does not generate Device, Host, certificate bindings, deployment plans, or certificate workflows.

## 9. Acceptance by Capability Type

All plugins must complete package-level contracts, import lifecycle, Binding/Assignment, tenant isolation, version immutability, sanitization, and idempotency testing; capability-level tests are selected based on actual declarations; do not force execution of inapplicable certificate flows. Preserve the corresponding test evidence.

| Capability Family | Required Tests |
| --- | --- |
| `device.connection.test`, `device.identity.detect` | Real endpoint/credential boundaries, product identity, failure sanitization, and cancellation |
| `device.discover`, `certificate.discover`, `application.discover` | Stable keys, true parent-child relationships, fact sources, quantity limits, warnings, and duplicate discovery idempotency; web servers must verify Full Agent fact chain |
| `certificate.verify` | Target read-back, certificate fingerprint, version/configuration drift, and UNKNOWN convergence |
| `certificate.deploy`, `certificate.rollback` | Artifact Contract, second-newest certificate version, preview/formal execution, write-then-read-back, failure compensation, rollback, and Receipt; only cover CONTROL_PLANE/GATEWAY/AGENT channels actually used by the plugin |
| `cloud.service.connection-test`, `cloud.service.discover` | Cloud account tenant isolation, `crypto.hmac`, separation of public identifiers and keys, resource hierarchy idempotency; certificate deployment not required |
| `ca.*` | CA account/order/challenge/issuance/renewal/revocation corresponding to real protocols, idempotency, external state UNKNOWN, and Secret sanitization |
| `credential.acquire` | Independent Browser Workflow, Origin restrictions, same BrowserContext, output contracts, temporary `BROWSER_SESSION`, and discarding undeclared sensitive outputs |
| `plugin.action` | Runner hello/execute, Action Binding digest, Host API Grant, cancellation, crash, UNKNOWN, late results, and resource limits |

General tests must still cover: Manifest/resource paths/logos/forms/presentations/locales/input contracts, import, enable, disable, retire, Binding update conflicts, duplicate idempotency keys, and version upgrade differences. Unit tests and fixtures can only prove contracts; real vendors, Gateways, Agents, browsers, external CAs, and production networks must be documented separately as evidence. Without field evidence, do not claim "all versions compatible" in plugin documentation.

## 10. Upgrade, Disable, and Retire

Before upgrading, use `GET /api/v1/plugin-versions/upgrade-diff` to compare capabilities, permissions, input contracts, resource digests, and compatibility. Upgrades must import new `pluginId + version`; old versions remain immutable; existing Bindings do not automatically switch.

```bash
curl "$BASE_URL/api/v1/plugin-versions/upgrade-diff?fromVersionId=$OLD_ID&toVersionId=$PLUGIN_VERSION_ID" \
  -H "Authorization: Bearer $TOKEN"
curl -X POST "$BASE_URL/api/v1/plugin-versions/disable" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"pluginVersionId":"'$OLD_ID'"}'
curl -X POST "$BASE_URL/api/v1/plugin-versions/retire" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"pluginVersionId":"'$OLD_ID'"}'
```

The diff response contains `addedCapabilities`, `removedCapabilities`, `addedPermissions`, `runtimeChanged`, `scopeChanged`, `compatibilityChanged`, `bindingRecheckRequired`, and `requiresApproval`. `disable` blocks new executions while retaining records; `retire` marks a version as no longer usable. Both return the updated version record.

After confirming the new version passes applicable capability tests, create or update Bindings and reassign capabilities. Disabling a version blocks new executions; retiring a version stops continued use, but old execution records are retained. When the Runner switches versions, the host first drains old processes, then starts the new version; late-arriving results must not overwrite new version results.

## 11. Common Failure Determinations

| Symptom | Correct Handling |
| --- | --- |
| Capability declaration rejected | Compare against `GET /api/v1/plugin-capabilities` to correct version, contract, risk, and execution location |
| Import succeeds but cannot enable | For non-USER packages, check applicable permission approval; USER plugins should be `NOT_REQUIRED`; also check resource completeness and whether Workflow is published |
| Capability not found | Check if version is ENABLED, Binding is ACTIVE, Assignment belongs to current tenant and target |
| Connection succeeds but discovery is empty | Check if discovery output conforms to v2 and true parent-child relationships; do not add default targets |
| Upload succeeds but deployment fails | Use target read-back verification as standard; check certificate fingerprint and service refresh results |
| Request timeout | Check execution record; status may be UNKNOWN; blind replay of write requests is prohibited |
| Runner rejected | Check if PluginVersion, Manifest/resource digest, capabilities, and permissions in hello match the host |

After completing the above steps, developers should be able to complete plugin development, import, enable, binding, testing, upgrade, and publishing relying only on the Manifest, resource contracts, and host control plane; source code paths serve only as traceability information for implementers and are not prerequisites for plugin use.
