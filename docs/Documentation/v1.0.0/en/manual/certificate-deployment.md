---
title: Certificate Deployment
description: Approve, execute, and verify certificate changes on target systems
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/router/menu.ts
  - web/src/router/modules/business.ts
  - backend/src/modules/deployment-plans
testRefs: []
lastVerified: 2026-09-04
---

# Certificate Deployment

“Certificate Deployment” installs the certificate selected in an application asset on a target system and records the operation for audit. It contains “Automation”, “Workflow Templates”, and “Execution Records”.


## Start a One-Time Deployment from an Application

1. Open **Asset Center → Applications** and find the application in the cards or list.
2. Select the application's **Deploy update** button to open its certificate-update dialog.
3. Select the certificate version to deploy. Confirm that the target, connection credentials, certificate format and other inputs shown on the page are correct; complete missing information in the application asset first.
4. Select **Deploy this certificate version** to submit the update. TLSFlow creates a deployment plan for this update and starts execution; when approval is enabled, the task remains pending until an approver approves it, and only then connects to the target.
5. During execution, follow the backup, installation, service refresh, and target verification stages.
6. Open the execution record and confirm the target read-back fingerprint and final status.


“Save” stores the plan; “Execute” changes the target. Do not edit a generated execution record. Update the application asset, credentials, format, or workflow, then create a new plan.

## Create an Automatic Update Plan

**Certificate Deployment → Automation** is for creating plans that run certificate updates automatically; it is not the entry point for a one-time manual deployment. Plans can run when a new certificate version is created, at a specified time, or under another trigger provided by the page.

1. Choose the trigger and the application assets it covers.
2. Set concurrency, failure threshold, and whether approval is required.
3. Save the automation plan and wait for its configured time or event.
4. Review each application’s success, failure, or exclusion reason in Run History and Execution Records.

Automation triggered by a new certificate version fixes the version selected at trigger time. A newer version created during approval does not replace the version in the current task.

## Choose a Workflow Template

Workflow templates describe the steps executed on a target. Open template details before selecting one and confirm supported platforms, required inputs, rollback support, and version. Updating a template does not change existing plans; new plans use the new version.

## Determine Whether It Really Succeeded

Only a passed “Target Read-back Verification” confirms that the service is using the new certificate. Upload or installation completion only proves that files were written.


If a task times out or shows “Result Unknown”, verify the current certificate through the business endpoint or target system before retrying or rolling back. When rollback is supported, use the rollback action in the execution record and run target verification again.
