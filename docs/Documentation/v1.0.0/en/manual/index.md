---
title: User Manual
description: A product guide organized around TLSFlow v1.0.0 console workflows
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/router/menu.ts
  - web/src/router/modules/business.ts
  - web/src/views/dashboard/DashboardView.vue
  - web/src/views/application-onboarding/ApplicationOnboardingView.vue
  - backend/src/modules/application-onboarding/application/application-onboarding.service.ts
  - backend/src/modules/application-onboarding/application/onboarding-commit.service.ts
testRefs: []
lastVerified: 2026-09-04
---

# User Manual

This manual helps you manage certificates and application assets in TLSFlow. It is organized around real workflows, so you can start with the section for the task at hand instead of reading everything at once.

## Three Core Concepts

- **Certificate**: The digital certificate installed on a website or service. TLSFlow stores certificate materials and manages certificate versions by domain.
- **Asset**: An object that TLSFlow connects to and manages, such as a device, network device, gateway, or discovered service. For a first update, the asset is the resource where the certificate will be installed.
- **Application**: A website, API, or other TLS service that needs a certificate. An application records its access domain, target site, certificate, and update method.

Preparing for a first update only requires a certificate and an application. The following are advanced concepts you may use for ongoing administration:

- **Credential**: A password, key, or token encrypted by the platform and referenced by connection and deployment tasks.
- **Workflow**: A deployment plan that checks, backs up, writes, verifies, and rolls back a certificate in defined steps.
- **Automation**: A rule that automatically creates and runs update tasks when a certificate gets a new version or at a scheduled time.
- **Execution record**: The actual process and result of one update task, including submission, approval, execution, and verification information.
- **Tenant**: A workspace that isolates people, assets, certificates, and applications. Data and permissions do not cross tenant boundaries.

## Complete an Update from Scratch

For a first deployment, do not configure every underlying object page separately. Start from **Get started here** on the dashboard. The minimum certificate-update configuration has two steps:

1. **Import or create a certificate**: Import existing certificate materials, or use a configured ACME request in the wizard. Confirm that the new version is available, and verify its domains, validity, and fingerprint.
2. **Create the application and update plan**: Select **Deploy to a website or application**, then choose the business platform, device or service, discovered site, access domain, and certificate version in the wizard. After confirmation, the system creates the application; when you select an existing certificate version, it also creates a pending update plan.

After the application and plan are created, open [Certificate Deployment](./certificate-deployment.md), follow the page instructions to submit and execute the update, then confirm the result in [Execution Records](./execution-records.md).

If the wizard has no selectable device or site, use [Asset Center](./asset-center.md) to connect the resource and complete discovery. You do not need to open every advanced page before the first update.

> **Completion standard:** The execution record reports success, and the target service is confirmed to use the selected certificate.

## Find the Right Guide

| Your task | Start here | Related pages |
| --- | --- | --- |
| See what needs attention today | [Dashboard](./dashboard.md) | [Dashboard Quick Start](./dashboard-quick-start.md) |
| Request and import a product license | [License Request and Import](./license-request-and-import.md) | [Licenses](./licenses.md), [First Login](../installation/first-login.md) |
| Connect hosts, network devices, or cloud services | [Asset Center](./asset-center.md) | [Devices](./devices.md), [Agent](./Agent.md), [Gateway](./Gateway.md), [Cloud Accounts](./cloud-accounts.md), [Credentials](./credentials.md) |
| Import certificates and maintain versions | [Certificate Management](./certificate-management.md) | [Certificate Assets](./certificate-assets.md), [Certificate Format Configuration](./certificate-format-configuration.md), [ACME Automation](./acme-automation.md), [CA Operations](./ca-operations.md) |
| Deploy a certificate to a target service | [Certificate Deployment](./certificate-deployment.md) | [Workflow Templates](./workflow-templates.md), [Execution Records](./execution-records.md), [Upgrade and Rollback](./upgrade-and-rollback.md) |
| Run updates repeatedly or by condition | [Automation](./automation.md) | [Monitoring](./monitoring.md), [Notifications](./notifications.md), [Reports](./reports.md) |
| Manage people, permissions, and security | [System Settings](./system-settings.md) | [Users](./users.md), [Roles](./roles.md), [Tenants and RBAC](./tenant-and-rbac.md), [Security Considerations](./security-considerations.md) |
| Back up, recover, or investigate a failure | [Backup and Recovery](./backup-and-restore.md) | [Troubleshooting](./troubleshooting.md), [Upgrade and Rollback](./upgrade-and-rollback.md) |
| Manage plugins and licensing | [Plugin Center](./plugin-center.md) | [Licenses](./licenses.md) |

When something goes wrong, first record the tenant, page, time, plan ID, or run ID. Then follow the evidence order in [Troubleshooting](./troubleshooting.md).
