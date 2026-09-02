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

# Applications

Applications are business endpoints that need certificate protection or updates. They bring together business name, access address, owner, certificate version, and execution targets. All subsequent deployments start here. The page entry is fixed at `/applications`, and the backend entry is fixed at `/api/v1/applications`.

> [Screenshot placeholder: Application asset list showing application name, environment, certificate status, target count, and action buttons]

## Create Application Asset

1. Go to "Asset Center → Applications" and click "Add" or "Application Onboarding".
2. Fill in application name, access domain or IP, environment (such as production/test), and owner.
3. Select devices, sites, or targets that have completed connection tests and discovery. If no targets are available, go to "Devices" first to onboard and discover.
4. Select certificate asset and specific version, then choose the certificate format required by the target system.
5. Follow the wizard to fill in verification address, port, and security credentials required for deployment, and review the auto-generated deployment inputs.
6. On the confirmation page, verify business info, certificate, targets, and deployment method, then click "Save".

> [Screenshot placeholder: Application onboarding wizard steps showing business info, target selection, certificate selection, and confirmation]
>
> [Screenshot placeholder: Application asset confirmation page showing certificate version, targets, and certificate format]

"Save" only saves the business configuration and will not write to target hosts. You must go to "Certificate Deployment" and pass pre-check and approval (if enabled) before execution.

## Modify Application Asset

1. Open application details from the list and click "Edit".
2. Modify business address, owner, targets, certificate version, or output format.
3. When connection information changes, go to the device page first to re-test and discover, then return to save.
4. After saving, reopen deployment pre-check to confirm that new inputs and targets are available.

Deployment plans that have already been created will still execute according to the configuration at creation time and will not automatically change due to subsequent edits.

## Delete Application Asset

Before deletion, first remove automation, pending plans, and other active bindings. The system will check reference relationships; application assets still in use cannot be deleted directly.

## Principles for Selecting Deployment Method

- Prioritize targets explicitly shown as "available" in device discovery results; do not manually fill in paths or service names based on experience.
- If the page provides a "Use workflow override" option, only use it when you truly need custom steps; otherwise, use the default capabilities provided by the device.
- Agent (management program), Gateway (network forwarding entry), SSH, or HTTP are just execution locations or connection methods, not specific vendor capabilities.
- Before saving, confirm that the application has only one clear certificate source and one clear execution method to avoid duplicate deployments for the same application.
