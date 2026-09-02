---
title: Quick Start (Dashboard)
description: Import certificates from the dashboard quick start entry and proceed to application asset onboarding
docStatus: in_review
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/dashboard/DashboardView.vue
  - web/src/i18n/zh-CN.ts
testRefs: []
lastVerified: 2026-09-02
---

# Quick Start (Dashboard)

"Quick Start" provides two common entries on the dashboard: importing certificates and onboarding existing applications for deployment preparation.

## Complete Sequence for First-Time Use

1. Click "Add Certificate" on the dashboard, select the certificate source, and fill in the certificate, private key, and intermediate certificate chain according to the page prompts.
2. After import is complete, enter the application asset wizard and select the application type to manage.
3. Select an existing device, or complete Agent/agentless device onboarding first, then run discovery.
4. In the discovery results, select compatible sites or services, confirming certificate locations and connection status.
5. After saving the application asset, enter the certificate deployment page, select the deployment method, execute pre-check first, then submit the deployment plan.
6. Return to the dashboard and refresh the page to confirm that the application count, certificate status, and recent execution records have been updated.

## When Entries Are Unavailable

- "Onboard Application" is unavailable: Create certificates, devices, or application assets first, then return to the dashboard.
- No selectable targets in the wizard: Check if devices are online and re-run discovery.
- Other entries unavailable: Contact the system administrator for assistance.

Quick Start does not skip connection tests, pre-checks, approvals, or credential verification. Successful certificate import does not mean deployment is complete; final results should be based on target readback and execution records.

> [Placeholder screenshot: Dashboard "Quick Start" area, highlighting "Add Certificate" and "Onboard Application" entries]
