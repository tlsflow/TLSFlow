---
title: Certificate Management
description: Certificate Management top-level menu and operation map for its secondary menus
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/router/menu.ts
  - web/src/router/modules/business.ts
testRefs: []
lastVerified: 2026-09-02
---

# Certificate Management

"Certificate Management" is the entry point for preparing certificates, maintaining certificate sources, and setting deployment file formats. You can prepare certificates first, then go to "Asset Center" to select applications and devices.

| Page | Purpose |
| --- | --- |
| Certificate Assets | Import, view, delete certificate versions, and view usage relationships |
| ACME Automation | Configure ACME providers, accounts, and application/renewal tasks |
| CA Operations | View CA hierarchy, synchronization objects, and internal CA |
| Certificate Format Configuration | Define deployment output formats such as PEM, PFX/P12, JKS |

## Complete Usage Process

1. Import existing certificates in "Certificate Assets", or automatically apply for certificates from ACME.
2. If certificates are managed by enterprise CA, confirm CA and synchronization status are normal in "CA Operations".
3. Pre-prepare formats such as PEM, PFX/P12, JKS required by target systems in "Certificate Format Configuration".
4. Open "Asset Center → Application Assets", select business, certificate version, and executable targets.
5. Enter deployment process and first check pre-check results; complete approval after submission when approval is required.

> [Screenshot placeholder: Certificate Management menu highlighting Certificate Assets, ACME Automation, CA Operations, and Certificate Format Configuration]

## Page Entries and Completion Indicators

| Page | What to Do | Completion Indicator |
| --- | --- | --- |
| Certificate Assets | Import certificates, view versions and usage relationships | List shows domain, status, and expiration time |
| ACME Automation | Automatically apply, renew, and track tasks | Provider is available, task has most recent result |
| CA Operations | View CA hierarchy, objects, and synchronization records | CA status is normal, synchronization record shows success |
| Certificate Format Configuration | Set output method for deployment files | Configuration can be selected in application assets |

## Key Points for Use

- The same domain may have multiple versions; before deployment, verify domain, expiration time, and version fingerprint together.
- Format configuration only determines what type of files to generate and will not write files to servers alone.
- Before deletion or disabling, first check whether applications, automation tasks, and pending deployments are still in use.
- Page times are displayed in browser local time; "Expiring Soon" and "Expired" are prompts requiring priority handling.
