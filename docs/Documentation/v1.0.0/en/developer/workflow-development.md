---
title: Workflow Development Specification
description: TLSFlow v1.0.0 workflow DSL, template sources, input contracts, and execution boundaries
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - backend/src/modules/workflow-templates/dto/workflow-templates.dto.ts
  - backend/src/modules/workflow-templates/schema/workflow-templates.schema.ts
  - backend/src/modules/workflow-templates/domain/workflow-templates.domain-service.ts
  - backend/src/modules/executors/ssh
  - backend/src/modules/executors/curl
  - backend/src/modules/executions/application/executors.ts
  - backend/src/modules/workflow-templates/domain/workflow-canvas.compiler.ts
  - backend/src/modules/deployment-inputs/dto/deployment-input-contract.dto.ts
  - backend/src/modules/deployment-inputs/dto/resolved-deployment-input.dto.ts
  - backend/src/modules/deployment-inputs/schema/deployment-input-contract.schema.ts
testRefs:
  - backend/src/modules/workflow-templates/workflow-templates.test.ts
  - backend/src/modules/workflow-templates/workflow-templates.security.test.ts
  - backend/src/modules/workflow-templates/workflow-step-dispatcher.test.ts
  - backend/src/modules/executions/workflow-executor-adapter.test.ts
  - backend/src/modules/executions/execution-grant-artifact.test.ts
lastVerified: 2026-08-24
---

# Workflow Development Specification

The workflow DSL (Domain-Specific Language) is a TLSFlow proprietary protocol, not arbitrary Shell or JavaScript scripts. The current official template API version is `gcac.workflow/v1`, and templates must use the `CurlSshWorkflow` structure and pass host validation.

The minimal root object is as follows; root fields beyond these will be rejected by the Schema:

```json
{
  "apiVersion": "gcac.workflow/v1",
  "kind": "CurlSshWorkflow",
  "metadata": { "name": "example-certificate-deploy", "version": "1.0.0" },
  "inputContract": {
    "apiVersion": "gcac.deployment-input/v1",
    "variables": {}, "connections": {}, "credentials": {}, "artifacts": {}
  },
  "steps": []
}
```

`metadata.name` is the stable identifier, and `metadata.version` uses SemVer (Semantic Versioning); the integer version in database edit history cannot replace the DSL version. Templates must not carry plaintext passwords, tokens, private keys, or production credentials.

## 1. Template Sources and Versioning

- Built-in templates can only be placed in `backend/src/modules/workflow-templates/builtin-workflows`, released with code and tracked by Git.
- User-imported templates are saved to `data/workflows` and must not be mixed with the built-in directory.
- Workflow resources in plugin packages must match the Manifest plugin version; updating resources requires incrementing the plugin version.
- The integer version in the database `WorkflowTemplateVersion` represents edit/publish history and cannot replace the DSL `metadata.version`.

## 2. Input Contract

Each template must declare a `DeploymentInputContractV1`:

- `variables`: plain values, enums, objects, or arrays;
- `connections`: transport method, host, port, TLS, and SSH Host Key;
- `credentials`: only store `credentialId` and allowed credential types;
- `artifacts`: certificates, private keys, intermediate chains, and output formats.

Fields must specify type, whether required, source, lifecycle, and binding policy. Sources can be asset facts, Binding, default values, derived values, system values, or previous step outputs. `fixed` fields do not allow user overrides; `runtime_injected` are only injected at runtime and do not enter application asset ordinary forms.

Standard projection endpoints are `POST /api/v1/deployment-inputs/projection` and `POST /api/v1/managed-targets/:managedTargetId/deployment-input-projection`. Saving projections and formal pre-checks must reuse the same resolution rules.

Resolution results must be `ResolvedDeploymentInputV1`, containing `assetContext`, four input categories, `provenance` (source chain), `sensitivePaths` (sensitive paths), `issues`, `executable`, and `resolvedSha256`. When blocking Issues exist or `executable=false`, execution must not proceed to SSH, HTTP, Agent, or Gateway. Input snapshots must also pin Assignment, PluginVersion, PluginBinding, WorkflowVersion, credential version, and artifact digest; execution and retries must not re-read the "current latest" configuration.

## 3. Available Steps and Executors

Current workflows use controlled executors such as SSH (secure remote login) and CURL (HTTP request executor), and can invoke plugin Runners via `plugin.action` when explicitly declared. Steps can only read declared inputs and structured outputs from the previous step; they cannot guess Secrets from the template root scope.

