---
title: System Settings Page
description: Configure deployment security and system parameters for the current tenant
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/settings/SettingsView.vue
  - web/src/views/settings/DeploymentTaskSettingsView.vue
testRefs: []
lastVerified: 2026-09-02
---

# System Settings Page

Go to "System Settings → Deployment Task Parameters" to set default check items for certificate deployment. The page has two switches:

- **Enable Dry-run**: Execute read-only pre-check before formal deployment to help identify input and connection issues in advance. Pre-check results are for confirmation use and will not replace formal deployment.
- **Enable Approval Process**: When applications do not have separate approval requirements, determines whether deployment should enter approval first.

## Modify Settings

1. View the current status of the two switches and first confirm approval requirements with the operations manager.
2. Turn the switches on or off as needed and click "Save Settings".
3. After the page prompts "Deployment task parameters saved", use a low-risk test deployment to verify that subsequent tasks execute as expected.

Turning off dry-run will not skip approval requirements or deployment input verification; after turning on approval, tasks still require actual approval by an approver. Setting changes mainly affect runs created afterward; already established plans execute according to their own saved configurations.

> [Placeholder screenshot: Deployment task parameters page, highlighting dry-run, approval process switches, and "Save Settings" button]
