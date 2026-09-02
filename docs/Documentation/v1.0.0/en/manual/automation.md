---
title: Automation
description: Create deployment automation triggered by new certificate versions, scheduled, and manual triggers
docStatus: implemented
productVersion: v1.0.0
sourceLocale: zh-CN
locale: en-US
specRefs: []
codeRefs:
  - web/src/views/automations/AutomationsView.vue
  - backend/src/modules/automations
testRefs: []
lastVerified: 2026-09-02
---

# Automation

Automation is used to hand over repetitive certificate update work to the system to execute according to rules. It only processes application assets that have been managed and have certificate bindings established, and is not responsible for first-time certificate installation or adding new applications.

## Create Automation

Before starting, please confirm: certificates have been imported and have available versions, application assets have been added, and target applications have been bound to certificates. Then go to "Certificate Deployment → Automation" and click "New Automation". The form is divided into three steps; you can use "Previous" and "Next" to return and check during the filling process.

### Step 1: Select Trigger Method

1. In the "Trigger" dropdown box, select "On-Demand Execution".
2. Click "Next".

Screenshot placeholder: Automation creation window "Trigger" step, highlighting trigger method dropdown box and step progress.

### Step 2: Determine Update Scope

1. In "Certificate Domain", check the domains that need to be processed. Domains come from registered certificate assets; if the list is empty, first go back to certificate management to import certificates.
2. Select "Update all associated application assets" to let the system find all bound targets under that domain at runtime; or select "Update only specified application assets", check targets from "Available Assets", then click "Add".
3. If scope adjustment is needed, check targets in "Selected Assets" and click "Remove", or click "Clear" to reselect. When selecting specified assets, keep at least one target.
4. View the execution capability prompt at the bottom of the page, confirm these targets have available deployment methods, then click "Next".

Screenshot placeholder: Automation "Executor" step, showing certificate domain selector, all associated targets/specified targets options, and left-right asset selection areas.

### Step 3: Set Execution Safety Controls

1. Fill in an easily identifiable automation name; description can specify responsible business, environment, and maintenance window.
2. Set "Concurrency". The larger the value, the more applications processed simultaneously, but the greater the pressure on target systems; it is recommended to start with a smaller value.
3. Set "Failure Count Threshold". When failures reach this count, the system will stop further propagation, making it easier to handle problem targets first.
4. Decide whether to check "Approval required before execution" according to organizational processes. Keeping approval for production environments is recommended.
5. Read "Configuration Summary", confirm trigger method, domains, and target scope are correct, then click "Save".

Screenshot placeholder: Automation "Execution Safety Controls" step, showing name, concurrency, failure threshold, approval switch, and configuration summary.

## Manage Automation

After saving, the following operations can be performed in the list:

- "Details": View current status, certificate domains, target scope, version strategy, concurrency, and approval settings.
- "Edit": Modify rules; a new configuration version is generated after saving.
- "Copy": Create a new rule based on existing rules, suitable for creating test environment copies.
- "Enable/Disable": Control whether the rule can continue to be run.
- "Execute Now": Immediately open manual execution window.
- "Run History": View overall progress of each run and processing results for each target.
- "Delete": Delete rules no longer in use. Before deletion, confirm there are no pending maintenance tasks.

Screenshot placeholder: Automation list showing status, trigger method, target scope, last run time, and row operation menu.

## Manual Execution and Preview

1. Click "Execute Now" in automation row operations.
2. Select the certificate version to deploy. The system will resolve associated application assets according to the certificate this version belongs to.
3. First check "Asset Impact Preview", focusing on confirming match count, executable count, exclusion count, and prompts such as "Validity Period Shortening Risk" and "Current Certificate Missing".
4. When you want to stop subsequent processing if one target fails, check "Error interrupts workflow"; after confirming executable targets exist in preview, click "Start Execution".
5. After execution starts, go to "Run History" to view progress. When there are no executable targets, do not repeatedly click execute; instead, first correct certificate binding, target status, or permissions according to exclusion reasons.

Screenshot placeholder: Manual execution window showing certificate version dropdown, impact preview statistics, exclusion reasons, and "Error interrupts workflow" option.

## View Run Results

After opening a specific run, you can see trigger source, actually used certificate version, approval status, failure stage, and target snapshot. Expanding target details allows viewing current action, failure reason, and corresponding deployment plan or execution record entry. Target exclusion typically indicates no binding, target not deployable, environment mismatch, insufficient permissions, or target already has equivalent validity period; please correct source data and rerun, do not manually rewrite run results.

After resuming from approval pause, the system continues using targets and certificate version already determined for this run and will not automatically use versions added later. Notification delivery failure and certificate deployment results are recorded separately; notification failure will not revoke completed deployments.

Screenshot placeholder: Automation run history details showing run status, success/failure progress, failure stage, target details, and "View Deployment Plan/Execution Record" buttons.

## Notes for Use

- First validate with a small number of test targets, then expand to production scope.
- Certificate version and target scope are determined at run start; do not temporarily replace certificates or bindings during execution.
- For production environments, it is recommended to enable approval and set reasonable failure thresholds to avoid large-scale changes caused by single target exceptions.
- When run shows "Unknown" or external write timeout, do not immediately repeat execution; first confirm actual target status in execution records and audit.
