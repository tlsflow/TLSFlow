---
title: Automation
description: Create certificate update plans that run automatically on new versions or schedules
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

Automation creates plans that run repeatable certificate updates according to rules. It processes application assets that are onboarded, have a certificate binding and have a usable deployment target; it does not install a certificate for the first time or add applications. To update one application immediately, return to **Asset Center → Applications** and select that application's **Deploy update** button instead of starting here.

## Create Automation

Before starting, please confirm: certificates have been imported and have available versions, application assets have been added, and target applications have been bound to certificates. Then go to "Certificate Deployment → Automation" and click "New Automation". The form is divided into three steps; you can use "Previous" and "Next" to return and check during the filling process.

### Step 1: Select Trigger Method

1. In **Trigger**, choose a certificate-version, one-time, recurring, on-demand or API trigger.
2. Enter the run time, recurrence or certificate-event sources requested by the page.
3. Select **Next**.


### Step 2: Determine Update Scope

1. In "Certificate Domain", check the domains that need to be processed. Domains come from registered certificate assets; if the list is empty, first go back to certificate management to import certificates.
2. Select "Update all associated application assets" to let the system find all bound targets under that domain at runtime; or select "Update only specified application assets", check targets from "Available Assets", then click "Add".
3. If scope adjustment is needed, check targets in "Selected Assets" and click "Remove", or click "Clear" to reselect. When selecting specified assets, keep at least one target.
4. View the execution capability prompt at the bottom of the page, confirm these targets have available deployment methods, then click "Next".


### Step 3: Set Execution Safety Controls

1. Fill in an easily identifiable automation name; description can specify responsible business, environment, and maintenance window.
2. Set "Concurrency". The larger the value, the more applications processed simultaneously, but the greater the pressure on target systems; it is recommended to start with a smaller value.
3. Set "Failure Count Threshold". When failures reach this count, the system will stop further propagation, making it easier to handle problem targets first.
4. Decide whether to check "Approval required before execution" according to organizational processes. Keeping approval for production environments is recommended.
5. Read "Configuration Summary", confirm trigger method, domains, and target scope are correct, then click "Save".


## Manage Automation

After saving, the following operations can be performed in the list:

- "Details": View current status, certificate domains, target scope, version strategy, concurrency, and approval settings.
- "Edit": Modify rules; a new configuration version is generated after saving.
- "Copy": Create a new rule based on existing rules, suitable for creating test environment copies.
- "Enable/Disable": Control whether the rule can continue to be run.
- "Run History": View overall progress of each run and processing results for each target.
- "Delete": Delete rules no longer in use. Before deletion, confirm there are no pending maintenance tasks.


## View Run Results

After opening a specific run, you can see trigger source, actually used certificate version, approval status, failure stage, and target snapshot. Expanding target details allows viewing current action, failure reason, and corresponding deployment plan or execution record entry. Target exclusion typically indicates no binding, target not deployable, environment mismatch, insufficient permissions, or target already has equivalent validity period; please correct source data and rerun, do not manually rewrite run results.

After resuming from approval pause, the system continues using targets and certificate version already determined for this run and will not automatically use versions added later. Notification delivery failure and certificate deployment results are recorded separately; notification failure will not revoke completed deployments.


## Notes for Use

- First validate with a small number of test targets, then expand to production scope.
- Certificate version and target scope are determined at run start; do not temporarily replace certificates or bindings during execution.
- For production environments, it is recommended to enable approval and set reasonable failure thresholds to avoid large-scale changes caused by single target exceptions.
- When run shows "Unknown" or external write timeout, do not immediately repeat execution; first confirm actual target status in execution records and audit.