Certificate materials are obtained through Artifact Slots, and passwords and tokens through Credential/`secret://` references; PEM, private keys, and Secrets must not enter ordinary variables, command text, logs, or plan JSON.

Current Step types are: `http`, `ssh`, `browser`, `sftp`, `scp`, `condition`, `transform`, `foreach`, `checkpoint`, `checkpoint_verify`, `wait`, `manual`, and `plugin.action`. Certificate deployment stages are fixed as `prepare → backup → install → refresh → verify`; `rollback` is a separate array of the same WorkflowVersion, not commands appended to the main flow. `plugin.execute` belongs only to the legacy plugin Workflow Schema; the current DSL does not accept it.

### HTTP/CURL

HTTP Steps must reference a `connectionRef` from the Contract. Basic, Bearer, API Key, Cookie, custom Header, and mTLS (mutual TLS) are all injected via Credential/SecretRef; URLs only allow HTTP(S), and plaintext remote HTTP is rejected by default. `tls.verify=false` will only execute when the DSL explicitly declares `allowInsecure=true`, the resolved execution authorization contains `allowInsecureTls=true`, and the host has issued a valid short-term `ExecutionGrant` for the current tenant, run, step, and WorkflowVersion; the Grant is revoked after the step ends. `approvalId` is not a TLS connection prerequisite field; execution events must still be recorded according to host audit rules and cannot treat this exception as production target verified. `extract` can read JSON paths, response Headers, regex, or status codes; `assert` can check status codes, JSON paths, Headers, text, regex, and certificate fingerprints.

Device APIs requiring continuous login declare `cookieSessionRef` on the HTTP request. This name is only valid within the current `tenantId`, run ID, and WorkflowVersion; the host maintains an in-memory CookieJar saving all original multi-value `Set-Cookie` entries, calculating subsequent requests by Domain/Path/Secure/Host-only/Expires/Max-Age; ordinary DSL cleans up sessions in workflow finally, and Plugin Runner cleans up sessions in action finally. Cookies do not enter logs, audits, step outputs, SSE, database, or frontend responses; explicit Cookie Header and CookieSession must not be declared simultaneously. Certificate multipart can only use `artifact://` Artifact or controlled PEM output, with filename, Content-Type, size limits, and optional SHA-256; local paths or UNC paths are strictly prohibited. Vendor nLIB/DNA dynamic encoding must be placed in dedicated Runners/adapters and cannot add arbitrary script execution to the generic DSL.

### Browser Step

Browser Steps are executed by the host Browser Runtime, allowing only three actions: `navigate`, `extract`, `verify`, with no arbitrary scripts, selector clicks, or filesystem access. The `url` defaults to the current capability contract; users or existing credentials can explicitly provide an HTTPS login address, and the host will temporarily add the normalized Origin of that address to the current session whitelist; subsequent navigation can only access Origins allowed by the session; navigation, extraction, and verification are completed within the same controlled BrowserContext.

```json
{
  "name": "extract-session",
  "type": "browser",
  "stage": "prepare",
  "browser": {
    "action": "extract",
    "extractions": [
      { "name": "sessionId", "source": "cookie", "key": "session_id", "sensitive": true },
      { "name": "csrf", "source": "header", "key": "x-csrf-token", "optional": true, "sensitive": true }
    ]
  },
  "extract": [{ "name": "browserSession", "type": "outputPath", "path": "sessionId", "sensitive": true }]
}
```

`cookie`, `header`, `local_storage`, `session_storage` must provide a `key`; `url` and `text` do not require a `key`. Sensitive extractions can only enter declared `BROWSER_SESSION` or other credential output contracts; undeclared fields must be discarded and must not be written to ordinary variables, logs, or workflow persistent snapshots.

### Plugin Action Step

`plugin.action` can only invoke a single Action that has been declared and published in the current plugin version Manifest. The host compares Action Contract, input/output Schema digests, capabilities, Grants, timeouts, and idempotency keys before execution; Runners do not receive Workflow, rollback, checkpoint, or global variables.

```json
{
  "name": "cloud-sign-request",
  "type": "plugin.action",
  "pluginId": "cloud.aliyun",
  "capability": "cloud.service.connection-test",
  "actionId": "cloud.service.connection-test",
  "actionContractVersion": "v1",
  "input": { "serviceRef": "{{ asset.cloudServiceRef }}" },
  "inputSchemaSha256": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "outputSchemaSha256": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "timeoutSeconds": 30,
  "writeEffect": false,
  "idempotencyKeyRef": "{{ variables.requestId }}"
}
```

