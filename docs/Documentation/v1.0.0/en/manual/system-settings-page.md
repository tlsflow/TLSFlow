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

**System Settings** is where administrators adjust how the current tenant operates. This page covers settings that directly affect day-to-day work; use the dedicated guides for users, roles, credentials and notifications.

## Deployment task parameters

Deployment does not require a separate check action. TLSFlow validates inputs, permissions, connections and target state during submission and execution. Users only need to complete the information requested by the page and confirm the final result in the execution record.

Other changes on the System Settings page do not alter plans that already exist or runs that are already in progress. Whether approval is required is determined by the deployment plan and your organization's process.
