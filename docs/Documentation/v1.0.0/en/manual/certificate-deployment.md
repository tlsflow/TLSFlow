---
title: Certificate Deployment
description: Certificate Deployment top-level menu and operation map for automation, workflow templates, and execution records
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
lastVerified: 2026-09-02
---

# Certificate Deployment

"Certificate Deployment" is the operation area for installing prepared certificates to target systems, including three pages: "Automation", "Workflow Templates", and "Execution Records".

> [Screenshot placeholder: Certificate Deployment menu and entries for Automation, Workflow Templates, and Execution Records]

## Complete Process for Manual Deployment

1. Initiate deployment from "Automation" or application asset entry, select application, target device, and certificate version to use.
2. Select deployment method or workflow, and fill in connection information, credentials, and output format required by the page.
3. Click "Pre-check/Dry Run" to first check permissions, target availability, certificate matching, and input completeness.
4. If the system has approval enabled, wait for approver to approve after submission; when approval is not enabled, you can execute directly.
5. Enter execution process and wait for backup, installation, service refresh, and verification to all complete.
6. Open execution record to confirm target read-back result, certificate fingerprint, and final status.

> [Screenshot placeholder: Deployment plan wizard highlighting application, certificate version, targets, and pre-check button]

Do not directly modify execution records that have already been generated. When changes are needed, return to application asset, credentials, workflow, or automation rules to modify, then create a new deployment plan.

## Using Automated Deployment

1. Go to "Certificate Deployment → Automation" and click "New Automation".
2. Select trigger method: manual run, scheduled run, or automatic run when certificate generates new version.
3. Select application assets to deploy, and narrow the scope by domain, environment, tag, or owner.
4. Set concurrency count, failure threshold, whether to execute pre-check first, and whether approval is required.
5. After saving, click "Run", or wait for the set time/event to trigger.
6. Go to "Execution Records" to view execution results for each application and reasons for exclusion.

Automation triggered by new certificate versions will use the version at trigger time. Even if another new version is generated during approval, the version will not be automatically changed.

## Selecting and Managing Workflow Templates

1. Go to "Certificate Deployment → Workflow Templates" and filter by name, applicable platform, or status.
2. Open template details and confirm the target systems it supports, required inputs, and whether it supports rollback.
3. Select the appropriate template version in application asset or deployment plan.
4. After template updates, existing plans still use the version selected at creation time; only new plans will see the new version.

## How to Determine Success at Deployment Stage

Deployment typically completes preparation, backup, installation, service refresh, and target verification in sequence. Only when "Target Read-back Verification" passes is deployment truly successful; just seeing "Upload Complete" does not mean the service is using the new certificate.

> [Screenshot placeholder: Step progress and target verification results in execution record]

If execution times out or status shows "Result Unknown", first log into the target system or access the business address to confirm the current certificate, then decide whether to retry or rollback, avoiding repeated writes. When rollback is supported, operate via the rollback entry provided in the execution record, and confirm target verification results again.
