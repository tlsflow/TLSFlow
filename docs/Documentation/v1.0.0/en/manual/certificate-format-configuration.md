---
title: Certificate Format Configuration
description: Prepare deployment output formats and password credentials for a certificate version
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/certificates/CertificateFormatsView.vue
  - backend/src/modules/certificates/application/certificate-format-exporter.ts
testRefs: []
lastVerified: 2026-09-04
---

# Certificate Format Configuration

Format configuration determines which certificate artifact is generated during deployment. It is not the certificate itself and does not trigger deployment. The platform generates files only when a configuration is selected by an application asset or workflow.


## Create a Configuration

1. Open “Certificate Management → Certificate Assets”, open the target version, and select “Format Configuration”.
2. Choose an output format: `PEM`, `PFX / PKCS#12`, `JKS`, `P7B / PKCS#7`, or `DER`.
3. Enter a certificate version ID when the configuration must be bound to one version. Leave it empty to create a reusable template when the page offers that option.
4. Choose whether the output contains a private key. `PFX` and `JKS` require a private key; `DER` and `P7B` cannot contain one.
5. For `PFX` or `JKS`, select a password credential. Enter an alias when the Java keystore target requires one.
6. Select “Create” and confirm that the configuration is available in the list.


The password field represents a credential reference and never reveals the plaintext password. A configuration may be saved without a matching key or password, but deployment submission or artifact generation will fail until the material is fixed.

## Format Guidance

| Format | Typical targets | Confirm before generating |
| --- | --- | --- |
| PEM | Nginx, Apache, and most Linux services | Chain order and whether the target needs a separate private-key file |
| PFX / PKCS#12 | Windows, gateways, and some middleware | Matching private key, password credential, and alias when required |
| JKS | Java application servers | Matching private key, password credential, and alias |
| P7B / PKCS#7 | Certificate-chain-only import scenarios | It has no private key and cannot complete HTTPS setup alone |
| DER | Systems requiring a binary single certificate | The target accepts DER encoding; it has no private key |

## Use It in Deployment

1. Edit the application asset in “Asset Center → Application Assets” and select the certificate version and format configuration.
2. Save, then open Certificate Deployment to confirm that the generated filename, format, and credential references meet the target’s requirements.
3. Review the page messages, then submit for execution or approval.

Changing a format configuration affects plans created afterward. Existing plans retain the configuration snapshot from creation; create a new plan to use the updated rules.

## Edit or Delete

Check for running tasks that depend on a configuration before editing it. Check usage relationships before deletion; the system prevents deleting a referenced configuration. Editing or deleting a configuration does not remove historical files already generated on servers.
