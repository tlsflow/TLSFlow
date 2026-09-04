---
title: Application Assets
description: Create application assets, select certificates and bind managed targets
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/applications/ApplicationsView.vue
  - backend/src/modules/assets
  - backend/src/modules/application-onboarding
testRefs: []
lastVerified: 2026-09-02
---

# Application Assets

An application asset represents a website, API or other TLS service whose certificate needs protection or renewal. It keeps the access address, environment, certificate and deployment target together. Deployments and rollbacks use this configuration as their reference.


## Create an application asset

1. Open **Asset Center → Applications** and select **Add Application**.
2. Enter the application address, port and environment. Add a display name, verification URL or owner when requested.
3. Under **Where should the certificate be updated?**, select a device, service and deployment target that have completed onboarding and discovery. If no target is available, return to Asset Center and add or discover it first.
4. Select the certificate asset and version, then choose the format required by the target system.
5. Enter the deployment credential and any other values requested by the page. Review the generated deployment information.
6. On the confirmation step, verify the address, certificate version, target and execution method, then select **Save**.

**Save** records the application configuration only; it does not write to the target host. Open **Certificate Deployment**, review the page messages, submit the deployment, and wait for approval when approvals are enabled before execution.

## Modify Application Asset

1. Open the application details and select **Edit**.
2. Change the address, port, owner, target, certificate version or certificate format.
3. When connection information changes, re-test and run discovery in Asset Center before saving the application again.
4. Reopen Certificate Deployment after saving and confirm that the new inputs and target are available.

Deployment plans that have already been created will still execute according to the configuration at creation time and will not automatically change due to subsequent edits.

## Delete Application Asset

Before deletion, first remove automation, pending plans, and other active bindings. The system will check reference relationships; application assets still in use cannot be deleted directly.

## Principles for Selecting Deployment Method

- Prefer targets marked **Available** in discovery results; do not guess paths or service names.
- Select **Workflow override** only when custom steps are genuinely required. In most cases, use the target's default capability.
- An Agent is the management program on a target host, while a Gateway is a forwarding node. SSH and HTTP are connection methods, not vendor capabilities.
- Before saving, confirm that the application has one clear certificate source and one execution method to avoid duplicate deployments.


## Deploy an Update Manually

- After saving, return to the application card or list row and select **Deploy update** to choose the certificate version to deploy.
- Before submitting, resolve any credential, format or connection issues shown by the page.
- After deployment, review the execution record, target readback and snapshot. To restore the previous state, start a rollback from the application's snapshot details.
