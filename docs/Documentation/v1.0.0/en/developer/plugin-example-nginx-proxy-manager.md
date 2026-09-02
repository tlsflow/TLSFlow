---
title: "Plugin Example: Nginx Proxy Manager"
description: "Demonstrates device management, discovery, and certificate deployment using the built-in Nginx Proxy Manager plugin"
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - backend/src/modules/plugins/builtin-plugins/device-nginx-proxy-manager
  - docs/插件开发/nginx-proxy-manager/README.md
  - docs/插件开发/nginx-proxy-manager/测试文档/20260821-证书更新流程测试.md
testRefs:
  - backend/src/modules/plugins/builtin-plugin-migration.test.ts
  - backend/src/modules/plugins/application/user-plugin-directory-importer.test.ts
  - docs/插件开发/nginx-proxy-manager/测试文档/20260821-证书更新流程测试.md
lastVerified: 2026-08-24
---

# Plugin Example: Nginx Proxy Manager

The Nginx Proxy Manager (NPM) plugin is currently a built-in plugin `device.nginx-proxy-manager` with manifest version `0.1.11`. The older example version `0.1.7` serves only as historical test evidence and cannot override the current manifest facts. This plugin treats NPM management instances as devices and maps each Proxy Host to a deployable site and TLS binding.

## 1. Device Management

The device form saves the management address, port, HTTP/HTTPS selection, and username/password credentials. The connection test only accesses the root path of the management address to verify network connectivity and TLS; it does not log into NPM, nor does it treat the connection test as confirmation of business API availability.

Login credentials are used only in the first step of the deployment workflow to call `POST /api/tokens` to obtain a JWT (JSON Web Token, a short-lived login token). The JWT is passed as a sensitive step output to subsequent requests and must not be written to the plugin package, ordinary variables, or persisted credentials. Subsequent requests can only reference the JWT using `secret` outputs declared in the current step; the JWT must not be concatenated into ordinary variables or logs.

## 2. Discovery

After a successful device connection test, standard discovery is performed:

1. Call the NPM identity interface to confirm the product family.
2. Read Proxy Hosts and map them to `proxy.host` sites under the `proxy.nginx-proxy-manager` framework.
3. Read certificates and generate `tls.binding` managed targets, saving the Proxy Host ID, current certificate ID, and certificate validity period.
4. Confirm sites, certificate fingerprints, and binding relationships in the device details, then select targets from the application asset wizard.

Discovery results may include warnings for some objects; when target IDs or certificate locations are missing, deployment will fail and abort without guessing default sites.

## 3. Certificate Deployment Workflow

After selecting NPM targets and submitting certificate deployment, the workflow executes in the following order:

1. Log in to obtain a JWT and reference the sensitive step output in runtime request headers.
2. `POST /api/nginx/certificates` to create a temporary custom certificate record with `provider: other`.
3. `POST /api/nginx/certificates/:id/upload` to upload the certificate, private key, and intermediate chain as multipart; NPM handles parsing and validity verification.
4. For each Proxy Host, read the original configuration, replace only the `certificate_id`, then `PUT /api/nginx/proxy-hosts/:id`; do not send fields that NPM 2.11.3 does not accept or overwrite discovered addresses with host defaults.
5. Read back the `expires_on` of the new certificate, then read back each Proxy Host to confirm the `certificate_id` has been switched.

When the optional intermediate chain is missing, it is normalized to an empty string before submission. The workflow does not send fields that NPM 2.11.3 does not accept.

## 4. Rollback and Failure Handling

Before deployment, save the Proxy Host ID, old certificate ID, and the temporary certificate ID created in this round. If any step fails:

1. Re-read the current Proxy Host configuration and restore the old `certificate_id`.
2. Delete the temporary certificate record created in this round that is no longer referenced.
3. Read back the Proxy Host and certificate status again, and write the rollback result to the execution record.

Connection interruptions or write request timeouts may indicate unknown external state; do not directly replay write requests—check the execution record and actual NPM state first.

Rollback must use the original snapshot in the order "old Proxy Host configuration → old certificate ID → this round's temporary certificate ID". If the old certificate is still referenced by other Proxy Hosts, only restore the binding without deleting the old certificate; delete the temporary certificate only after confirming it has no references.

## 5. Real-World Boundaries of This Example

The current code covers NPM API connection, identity, Proxy Host/certificate discovery, and certificate switching logic; actual NPM versions, network policies, certificate chains, and service behavior still require acceptance testing in the target environment. This example does not represent automatic compatibility with all NPM versions or all vendor devices.