`inputSchemaSha256` and `outputSchemaSha256` must be `sha256:<64 lowercase hex>` digests of resource content; `timeoutSeconds` is 1-3600; `idempotencyKeyRef` must be a variable reference. Runners can only read cloud services, Artifacts, Secrets, signatures, HTTPS, cancellation status, and append audits through the [Host Plugin Capabilities](./host-plugin-capabilities.md#runner-host-api-精确合同).

### SSH/SFTP/SCP

SSH, SFTP (secure file transfer), and SCP (secure copy) use `connectionRef` and Credential Slot. Host Key policy must be explicitly strict verification, trust-on-first-use, or manual approval; file uploads should preferentially write to temporary paths, validate size or hash, then atomically replace. Remote paths, permissions, Owner/Group, expected hash, and timeouts must all enter the plan and audit.

`foreach` must declare `itemsPath`, element variable, and sub-steps, with a maximum of 1000 items and nested up to three levels; only read-only discovery can use `continueOnError`; deployment and rollback are prohibited from using it to mask failures. `plugin.action` can only invoke a single version-pinned Runner Action and cannot take over workflow sequencing.

## 4. Failure, Cancellation, and Rollback

Deployment, changes, and rollback default to fail-closed; only read-only discovery can allow partial continuation per contract. Submission and execution use the current tenant deployment task settings; plugins cannot skip Dry Run or approval on their own.

Workflows should save stable identifiers and old values needed for recovery before write operations, and perform target readback after writes. Timeout or connection interruption may result in unknown external state; non-idempotent write operations must not be automatically replayed; state must converge to failed or UNKNOWN, and users must first confirm the actual target state.

`checkpoint` must declare name, capture paths, and whether required for rollback; `checkpoint_verify` checks drift with actual values and expected hashes. The host creates a recovery ledger and resource lock for formal execution, writes each successful step to the ledger, and reclaims the Grant after step completion. Only idempotent steps allow automatic recovery; non-idempotent steps must be handled manually or perform explicit compensation. Rollback always uses the original WorkflowVersion and input snapshot, and simultaneously preserves the original failure, rollback result, and final verification result.

Windows Remote currently has only planning or mock boundaries and cannot be written into the specification as having production execution capability. Real vendors, Gateways, multi-instance, and external target acceptance must be recorded separately; unit tests cannot replace on-site verification.

## 5. Validation Checklist

1. Schema validation, resource paths, and version consistency pass.
2. Input projection only contains fields declared in the contract; sensitive fields are references, not plaintext.
3. Connection tests, discovery, deployment, readback, and failure rollback all have redacted test records.
4. Permissions, tenant isolation, approval, cancellation, retry, and audit events pass.
5. After adding new steps, stages, variables, or executors, synchronously update project specifications and re-run documentation and related tests.

Certificate deployment workflows must also pin `certificateVersionId` and `certificateFormatId`, with the host generating leaf certificates, private keys, intermediate chains, PFX/P12, JKS, or P7B/P7C artifacts. The `verify` stage must read the actual certificate fingerprint returned by the target service; upload success does not equal deployment success. Result synchronization only updates the current binding state after formal verification succeeds or rollback succeeds.

## 6. Authoritative Schema and Execution Contract Index

The following files are the sole source of machine-verifiable contracts; this document only explains usage and does not duplicate a simplified Schema that may drift:

| Contract | Authoritative Source |
| --- | --- |
| Workflow DSL and Step validation | `backend/src/modules/workflow-templates/schema/workflow-templates.schema.ts`, `backend/src/modules/workflow-templates/dto/workflow-templates.dto.ts` |
| DeploymentInput Contract | `backend/src/modules/deployment-inputs/dto/deployment-input-contract.dto.ts`, `backend/src/modules/deployment-inputs/schema/deployment-input-contract.schema.ts` |
| ResolvedDeploymentInput / Artifact snapshot | `backend/src/modules/deployment-inputs/dto/resolved-deployment-input.dto.ts` |
| Runner `plugin.action` Host API | `backend/src/modules/plugins/runner/protocol/host-api.registry.ts`, `backend/src/modules/plugins/runner/protocol/schemas/host-api-v1.schema.json` |
| Runner IPC v2 | `backend/src/modules/plugins/runner/protocol/protocol.types.ts`, `backend/src/modules/plugins/runner/protocol/schemas/ipc-v1.schema.json` |

After adding or modifying Steps, stages, variables, SecretRef, extract/assert, SSH/CURL, or Runner adapters, you must synchronously update `docs/项目规范/20260723-工作流模板管理及编写规范.md` and record contract digest changes in the plugin iteration notes.
